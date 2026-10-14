// V4 optical art-direction proof: same original MORROW source, materially different
// editorial geometry & source-linked optics, with two controlled variants.
// This is an actual edit to source scene graph, not a finished-work PNG overlay.
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {createRiv} from "../dist/rivWriter.js";
import {createFlagshipScene} from "./v3-flagship-scenes.mjs";
import {extractExistingEffect} from "./effect-capsule-reuse.mjs";

export const MORROW_VARIANTS=Object.freeze(["atelier","spectral"]);
const SOLID=c=>({color:c});
const RADIAL=(a,b,x1=0,y1=0,x2=150,y2=0)=>({gradient:{
 type:"radial",stops:[{color:a,position:0},{color:b,position:1}],
 start:{x:x1,y:y1},end:{x:x2,y:y2}
}});
const LINEAR=(a,b,x1=-130,y1=-140,x2=130,y2=150)=>({gradient:{
 type:"linear",stops:[{color:a,position:0},{color:b,position:1}],
 start:{x:x1,y:y1},end:{x:x2,y:y2}
}});
const clone=x=>structuredClone(x);
const SHA=b=>createHash("sha256").update(b).digest("hex");
const find=(xs,id)=>{const v=xs.find(x=>x.id===id);if(!v)throw Error("Missing source node "+id);return v;};
function addedRect(shapes,id,parent,x,y,w,h,fill,z,extras={}){
 shapes.push({id,type:"rect",parent,x,y,width:w,height:h,z,cornerRadius:3,fill,...extras});
}
function addedOval(shapes,id,parent,x,y,w,h,fill,z,extras={}){
 shapes.push({id,type:"ellipse",parent,x,y,width:w,height:h,z,fill,...extras});
}
function addedLine(shapes,id,parent,points,color,z,width=1,extras={}){
 shapes.push({id,type:"polygon",parent,x:0,y:0,points:points.map(p=>({x:p[0],y:p[1]})),
  closed:false,stroke:{color,thickness:width,cap:"round",join:"round"},z,...extras});
}
function track(anim,target,property,knots){
 if(anim.tracks.some(t=>t.target===target&&t.property===property))
  throw Error("Duplicate animated property lane "+target+"."+property);
 anim.tracks.push({target,property,keyframes:knots.map(([frame,value,easing])=>({
  frame,value,...(easing?{easing}:{})
 }))});
}
function transformSourceVessel(scene){
 const s=scene.shapes,g=scene.groups,texts=scene.texts,anim=scene.animations[0];
 const object=find(g,"object");
 // Artist-directed transition from centred illustration to asymmetric luxury
 // object study. All existing Y/scale keyframes are transformed as well.
 object.x=643;
 for(const tr of anim.tracks){
  if(tr.target==="object"&&tr.property==="y")
   for(const k of tr.keyframes)k.value-=35;
  if(tr.target==="object"&&["scaleX","scaleY"].includes(tr.property))
   for(const k of tr.keyframes)k.value*=1.15;
 }
 object.y=345;object.scaleX=1.15;object.scaleY=1.15;
 const pool=find(s,"warm-pool");
 Object.assign(pool,{x:632,y:320,width:635,height:505,opacity:.63,
  fill:RADIAL("#42716E","#061219",0,0,320,20)});
 const fall=find(s,"falloff");
 fall.x=640;fall.y=549;fall.width=408;fall.opacity=.64;
 find(s,"cyclorama").fill=LINEAR("#18292C","#04090D",-450,-290,470,380);
 const glass=find(s,"outer-wall");
 glass.fill=RADIAL("#98D8C8","#102833",-45,-78,148,95);
 glass.opacity=.94;
 find(s,"inner-well").fill=LINEAR("#406D6B","#0B212C",-110,-140,105,140);
 find(s,"inner-well").opacity=.69;
 find(s,"inner-matte").fill=RADIAL("#0C2830","#08151E",0,-25,108,125);
 find(s,"liquid-volume").fill=LINEAR("#B0D2B0","#133D49",-105,-112,100,153);
 find(s,"meniscus").fill=LINEAR("#DFE6C3","#366F6D",-85,-10,90,18);
 find(s,"refracted-left").fill=LINEAR("#D1F4D9","#346F77",-132,-150,45,120);
 find(s,"refracted-right").fill=LINEAR("#F2F8D8","#174E65",90,-155,125,130);
 find(s,"refracted-right").opacity=.55;
 find(s,"cap-face").fill=LINEAR("#F6E8CB","#8E937B",-65,-45,74,58);
 find(s,"cap-shell").fill=LINEAR("#F5E2B9","#625C4E",-81,-58,87,60);
 const header=find(texts,"product-title");
 Object.assign(header,{x:63,y:170,width:460});
 header.runs[0].fontSize=95;
 header.runs[0].color="#F4EAD6";
 const sub=find(texts,"product-title-2");
 Object.assign(sub,{x:68,y:300,width:390});
 sub.runs[0].fontSize=21;
 sub.runs[0].color="#A2C9BC";
 Object.assign(find(texts,"product-small"),{x:70,y:130});
 Object.assign(find(texts,"product-number"),{x:750,y:74});
 Object.assign(find(texts,"product-note"),{x:72,y:547,width:400});
 // Physical product study: broader negative space and minimal left-side
 // typography; precision keyline must not cross the bottle silhouette.
 scene.groups.push({id:"editorial-axis",x:0,y:0,opacity:1});
 addedLine(s,"editorial-vertical","editorial-axis",[[68,96],[68,120]],"#B9C0A5",8,1.5,{opacity:.8});
 addedLine(s,"editorial-horizon","editorial-axis",[[69,531],[326,531]],"#638B7D",8,.65,{opacity:.56});
 addedLine(s,"hero-index-rule","editorial-axis",[[788,147],[890,147]],"#B5AE92",8,.65,{opacity:.52});
 addedOval(s,"left-studio-haze","editorial-axis",304,331,375,335,
  RADIAL("#274B4E","#09151C",0,0,188,0),3,{opacity:.26,blendMode:"screen"});
 // Fully native Rive screen composites over existing authored glass masks.
 addedOval(s,"backlight-aurora","editorial-axis",646,299,440,476,
  RADIAL("#729F8D","#07141A",0,0,208,15),4,{opacity:.44,blendMode:"screen"});
 // Refracted highlights are parented to the actual source authored glass rig.
 // Clip remains source 'vesselMask': existing body owns its silhouette.
 addedOval(s,"interior-cold-glint","glass",-42,-48,156,310,
  RADIAL("#E9FFE0","#27626B",-20,-45,111,70),18,
  {opacity:.23,clipBy:"vesselMask",blendMode:"screen"});
 addedOval(s,"amber-caustic-core","fluid",36,55,215,222,
  RADIAL("#E9DFAC","#326D69",30,0,110,45),22,
  {opacity:.22,clipBy:"vesselMask",blendMode:"screen"});
 addedRect(s,"shoulder-reflection","glass",-40,-132,20,107,
  LINEAR("#ECFFF2","#356A72",-13,-50,13,60),27,
  {rotation:12,opacity:.36,clipBy:"vesselMask",blendMode:"screen"});
 addedRect(s,"soft-reflect-right","glass",86,-22,15,271,
  LINEAR("#EDFCE4","#346977",-7,-142,4,139),27,
  {rotation:-6,opacity:.24,clipBy:"vesselMask",blendMode:"screen"});
 addedLine(s,"left-rim-etched","glass",[[-119,-109],[-127,92],[-108,150]],
  "#E8F6E2",32,1.55,{opacity:.75});
 addedLine(s,"upper-shoulder","glass",[[-100,-153],[92,-153],[112,-128]],
  "#E2F9E1",32,1.2,{opacity:.55});
 addedLine(s,"right-reflect-inner","glass",[[97,-123],[110,-97],[109,111]],
  "#D6F1E4",32,1.3,{opacity:.69});
 // Quiet etched micro-pattern repeats are spatial, not random faux noise.
 for(let i=0;i<18;i++){
  const y=42+i*6.4;
  addedLine(s,"glass-microgroove-"+i,"glass",
    [[-68,y],[66,y+((i%4)-1)*.7]],i%3===0?"#B8E3CD":"#77B0A7",26,.34,
    {opacity:i%4===0?.15:.06,clipBy:"vesselMask"});
 }
 // Source geometry keeps all strokes and face/brand glyphs separately editable.
 // No feather here: the current Canvas runtime does not promise Rive Renderer blur.
 // Controlled material light timing: no spectacle unrelated to the product.
 track(anim,"backlight-aurora","opacity",[[0,.04],[55,.08],[154,.39,"ease-in-out"],[245,.44],[300,.44]]);
 track(anim,"interior-cold-glint","opacity",[[0,0],[93,0],[160,.33,"ease-in-out"],[250,.23],[300,.23]]);
 track(anim,"shoulder-reflection","opacity",[[0,0],[75,0],[183,.39],[279,.36],[300,.36]]);
 track(anim,"soft-reflect-right","opacity",[[0,0],[130,0],[235,.25],[300,.24]]);
 track(anim,"amber-caustic-core","opacity",[[0,0],[99,0],[195,.24],[300,.22]]);
 track(anim,"editorial-axis","opacity",[[0,.2],[128,.55],[264,1],[300,1]]);
 return {sourceOriginalNodes:scene.shapes.length,nonFXMaterialLayers:25,
  artDirection:"asymmetric typographic negative space, sculpted edge light, clipped optical caustics"};
}
function existingSpectralBeams(scene){
 const original=extractExistingEffect("spectral-beams");
 if(original.spec.sourceScene!=="prism"||original.shapes.length!==8)
  throw Error("Unverified original authored prism source");
 const anim=scene.animations[0];
 scene.groups.push({id:"source-spectral-glints",parent:"object",x:0,y:0,opacity:1});
 const namespace="authoredPrism_";
 const ids=new Set();
 for(const item of original.shapes){
  // The original refracted beams are adapted to obey THIS bottle's physical
  // clip silhouette. Their source path color and keyframed opacity are retained.
  const copied=clone(item);
  if(copied.type!=="polygon"||copied.parent!=="accent"||!copied.stroke)
   throw Error("Unexpected optical source type");
  copied.id=namespace+copied.id;
  copied.parent="source-spectral-glints";
  copied.clipBy="vesselMask";
  copied.x=-85;copied.y=-46;copied.z=36;
  copied.opacity=.20;
  copied.blendMode="screen";
  copied.stroke.thickness=Math.min(copied.stroke.thickness,1.3);
  ids.add(item.id);
  scene.shapes.push(copied);
 }
 for(const t of original.tracks){
  if(!ids.has(t.target))continue;
  if(t.property!=="opacity")throw Error("Unsupported imported property");
  const copied=clone(t);
  copied.target=namespace+t.target;
  copied.keyframes=copied.keyframes.map(k=>({...k,
   // Scale the originating visual opacity, retaining source times+ease.
   value:k.value*.20}));
  anim.tracks.push(copied);
 }
 const importedTracks=anim.tracks.filter(t=>t.target.startsWith(namespace)).length;
 if(importedTracks!==8)throw Error("Lost prism source authoring timeline");
 return {sourceScene:"prism",sourceCapsule:"spectral-beams",shapes:original.shapes.length,
  tracks:importedTracks,geometryHash:original.provenance.sourceGeometryHash,
  nativeEffect:"8 existing authored refracted vector path strokes, material-clipped to native bottle"};
}
export function makeMorrowVariant(variant){
 if(!MORROW_VARIANTS.includes(variant))throw Error("Unknown optical comparison variant");
 const {scene,meta}=createFlagshipScene("vessel");
 const source=clone(scene);
 const material=transformSourceVessel(scene);
 const sourceReuse=variant==="spectral"?existingSpectralBeams(scene):null;
 const nodes=[...scene.groups,...scene.shapes,...scene.texts],nodeIds=new Set(nodes.map(x=>x.id));
 if(nodes.length!==nodeIds.size)throw Error("Duplicate assembled editable node ID");
 const shapesById=new Map(scene.shapes.map(x=>[x.id,x]));
 for(const node of nodes){
  if(node.parent&&!nodeIds.has(node.parent))throw Error("Unknown parent "+node.id);
  if(node.clipBy&&!shapesById.has(node.clipBy))throw Error("Unknown authored optical mask");
 }
 const anim=scene.animations[0],lanes=new Set();
 for(const t of anim.tracks){
  const id=t.target+"."+t.property;
  if(lanes.has(id)||!nodeIds.has(t.target))throw Error("Invalid animation lane "+id);
  lanes.add(id);
  if(!t.keyframes?.every((p,i)=>Number.isFinite(p.value)&&
   Number.isInteger(p.frame)&&p.frame>=0&&p.frame<=300&&
   (i===0||p.frame>t.keyframes[i-1].frame)))
   throw Error("Unverified property keyframes "+id);
 }
 scene.artboard.name="Flagship_MorrowV4_"+variant;
 const native=createRiv(scene),baseline=createRiv(source);
 if((native.warnings??[]).length||(baseline.warnings??[]).length)
  throw Error("Rive writer warned of unsupported material features");
 const bytes=Buffer.from(native.bytes),baselineBytes=Buffer.from(baseline.bytes);
 if(bytes.subarray(0,4).toString("ascii")!=="RIVE"||bytes.equals(baselineBytes))
  throw Error("No distinct editable actual Rive result");
 return {variant,scene,bytes,baselineBytes,report:{
  variant,sourceProject:"Original authored V3 MORROW Rive scene",
  sourceUses:"native radial gradient, screen blend, cubic-ready path geometry, existing native clip masks",
  removedFromScope:"no fake glass shader, no unsupported feather; browser host canvas evidence required",
  originalRiveHash:SHA(baselineBytes),adaptedRiveHash:SHA(bytes),
  material,transferredSource:sourceReuse,
  sourceRights:"project-authored vectors; original internal PRISM authored rays only",
  geometry:{shapes:scene.shapes.length,texts:scene.texts.length,
   animatedPropertyLanes:anim.tracks.length},
  editability:"native shapes, text, keyframed Rive animation tracks",
  aestheticHumanReview:"NOT_EVALUATED",releaseStatus:"PROTOTYPE"
 }};
}
export async function renderMorrowComparison(variant,directory){
 const result=makeMorrowVariant(variant);
 const {RiveHost}=await import("../dist/riveHost.js");
 const {PAGE_SCRIPT}=await import("../dist/pageScript.js");
 const out=resolve(directory);mkdirSync(out,{recursive:true});
 writeFileSync(join(out,variant+".riv"),result.bytes);
 writeFileSync(join(out,"original-v3.riv"),result.baselineBytes);
 const host=new RiveHost(PAGE_SCRIPT);
 try{
  const inspect=await host.inspect(result.bytes);
  if(!inspect.artboards.some(a=>a.name===result.scene.artboard.name&&
    a.animations.some(t=>t.name==="Direction")))
   throw Error("Native official Rive runtime could not inspect "+variant);
  const frames=await host.renderFrames(result.bytes,{
   animation:"Direction",startTime:0,frameCount:76,fps:15,width:960,format:"png"});
  if(frames.frames.length!==76)throw Error("Native optical animation didn't render 76 frames");
  const hs=new Set();
  for(const [i,b64] of frames.frames.entries()){
   const b=Buffer.from(b64,"base64");
   if(b.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")
    throw Error("PNG capture invalid "+i);
   hs.add(SHA(b));
   writeFileSync(join(out,"frame-"+String(i).padStart(3,"0")+".png"),b);
  }
  if(hs.size<45)throw Error("Optical scene has too few unique visible animation frames");
  writeFileSync(join(out,variant+"-poster.png"),Buffer.from(frames.frames[75],"base64"));
  // A/B image-difference checks have matched *original timing & size*.
  const samples=[];
  for(const time of [0.5,1.1,1.8,2.6,3.6,4.7]){
   const diff=await host.visualDiff(result.baselineBytes,result.bytes,{
    animation:"Direction",time,width:960,height:600,threshold:16});
   samples.push({time,diffPixels:diff.diffPixels,
    changedPercent:+(100*diff.diffPixels/diff.totalPixels).toFixed(5)});
  }
  if(!samples.some(x=>x.changedPercent>2))
   throw Error("V4 candidate didn't deliver a meaningful spatial redesign");
  const evidence={...result.report,officialRuntimeFrames:76,
   uniqueFrameHashes:hs.size,originalComparedAtSameTimes:samples,
   outputStatus:"REAL_EDITABLE_RIVE_AND_PNG",
   artisticPreference:"NOT_EVALUATED",
   sourceToEffect:"real source drawing + keyframes, no fake bloom assumption"};
  writeFileSync(join(out,"proof.json"),JSON.stringify(evidence,null,2)+"\n");
  console.log(JSON.stringify({variant,frames:76,distinct:hs.size,comparisons:samples,
   imported:result.report.transferredSource,beauty:"NOT_EVALUATED"}));
 }finally{await host.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const variant=process.argv[2];
 if(!MORROW_VARIANTS.includes(variant))
  throw Error("Use atelier|spectral");
 const out=process.argv[3]??"test/tmp/v4-morrow/"+variant;
 if(process.argv.includes("--render"))await renderMorrowComparison(variant,out);
 else{
  const scene=makeMorrowVariant(variant);
  mkdirSync(out,{recursive:true});
  writeFileSync(join(out,variant+".riv"),scene.bytes);
  writeFileSync(join(out,"proof.json"),JSON.stringify(scene.report,null,2)+"\n");
  console.log(JSON.stringify({variant,bytes:scene.bytes.length}));
 }
}