// Experimental semantic decomposition + exactly one typed, reversible watch pivot.
// This is an evidence-producing prototype, not a general-purpose part parser.
// npm run build && node scripts/scene-assembly-lab.mjs [directory] [--render]
import assert from "node:assert/strict";
import {mkdirSync,writeFileSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createRiv} from "../dist/rivWriter.js";
import {makeGoldScene} from "./build-motion-atlas-gold.mjs";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const BASE_GROUPS=new Set(["watch","indices","hourHand","minuteHand","dialSignature"]);
const ENV_GROUPS=new Set(["atmosphere","orbit","watchShadow"]);
const COPY_GROUPS=new Set(["masthead","headlineA","headlineB","caption","footer"]);
const GROUPS={watch:BASE_GROUPS,environment:ENV_GROUPS,copy:COPY_GROUPS};
const KINDS=["environment","watch","copy"];
function cloneValue(value){
 if(value instanceof Uint8Array)return new Uint8Array(value);
 if(Array.isArray(value))return value.map(cloneValue);
 if(value&&typeof value==="object")
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,cloneValue(item)]));
 return value;
}
function groupFamily(id,byId){
 const seen=new Set();
 let p=id;
 while(p){
  if(seen.has(p))throw Error("cyclic parent at "+p);
  seen.add(p);
  for(const kind of KINDS)if(GROUPS[kind].has(p))return kind;
  p=byId.get(p)?.parent;
 }
 return null;
}
function validateSceneNodes(scene){
 const all=[...scene.groups,...scene.shapes,...scene.texts];
 const ids=new Set();
 for(const node of all){
  if(!node?.id||ids.has(node.id))throw Error("empty or duplicated scene id: "+node?.id);
  ids.add(node.id);
 }
 for(const node of all)if(node.parent&&!ids.has(node.parent))
  throw Error("missing parent: "+node.id+" -> "+node.parent);
 return new Map(all.map(node=>[node.id,node]));
}
export function decomposeSolstice(scene=makeGoldScene()){
 const nodes=validateSceneNodes(scene);
 const bundles=Object.fromEntries(KINDS.map(k=>[k,{groups:[],shapes:[],texts:[]}]));
 const buckets=["groups","shapes","texts"];
 for(const bucket of buckets){
  for(const [index,node] of scene[bucket].entries()){
   // Root background and progress strokes belong to environment.
   const kind=groupFamily(node.id,nodes)??(bucket==="texts"?"copy":"environment");
   bundles[kind][bucket].push({index,node:cloneValue(node)});
  }
 }
 const totals=Object.fromEntries(buckets.map(k=>[k,KINDS.reduce((n,a)=>n+bundles[a][k].length,0)]));
 for(const key of buckets)if(totals[key]!==scene[key].length)throw Error("lost nodes in "+key);
 return {
  schema:"solstice-semantic-assembly/v1",
  artboard:cloneValue(scene.artboard),
  fonts:cloneValue(scene.fonts),
  animationGraph:cloneValue({animations:scene.animations,stateMachine:scene.stateMachine}),
  components:bundles
 };
}
export function recomposeSolstice(manifest){
 if(manifest.schema!=="solstice-semantic-assembly/v1")throw Error("unsupported manifest schema");
 const scene={artboard:cloneValue(manifest.artboard),fonts:cloneValue(manifest.fonts)};
 for(const bucket of ["groups","shapes","texts"]){
  const flattened=KINDS.flatMap(k=>(manifest.components[k]?.[bucket]??[]));
  const indices=new Set(flattened.map(item=>item.index));
  if(indices.size!==flattened.length||Math.min(...indices)!==0||Math.max(...indices)!==flattened.length-1)
   throw Error("missing or duplicate ordering indices for "+bucket);
  scene[bucket]=flattened.sort((a,b)=>a.index-b.index).map(item=>cloneValue(item.node));
 }
 scene.animations=cloneValue(manifest.animationGraph.animations);
 scene.stateMachine=cloneValue(manifest.animationGraph.stateMachine);
 validateSceneNodes(scene);
 for(const a of scene.animations)for(const t of a.tracks){
  if(![...scene.groups,...scene.shapes,...scene.texts].some(n=>n.id===t.target))
   throw Error("missing animation target "+t.target);
 }
 return scene;
}
function requireNode(nodes,id,type){
 const node=nodes.get(id);
 if(!node)throw Error("missing required slot node: "+id);
 if(type&&node.type!==type)throw Error("slot node type changed: "+id);
 return node;
}
function finalizeOriginalPose(scene){
 const nodes=validateSceneNodes(scene);
 // The new quiet-idle variant starts at the composited END pose of SOLSTICE.
 // Rive properties like stroke trims and width must be settled explicitly.
 for(const animation of scene.animations)for(const track of animation.tracks){
  const node=requireNode(nodes,track.target);
  const keyframe=track.keyframes.at(-1);
  if(!keyframe||!Number.isFinite(keyframe.value))
   throw Error("not a numeric end pose "+track.target+"."+track.property);
  const prop=track.property;
  if(["x","y","rotation","scaleX","scaleY","opacity","width","height"].includes(prop))
   node[prop]=keyframe.value;
  else if(["trimEnd","trimStart","trimOffset"].includes(prop)){
   if(!node.stroke?.trim)throw Error("missing stroke trim target "+node.id);
   const key={trimEnd:"end",trimStart:"start",trimOffset:"offset"}[prop];
   node.stroke.trim[key]=keyframe.value;
  }else throw Error("cannot finalize track: "+node.id+"."+prop);
 }
}
function tickFrames(){
 const keyframes=[{frame:0,value:0,easing:"hold"}];
 // Mechanical seconds subdial: hold between ticks and advance by six degrees.
 for(let i=1;i<=8;i++)keyframes.push({frame:30*i,value:6*i,easing:"hold"});
 keyframes.push({frame:269,value:48});
 return keyframes;
}
export function makeSecondHandSlotVariant(original=makeGoldScene()){
 const scene=recomposeSolstice(decomposeSolstice(original));
 finalizeOriginalPose(scene);
 const nodes=validateSceneNodes(scene);
 const hand=requireNode(nodes,"smallSeconds","polygon");
 const pin=requireNode(nodes,"smallSecondsPin","ellipse");
 const watch=requireNode(nodes,"watch");
 if(hand.parent!=="watch"||pin.parent!=="watch"||hand.x!==0||hand.y!==0||
    pin.x!==0||pin.y!==45||!Array.isArray(hand.points)||hand.points.length!==2)
  throw Error("seconds slot source geometry changed; refuse ambiguous re-parenting");
 if(scene.groups.some(g=>g.id==="secondsRig"))throw Error("secondsRig already exists");
 // Existing subdial axis is local (0,45) inside the watch group.
 scene.groups.push({id:"secondsRig",parent:"watch",x:0,y:45,rotation:0,opacity:1});
 hand.parent="secondsRig";
 hand.points=hand.points.map(p=>({...p,x:p.x,y:p.y-45}));
 pin.parent="secondsRig";
 pin.y=0;
 scene.animations=[{name:"Reveal",duration:270,fps:60,loop:"oneShot",tracks:[
  {target:"secondsRig",property:"rotation",keyframes:tickFrames()}
 ]}];
 // Existing Showcase state machine references animation "Reveal".
 const evidence={schema:"typed-slot-evidence/v1",slotId:"watch.subdial.second",
  sourceNodes:["smallSeconds","smallSecondsPin"],newParent:"secondsRig",
  parentAnchor:{node:"watch",local:{x:0,y:45}},childPivot:{node:"secondsRig",local:{x:0,y:0}},
  semantics:"watch.seconds-indicator",domain:["wristwatch","analog-instrument"],
  allowedMotion:["secondsRig.rotation"],forbiddenMotion:["watch.*","hourHand.*","minuteHand.*"],
  comparison:"same-scene reinterpretation, NOT a matched A/B aesthetic test"};
 validateSceneNodes(scene);
 return {scene,evidence};
}
export function makeTamperedPivotVariant(){
 const s=makeSecondHandSlotVariant().scene;
 s.groups.find(g=>g.id==="secondsRig").x=8;
 return s;
}
function mult(A,B){
 return [
  A[0]*B[0]+A[2]*B[1], A[1]*B[0]+A[3]*B[1],
  A[0]*B[2]+A[2]*B[3], A[1]*B[2]+A[3]*B[3],
  A[0]*B[4]+A[2]*B[5]+A[4], A[1]*B[4]+A[3]*B[5]+A[5]
 ];
}
function point(M,p){return {x:M[0]*p.x+M[2]*p.y+M[4],y:M[1]*p.x+M[3]*p.y+M[5]};}
function groupLocalMatrix(g){
 const theta=(g.rotation??0)*Math.PI/180,c=Math.cos(theta),s=Math.sin(theta);
 return [c*(g.scaleX??1),s*(g.scaleX??1),-s*(g.scaleY??1),c*(g.scaleY??1),g.x,g.y];
}
function worldMatrix(id,nodes,seen=new Set()){
 if(seen.has(id))throw Error("transform parent cycle "+id);
 const g=nodes.get(id);
 if(!g)throw Error("transform target not found "+id);
 seen.add(id);
 const parent=g.parent?worldMatrix(g.parent,nodes,seen):[1,0,0,1,0,0];
 seen.delete(id);
 return mult(parent,groupLocalMatrix(g));
}
export function checkSecondsPivot(scene,{tolerancePx=0.5}={}){
 const nodes=validateSceneNodes(scene);
 const pivot=requireNode(nodes,"secondsRig");
 if(pivot.parent!=="watch")return {status:"FAIL",reason:"wrong parent",distancePx:Infinity};
 const actual=point(worldMatrix("secondsRig",nodes),{x:0,y:0});
 const expected=point(worldMatrix("watch",nodes),{x:0,y:45});
 const distancePx=Math.hypot(actual.x-expected.x,actual.y-expected.y);
 return {status:distancePx<=tolerancePx?"PASS":"FAIL",actual,expected,distancePx};
}
export function checkExclusiveSecondHandMotion(scene){
 if(scene.animations.length!==1||scene.animations[0].name!=="Reveal"||
    scene.stateMachine?.states?.length!==1||
    scene.stateMachine.states[0]?.animation!=="Reveal")
  return {status:"UNKNOWN",reason:"multi-clip or state changes need input-driven runtime inspection"};
 const tracks=scene.animations[0].tracks;
 const illegal=tracks.filter(t=>t.target!=="secondsRig"||t.property!=="rotation");
 return {status:illegal.length===0&&tracks.length===1?"PASS":"FAIL",
  illegal:illegal.map(t=>t.target+"."+t.property),checkedTracks:tracks.length};
}
export function buildAssemblyExperiment(){
 const original=makeGoldScene();
 const manifest=decomposeSolstice(original);
 const roundtrip=recomposeSolstice(manifest);
 const originalRiv=createRiv(original),roundtripRiv=createRiv(roundtrip);
 assert.deepEqual(Buffer.from(originalRiv.bytes),Buffer.from(roundtripRiv.bytes),
  "decompose/recompose must preserve original RIVE byte-for-byte");
 const typed=makeSecondHandSlotVariant(original);
 const check=checkSecondsPivot(typed.scene);
 if(check.status!=="PASS")throw Error("reparented seconds axis shifted: "+JSON.stringify(check));
 if(checkExclusiveSecondHandMotion(typed.scene).status!=="PASS")
  throw Error("quiet variant has unapproved animation");
 return {original,manifest,typed,originalBytes:originalRiv.bytes,typedBytes:createRiv(typed.scene).bytes};
}
async function renderComparison(build,dir){
 const [{RiveHost},{PAGE_SCRIPT}]=await Promise.all([
  import("../dist/riveHost.js"),import("../dist/pageScript.js")
 ]);
 const host=new RiveHost(PAGE_SCRIPT);
 try{
  for(const [name,bytes] of [["original",build.originalBytes],["seconds-only",build.typedBytes]]){
   const inspect=await host.inspect(Buffer.from(bytes));
   if(!inspect.artboards.some(a=>a.name==="SolsticeChronograph"&&a.animations.some(x=>x.name==="Reveal")))
    throw Error("official Rive runtime could not inspect "+name);
   const frames=await host.renderFrames(Buffer.from(bytes),{
    animation:"Reveal",startTime:0,frameCount:46,fps:10,width:720,format:"png"
   });
   if(frames.frames.length!==46)throw Error("render failed for "+name);
   const sub=join(dir,name);mkdirSync(sub,{recursive:true});
   for(let i=0;i<46;i++){
    const b=Buffer.from(frames.frames[i],"base64");
    if(b.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")
     throw Error("invalid PNG at "+name+" frame "+i);
    writeFileSync(join(sub,"frame-"+String(i).padStart(3,"0")+".png"),b);
   }
   writeFileSync(join(dir,name+"-poster.png"),Buffer.from(frames.frames.at(-1),"base64"));
  }
 }finally{await host.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const dir=resolve(process.argv[2]??"test/tmp/scene-assembly-evidence");
 mkdirSync(dir,{recursive:true});
 const build=buildAssemblyExperiment();
 writeFileSync(join(dir,"solstice-original.riv"),Buffer.from(build.originalBytes));
 writeFileSync(join(dir,"solstice-seconds-only.riv"),Buffer.from(build.typedBytes));
 writeFileSync(join(dir,"solstice-slot-evidence.json"),JSON.stringify(build.typed.evidence,null,2)+"\n");
 const summary={binaryRoundtrip:"PASS",pivot:checkSecondsPivot(build.typed.scene),
  onlySecondHandMoves:checkExclusiveSecondHandMotion(build.typed.scene),
  originalBytes:build.originalBytes.length,typedBytes:build.typedBytes.length,
  originalShapes:build.original.shapes.length,originalGroups:build.original.groups.length,
  typedGroups:build.typed.scene.groups.length};
 if(process.argv.includes("--render"))await renderComparison(build,dir);
 writeFileSync(join(dir,"summary.json"),JSON.stringify(summary,null,2)+"\n");
 console.log(JSON.stringify(summary));
}
