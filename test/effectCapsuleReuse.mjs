import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createStudioScene} from "../scripts/studio-foundry-scenes.mjs";
import {CAPSULE_IDS,VARIANTS,extractExistingEffect,applyExistingEffect,renderVariantScene} from "../scripts/effect-capsule-reuse.mjs";
const data=JSON.parse(readFileSync("data/effect-capsules/reusable-studio-fx.v1.json","utf8"));
assert.equal(CAPSULE_IDS.length,12);
assert.equal(VARIANTS.length,8);
assert.equal(new Set(CAPSULE_IDS).size,CAPSULE_IDS.length);
let totalCopied=0,totalSourceTracks=0;
for(const id of CAPSULE_IDS){
 const src=extractExistingEffect(id);
 assert.ok(src.shapes.length>=1,id+" no source shapes");
 assert.ok(src.provenance.sourceGeometryHash.length===64);
 assert.equal(src.provenance.rights,"project-original");
 const sourceScene=createStudioScene(src.spec.sourceScene);
 for(const shape of src.shapes)
  assert.deepEqual(shape,sourceScene.shapes.find(s=>s.id===shape.id),
   "Capsule shape MUST preserve source drawn geometry/materials");
 totalCopied+=src.shapes.length;
 totalSourceTracks+=src.tracks.length;
}
for(const id of VARIANTS){
 const {scene,evidence,bytes,baselineBytes,variant}=renderVariantScene(id);
 assert.equal(Buffer.from(bytes).subarray(0,4).toString("ascii"),"RIVE");
 assert.ok(bytes.length>2000);
 assert.notDeepEqual(Buffer.from(bytes),Buffer.from(baselineBytes));
 assert.ok(evidence.effectNodeIds.length>0);
 const native=scene.animations.find(a=>a.name==="Reveal");
 const names=new Set([...scene.groups,...scene.shapes,...scene.texts].map(x=>x.id));
 const ns="fx_"+variant.capsuleId.replaceAll("-","_");
 assert.equal(scene.groups.find(g=>g.id===ns)?.parent,"hero");
 assert.ok(evidence.effectNodeIds.every(id=>names.has(id)&&id.startsWith(ns+"__")));
 assert.ok(evidence.importedTracks>=0);
 assert.ok(native.tracks.filter(x=>x.target.startsWith("fx_")).length>=evidence.importedTracks);
 assert.equal(evidence.humanAestheticRating,"NOT_EVALUATED");
}
assert.throws(()=>applyExistingEffect("vesper","joy-sparkle"),/Semantically invalid/);
assert.throws(()=>applyExistingEffect("meridian","organic-dew"),/Semantically invalid/);
assert.throws(()=>applyExistingEffect("prism","organic-dew",{scale:12}),/Invalid effect attachment/);
assert.throws(()=>applyExistingEffect("prism","organic-dew",{x:NaN}),/Invalid effect attachment/);
assert.throws(()=>extractExistingEffect("made-up-effect"),/FX unknown/);
assert.equal(data.entries,undefined);
console.log(JSON.stringify({result:"PASS",existingCapules:CAPSULE_IDS.length,
 exampleTransferScenes:VARIANTS.length,copiedSourceVectorNodes:totalCopied,
 existingAuthoredTracks:totalSourceTracks,negativeTests:5}));
