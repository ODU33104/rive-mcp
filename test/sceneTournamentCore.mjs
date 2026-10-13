import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PASS,FAIL,UNKNOWN,pivotCheck,motionCheck,visualCheck,worldPoint,evaluate} from "../scripts/scene-tournament-verify.mjs";
import {comparability} from "../scripts/scene-tournament-pack.mjs";
const prompts=JSON.parse(readFileSync(new URL("../data/motion-eval/frozen-prompts.v1.json",import.meta.url),"utf8"));
assert.equal(prompts.schema,"scene-tournament-prompts/v1");
assert.equal(prompts.cases.length,100);
for(const [bucket,n] of Object.entries({existing:40,novel:20,"hard-negative":20,oos:20}))
  assert.equal(prompts.cases.filter(x=>x.bucket===bucket).length,n);
assert.equal(new Set(prompts.cases.map(x=>x.id)).size,100);
assert.equal(new Set(prompts.cases.map(x=>x.prompt)).size,100);
assert.match(prompts.authoring,/NOT an independent/);
for(const row of prompts.cases) {
  assert.ok(row.expected.intent&&row.expected.required&&row.expected.forbidden);
  assert.equal(row.expected.abstain,row.bucket==="oos");
  if(row.bucket==="hard-negative")assert.ok(row.expected.motion.length);
}
const base={
 artboard:{name:"Toy",width:400,height:250},
 groups:[{id:"watch",x:100,y:100},{id:"minuteHand",parent:"watch",x:0,y:0,rotation:0}],
 shapes:[{id:"caseMetal",type:"ellipse",parent:"watch",x:0,y:0,width:200,height:200}],
 texts:[{id:"headline",x:30,y:30,width:100,runs:[{text:"A",fontSize:30}]}],
 animations:[{name:"Reveal",duration:60,fps:60,tracks:[
  {target:"watch",property:"x",keyframes:[{frame:0,value:100,easing:"linear"},{frame:60,value:130}]}
 ]}]
};
const p={nodePath:"minuteHand",referencePath:"watch",frames:[0,30,60],tolerancePx:0.5};
assert.equal(pivotCheck(base,p).status,PASS);
assert.deepEqual(worldPoint(base,"minuteHand",[0,0],30).value,[115,100]);
const pivotTamper=structuredClone(base);
pivotTamper.groups.find(x=>x.id==="minuteHand").x+=8;
const pivotViolation=pivotCheck(pivotTamper,p);
assert.equal(pivotViolation.status,FAIL);
assert.ok(pivotViolation.observedPx>7.99);
const minuteTamper=structuredClone(base);
minuteTamper.animations[0].tracks.push({target:"minuteHand",property:"rotation",
  keyframes:[{frame:0,value:0},{frame:60,value:40}]});
assert.equal(motionCheck(base,{kind:"forbid-rotation",target:"minuteHand"}).status,PASS);
assert.equal(motionCheck(minuteTamper,{kind:"forbid-rotation",target:"minuteHand"}).status,FAIL);
assert.equal(motionCheck(base,{kind:"no-bounce",target:"watch",property:"x"}).status,PASS);
assert.equal(motionCheck(base,{kind:"only-x",target:"watch"}).status,PASS);
const xyTamper=structuredClone(base);
xyTamper.animations[0].tracks.push({target:"watch",property:"y",
  keyframes:[{frame:0,value:100},{frame:60,value:105}]});
assert.equal(motionCheck(xyTamper,{kind:"only-x",target:"watch"}).status,FAIL);
const bounceTamper=structuredClone(base);
bounceTamper.animations[0].tracks[0].keyframes.splice(1,0,{frame:30,value:145,easing:"linear"});
assert.equal(motionCheck(bounceTamper,{kind:"no-bounce",target:"watch",property:"x"}).status,FAIL);
const eased=structuredClone(base);eased.animations[0].tracks[0].keyframes[0].easing="ease-out-back";
assert.equal(motionCheck(eased,{kind:"no-bounce",target:"watch",property:"x"}).status,UNKNOWN);
assert.equal(visualCheck(base,{kind:"text-overflow",target:"headline"}).status,UNKNOWN);
assert.equal(visualCheck(base,{kind:"clip",target:"caseMetal"}).status,UNKNOWN);
assert.equal(visualCheck(base,{kind:"text-overflow",target:"headline"},{headline:{
  actualRiveRender:true,measuredGlyphBounds:{x:30,y:30,width:105,height:25},
  visibleClipBounds:{x:30,y:30,width:100,height:25}
}}).status,FAIL,"synthetic measured-glyph fixture");
assert.equal(evaluate(pivotTamper,{pivots:[p]}).status,FAIL);
const common={promptId:"hard-negative-001",holdoutMembership:true,budget:{model:"same",candidates:2,repairs:1,tokenCap:2000},
 assets:[{path:"art.svg",hash:"sha256-a",rights:"allow"}],render:{status:PASS},png:[{path:"a.png"}],fallbackFrom:null};
const a={...common,id:"a",route:"A"},b={...common,id:"b",route:"B"};
assert.equal(comparability(a,b).status,"COMPARABLE_ON_DECLARED_CONTROLS");
assert.equal(comparability(a,{...b,budget:{...b.budget,repairs:3}}).status,"NOT_COMPARABLE");
assert.equal(comparability(a,{...b,fallbackFrom:"C"}).status,"NOT_COMPARABLE");
assert.equal(comparability(a,{...b,assets:[{...b.assets[0],hash:null}]}).status,"NOT_COMPARABLE");
console.log("sceneTournamentCore: PASS — frozen 100, pivot +8px, forbidden hand, bounce, only-X, overflow unknown/failure, comparability");
