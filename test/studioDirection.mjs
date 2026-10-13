import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createStudioScene} from "../scripts/studio-foundry-scenes.mjs";
import {DIRECTION_IDS,createArtDirectedScene,buildArtDirectedScene} from "../scripts/studio-direction-experiments.mjs";
assert.equal(DIRECTION_IDS.length,8);
const layouts=new Set(),geometry=new Set(),viewports=new Set();
for(const id of DIRECTION_IDS){
 const {scene,provenance,bytes}=buildArtDirectedScene(id);
 const original=createStudioScene(provenance.source);
 const {W,H}= {W:scene.artboard.width,H:scene.artboard.height};
 assert.ok(W>=540&&W<=960&&H>=540&&H<=720);
 assert.ok(W!==original.artboard.width||H!==original.artboard.height,
   id+" should be a materially different composition viewport");
 assert.ok(["portrait","cinematic","square"].includes(provenance.mode));
 assert.equal(scene.artboard.name,"StudioDirection_"+id);
 assert.equal(scene.shapes.length,original.shapes.length);
 assert.ok(scene.texts.length>=5);
 assert.ok(scene.animations[0].tracks.length>=original.animations[0].tracks.length);
 assert.equal(Buffer.from(bytes).subarray(0,4).toString("ascii"),"RIVE");
 const nodes=new Set([...scene.groups,...scene.shapes,...scene.texts].map(n=>n.id));
 assert.equal(nodes.size,scene.groups.length+scene.shapes.length+scene.texts.length);
 for(const n of [...scene.groups,...scene.shapes,...scene.texts])
  if(n.parent)assert.ok(nodes.has(n.parent));
 assert.ok(provenance.humanAestheticRating==="NOT_EVALUATED");
 const hero=scene.groups.find(n=>n.id==="hero");
 const head=scene.groups.find(n=>n.id==="heading");
 assert.deepEqual([hero.x,hero.y],provenance.heroPosition);
 assert.deepEqual([head.x,head.y],provenance.copyPosition);
 const h=scene.texts.find(t=>t.id==="headline");
 assert.ok(h.width<=W&&h.runs[0].fontSize<100);
 if(W===540)assert.ok(head.y>hero.y+200,id+" portrait copy should be physically below the art");
 if(W===960)assert.ok(head.x<hero.x-500,id+" hero/copy cinematic split required");
 if(W===600)assert.ok(head.y>hero.y+150,id+" square layout keeps readable copy below hero");
 assert.deepEqual(buildArtDirectedScene(id).bytes,bytes,id+" deterministic output");
 layouts.add(provenance.mode);viewports.add(W+"x"+H);
 geometry.add(createHash("sha256").update(JSON.stringify({
  artboard:scene.artboard,hero:[hero.x,hero.y],copy:[head.x,head.y],source:provenance.source
 })).digest("hex"));
}
assert.equal(layouts.size,3);
assert.equal(viewports.size,3);
assert.equal(geometry.size,8);
assert.throws(()=>createArtDirectedScene("nonexistent"),/Unknown art direction/);
console.log(JSON.stringify({status:"PASS",layouts:[...layouts],eightRecompositionScenes:DIRECTION_IDS.length,
 visualHumanRating:"NOT_EVALUATED"}));
