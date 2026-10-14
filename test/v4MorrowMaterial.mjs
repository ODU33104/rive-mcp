import assert from "node:assert/strict";
import {MORROW_VARIANTS,makeMorrowVariant} from "../scripts/v4-morrow-material.mjs";
import {createFlagshipScene} from "../scripts/v3-flagship-scenes.mjs";
assert.deepEqual(MORROW_VARIANTS,["atelier","spectral"]);
const source=createFlagshipScene("vessel").scene;
const noGlassSource=JSON.stringify(source.shapes);
const data=MORROW_VARIANTS.map(makeMorrowVariant);
assert.equal(JSON.stringify(createFlagshipScene("vessel").scene.shapes),noGlassSource,
 "do not mutate baseline source through a renderer/editor");
for(const t of data){
 const {scene,bytes,baselineBytes,report}=t;
 assert.equal(bytes.subarray(0,4).toString("ascii"),"RIVE");
 assert.ok(bytes.length>5000);
 assert.notDeepEqual(bytes,baselineBytes);
 assert.equal(scene.artboard.width,960);
 assert.equal(scene.artboard.height,600);
 assert.ok(scene.shapes.length>source.shapes.length+15);
 assert.ok(scene.shapes.filter(x=>x.fill?.gradient?.type==="radial").length>=5);
 assert.ok(scene.shapes.filter(x=>x.blendMode==="screen").length>=5);
 assert.ok(scene.shapes.filter(x=>x.clipBy==="vesselMask").length>=7);
 const main=scene.groups.find(g=>g.id==="object");
 assert.ok(main.x>=600&&main.x<700,"centralized poster layout must be broken");
 assert.ok(Math.abs(main.y-345)<1e-6);
 const label=scene.texts.find(t=>t.id==="product-title");
 assert.ok(label.y>140&&label.x<100&&label.runs[0].fontSize>=80);
 const actualVisibleGap=(main.x-134*1.15)-
   (label.x+label.runs[0].fontSize*4.85);
 assert.ok(actualVisibleGap>=45,
  "visual-QA failure: large title collides with object silhouette: "+actualVisibleGap);
 assert.ok(scene.shapes.find(s=>s.id==="warm-pool").opacity<.4,
  "source-specific radial light must not form a large flat color circle");
 const track=scene.animations[0].tracks.find(t=>t.target==="object"&&t.property==="scaleX");
 assert.equal(track.keyframes.at(-1).value,1.15);
 const ids=new Set([...scene.groups,...scene.shapes,...scene.texts].map(x=>x.id));
 const lanes=scene.animations[0].tracks.map(x=>x.target+"."+x.property);
 assert.equal(ids.size,scene.groups.length+scene.shapes.length+scene.texts.length);
 assert.equal(lanes.length,new Set(lanes).size);
 assert.equal(report.aestheticHumanReview,"NOT_EVALUATED");
 assert.equal(report.releaseStatus,"PROTOTYPE");
 assert.ok(report.material.nonFXMaterialLayers>=20);
 assert.deepEqual(makeMorrowVariant(t.variant).bytes,bytes,"pure deterministic Rive");
}
assert.equal(data[0].report.transferredSource,null);
assert.equal(data[1].report.transferredSource.sourceScene,"prism");
assert.equal(data[1].report.transferredSource.sourceCapsule,"spectral-beams");
assert.equal(data[1].report.transferredSource.shapes,8);
assert.equal(data[1].report.transferredSource.tracks,8);
assert.ok(data[1].scene.shapes.some(x=>x.id==="authoredPrism_refraction-0"));
assert.notDeepEqual(data[0].bytes,data[1].bytes);
assert.throws(()=>makeMorrowVariant("invented-bloom"),/Unknown optical comparison variant/);
console.log(JSON.stringify({result:"PASS",candidateCount:data.length,
 sourcePreserved:true,radial:5,mask:true,sourceReusedOnlyInSpectral:true,
 beauty:"NOT_EVALUATED"}));
