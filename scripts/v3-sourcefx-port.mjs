// Third-party SVG/SMIL -> genuinely editable native Rive vector+keyframe imports.
// Narrow compiler: fail on unsupported SVG, animation semantics or changed pinned source.
// Licensed source originals and license text live under data/v3-sourcefx/upstream/.
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve,join,dirname} from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath,pathToFileURL} from "node:url";
import {performance} from "node:perf_hooks";
import {createRiv} from "../dist/rivWriter.js";
import {createStudioScene} from "./studio-foundry-scenes.mjs";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const registry=JSON.parse(readFileSync(join(ROOT,"data/v3-sourcefx/source-registry.v1.json"),"utf8"));
const hash=b=>createHash("sha256").update(b).digest("hex");
const blobSha=b=>{const v=Buffer.isBuffer(b)?b:Buffer.from(b);return createHash("sha1").update(Buffer.concat([Buffer.from("blob "+v.length+"\0"),v])).digest("hex");};
export const PORT_IDS=Object.freeze(registry.ports.map(p=>p.id));
const allowedTags=new Set(["svg","g","circle","rect","animate"]);
const allowAttrs=new Set(["r","cx","cy","x","y","width","height","opacity","fill-opacity","stroke-opacity"]);
const num=v=>{const n=Number(v);if(!Number.isFinite(n))throw Error("Non-finite source number: "+v);return n;};
function attributes(tag){
 const out={};const text=tag.slice(tag.indexOf(" ")+1).replace(/\/?>$/,"");
 for(const m of text.matchAll(/([:\w-]+)\s*=\s*"([^"]*)"/g)){if(Object.hasOwn(out,m[1]))throw Error("Duplicate SVG attribute");out[m[1]]=m[2];}
 return out;
}
function translate(value){
 if(!value)return [0,0];
 const m=/^translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)$/.exec(value);
 if(!m)throw Error("Unsupported inherited SVG transform "+value);
 return [num(m[1]),num(m[2])];
}
export function parsePinnedSVG(xml){
 if(typeof xml!=="string"||xml.includes("<!DOCTYPE")||xml.includes("<script")||xml.includes("<image")||xml.includes("href="))
  throw Error("Unsafe or unsupported external SVG");
 const cleaned=xml.replace(/<!--[\s\S]*?-->/g,"").trim();
 const tokens=[...cleaned.matchAll(/<\/?([a-zA-Z][\w:-]*)\b[^>]*>/g)];
 if(!tokens.length||tokens[0][1]!=="svg")throw Error("No SVG root");
 // Only these selected source files are supported; no opaque SVG or skipped geometry.
 const left=cleaned.replace(/<[^>]*>/g,"").trim();if(left)throw Error("Unparsed SVG text");
 const stack=[],shapes=[],idMap=new Map();
 let viewport;
 for(const t of tokens){
  const raw=t[0],name=t[1],closing=raw.startsWith("</"),self=raw.endsWith("/>");
  if(!allowedTags.has(name))throw Error("Unsupported SVG element "+name);
  if(closing){const top=stack.pop();if(!top||top.name!==name)throw Error("Malformed SVG nesting");continue;}
  const attrs=attributes(raw);
  if(name==="svg"){
   if(viewport)throw Error("Multiple SVG roots");
   const v=(attrs.viewBox||"").trim().split(/[\s,]+/).map(num);
   if(v.length!==4||v[0]!==0||v[1]!==0||v[2]<=0||v[3]<=0)throw Error("Unsupported SVG viewport");
   viewport={width:v[2],height:v[3]};
  }
  if(name==="circle"||name==="rect"){
   const inherited=Object.assign({},...stack.map(s=>s.attrs),attrs);
   let dx=0,dy=0;
   for(const s of stack){const a=translate(s.attrs.transform);dx+=a[0];dy+=a[1];}
   const base=name==="circle"
    ?{cx:num(attrs.cx),cy:num(attrs.cy),r:num(attrs.r)}
    :{x:num(attrs.x),y:num(attrs.y),width:num(attrs.width),height:num(attrs.height)};
   const shape={kind:name,base,paint:inherited,translate:[dx,dy],animations:[]};
   shapes.push(shape);
   stack.push({name,attrs,shape});
  }else if(name==="animate"){
   const owner=stack.at(-1)?.shape;
   if(!owner||!self)throw Error("Animation must belong to a source shape");
   if(!allowAttrs.has(attrs.attributeName))throw Error("Unsupported SMIL property "+attrs.attributeName);
   if(!attrs.values||!attrs.dur)throw Error("Source animation has no authored values or duration");
   const values=attrs.values.split(";").map(num);
   if(values.length<2)throw Error("Insufficient original keyframes");
   const dur=num(attrs.dur.replace(/s$/,""));
   if(dur<=0)throw Error("Invalid SMIL duration");
   const times=attrs.keyTimes?attrs.keyTimes.split(";").map(num):values.map((_,i)=>i/(values.length-1));
   if(times.length!==values.length||times[0]!==0||times.at(-1)!==1||
       times.some((v,i)=>v<0||v>1||(i>0&&v<=times[i-1])))
    throw Error("Invalid SMIL key times");
   const easing=attrs.keySplines?attrs.keySplines.split(";").map(x=>x.split(/[,\s]+/).map(num)):null;
   if(easing&&(easing.length!==values.length-1||easing.some(x=>x.length!==4||x.some(n=>n<0||n>1))))
    throw Error("SMIL spline cannot be transferred");
   const calc=attrs.calcMode||"linear";
   if(!["linear","spline"].includes(calc)||calc==="spline"&&!easing)throw Error("Unsupported SMIL interpolation");
   const anim={id:attrs.id||null,property:attrs.attributeName,begin:attrs.begin||"0",duration:dur,values,times,easing,repeat:attrs.repeatCount==="indefinite"};
   if(anim.id){if(idMap.has(anim.id))throw Error("Duplicate external animation ID");idMap.set(anim.id,anim);}
   owner.animations.push(anim);
  }else if(!self){stack.push({name,attrs});}
 }
 if(stack.length||!viewport||!shapes.length||shapes.some(s=>!s.animations.length))
  throw Error("Malformed or non-animated source SVG");
 const memo=new Map();
 const beginOf=(a,depth=0)=>{
  if(depth>20)throw Error("Cyclic SMIL begin reference");
  if(memo.has(a))return memo.get(a);
  const candidates=a.begin.split(";").map(s=>s.trim());
  let resolved=null;
  for(const token of candidates){
   if(/^[-\d.]+s?$/.test(token)){resolved=num(token.replace(/s$/,""));break;}
   const m=/^([\w-]+)\.begin([+-][\d.]+s)?$/.exec(token);
   if(m&&idMap.has(m[1])){resolved=beginOf(idMap.get(m[1]),depth+1)+num((m[2]||"+0").replace(/s$/,""));break;}
  }
  if(resolved===null)throw Error("Unresolvable first cycle SMIL: "+a.begin);
  memo.set(a,resolved);return resolved;
 };
 for(const s of shapes)for(const a of s.animations)a.start=beginOf(a);
 return {viewport,shapes,animations:[...shapes.flatMap(s=>s.animations)],idMap};
}
function cycleFromSource(parsed){
 for(const a of parsed.animations){
  for(const token of a.begin.split(";")){
   const m=/^([\w-]+)\.end([+-][\d.]+s)?$/.exec(token.trim());
   if(m&&parsed.idMap.has(m[1])){
    const predecessor=parsed.idMap.get(m[1]);
    return predecessor.start+predecessor.duration+num((m[2]||"+0").replace(/s$/,""));
   }
  }
 }
 const durations=[...new Set(parsed.animations.map(a=>a.duration))];
 if(parsed.animations.every(a=>a.repeat)&&durations.length===1)return durations[0];
 throw Error("Cannot determine original author repeat cycle");
}
const uniqueTrack=(tracks,t)=>{
 const key=t.target+"."+t.property;
 if(tracks.some(a=>a.target+"."+a.property===key))throw Error("Duplicate target property: "+key);
 if(t.keyframes.length<2)return;
 tracks.push(t);
};
function valuesFor(s,property){
 return s.animations.find(a=>a.property===property)||null;
}
function timingToFrames(a,periodSec,property,scale,transform,limit){
 // Transfer source key values, keyTimes and 4-point splines verbatim where visible.
 // First negative pulse has an initial partial cycle; its off-screen pre-roll is quarantined.
 const keys=new Map();
 for(let cycle=0;cycle<Math.ceil(limit/60/periodSec)+2;cycle++){
  const begin=a.start+cycle*periodSec;
  for(let i=0;i<a.values.length;i++){
   const time=begin+a.times[i]*a.duration,frame=Math.round(time*60);
   if(frame<0||frame>limit)continue;
   const value=transform(a.values[i])*scale;
   const ease=a.easing&&i<a.easing.length?a.easing[i]:"linear";
   keys.set(frame,{frame,value,easing:ease});
  }
 }
 const out=[...keys.values()].sort((a,b)=>a.frame-b.frame);
 if(!out.length)throw Error("Animation no keyframes in Rive timeline: "+property);
 if(out[0].frame>0)out.unshift({frame:0,value:out[0].value,easing:"hold"});
 return out;
}
function makeTracks(s,id,scale,vp,period,duration){
 const out=[];
 const push=(p,sourceProp,fn,mul=1)=>{const a=valuesFor(s,sourceProp);if(a)uniqueTrack(out,{target:id,property:p,keyframes:timingToFrames(a,period,sourceProp,mul,fn,duration)});};
 if(s.kind==="circle"){
  push("x","cx",v=>v-vp.width/2+s.translate[0],scale);
  push("y","cy",v=>v-vp.height/2+s.translate[1],scale);
  const r=valuesFor(s,"r");
  if(r){const keys=timingToFrames(r,period,"r",2*scale,x=>x,duration);
   uniqueTrack(out,{target:id,property:"width",keyframes:keys});
   uniqueTrack(out,{target:id,property:"height",keyframes:structuredClone(keys)});}
 }else{
  // SVG rect uses top-left; Rive rect uses center. Respect moving origin AND size.
  for(const [pos,size,center,viewSize,offset] of [["x","width","x",vp.width,s.translate[0]],["y","height","y",vp.height,s.translate[1]]]){
   const a=valuesFor(s,pos),b=valuesFor(s,size),template=a||b;
   if(template){
    if(a&&b&&(JSON.stringify(a.times)!==JSON.stringify(b.times)||a.duration!==b.duration||a.start!==b.start))
     throw Error("Incompatible rect origin/size timings");
    const vals=template.values.map((_,i)=>{
     const origin=a?a.values[i]:s.base[pos],width=b?b.values[i]:s.base[size];
     return origin+width/2-viewSize/2+offset;
    });
    const composed={...template,values:vals};
    uniqueTrack(out,{target:id,property:center,keyframes:timingToFrames(composed,period,center,scale,x=>x,duration)});
   }
   push(size,size,x=>x,scale);
  }
 }
 for(const p of ["opacity","fill-opacity","stroke-opacity"])push("opacity",p,x=>x,1);
 return out;
}
export function importSourceFx(id,opts={}){
 const spec=registry.ports.find(x=>x.id===id);
 if(!spec)throw Error("Unknown V3 source effect: "+id);
 const family=registry.families[spec.family],pin=registry.pinning.find(x=>x.family===spec.family&&x.path===spec.file);
 if(!family||!pin||family.license!=="MIT")throw Error("Uncleared third-party source rights");
 const raw=readFileSync(join(ROOT,pin.local));
 if(blobSha(raw)!==pin.gitBlobSha)throw Error("Original source changed SHA1 Git blob: "+pin.local);
 const license=readFileSync(join(ROOT,"data/v3-sourcefx/upstream/"+spec.family+"/"+family.licensePath.split("/").pop()),"utf8");
 if(!license.includes("The MIT License")||!license.includes(family.author))
  throw Error("MIT attribution text missing");
 const parsed=parsePinnedSVG(raw.toString("utf8"));
 const cycle=cycleFromSource(parsed);
 if(Math.abs(cycle-spec.periodSec)>.000001)throw Error("Original technique cycle changed");
 const scene=createStudioScene(spec.host);
 const before=createRiv(createStudioScene(spec.host));
 const ns="v3_sourcefx__"+id.replace(/-/g,"_");
 scene.groups.push({id:ns,parent:"hero",x:spec.offset[0],y:spec.offset[1],opacity:1});
 const sceneTracks=scene.animations[0].tracks,sourceIds=[],sourceDetails=[];
 for(const [index,s] of parsed.shapes.entries()){
  const sid=ns+"__"+index,base=s.base,size=spec.size,v=parsed.viewport;
  const x=s.kind==="circle"?base.cx:base.x+base.width/2;
  const y=s.kind==="circle"?base.cy:base.y+base.height/2;
  const width=s.kind==="circle"?2*base.r:base.width;
  const height=s.kind==="circle"?2*base.r:base.height;
  const fill=s.paint.fill==="none"?null:{color:spec.family==="utk"?"#FBE9BB":(s.paint.fill&&s.paint.fill!=="none"?s.paint.fill:"#FFFFFF")};
  const stroke=(s.paint.stroke&&s.paint.stroke!=="none")?
   {color:s.paint.stroke,thickness:num(s.paint["stroke-width"]||1)*size}:undefined;
  if(!fill&&!stroke)throw Error("No paint in original SMIL geometry");
  const obj={id:sid,type:s.kind==="circle"?"ellipse":"rect",parent:ns,
   x:(x+s.translate[0]-v.width/2)*size,y:(y+s.translate[1]-v.height/2)*size,
   width:width*size,height:height*size,z:115+index,opacity:num(s.paint.opacity||s.paint["fill-opacity"]||s.paint["stroke-opacity"]||1),
   ...(fill?{fill}:{}),...(stroke?{stroke}:{}),
   ...(s.kind==="rect"?{cornerRadius:0}:{})};
  scene.shapes.push(obj);
  const tracks=makeTracks(s,sid,size,v,cycle,scene.animations[0].duration);
  if(!tracks.length)throw Error("No source-authored motion tracks");
  sceneTracks.push(...tracks);
  sourceIds.push(sid);
  sourceDetails.push({id:sid,kind:s.kind,sourceBase:s.base,
   authoredSMIL:s.animations.map(a=>({property:a.property,duration:a.duration,begin:a.begin,values:a.values,keyTimes:a.times,keySplines:a.easing})),
   importedTracks:tracks.map(t=>({property:t.property,keys:t.keyframes.length}))});
 }
 const a=createRiv(scene);
 if((a.warnings||[]).length||(before.warnings||[]).length)
  throw Error("Native Rive warnings: "+(a.warnings||[]).join("; "));
 const original=Buffer.from(before.bytes),after=Buffer.from(a.bytes);
 if(after.subarray(0,4).toString("ascii")!=="RIVE"||original.equals(after))
  throw Error("Real native RIVE effect binary was not produced");
 const names=new Set([...scene.groups,...scene.shapes,...scene.texts].map(x=>x.id));
 if(names.size!==scene.groups.length+scene.shapes.length+scene.texts.length)
  throw Error("Source import ID collisions");
 const laneIds=sceneTracks.map(t=>t.target+"."+t.property);
 if(new Set(laneIds).size!==laneIds.length)throw Error("Animation lane collision");
 return {id,scene,before:original,after,raw,evidence:{
  schema:"v3-sourcefx-import/v1",sourceId:id,sourceFamily:spec.family,sourceUrl:"https://github.com/"+family.repo+"/blob/"+family.commit+"/"+spec.file,
  author:family.author,license:"MIT",licenseFile:family.licensePath,commit:family.commit,
  sourceSha256:hash(raw),sourceGitBlobSha:pin.gitBlobSha,sourcePath:spec.file,
  embeddedAssets:{fonts:[],images:[],scripts:[],externalDependencies:[]},
  originalFormat:"editable SVG with SMIL authored keyframes",destinationFormat:"editable native Rive geometry and keyframes",
  changes:["SVG shape center coordinates reparented to Studio hero", "Scale/position adapted for host composition",
   ...(spec.family==="utk"?["Black SVG paint recolored pale gold for dark host contrast"]:[]),
   "Author keyTimes and source cubic keySplines preserved, repeated within 270-frame host timeline",
   "Negative pre-roll keyframes omitted before destination t=0"],
  sourceNodes:sourceDetails,originalCycleSec:cycle,semanticFit:spec.semantic,
  importedIds:sourceIds,sourceTrackCount:parsed.animations.length,
  outputBeforeSha256:hash(original),outputAfterSha256:hash(after),
  featherShaderSupport:"NOT_ATTEMPTED; no feather/shader claimed on Canvas renderer",
  independentAesthetics:"NOT_EVALUATED",editorClickThrough:"NOT_EVALUATED",
  sourceRights:"MIT source+license pinned; no third-party image/font/script included",
  visiblePixelImpact:"NOT_TESTED_UNTIL_OFFICIAL_RUNTIME"}};
}
export async function renderSourceFx(id,outdir){
 const v=importSourceFx(id),dir=resolve(outdir);mkdirSync(dir,{recursive:true});
 const outputPrefix=id;
 writeFileSync(join(dir,outputPrefix+"-editable-native.riv"),v.after);
 writeFileSync(join(dir,outputPrefix+"-host-baseline.riv"),v.before);
 writeFileSync(join(dir,outputPrefix+"-source-original.svg"),v.raw);
 const [{RiveHost},{PAGE_SCRIPT},{chromium}]=await Promise.all([
  import("../dist/riveHost.js"),import("../dist/pageScript.js"),import("playwright-core")
 ]);
 const host=new RiveHost(PAGE_SCRIPT);let browser;
 try{
  const info=await host.inspect(v.after);
  if(!info.artboards.some(ab=>ab.animations.some(an=>an.name==="Reveal")))
   throw Error("Official runtime did not load editable native Rive animation");
  const times=[.8,1.15,1.55,2.1,2.65];
  const diffs=[];
  const start=performance.now();
  for(const [index,time] of times.entries()){
   const d=await host.visualDiff(v.before,v.after,{animation:"Reveal",time,width:720,height:460,threshold:12});
   const changedPercent=100*d.diffPixels/d.totalPixels;
   const bytes=Buffer.from(d.diffImage,"base64");
   if(bytes.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")throw Error("Invalid native impact PNG");
   writeFileSync(join(dir,"diff-"+String(index).padStart(2,"0")+".png"),bytes);
   diffs.push({time,changedPercent:+changedPercent.toFixed(5),pixels:d.diffPixels,sha256:hash(bytes)});
  }
  if(diffs.filter(d=>d.changedPercent>=.05).length<5)
   throw Error("Native import does not impact at least five frames by 0.05%: "+JSON.stringify(diffs));
  const renderStarted=performance.now();
  const sequence=await host.renderFrames(v.after,{animation:"Reveal",startTime:0,frameCount:46,fps:10,width:720,format:"png"});
  const durationMs=performance.now()-renderStarted;
  if(sequence.frames.length!==46)throw Error("Missing official native PNG sequence");
  for(const [index,b64] of sequence.frames.entries()){
   const bytes=Buffer.from(b64,"base64");
   if(bytes.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")throw Error("Invalid source FX Rive PNG frame");
   writeFileSync(join(dir,"frame-"+String(index).padStart(3,"0")+".png"),bytes);
  }
  // An independent browser SVG playback is SOURCE evidence, never native Rive evidence.
  browser=await chromium.launch({headless:true,executablePath:process.env.RIVE_MCP_CHROME||undefined,args:["--no-sandbox"]});
  const page=await browser.newPage({viewport:{width:256,height:256},deviceScaleFactor:1});
  const sourceDoc='<html><body style="margin:0;background:#24303e;display:flex;align-items:center;justify-content:center;width:256px;height:256px">'+v.raw.toString("utf8").replace("<svg ","<svg style=\"width:180px;height:180px\" ")+"</body></html>";
  await page.setContent(sourceDoc);
  // Browser screenshots of the actual original SVG only; no raster derivative is imported.
  const sourceOriginalHashes=[];
  for(let i=0;i<5;i++){
   await page.evaluate(time=>{
    const svg=document.querySelector("svg");
    if(!svg||typeof svg.setCurrentTime!=="function"||typeof svg.pauseAnimations!=="function")
      throw Error("SMIL source-time control unavailable; do not fabricate original frames");
    svg.pauseAnimations();svg.setCurrentTime(time);
   },i*v.evidence.originalCycleSec/5);
   const shot=await page.screenshot({type:"png"});
   sourceOriginalHashes.push(hash(shot));
   writeFileSync(join(dir,"source-original-"+String(i).padStart(2,"0")+".png"),shot);
  }
  if(new Set(sourceOriginalHashes).size<3)
   throw Error("Original source playback not visibly animated across five sampled frames");
  const report={...v.evidence,officialRuntime:"PASS",officialRuntimePackage:"@rive-app/canvas-advanced",
    actualNativePNGFrames:46,impactAtFiveTimes:diffs,sourceBrowserOriginalCapture:true,sourceOriginalFrameHashes,
    performance:{impactChecksWallMs:Math.round(performance.now()-start),nativeFrameSequenceWallMs:Math.round(durationMs),
      nativeFrames:46,outputRivBytes:v.after.length,outputRivSha256:hash(v.after),benchmarkEnvironment:"GitHub Actions ephemeral Ubuntu runner, wall-clock only"},
    originalAssetPolicy:"SVG source captured in browser; not represented as original Rive program",
    beautyReview:"NOT_EVALUATED",semanticReview:"SPECIFICATION_ONLY; MANUAL_REVIEW_REQUIRED"};
  writeFileSync(join(dir,"sourcefx-receipt.json"),JSON.stringify(report,null,2)+"\n");
  return report;
 }finally{if(browser)await browser.close();await host.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const id=process.argv[2],out=process.argv[3]||"test/tmp/v3-sourcefx/"+id;
 if(!PORT_IDS.includes(id))throw Error("Usage: node scripts/v3-sourcefx-port.mjs <source-id> <out-dir> [--render]");
 if(process.argv.includes("--render")){
  const v=await renderSourceFx(id,out);
  console.log(JSON.stringify({id,officialRuntime:v.officialRuntime,maxImpact:Math.max(...v.impactAtFiveTimes.map(d=>d.changedPercent))}));
 }else{
  const v=importSourceFx(id);mkdirSync(out,{recursive:true});
  writeFileSync(join(out,id+".riv"),v.after);
  writeFileSync(join(out,"sourcefx-receipt.json"),JSON.stringify(v.evidence,null,2)+"\n");
  console.log(JSON.stringify({id,importedNodes:v.evidence.importedIds.length,tracks:v.evidence.sourceTrackCount}));
 }
}
