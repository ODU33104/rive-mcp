import assert from "node:assert/strict";
import {createRiv} from "../dist/rivWriter.js";
import {makeGoldScene} from "../scripts/build-motion-atlas-gold.mjs";
import {
 decomposeSolstice,recomposeSolstice,makeSecondHandSlotVariant,
 makeTamperedPivotVariant,checkSecondsPivot,checkExclusiveSecondHandMotion,
 buildAssemblyExperiment
} from "../scripts/scene-assembly-lab.mjs";

const original=makeGoldScene(),m=decomposeSolstice(original);
assert.equal(m.schema,"solstice-semantic-assembly/v1");
const families=Object.keys(m.components);
assert.deepEqual(families,["environment","watch","copy"]);
for(const bucket of ["groups","shapes","texts"])
 assert.equal(families.reduce((n,f)=>n+m.components[f][bucket].length,0),original[bucket].length);
assert.ok(m.components.watch.shapes.some(s=>s.node.id==="smallSeconds"));
assert.ok(m.components.copy.texts.some(s=>s.node.id==="heroLine1"));
assert.ok(m.components.environment.shapes.some(s=>s.node.id==="nightGradient"));
const restored=recomposeSolstice(m);
assert.deepEqual(restored,original,"full semantic assembly roundtrip, including font and timeline");
assert.deepEqual(Buffer.from(createRiv(restored).bytes),Buffer.from(createRiv(original).bytes));

const bad=decomposeSolstice(original);
bad.components.environment.shapes[0].index=bad.components.environment.shapes[1].index;
assert.throws(()=>recomposeSolstice(bad),/missing or duplicate ordering indices/);
const missing=decomposeSolstice(original);
missing.components.watch.groups[0].node.id="lost-watch";
assert.throws(()=>recomposeSolstice(missing),/missing parent|missing animation target/);

const {scene,evidence}=makeSecondHandSlotVariant(original);
assert.equal(evidence.slotId,"watch.subdial.second");
assert.deepEqual(evidence.domain,undefined); // semantic contracts use domain list not generic category
assert.deepEqual(evidence.allowedMotion,["secondsRig.rotation"]);
assert.equal(scene.groups.length,original.groups.length+1);
assert.equal(scene.shapes.length,original.shapes.length);
assert.equal(scene.texts.length,original.texts.length);
assert.equal(scene.animations[0].tracks.length,1);
assert.deepEqual(scene.animations[0].tracks.map(t=>t.target),["secondsRig"]);
const seconds=scene.shapes.find(s=>s.id==="smallSeconds");
const pin=scene.shapes.find(s=>s.id==="smallSecondsPin");
assert.equal(seconds.parent,"secondsRig");
assert.equal(pin.parent,"secondsRig");
assert.deepEqual(seconds.points.map(p=>[p.x,p.y]),[[0,21],[10,-11]]);
assert.equal(pin.y,0);
assert.equal(checkSecondsPivot(scene).status,"PASS");
assert.equal(checkExclusiveSecondHandMotion(scene).status,"PASS");
assert.ok(createRiv(scene).bytes.length>3000);
assert.equal(Buffer.from(createRiv(scene).bytes).subarray(0,4).toString("ascii"),"RIVE");

const brokenPivot=makeTamperedPivotVariant();
assert.equal(checkSecondsPivot(brokenPivot).status,"FAIL");
assert.ok(checkSecondsPivot(brokenPivot).distancePx>=7.9);
const brokenMotion=makeSecondHandSlotVariant().scene;
brokenMotion.animations[0].tracks.push({target:"minuteHand",property:"rotation",keyframes:[
 {frame:0,value:0},{frame:269,value:8}
]});
const wrong=checkExclusiveSecondHandMotion(brokenMotion);
assert.equal(wrong.status,"FAIL");
assert.deepEqual(wrong.illegal,["minuteHand.rotation"]);
const unknown=makeSecondHandSlotVariant().scene;
unknown.animations.push({name:"secondary",duration:270,tracks:[]});
assert.equal(checkExclusiveSecondHandMotion(unknown).status,"UNKNOWN");

const build=buildAssemblyExperiment();
assert.ok(build.originalBytes.length>3000);
assert.ok(build.typedBytes.length>3000);
assert.ok(!Buffer.from(build.originalBytes).equals(Buffer.from(build.typedBytes)),
 "two distinct editable Rive outputs must actually differ");
console.log("scene assembly lab: PASS (semantic roundtrip + binary parity; typed second hand; pivot tamper; exclusive-motion violations)");
