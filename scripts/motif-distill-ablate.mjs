// Self-authored two-domain causal interventions. Requires: npm run build.
// node scripts/motif-distill-ablate.mjs test/tmp/motif-distillation --render --gif
// Native editable .riv outputs, not PNG compositions masquerading as Rive sources.
import {mkdirSync,writeFileSync,readFileSync} from "node:fs";
import {resolve,join,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {createRiv} from "../dist/rivWriter.js";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const sha=b=>createHash("sha256").update(b).digest("hex");
export const MOTIFS=["detail-after-hero","material-glint","shadow-follows-object"];
export const DOMAINS=["instrument","parcel-card"];
const frames=[0,12,45,65,90];
const animTrack=(target,property,values)=>({target,property,
 keyframes:values.map(([frame,value,easing])=>({frame,value,...(easing?{easing}:{})}))});
const box=(id,x,y,width,height,color,parent,z=5,r=0)=>({
 id,type:"rect",x,y,width,height,parent,z,cornerRadius:r,fill:{color}});
const disc=(id,x,y,width,height,color,parent,z=5)=>({
 id,type:"ellipse",x,y,width,height,parent,z,fill:{color}});
const glyph=(id,points,color,parent,z=5)=>({
 id,type:"polygon",parent,z,x:0,y:0,points,closed:false,
 stroke:{color,thickness:5,cap:"round",join:"round"}});
export function makeIntervention(domain,motif,ablate=false){
 if(!DOMAINS.includes(domain)||!MOTIFS.includes(motif))throw Error("Unsupported trial");
 const A=domain==="instrument", cx=244, y=A?160:157;
 const groups=[
  {id:"hero",x:cx,y,opacity:1,scaleX:1,scaleY:1},
  {id:"shadow",x:cx+12,y:y+99,opacity:0.7},
  {id:"glint",x:cx,y,opacity:0},
  {id:"detail",x:cx,y:A?283:267,opacity:0}
 ];
 const shapes=[box("backdrop",240,160,480,320,A?"#0B1824":"#17172B",undefined,0),
  disc("shadow-haze",0,0,A?230:252,28,"#04070E","shadow",1)];
 if(A){
  shapes.push(disc("case",0,0,216,216,"#B8CBD4","hero",5),
   disc("bezel",0,0,196,196,"#233746","hero",6),
   disc("dial",0,0,174,174,"#101E2D","hero",7),
   disc("pivot",0,0,23,23,"#EAD3A0","hero",10),
   glyph("needle",[{x:-7,y:10},{x:0,y:0},{x:45,y:-38}],"#F6C77A","hero",9),
   box("detail-rule",0,0,145,5,"#DAAD66","detail",11,2),
   disc("glint-mark",-60,-62,28,13,"#E5F5FF","glint",12));
 }else{
  shapes.push(box("parcel-panel",0,0,282,187,"#E5E7F3","hero",5,21),
   box("parcel-outline",0,-11,155,105,"#665C86","hero",6,12),
   box("parcel-label",0,-15,128,61,"#F4CB85","hero",7,8),
   glyph("route-mark",[{x:-25,y:-19},{x:-3,y:5},{x:26,y:-30}],"#2F405C","hero",9),
   box("detail-rule",0,0,220,8,"#F4CB85","detail",11,4),
   disc("glint-mark",-85,-78,34,17,"#FFFFFF","glint",12));
 }
 const baseHero=[[0,cx+65],[12,cx+65,"ease-in-out"],[48,cx,"ease-out"],[90,cx]];
 const shadowFollow=[[0,cx+77],[12,cx+77,"ease-in-out"],[48,cx+12,"ease-out"],[90,cx+12]];
 const shadowStationary=[[0,cx+12],[90,cx+12]];
 const detailDelayed=[[0,0],[47,0,"emphasized-decel"],[72,1],[90,1]];
 const detailImmediate=[[0,1],[90,1]];
 const glintPulse=[[0,0],[44,0,"ease-in-out"],[61,0.9,"ease-out"],[82,0],[90,0]];
 const glintMissing=[[0,0],[90,0]];
 const tracks=[
  animTrack("hero","x",baseHero),
  animTrack("hero","opacity",[[0,0],[12,0,"emphasized-decel"],[51,1],[90,1]]),
  animTrack("shadow","x",motif==="shadow-follows-object"&&ablate?
    shadowStationary:shadowFollow),
  animTrack("detail","opacity",motif==="detail-after-hero"&&ablate?
    detailImmediate:detailDelayed),
  animTrack("glint","opacity",motif==="material-glint"&&ablate?
    glintMissing:glintPulse)
 ];
 const scene={artboard:{name:A?"CausalInstrument":"CausalParcelCard",width:480,height:320},
  groups,shapes,animations:[{name:"Flow",fps:60,duration:91,loop:"oneShot",tracks}],
  stateMachine:{name:"CausalFlow",states:[{name:"Trial",animation:"Flow"}],
   transitions:[{from:"entry",to:"Trial"}]}};
 return {scene,intervention:{motif,domain,ablation:ablate,
  removed:motif==="detail-after-hero"?"post-hero-detail-delay":
   motif==="material-glint"?"specular-highlight-pulse":"shadow-x-attachment",
  changedTracks:[motif==="detail-after-hero"?"detail.opacity":
   motif==="material-glint"?"glint.opacity":"shadow.x"],
  allOtherTracksIdenticalToControl:true}};
}
function interpolate(track,frame){
 const points=track.keyframes;
 if(frame<=points[0].frame)return points[0].value;
 for(let i=1;i<points.length;i++){
  if(frame<=points[i].frame){
   const a=points[i-1],b=points[i];
   return a.value+(b.value-a.value)*(frame-a.frame)/(b.frame-a.frame);
  }
 }
 return points.at(-1).value;
}
function sample(scene,target,prop,frame){
 return interpolate(scene.animations[0].tracks.find(t=>t.target===target&&t.property===prop),frame);
}
export function measureIntervention(domain,motif){
 const control=makeIntervention(domain,motif,false).scene;
 const ablation=makeIntervention(domain,motif,true).scene;
 let metric,controlValue,ablationValue,units;
 if(motif==="detail-after-hero"){
  metric="premature-detail-opacity-frame-25";units="alpha";
  controlValue=sample(control,"detail","opacity",25);
  ablationValue=sample(ablation,"detail","opacity",25);
 }else if(motif==="material-glint"){
  metric="specular-opacity-frame-61";units="alpha";
  controlValue=sample(control,"glint","opacity",61);
  ablationValue=sample(ablation,"glint","opacity",61);
 }else{
  metric="maximum-shadow-offset-error-relative-to-hero";units="local-artboard-px";
  const distance=scene=>Math.max(...frames.map(f=>Math.abs(
   sample(scene,"shadow","x",f)-sample(scene,"hero","x",f)-12)));
  controlValue=distance(control);ablationValue=distance(ablation);
 }
 return {domain,motif,metric,units,controlValue,ablationValue,
  absoluteDifference:Math.abs(controlValue-ablationValue),measurementLayer:"source-property-trace",
  disclaimer:"Quantifies the ablated motion variable; not visual preference or causal aesthetics",
  blindHumanRating:"NOT_EVALUATED"};
}
export async function buildTrials(outDir,{render=false,gif=false}={}){
 if(gif&&!render)throw Error("--gif requires --render");
 const dir=resolve(outDir);mkdirSync(dir,{recursive:true});
 const lock=JSON.parse(readFileSync(join(ROOT,"package-lock.json"),"utf8"));
 const version=lock.packages?.["node_modules/@rive-app/canvas-advanced"]?.version;
 if(!version)throw Error("Official renderer runtime must have a pinned package-lock entry");
 let host;
 if(render){
  const [{RiveHost},{PAGE_SCRIPT}]=await Promise.all([
   import("../dist/riveHost.js"),import("../dist/pageScript.js")]);
  host=new RiveHost(PAGE_SCRIPT);
 }
 const results=[];
 try{
  for(const domain of DOMAINS)for(const motif of MOTIFS)for(const ablation of [false,true]){
   const {scene,intervention}=makeIntervention(domain,motif,ablation);
   const result=createRiv(scene);
   const bytes=Buffer.from(result.bytes);
   if(bytes.subarray(0,4).toString("ascii")!=="RIVE")throw Error("Writer did not emit RIVE");
   const name=domain+"--"+motif+"--"+(ablation?"ablated":"control");
   const folder=join(dir,name);mkdirSync(folder,{recursive:true});
   writeFileSync(join(folder,"scene.riv"),bytes);
   const item={name,domain,motif,ablation,rivSha256:sha(bytes),bytes:bytes.length,
    source:"self-authored geometries; no fonts, images, or imported reference assets",
    nativeEditableObjects:scene.shapes.map(x=>x.id),
    intervention,measurement:measureIntervention(domain,motif),
    humanBlind:"NOT_EVALUATED",rendered:false,frames:[],
    runtime:{name:"@rive-app/canvas-advanced",version,pinnedBy:"package-lock.json"}};
   if(render){
    const info=await host.inspect(bytes);
    if(!info.artboards.some(x=>x.name===scene.artboard.name &&
       x.animations?.some(a=>a.name==="Flow")))
     throw Error("Official runtime inspection failed "+name);
    const capt=await host.renderFrames(bytes,{animation:"Flow",startTime:0,
     frameCount:4,fps:2,width:480,format:"png"});
    if(capt.frames.length!==4)throw Error("Missing runtime frames "+name);
    item.rendered=true;
    for(let i=0;i<capt.frames.length;i++){
     const png=Buffer.from(capt.frames[i],"base64");
     if(png.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")
      throw Error("Invalid official-runtime PNG "+name+" frame "+i);
     const filename="frame-"+String(i).padStart(3,"0")+".png";
     writeFileSync(join(folder,filename),png);
     item.frames.push({filename,sha256:sha(png),timeMs:i*500});
    }
    if(gif){
     const r=spawnSync("ffmpeg",["-y","-loglevel","error","-framerate","2",
      "-i",join(folder,"frame-%03d.png"),"-loop","0",join(folder,"preview.gif")],
      {encoding:"utf8",timeout:60_000});
     if(r.status!==0)throw Error("FFmpeg GIF failed "+name+": "+r.stderr);
     item.gifSha256=sha(readFileSync(join(folder,"preview.gif")));
    }
   }
   results.push(item);
  }
 }finally{if(host)await host.close();}
 const visualPairs=[];
 if(render){
  for(const domain of DOMAINS)for(const motif of MOTIFS){
   const prefix=domain+"--"+motif+"--";
   const a=results.find(x=>x.name===prefix+"control");
   const b=results.find(x=>x.name===prefix+"ablated");
   const changed=a.frames.map((f,i)=>i).filter(i=>
    a.frames[i]?.sha256!==b.frames[i]?.sha256);
   if(!changed.length)throw Error("Control/ablation visually indistinguishable in official runtime: "+prefix);
   const selected=changed[0];
   const delta={domain,motif,changedFrameIndices:changed,
    atMs:a.frames[selected].timeMs,hashesDiffer:true,
    meaning:"rendered-output-change-only; not aesthetic-effect-proof"};
   if(gif){
    const frameBytes=(item)=>{
     const png=join(dir,item.name,item.frames[selected].filename);
     const r=spawnSync("ffmpeg",["-loglevel","error","-i",png,
      "-frames:v","1","-f","rawvideo","-pix_fmt","rgba","pipe:1"],
      {maxBuffer:4*1024*1024});
     if(r.status!==0)throw Error("Cannot decode pixel witness "+png+": "+r.stderr);
     return r.stdout;
    };
    const px=frameBytes(a),py=frameBytes(b);
    if(px.length!==480*320*4||py.length!==px.length)
     throw Error("Unexpected frame size for pixel comparison");
    let count=0,sum=0;
    for(let i=0;i<px.length;i+=4){
     let different=false;
     for(let j=0;j<4;j++){const d=Math.abs(px[i+j]-py[i+j]);sum+=d;if(d)different=true;}
     if(different)count++;
    }
    if(count===0)throw Error("Zero changed pixels despite different hashes");
    delta.changedPixels=count;
    delta.totalPixels=480*320;
    delta.meanAbsChannelDifference=Number((sum/px.length).toFixed(6));
   }
   visualPairs.push(delta);
  }
 }

 const report={schema:"motif-ablation-evidence/v1",authoring:"existing SceneSpec/rivWriter",
  renderer:render?"actual official Rive runtime, version pinned by lockfile":"NOT_RENDERED",
  caseCount:results.length,domainCount:DOMAINS.length,motifCount:MOTIFS.length,
  interpretation:"Single-variable controlled source interventions. Measurable traces do not establish preferred aesthetics",
  promotionStage:render?"rendered-experiment-only; human and rights gate pending":"buildable-experiment-only",
  visualPairs,cases:results};
 writeFileSync(join(dir,"evidence.json"),JSON.stringify(report,null,2)+"\n");
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const opts=process.argv.slice(2);
  const report=await buildTrials(opts.find(x=>!x.startsWith("--"))??"test/tmp/motif-distillation",
   {render:opts.includes("--render"),gif:opts.includes("--gif")});
  console.log(JSON.stringify({cases:report.caseCount,domains:report.domainCount,
   motifs:report.motifCount,renderer:report.renderer}));
 }catch(e){console.error(e);process.exitCode=1;}
}
