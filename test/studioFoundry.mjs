// Per-scene tests are independently run in parallel GitHub Actions matrix jobs.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {SCENE_IDS,buildStudioScene,createStudioScene} from "../scripts/studio-foundry-scenes.mjs";
assert.equal(SCENE_IDS.length,12);
assert.equal(new Set(SCENE_IDS).size,12);
const selected=process.argv[2];
if(selected)assert.ok(SCENE_IDS.includes(selected),"unknown test scene: "+selected);
const results=[];
for(const id of selected?[selected]:SCENE_IDS){
 const {scene,bytes,warnings}=buildStudioScene(id);
 assert.equal(warnings.length,0,JSON.stringify(warnings));
 assert.equal(Buffer.from(bytes).subarray(0,4).toString("ascii"),"RIVE");
 assert.ok(bytes.length>2500,id+" should be a real Rive scene");
 assert.ok(scene.shapes.length>=12,id+" should be an illustrated scene, not a blank preset");
 assert.ok(scene.texts.length>=5,id+" should have visual typographic hierarchy");
 assert.ok(scene.animations[0].tracks.length>=12,id+" needs deliberate temporal staging");
 assert.ok(scene.shapes.some(x=>x.fill?.gradient),id+" needs authored gradient materials");
 const nodes=[...scene.groups,...scene.shapes,...scene.texts];
 const names=new Set(nodes.map(x=>x.id));
 assert.equal(names.size,nodes.length,id+" duplicate IDs");
 for(const n of nodes){if(n.parent)assert.ok(names.has(n.parent),id+" bad parent "+n.id);}
 const lanes=new Set();
 for(const tr of scene.animations[0].tracks){
  assert.ok(names.has(tr.target),id+" broken track target");
  const lane=tr.target+"."+tr.property;
  assert.ok(!lanes.has(lane),id+" duplicate track lane: "+lane);
  lanes.add(lane);
  assert.ok(tr.keyframes.every((k,i)=>Number.isFinite(k.value)&&k.frame>=0&&k.frame<=270&&(i===0||k.frame>tr.keyframes[i-1].frame)),id+" bad frames");
 }
 const signature=createHash("sha256").update(JSON.stringify(scene.shapes.map(s=>[s.id,s.type,s.x,s.y,s.width,s.height,s.parent,s.points]))).digest("hex");
 results.push({id,shapes:scene.shapes.length,bytes:bytes.length,geometryHash:signature});
 assert.equal(JSON.stringify(scene),JSON.stringify(createStudioScene(id)),id+" not deterministic");
}
if(!selected)assert.equal(new Set(results.map(x=>x.geometryHash)).size,12,"all distinct geometries expected");
console.log(JSON.stringify({result:"PASS",scenes:results}));
