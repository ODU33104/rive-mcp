import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {planConstructiveScene,makeConstructiveScene,validateConstructiveSlots,
  writeConstructiveScene} from "../scripts/constructive-scene-agent.mjs";

const fixtures=JSON.parse(readFileSync(new URL("../samples/constructive-scene/prompts.json",import.meta.url),"utf8"));
test("six bilingual prompts construct three unrelated editable topologies",()=>{
  const domains=new Set(),fingerprints=new Set();
  for(const item of fixtures){
    const plan=planConstructiveScene(item.prompt);
    assert.equal(plan.status,"PLANNED",item.id+":"+plan.reason);
    domains.add(plan.design.domain);
    const a=makeConstructiveScene(plan);
    assert.ok(a.scene.groups.length>=2);
    assert.ok(a.scene.shapes.length>=12);
    assert.ok(a.verifiedSlots.length>=2);
    assert.ok(a.scene.animations[0].tracks.length>=2);
    assert.deepEqual(makeConstructiveScene(plan).scene,a.scene,"deterministic repeat");
    fingerprints.add(JSON.stringify([a.scene.shapes.map(s=>[s.id,s.type,s.points?.length,s.x,s.y,s.width,s.height]),a.scene.groups.map(g=>[g.id,g.x,g.y])]));
  }
  assert.deepEqual([...domains].sort(),["earbuds","instrument","poster"]);
  assert.equal(fingerprints.size,6,"different prompts must vary actual geometry, not merely text/colors");
});
test("strongly typed child pivots are world-validated and tampering fails",()=>{
  const plan=planConstructiveScene(fixtures[0].prompt);
  const out=makeConstructiveScene(plan);
  assert.ok(out.slots.some(s=>s.role==="earbud.stem"&&s.anchor.x!==0));
  assert.ok(out.slots.some(s=>s.role==="earbud.case"&&s.anchor.y!==0));
  const stem=out.scene.groups.find(g=>g.id==="stemL");
  stem.x+=5;
  assert.throws(()=>validateConstructiveSlots(out.scene,out.slots),/pivot shifted/);
});
test("motion respects no bounce, no spin and case-only without silent fallback",()=>{
  for(const prompt of [
    "イヤホン ケースだけ動かして バウンスなし",
    "軌道計器を回転させない",
    "floating open premium earbuds, do not spin",
    "bold typographic poster with no bounce"
  ]){
    const plan=planConstructiveScene(prompt);
    assert.equal(plan.status,"PLANNED");
    const {scene}=makeConstructiveScene(plan);
    const tracks=scene.animations[0].tracks;
    assert.ok(tracks.every(t=>t.keyframes.every(k=>!/back|elastic|bounce/.test(k.easing??""))));
    if(plan.design.constraints.noSpin)assert.ok(tracks.every(t=>t.property!=="rotation"));
    if(plan.design.constraints.onlyCase)
      assert.ok(tracks.every(t=>["caseRig","lidRig"].includes(t.target)));
  }
});
test("ambiguous, unknown and unsupported jobs abstain explicitly",()=>{
  const bad=["","a dinosaur running","watch with only seconds hand",
    "イヤホンで秒針だけ動かす","時計 秒針だけ","a 3D model of premium earbuds",
    "orbital instrument and earbuds together","長い日本語本文のタイポグラフィポスター"];
  for(const prompt of bad){
    const result=planConstructiveScene(prompt);
    assert.equal(result.status,"ABSTAIN",prompt);
    assert.ok(result.reason);
  }
});
test("constructive scene never splices GOLD/watch stems into earbuds",()=>{
  const {scene}=makeConstructiveScene(planConstructiveScene(fixtures[0].prompt));
  assert.ok(scene.shapes.some(s=>s.id==="budLstem"));
  assert.ok(scene.shapes.every(s=>!s.id.toLowerCase().includes("seconds")));
  assert.ok(scene.groups.some(g=>g.id==="stemL"));
  assert.ok(!scene.groups.some(g=>g.id==="watch"));
});
test("generated binary is a real RIVE file with deterministic digest",async()=>{
  const dir=fileURLToPath(new URL("../test/tmp/constructive-scene-smoke/",import.meta.url));
  const {output,evidence}=await writeConstructiveScene(fixtures[0].prompt,
    dir+"test.riv");
  assert.ok(output.endsWith("test.riv"));
  assert.equal(readFileSync(output).subarray(0,4).toString(),"RIVE");
  assert.equal(evidence.renderStatus,"NOT_RENDERED");
  assert.ok(evidence.riveSha256);
});
