import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {
  planConstructiveScene,makeConstructiveScene,validateConstructiveSlots,writeConstructiveScene
} from "../scripts/v3-construct-agent.mjs";

const accepted=JSON.parse(readFileSync(new URL("../samples/v3-construct/prompts.json",import.meta.url),"utf8"));
const holdouts=JSON.parse(readFileSync(new URL("../samples/v3-construct/holdouts.json",import.meta.url),"utf8"));

test("frozen JP/EN prompts produce planned or explicit abstained results",()=>{
  assert.ok(holdouts.length>=12);
  assert.ok(holdouts.some(x=>/[\u3040-\u30ff\u4e00-\u9fff]/u.test(x.prompt)));
  assert.ok(holdouts.some(x=>!/[\u3040-\u30ff\u4e00-\u9fff]/u.test(x.prompt)));
  for(const request of holdouts){
    const p=planConstructiveScene(request.prompt);
    assert.equal(p.status,request.expected,request.id+": "+p.reason);
    if(p.status==="ABSTAIN")assert.ok(p.reason && p.capability);
  }
});
test("at least eight distinct scene constructions span four substantive shape domains",()=>{
  const domains=new Set(),fingerprints=new Set(),stage=new Set();
  for(const item of accepted){
    const p=planConstructiveScene(item.prompt);
    assert.equal(p.status,"PLANNED",item.id);
    assert.equal(p.design.domain,item.domain,item.id);
    assert.ok(p.design.components.every(c=>c.anchorUnits && c.geometryTemplate && c.sourceId));
    assert.equal(p.design.sourceManifest.geometry.externalMedia,false);
    assert.ok(p.design.camera.width>0&&p.design.camera.height>0);
    const a=makeConstructiveScene(p);
    assert.ok(a.verifiedSlots.length>=2);
    assert.ok(a.scene.shapes.length>=12);
    assert.ok(a.scene.animations[0].tracks.length>=2);
    assert.deepEqual(makeConstructiveScene(p).scene,a.scene);
    domains.add(p.design.domain);
    fingerprints.add(JSON.stringify(a.scene.shapes.map(s=>[s.id,s.type,s.points?.length,s.x,s.y,s.width,s.height])));
    stage.add(JSON.stringify(a.scene.animations[0].tracks.map(t=>[t.target,t.property,t.keyframes])));
    assert.ok(a.scene.shapes.every(s=>s.sourceId==="original:procedural-v3"));
  }
  assert.deepEqual([...domains].sort(),["earbuds","instrument","poster","transit"]);
  assert.equal(fingerprints.size,accepted.length,"topology must differ beyond color/text");
  assert.ok(stage.size>=6,"timelines must respond to subject/staging constraints");
});
test("semantically typed rigs have real parent/world pivots; broken anchors fail",()=>{
  for(const item of accepted){
    const a=makeConstructiveScene(planConstructiveScene(item.prompt));
    assert.ok(a.slots.every(s=>Number.isFinite(s.anchor.x)&&Number.isFinite(s.anchor.y)));
    assert.ok(a.slots.some(s=>s.anchor.x!==0||s.anchor.y!==0));
    if(item.domain==="transit")assert.ok(a.slots.some(s=>s.role==="transit.station"));
  }
  const a=makeConstructiveScene(planConstructiveScene(accepted[0].prompt));
  a.scene.groups.find(g=>g.id==="stemL").x+=7;
  assert.throws(()=>validateConstructiveSlots(a.scene,a.slots),/pivot shifted/);
});
test("hard negatives are track exclusions, not lexical tags",()=>{
  for(const request of [
    "イヤホン ケースだけ動かして バウンスなし",
    "精密な軌道計器を回転させない",
    "premium earbuds floating open, do not spin",
    "bold typographic poster without bounce",
    "transit map no spin, no bounce"
  ]){
    const p=planConstructiveScene(request);
    assert.equal(p.status,"PLANNED",request);
    const tracks=makeConstructiveScene(p).scene.animations[0].tracks;
    if(p.design.constraints.noSpin)assert.ok(tracks.every(t=>t.property!=="rotation"),request);
    if(p.design.constraints.onlyCase)assert.ok(tracks.every(t=>["caseRig","lidRig"].includes(t.target)),request);
    if(p.design.constraints.noBounce)assert.ok(tracks.every(t=>t.keyframes.every(
      k=>!/bounce|elastic|back/i.test(k.easing??""))),request);
  }
});
test("transit network connects the requested number of stations",()=>{
  for(const [prompt,n,edgeCount] of [
    ["urban transit diagram with 4 stations",4,3],
    ["地下鉄の環状線で8駅の路線図",8,8]
  ]){
    const p=planConstructiveScene(prompt);
    assert.equal(p.status,"PLANNED");
    const {scene}=makeConstructiveScene(p);
    assert.equal(scene.shapes.filter(s=>/^stationOuter\d+$/.test(s.id)).length,n);
    assert.equal(scene.shapes.filter(s=>/^routeLine\d+$/.test(s.id)).length,edgeCount);
  }
});
test("real binary writer emits editable RIVE and a receipt, not a pretend success",async()=>{
  const dir=fileURLToPath(new URL("../test/tmp/v3-construct-smoke/",import.meta.url));
  const {output,evidence}=await writeConstructiveScene(accepted[0].prompt,dir+"smoke.riv");
  assert.equal(readFileSync(output).subarray(0,4).toString(),"RIVE");
  assert.ok(evidence.shapeCount>12);
  assert.equal(evidence.renderStatus,"NOT_RENDERED");
  assert.equal(evidence.blindedAesthetics,"NOT_EVALUATED");
  assert.ok(evidence.verifiedSlots.length>=2);
});
