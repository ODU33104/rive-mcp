import assert from "node:assert/strict";
import {loadEffects,evaluateAcquisitionPromotion,discoverySummary} from "../scripts/effect-scout-gate.mjs";
const data=loadEffects();
assert.equal(data.entries.length,42);
const ids=new Set(data.entries.map(x=>x.id));assert.equal(ids.size,42);
const cats=new Set(data.entries.map(x=>x.effect.category));assert.ok(cats.size>=10);
for(const e of data.entries){
 assert.equal(e.stage,"reference-only");
 assert.equal(e.downloadedAssetHash,null);
 assert.equal(e.rights.embeddedAssetClearance,"UNKNOWN");
 assert.equal(e.rights.redistribution,"BLOCKED_UNTIL_REVIEW");
 assert.equal(evaluateAcquisitionPromotion(e,null).status,"DENY");
 const fake={workRights:{approvedAdaptation:true,approvedRedistribution:true,openThirdPartyClaims:false},
  assets:[{sha256:"a".repeat(64),distributionAllowed:true}],
  source:{sha256:"f".repeat(64),fileType:"rev"},import:{nodeIds:["fx/glow"]},
  runtime:{verified:true,pngSha256:"e".repeat(64),rivSha256:"c".repeat(64)},
  attribution:{author:e.author,url:e.sourceUrl}};
 assert.equal(evaluateAcquisitionPromotion(e,fake).status,"ELIGIBLE_FOR_HUMAN_VISUAL_REVIEW");
 for(const violation of [
  {...fake,source:{fileType:"gif",sha256:"f".repeat(64)}},
  {...fake,workRights:{...fake.workRights,approvedAdaptation:false}},
  {...fake,assets:[{sha256:"x",distributionAllowed:false}]},
  {...fake,runtime:{...fake.runtime,verified:false}},
  {...fake,attribution:{...fake.attribution,url:"https://example.org"}},
 ]){
  assert.equal(evaluateAcquisitionPromotion(e,violation).status,"DENY",e.id);
 }
}
assert.equal(discoverySummary().readyToReuse,0);
console.log(JSON.stringify({status:"PASS",marketplaceSources:data.entries.length,
 categories:cats.size,readyToReuse:0,adversarialPolicyChecks:42*5}));
