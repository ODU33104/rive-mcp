// Reart-direct existing fully editable, genuinely illustrated Studio scene assets:
// actual portrait/square/cinematic layouts, not eight metadata aliases.
import {resolve,dirname,join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {mkdirSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {createRiv} from "../dist/rivWriter.js";
import {createStudioScene} from "./studio-foundry-scenes.mjs";
const SPECS={
 "portrait-archive":{source:"archive",W:540,H:720,hero:[269,264],headline:[57,500],detail:[57,623],headingSize:64,mode:"portrait"},
 "portrait-botanica":{source:"botanica",W:540,H:720,hero:[269,264],headline:[57,501],detail:[57,621],headingSize:55,mode:"portrait"},
 "portrait-luma":{source:"luma",W:540,H:720,hero:[270,265],headline:[58,490],detail:[58,620],headingSize:70,mode:"portrait"},
 "cinematic-spectra":{source:"spectra",W:960,H:540,hero:[690,265],headline:[76,165],detail:[76,340],headingSize:84,mode:"cinematic"},
 "cinematic-bassline":{source:"bassline",W:960,H:540,hero:[684,263],headline:[74,164],detail:[74,340],headingSize:82,mode:"cinematic"},
 "cinematic-quantum":{source:"quantum",W:960,H:540,hero:[693,264],headline:[74,165],detail:[74,335],headingSize:79,mode:"cinematic"},
 "square-prism":{source:"prism",W:600,H:600,hero:[310,225],headline:[54,428],detail:[54,546],headingSize:69,mode:"square"},
 "square-orbital":{source:"orbital",W:600,H:600,hero:[304,218],headline:[52,430],detail:[52,548],headingSize:62,mode:"square"}
};
export const DIRECTION_IDS=Object.freeze(Object.keys(SPECS));
function must(arr,id){const node=arr.find(x=>x.id===id);if(!node)throw Error("Missing source art node "+id);return node;}
function shiftTracks(scene,target,property,delta){
 if(!delta)return;
 for(const anim of scene.animations)for(const tr of anim.tracks){
  if(tr.target===target&&tr.property===property)
   for(const key of tr.keyframes)key.value+=delta;
 }
}
function reframe(scene,groupId,pos){
 const g=must(scene.groups,groupId);
 const dx=pos[0]-g.x,dy=pos[1]-g.y;
 g.x=pos[0];g.y=pos[1];
 shiftTracks(scene,groupId,"x",dx);
 shiftTracks(scene,groupId,"y",dy);
 return {dx,dy};
}
export function createArtDirectedScene(id){
 const s=SPECS[id];
 if(!s)throw Error("Unknown art direction "+id);
 const scene=createStudioScene(s.source),original=createStudioScene(s.source);
 scene.artboard={name:"StudioDirection_"+id,width:s.W,height:s.H};
 const heroDelta=reframe(scene,"hero",s.hero);
 const accent=reframe(scene,"accent",s.hero);
 if(accent.dx!==heroDelta.dx||accent.dy!==heroDelta.dy)
  throw Error("Hero/accent origins no longer correspond");
 reframe(scene,"heading",s.headline);
 reframe(scene,"detail",s.detail);
 for(const node of scene.shapes){
  if(node.id==="canvas"){
   Object.assign(node,{x:s.W/2,y:s.H/2,width:s.W,height:s.H});
  }else if(node.id==="ambientLight"){
   node.x+=heroDelta.dx;node.y+=heroDelta.dy;
  }else if(node.id==="separation"||node.id==="baseline"){
   node.points=[
    {x:s.mode==="cinematic"?67:42,y:node.id==="separation"?59:s.H-59},
    {x:s.W-(s.mode==="cinematic"?67:42),y:node.id==="separation"?59:s.H-59}
   ];
  }else if(node.id.startsWith("grid-horizontal-")){
   if(s.mode==="cinematic"){
    const i=Number(node.id.slice("grid-horizontal-".length));
    node.points=[{x:s.W*.56,y:80+57*i},{x:s.W-56,y:80+57*i}];
   }else{
    node.opacity=.07;
    const i=Number(node.id.slice("grid-horizontal-".length));
    node.points=[{x:40,y:115+i*68},{x:s.W-40,y:115+i*68}];
   }
  }
 }
 const headline=must(scene.texts,"headline");
 headline.runs[0].fontSize=s.headingSize;
 headline.width=s.mode==="portrait"?s.W-112:s.mode==="square"?s.W-105:465;
 const sub=must(scene.texts,"strapline");
 sub.width=s.mode==="portrait"?s.W-114:s.mode==="square"?s.W-105:475;
 // Copy respects viewport and design intent; no phantom Helvetica fallback.
 const desc=must(scene.texts,"descriptor");
 desc.width=s.mode==="cinematic"?470:s.W-112;
 must(scene.texts,"series").width=desc.width;
 if(s.mode==="cinematic"){
  must(scene.texts,"footleft").y=s.H-39;
  const foot=must(scene.texts,"footright");
  foot.x=s.W-150;foot.y=s.H-39;
 }else{
  scene.texts=scene.texts.filter(x=>!["footleft","footright"].includes(x.id));
 }
 const nodes=[...scene.groups,...scene.shapes,...scene.texts];
 const ids=new Set(nodes.map(n=>n.id));
 if(ids.size!==nodes.length)throw Error("Duplicated node after composition");
 for(const node of nodes)if(node.parent&&!ids.has(node.parent))throw Error("Broken parent "+node.id);
 const tracks=scene.animations.flatMap(a=>a.tracks);
 for(const t of tracks)if(!ids.has(t.target))throw Error("Broken animated node "+t.target);
 return {scene,provenance:{id,source:s.source,mode:s.mode,
  outputViewport:[s.W,s.H],sourceViewport:[original.artboard.width,original.artboard.height],
  heroPosition:s.hero,copyPosition:s.headline,scope:"real existing Studio vector scene re-art-direction; editable native Rive",
  sameSourceAssetLicense:true,humanAestheticRating:"NOT_EVALUATED"}};
}
export function buildArtDirectedScene(id){
 const {scene,provenance}=createArtDirectedScene(id);
 const native=createRiv(scene);
 if((native.warnings??[]).length)throw Error("Writer warnings in "+id+": "+native.warnings.join(","));
 return {scene,provenance,bytes:native.bytes};
}
async function runtime(id,directory){
 const {RiveHost}=await import("../dist/riveHost.js");
 const {PAGE_SCRIPT}=await import("../dist/pageScript.js");
 const {scene,bytes,provenance}=buildArtDirectedScene(id);
 const dir=resolve(directory);
 mkdirSync(dir,{recursive:true});
 writeFileSync(join(dir,id+".riv"),Buffer.from(bytes));
 const host=new RiveHost(PAGE_SCRIPT);
 try{
  const inspect=await host.inspect(Buffer.from(bytes));
  if(!inspect.artboards.some(ab=>ab.name===scene.artboard.name&&ab.animations.some(a=>a.name==="Reveal")))
   throw Error("Not an independently rendered RIVE "+id);
  const r=await host.renderFrames(Buffer.from(bytes),{animation:"Reveal",startTime:0,
   frameCount:37,fps:10,width:scene.artboard.width,format:"png"});
  if(r.frames.length!==37)throw Error("Bad runtime frame count "+id);
  const frames=[];
  for(let i=0;i<r.frames.length;i++){
   const b=Buffer.from(r.frames[i],"base64");
   if(b.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")throw Error("Bad PNG "+id);
   writeFileSync(join(dir,"frame-"+String(i).padStart(3,"0")+".png"),b);
   if([0,6,14,21,29,36].includes(i))frames.push({frame:i,
    sha256:createHash("sha256").update(b).digest("hex")});
  }
  writeFileSync(join(dir,id+"-poster.png"),Buffer.from(r.frames.at(-1),"base64"));
  writeFileSync(join(dir,id+"-evidence.json"),JSON.stringify({...provenance,
   pngFrames:frames,sourceShapeCount:scene.shapes.length,
   sourceTextCount:scene.texts.length,motionTracks:scene.animations[0].tracks.length,
   renderer:"official Canvas Rive (same backend for all 8 examples)",
   aestheticScore:"NOT_EVALUATED"},null,2)+"\n");
  console.log(JSON.stringify({id,artboard:scene.artboard,shapes:scene.shapes.length,
   tracks:scene.animations[0].tracks.length,rendered:r.frames.length}));
 }finally{await host.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const id=process.argv[2];if(!DIRECTION_IDS.includes(id))throw Error("Unknown "+id);
 const out=process.argv[3]??"test/tmp/studio-direction/"+id;
 if(process.argv.includes("--render"))await runtime(id,out);
 else{
  const {bytes,provenance}=buildArtDirectedScene(id);
  mkdirSync(out,{recursive:true});
  writeFileSync(join(out,id+".riv"),Buffer.from(bytes));
  console.log(JSON.stringify({bytes:bytes.length,provenance}));
 }
}