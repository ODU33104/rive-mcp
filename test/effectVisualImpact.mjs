import assert from "node:assert/strict";
import {IMPACT_TIMES,summarizeEffectImpact} from "../scripts/effect-visual-impact.mjs";
assert.ok(IMPACT_TIMES.length>=5);
assert.equal(new Set(IMPACT_TIMES).size,IMPACT_TIMES.length);
const mk=(values)=>values.map((p,i)=>({changedPercent:p,diffPixels:Math.round(720*460*p/100),time:i*.4}));
for(const [data,want] of [
 [[0,0,0],"NEGLIGIBLE"],
 [[0,.06,.1],"MICRO"],
 [[.1,.6,1.8],"SUBTLE"],
 [[0,.5,4.2],"VISIBLE"],
 [[.05,1.5,19],"EXTENSIVE"]
]){
 const out=summarizeEffectImpact(mk(data));
 assert.equal(out.classification,want);
 assert.equal(out.aestheticQuality,"NOT_EVALUATED");
 assert.ok(out.maxChangedPercent>=out.meanChangedPercent);
 assert.ok(out.sampledFrames===data.length);
}
assert.equal(summarizeEffectImpact(mk([0,.009])).portabilityGate,"INSUFFICIENT_PIXEL_EVIDENCE");
assert.equal(summarizeEffectImpact(mk([0,.07])).portabilityGate,"VISIBLY_APPLIED");
assert.throws(()=>summarizeEffectImpact([]),/Invalid/);
assert.throws(()=>summarizeEffectImpact(mk([Infinity])),/Invalid/);
assert.throws(()=>summarizeEffectImpact(mk([-1])),/Invalid/);
console.log("effect-visual-impact: PASS, five no-fake-beauty buckets and two real-visible/fail-closed gates");
