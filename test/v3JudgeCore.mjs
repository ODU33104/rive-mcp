import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PASS,FAIL,UNKNOWN,pivotCheck,motionCheck,visualCheck,worldPoint,evaluate,layoutCheck,fxCheck,identityCheck,rightsDisposition,stopGate} from "../scripts/v3-judge-verify.mjs";
import {comparability} from "../scripts/v3-judge-pack.mjs";
const prompts=JSON.parse(readFileSync(new URL("../data/v3-judge/frozen-prompts.v1.json",import.meta.url),"utf8"));
assert.equal(prompts.schema,"v3-judge-frozen-prompts/v1");
assert.equal(prompts.cases.length,124);
assert.equal(prompts.cases.filter(x=>x.split==="holdout").length,24);
assert.equal(prompts.cases.filter(x=>x.split==="development").length,100);
assert.ok(new Set(prompts.cases.map(x=>x.genre)).size>=5);
for(const [bucket,n] of Object.entries({existing:40,novel:20,"hard-negative":20,oos:20}))
  assert.equal(prompts.cases.filter(x=>x.bucket===bucket).length,n);
assert.equal(new Set(prompts.cases.map(x=>x.id)).size,124);
assert.equal(new Set(prompts.cases.map(x=>x.prompt)).size,124);
assert.match(prompts.authoring,/not independent/i);
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
const common={promptId:"hard-negative-001",holdoutMembership:true,budget:{model:"same",candidates:2,repairs:1,tokenCap:2000,wallTimeCapMs:1000},
 source:{hash:"source-a"},riv:{hash:"binary-a"},rights:{assetsDeclaredComplete:true},durationSeconds:3,gif:{sha256:"gif-a"},
 assets:[{path:"art.svg",hash:"sha256-a",rights:"allow"}],render:{status:PASS},png:[{path:"a.png"}],fallbackFrom:null};
const a={...common,id:"a",route:"finished-scene-edit"},b={...common,id:"b",route:"typed-slot"};
assert.equal(comparability(a,b).status,"COMPARABLE_ON_DECLARED_CONTROLS");
assert.equal(comparability(a,{...b,budget:{...b.budget,repairs:3}}).status,"NOT_COMPARABLE");
assert.equal(comparability(a,{...b,fallbackFrom:"C"}).status,"NOT_COMPARABLE");
assert.equal(comparability(a,{...b,assets:[{...b.assets[0],hash:null}]}).status,"NOT_COMPARABLE");


// Twenty-four named counterexamples, five+ genres, negative-only simulated
// detection. Synthetic measurements never constitute aesthetic/runtime proof.
const hazards=JSON.parse(readFileSync(new URL("../data/v3-judge/hazards.v1.json",import.meta.url),"utf8"));
assert.equal(hazards.schema,"v3-judge-hazards/v1");
assert.equal(hazards.cases.length,24);
assert.ok(new Set(hazards.cases.map(x=>x.genre)).size>=5);
assert.equal(new Set(hazards.cases.map(x=>x.id)).size,24);
for(const h of hazards.cases){
  let observed;
  if(h.kind==="collision")observed=layoutCheck(base,{kind:"collision",target:"hero",other:"copy"},{
    hero:{bounds:{x:40,y:40,width:160,height:140}},
    copy:{bounds:{x:110,y:100,width:200,height:50}}});
  else if(h.kind==="crop")observed=layoutCheck(base,{kind:"crop",target:"subject"},{
    artboard:{bounds:{x:0,y:0,width:400,height:250}},
    subject:{bounds:{x:390,y:70,width:35,height:100}}});
  else if(h.kind==="text-clipping")observed=visualCheck(base,{kind:"text-overflow",target:"headline"},{headline:{
    actualRiveRender:true,measuredGlyphBounds:{x:60,y:25,width:150,height:44},
    visibleClipBounds:{x:60,y:25,width:120,height:44}}});
  else if(h.kind==="pivot-8px")observed=pivotViolation;
  else if(h.kind==="forbidden-motion")observed=motionCheck(minuteTamper,{kind:"forbid-rotation",target:"minuteHand"});
  else if(h.kind==="silhouette-swap")observed=identityCheck(base,{target:"hero",expectedSubject:"earbud"},{
    hero:{independentlyObservedSubject:"clock",reviewerEvidenceSha256:"fake-fixture-only"}});
  else if(h.kind==="pointless-confetti")observed=fxCheck(base,{
    kind:"pointless-confetti",target:"particles",requestedByPrompt:false,promptEvidenceSha256:"fake-fixture-only"},{
    particles:{present:true}});
  else if(h.kind==="invisible-fx")observed=fxCheck(base,{kind:"invisible-fx",target:"sparkle"},{
    sparkle:{actualRiveRender:true,changedPixelFraction:0}});
  else if(h.kind==="ugly-fx")observed=fxCheck(base,{kind:"ugly-fx",target:"glow"},{
    glow:{actualRiveRender:true,occludedSubjectFraction:0.88}});
  assert.equal(observed.status,FAIL,h.id+" "+h.description);
}
assert.equal(layoutCheck(base,{kind:"negative-space",target:"hero"},{hero:{occupiedFraction:0.95}}).status,FAIL);
assert.equal(layoutCheck(base,{kind:"negative-space",target:"hero"},{hero:{occupiedFraction:0.4}}).status,UNKNOWN);
assert.equal(fxCheck(base,{kind:"invisible-fx",target:"sparkle"},{sparkle:{
  actualRiveRender:true,changedPixelFraction:0.8}}).status,UNKNOWN,"visible change != quality");
assert.equal(identityCheck(base,{target:"hero",expectedSubject:"watch"},{hero:{
  independentlyObservedSubject:"watch",reviewerEvidenceSha256:"test-only"}}).status,UNKNOWN);
assert.equal(rightsDisposition({sourceEvidence:"yes",assetsDeclaredComplete:true,operations:{
  inspect:"allow",render:"allow",adapt:"allow",embed:"allow",redistribute:"deny"}}).status,FAIL);
assert.equal(rightsDisposition({sourceEvidence:"yes",assetsDeclaredComplete:true,operations:{
  inspect:"allow",render:"allow",adapt:"allow",embed:"allow",redistribute:"allow"}},
  [{path:"stolen.svg",rights:"deny",rightsEvidence:"n/a"}]).status,FAIL);
assert.equal(rightsDisposition().status,UNKNOWN);
assert.equal(stopGate({semantic:{status:PASS},structural:{status:PASS},
  binaryStructural:{status:PASS},render:{status:PASS},editability:{status:UNKNOWN},
  licensing:{status:PASS},restrictions:[]}).status,UNKNOWN);
assert.equal(stopGate({semantic:{status:FAIL},structural:{status:PASS},
  binaryStructural:{status:PASS},render:{status:PASS},editability:{status:PASS},
  licensing:{status:PASS},restrictions:[]}).status,FAIL);
assert.equal(comparability(a,{...b,durationSeconds:2}).status,"NOT_COMPARABLE");
assert.equal(comparability(a,{...b,gif:null}).status,"NOT_COMPARABLE");
console.log("v3JudgeCore: PASS — 124 prompts, 24 destructive visual hazards, rights, unknown stops, strict comparison");
