// EFFECT CAPSULE REUSE — extracts already-authored shapes/tracks, not freshly invented FX.
// Requires Studio Foundry source as parent branch; result stays native editable Rive.
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {createRiv} from "../dist/rivWriter.js";
import {createStudioScene} from "./studio-foundry-scenes.mjs";

const HERE=dirname(fileURLToPath(import.meta.url));
const config=JSON.parse(readFileSync(resolve(HERE,"../data/effect-capsules/reusable-studio-fx.v1.json"),"utf8"));
export const CAPSULE_IDS=Object.freeze(config.capsules.map(x=>x.id));
export const VARIANTS=Object.freeze(config.examples.map(x=>x.id));
function copy(value){return structuredClone(value);}
function byId(array,id){
 const result=array.find(x=>x.id===id);
 if(!result)throw Error("FX unknown "+id);
 return result;
}
function fingerprint(x){
 return createHash("sha256").update(Buffer.from(JSON.stringify(x))).digest("hex");
}
export function extractExistingEffect(capsuleId){
 const spec=byId(config.capsules,capsuleId);
 const source=createStudioScene(spec.sourceScene);
 const shapes=source.shapes.filter(s=>s.id.startsWith(spec.shapeIdPrefix)&&s.parent===spec.sourceParent).map(copy);
 if(!shapes.length)throw Error("No reusable shapes in source for "+capsuleId);
 const matches=new Set(shapes.map(s=>s.id));
 const unrelated=source.shapes.filter(s=>s.id.startsWith(spec.shapeIdPrefix)&&s.parent!==spec.sourceParent);
 if(unrelated.length)throw Error("Source prefix includes other parent: "+unrelated.map(x=>x.id));
 const animation=source.animations.find(x=>x.name==="Reveal");
 if(!animation)throw Error("Missing original authored Reveal animation");
 const tracks=animation.tracks.filter(t=>matches.has(t.target)).map(copy);
 if(spec.inheritAccentMotion){
  if(spec.sourceParent!=="accent")throw Error("Only original accent motion may be inherited");
  for(const tr of animation.tracks.filter(t=>t.target==="accent"&&["rotation","opacity"].includes(t.property)))
   tracks.push({...copy(tr),target:"__ROOT__"});
 }
 if(new Set(shapes.map(s=>s.id)).size!==shapes.length)throw Error("Effect duplicate source shapes");
 return {id:capsuleId,spec:copy(spec),shapes,tracks,
  provenance:{sourceScene:spec.sourceScene,sourcePath:"scripts/studio-foundry-scenes.mjs",
  sourceGeometryHash:fingerprint(shapes),originalTrackCount:tracks.length,rights:"project-original"}};
}
export function applyExistingEffect(targetScene,capsuleId,placement={}){
 const target=createStudioScene(targetScene);
 const source=extractExistingEffect(capsuleId);
 if(!source.spec.compatibleScenes.includes(targetScene))throw Error(
  "Semantically invalid FX transfer: "+capsuleId+" to "+targetScene);
 const {
  x=0,y=0,scale=1,rotation=0,zOffset=0
 }=placement;
 if(![x,y,scale,rotation,zOffset].every(Number.isFinite)||scale<.45||scale>1.5||
   Math.abs(x)>200||Math.abs(y)>200||Math.abs(rotation)>90||zOffset<0||zOffset>80)
  throw Error("Invalid effect attachment transform");
 const hero=target.groups.find(g=>g.id==="hero");
 if(!hero)throw Error("Target has no semantic hero attachment point");
 const namespace="fx_"+capsuleId.replaceAll("-","_");
 if(target.groups.some(g=>g.id===namespace))throw Error("Duplicate namespace");
 // Required local frame contract: studio hero and accent share the same source origin.
 const src=createStudioScene(source.spec.sourceScene);
 for(const rootName of ["hero","accent"]){
  const g=src.groups.find(q=>q.id===rootName);
  if(!g)throw Error("Missing source attachment "+rootName);
 }
 const origin=src.groups.find(g=>g.id===source.spec.sourceParent);
 const sourceHero=src.groups.find(g=>g.id==="hero");
 if(origin.x!==sourceHero.x||origin.y!==sourceHero.y)
  throw Error("Source hero/FX origins have diverged: transformation is no longer portable");
 const layer={id:namespace,parent:"hero",x,y,rotation,
  scaleX:scale,scaleY:scale,opacity:1};
 target.groups.push(layer);
 const oldToNew=new Map();
 for(const shape of source.shapes){
  if(shape.parent!==source.spec.sourceParent)
   throw Error("Unsupported nested FX parent "+shape.id);
  const id=namespace+"__"+shape.id;
  oldToNew.set(shape.id,id);
  target.shapes.push({...copy(shape),id,parent:namespace,z:(shape.z??0)+zOffset});
 }
 for(const tr of source.tracks){
  const id=tr.target==="__ROOT__"?namespace:oldToNew.get(tr.target);
  if(!id)throw Error("Missing animated effect node: "+tr.target);
  if(!["opacity","x","y","rotation","scaleX","scaleY","width","height","trimEnd","trimStart","trimOffset"].includes(tr.property))
   throw Error("Unsupported imported property: "+tr.property);
  if(!tr.keyframes?.every((k,i)=>Number.isFinite(k.value)&&Number.isInteger(k.frame)&&
   k.frame>=0&&k.frame<=target.animations[0].duration&&(i===0||k.frame>tr.keyframes[i-1].frame)))
   throw Error("Broken source animation timing in "+tr.target);
  target.animations[0].tracks.push({...copy(tr),target:id});
 }
 const nodes=[...target.groups,...target.shapes,...target.texts];
 const ids=new Set(nodes.map(x=>x.id));
 if(ids.size!==nodes.length)throw Error("Capsule merge generated duplicate IDs");
 for(const node of nodes)if(node.parent&&!ids.has(node.parent))
  throw Error("Orphaned parent after effect merge "+node.id);
 const tracks=target.animations[0].tracks;
 const trackIds=new Set(tracks.map(t=>t.target+"."+t.property));
 if(trackIds.size!==tracks.length)throw Error("Capsule merge duplicate animation property lanes");
 const editEvidence={schema:"effect-capsule-transfer-evidence/v1",
  capsuleId,targetScene,sourceScene:source.spec.sourceScene,
  geometryHash:source.provenance.sourceGeometryHash,
  effectNodeIds:[...oldToNew.values()],importedTracks:source.tracks.length,
  attachment:{parent:"hero",local:{x,y,scale,rotation},depthReorder:zOffset},
  sourceRights:"self-authored source code; imported third-party art = none",
  reuseType:"COPY_PREEXISTING_SHAPES_AND_KEYFRAMES",
  humanAestheticRating:"NOT_EVALUATED",rendererStatus:"NOT_RUN_YET"};
 return {scene:target,evidence:editEvidence};
}
export function renderVariantScene(variantId){
 const variant=byId(config.examples,variantId);
 const output=applyExistingEffect(variant.targetScene,variant.capsuleId,variant.placement);
 const original=createStudioScene(variant.targetScene);
 const withEffect=createRiv(output.scene);
 const baseline=createRiv(original);
 if((withEffect.warnings??[]).length||(baseline.warnings??[]).length)
  throw Error("Rive writer warned about effect-source reuse");
 const changed=!Buffer.from(withEffect.bytes).equals(Buffer.from(baseline.bytes));
 if(!changed)throw Error("Effect composition made no binary change");
 return {...output,variant,bytes:withEffect.bytes,baselineBytes:baseline.bytes};
}
async function runtimeProof(id,outDir){
 const {RiveHost}=await import("../dist/riveHost.js");
 const {PAGE_SCRIPT}=await import("../dist/pageScript.js");
 const variant=renderVariantScene(id);
 const path=resolve(outDir);
 mkdirSync(path,{recursive:true});
 writeFileSync(join(path,id+".riv"),Buffer.from(variant.bytes));
 const host=new RiveHost(PAGE_SCRIPT);
 try{
  const record=[];
  for(const [name,bytes] of [["before",variant.baselineBytes],["after",variant.bytes]]){
   const art=await host.inspect(Buffer.from(bytes));
   if(!art.artboards.find(a=>a.animations.some(anim=>anim.name==="Reveal")))
    throw Error("Cannot inspect native animation "+id);
   const frames=await host.renderFrames(Buffer.from(bytes),{animation:"Reveal",
    startTime:0,frameCount:31,fps:10,width:720,format:"png"});
   if(frames.frames.length!==31)throw Error("Rive renderer failed "+name);
   const outputDir=join(path,name);
   mkdirSync(outputDir,{recursive:true});
   const selected=[0,5,10,15,20,25,30];
   const picks=[];
   for(const [i,base64] of frames.frames.entries()){
    const data=Buffer.from(base64,"base64");
    if(data.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")
     throw Error("Bad PNG "+name+" "+i);
    if(name==="after")writeFileSync(join(outputDir,"frame-"+String(i).padStart(3,"0")+".png"),data);
    if(selected.includes(i)){
     writeFileSync(join(outputDir,"key-"+String(i).padStart(3,"0")+".png"),data);
     picks.push({frame:i,sha256:createHash("sha256").update(data).digest("hex")});
    }
   }
   writeFileSync(join(path,id+"-"+name+".png"),Buffer.from(frames.frames.at(-1),"base64"));
   record.push({name,picks,frames:frames.frames.length});
  }
  const changed=record[0].picks.some((p,i)=>p.sha256!==record[1].picks[i].sha256);
  if(!changed)throw Error("Effect source copied but no visible PNG changed");
  writeFileSync(join(path,"transfer-evidence.json"),
   JSON.stringify({...variant.evidence,rendererStatus:"PASS",renderedFrames:record,
     sourceToTargetFrameChange:"YES",humanAestheticRating:"NOT_EVALUATED"},null,2)+"\n");
  console.log(JSON.stringify({id,source:variant.evidence.sourceScene,
   target:variant.evidence.targetScene,shapes:variant.evidence.effectNodeIds.length,
   importedTracks:variant.evidence.importedTracks,rendered:62,changed:true}));
 }finally{await host.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const id=process.argv[2];
 if(!VARIANTS.includes(id))throw Error("Usage: node scripts/effect-capsule-reuse.mjs <"+
  VARIANTS.join("|")+"> [outDir] [--render]");
 const outDir=process.argv[3]??"test/tmp/effect-capsules/"+id;
 if(process.argv.includes("--render"))await runtimeProof(id,outDir);
 else{
  const variant=renderVariantScene(id);
  mkdirSync(outDir,{recursive:true});
  writeFileSync(join(outDir,id+".riv"),Buffer.from(variant.bytes));
  writeFileSync(join(outDir,"transfer-evidence.json"),JSON.stringify(variant.evidence,null,2)+"\n");
  console.log(JSON.stringify({id,bytes:variant.bytes.length,shapeCount:variant.evidence.effectNodeIds.length}));
 }
}