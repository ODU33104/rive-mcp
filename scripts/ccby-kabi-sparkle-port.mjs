// A REAL third-party Rive effect port, derived from the upstream authoring model,
// NOT a fresh imitation. Author: Bryl Lim, Kabi, CC BY 4.0.
// Source is downloaded in CI from a pinned upstream commit; only the hand-authored
// sparkle subset is admitted (no traced photo-based character art or third-party logo).
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve,join} from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {createRiv} from "../dist/rivWriter.js";
import {createStudioScene} from "./studio-foundry-scenes.mjs";

const PIN="2c61483875f1218ad3b83aa55a0df8441812e3fdeb2fab61338426d1d41798c2";
const RIG_PREFIX="kabiCCBY__";
const SRC="https://github.com/bryllim/kabi-mascot";
const SRC_COMMIT="7dee2abc2320fcc72f08c7064214ba9df84687f5";
const ACCEPTED=new Set(["luma","zenith"]);
export const TARGETS=Object.freeze([...ACCEPTED]);
const hash=x=>createHash("sha256").update(x).digest("hex");
function cubic(a,b,c,d,t){
 const v=1-t;
 return v*v*v*a+3*v*v*t*b+3*v*t*t*c+t*t*t*d;
}
export function cubicSvgPolygon(d,samples=10){
 // Use only the format actually present in the external Kabi sparkle.
 // Refuse unsupported SVG commands instead of silently altering imported geometry.
 if(typeof d!=="string"||!/^M/i.test(d)||!/Z$/i.test(d)||samples<6||samples>36)
  throw Error("Unsupported external Kabi path");
 const tokens=d.match(/[A-Za-z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi);
 if(!tokens)throw Error("Unparseable Kabi sparkle SVG");
 let i=0,pos=null,start=null,command=null;const pts=[];
 const num=()=>{if(i>=tokens.length||/^[a-z]$/i.test(tokens[i]))throw Error("Missing SVG coordinate");const x=Number(tokens[i++]);if(!Number.isFinite(x))throw Error("Invalid SVG coordinate");return x;};
 while(i<tokens.length){
  if(!/^[a-z]$/i.test(tokens[i]))throw Error("Expected SVG path command");
  command=tokens[i++];
  if(command==="M"){
   if(pos!==null)throw Error("Multiple contours not supported");
   pos={x:num(),y:num()};start={...pos};pts.push(pos);
  }else if(command==="C"){
   if(!pos)throw Error("Cubic without start point");
   const a={x:num(),y:num()},b={x:num(),y:num()},end={x:num(),y:num()};
   for(let step=1;step<=samples;step++){
    const t=step/samples;
    pts.push({x:cubic(pos.x,a.x,b.x,end.x,t),y:cubic(pos.y,a.y,b.y,end.y,t)});
   }
   pos=end;
  }else if(command==="Z"){
   if(i!==tokens.length||!start)throw Error("Unexpected SVG close");
  }else throw Error("Unsupported original SVG command: "+command);
 }
 if(pts.length<20||pts.length>200)throw Error("Lossy imported path");
 return pts;
}
const EASE={hold:"hold",easeOut:"ease-out",easeIn:"ease-in",easeInOut:"ease-in-out",back:"ease-out-back",linear:"linear"};
export function importKabiSparkles(modelBytes,targetId){
 if(!ACCEPTED.has(targetId))throw Error("Kabi celebration sparkle invalid for "+targetId);
 const input=Buffer.isBuffer(modelBytes)?modelBytes:Buffer.from(modelBytes);
 if(hash(input)!==PIN)throw Error("Kabi source model hash changed: stop unauthorized import");
 const model=JSON.parse(input.toString("utf8"));
 if(model.format!=="kabi-model@30"||model.artboard?.name!=="Kabi")
  throw Error("Unknown external model format");
 const sourceAnimation=model.animations.find(a=>a.name==="celebrate");
 if(!sourceAnimation)throw Error("Missing source-authored sparkle choreography");
 const sourceObjects=model.shapes.filter(x=>/^sparkle[1-5]$/.test(x.id)&&x.parent==="sparkles").sort((a,b)=>a.id.localeCompare(b.id));
 if(sourceObjects.length!==5)throw Error("Missing licensed original sparkle vector art");
 const srcRoot=model.nodes.find(x=>x.id==="sparkles");
 if(!srcRoot||srcRoot.parent!=="root")throw Error("Sparkles changed source hierarchy");
 const scene=createStudioScene(targetId);
 scene.groups.push({id:RIG_PREFIX+"root",parent:"hero",x:0,y:0,opacity:.92});
 const paths=[];
 const ids=new Map();
 for(const shape of sourceObjects){
  if(typeof shape.d!=="string"||!["sparkle","accent"].includes(shape.fill))
   throw Error("Unknown embedded vector data "+shape.id);
  const fill=model.palette[shape.fill];
  if(!/^#[0-9a-f]{6}$/i.test(fill))throw Error("Palette shape is unsupported");
  const points=cubicSvgPolygon(shape.d);
  const id=RIG_PREFIX+shape.id;
  ids.set(shape.id,id);
  scene.shapes.push({id,type:"polygon",parent:RIG_PREFIX+"root",
   x:(shape.x??0)*.48,y:(shape.y??0)*.48,z:115,
   points:points.map(p=>({x:p.x*.64,y:p.y*.64})),
   fill:{color:fill},opacity:1,scaleX:0,scaleY:0});
  paths.push({sourceId:shape.id,pathSha256:hash(Buffer.from(shape.d)),sourceMaterialToken:shape.fill,
    authoredLocal:{x:shape.x??0,y:shape.y??0},renderLocal:{x:(shape.x??0)*.48,y:(shape.y??0)*.48}});
 }
 // Import Kabi's REAL five sparkle rotation+scale keyframe tracks
 // The local timebase is translated into the target's timeline, not reinvented.
 const offsetFrame=151;
 const selected=sourceAnimation.tracks.filter(t=>ids.has(t.target)&&
  ["rotation","scaleX","scaleY"].includes(t.prop));
 if(selected.length!==15)throw Error("Expected 15 independently authored sparkle motion lanes");
 const recorded=[];
 for(const source of selected){
  const target=ids.get(source.target);
  const keys=source.keys.map(([time,value,easing])=>{
   if(!Number.isFinite(time)||!Number.isFinite(value)||!(easing in EASE))
    throw Error("Unknown upstream authored keyframe");
   return {frame:offsetFrame+Math.round(60*time),value,easing:EASE[easing]};
  });
  if(keys.some((k,i)=>k.frame>scene.animations[0].duration||
   (i>0&&k.frame<=keys[i-1].frame)))throw Error("Imported timing not valid");
  scene.animations[0].tracks.push({target,property:source.prop,keyframes:keys});
  recorded.push({source:source.target+"."+source.prop,destination:target+"."+source.prop,originalKeys:source.keys.length});
 }
 const all=[...scene.groups,...scene.shapes,...scene.texts],nodes=new Set(all.map(n=>n.id));
 if(nodes.size!==all.length||all.some(x=>x.parent&&!nodes.has(x.parent)))
  throw Error("External art broke actual authored hierarchy");
 const before=createRiv(createStudioScene(targetId)),after=createRiv(scene);
 if((before.warnings??[]).length||(after.warnings??[]).length)
  throw Error("Warnings from native Rive writer");
 const a=Buffer.from(before.bytes),b=Buffer.from(after.bytes);
 if(a.equals(b)||b.subarray(0,4).toString("ascii")!=="RIVE")
  throw Error("No native Rive output change");
 return {before:a,after:b,scene,evidence:{
  schema:"ccby-source-component-transfer/v1",
  originalAuthor:"Bryl Lim",source: SRC,commit:SRC_COMMIT,
  license:"CC-BY-4.0",attribution:"Kabi sparkle shapes and celebrate timing by Bryl Lim, CC BY 4.0; scaled and reparented for the host Studio scene",
  adaptedSubset:"Only five original hand-authored sparkle paths; excludes traced character / branded T-shirt logo",
  originalSourceFormat:model.format,sourceFile:"dist/kabi.model.json",sourceSha256:PIN,
  targetScene:targetId,importedShapes:paths,originalMotionTracks:recorded,
  transform:{parent:"hero",shapeCoordinatesScale:.48,sourcePathScale:.64,trackTimeShiftFrames:offsetFrame},
  rightsReview:"project claims CC BY 4.0 for original art; embedded traced figure not imported",
  qualityReview:"NOT_EVALUATED",sourceRightsStatus:"SCOPE_RESTRICTED_REVIEW",
  editorAbility:"native Rive vectors/keyframes, original third-party model retained",
  marketPlaceCounter:"NOT_MARKETPLACE; genuine CC BY external source"
 }};
}
export async function renderExternalSparkles(inputFile,targetId,dir){
 const input=readFileSync(resolve(inputFile));
 const {before,after,evidence}=importKabiSparkles(input,targetId);
 const out=resolve(dir);mkdirSync(out,{recursive:true});
 writeFileSync(join(out,targetId+"-original.riv"),before);
 writeFileSync(join(out,targetId+"-kabi-sparkles.riv"),after);
 const [{RiveHost},{PAGE_SCRIPT}]=await Promise.all([
   import("../dist/riveHost.js"),import("../dist/pageScript.js")
 ]);
 const host=new RiveHost(PAGE_SCRIPT);
 try{
  const diffs=[];
  for(const t of [2.5,2.8,3.1,3.3]){
   const d=await host.visualDiff(before,after,{animation:"Reveal",time:t,width:720,height:460,threshold:12});
   diffs.push({time:t,diffPixels:d.diffPixels,changedPercent:+(100*d.diffPixels/d.totalPixels).toFixed(4)});
  }
  // Require true visual changes, not byte inequality or invisible source import.
  if(!diffs.some(x=>x.changedPercent>.05))throw Error("Imported external sparkle doesn't display visibly");
  const frameCount=46;
  const inspected=await host.inspect(after);
  if(!inspected.artboards.some(ab=>ab.animations.some(a=>a.name==="Reveal")))
   throw Error("Imported Rive scene didn't load");
  const frames=await host.renderFrames(after,{animation:"Reveal",startTime:0,width:720,frameCount,fps:10,format:"png"});
  if(frames.frames.length!==frameCount)throw Error("Incorrect native frame count");
  for(const [i,s] of frames.frames.entries()){
   const b=Buffer.from(s,"base64");
   if(b.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")throw Error("Invalid runtime frame");
   writeFileSync(join(out,"frame-"+String(i).padStart(3,"0")+".png"),b);
  }
  writeFileSync(join(out,"imported-sparkle-poster.png"),Buffer.from(frames.frames[31],"base64"));
  const receipt={...evidence,officialRuntime:"PASS",realNativeRive:true,diffs,
   outputBeforeSha256:hash(before),outputAfterSha256:hash(after),
   beautifulOrSurprising:"NOT_EVALUATED"};
  writeFileSync(join(out,"source-import-evidence.json"),JSON.stringify(receipt,null,2)+"\n");
  console.log(JSON.stringify({targetId,importedVectors:5,importedTracks:15,frames:46,diffs}));
  return receipt;
 }finally{await host.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const file=process.argv[2],target=process.argv[3],out=process.argv[4]??"test/tmp/ccby-sparkle/"+target;
 if(!TARGETS.includes(target))throw Error("Usage: node scripts/ccby-kabi-sparkle-port.mjs <model.json> <luma|zenith> [out]");
 if(process.argv.includes("--render"))await renderExternalSparkles(file,target,out);
 else{
  const v=importKabiSparkles(readFileSync(file),target);
  mkdirSync(out,{recursive:true});
  writeFileSync(join(out,target+"-kabi-sparkles.riv"),v.after);
  writeFileSync(join(out,"source-import-evidence.json"),JSON.stringify(v.evidence,null,2)+"\n");
  console.log(JSON.stringify({target,shapes:v.evidence.importedShapes.length,tracks:v.evidence.originalMotionTracks.length}));
 }
}