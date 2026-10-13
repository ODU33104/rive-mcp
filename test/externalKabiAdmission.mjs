import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {UPSTREAM,POSES,getAdmissionInformation} from "../scripts/external-kabi-admission.mjs";
const s=UPSTREAM;
assert.equal(s.sourceCommit.length,40);
assert.match(s.sourceCommit,/^[a-f0-9]{40}$/);
assert.equal(s.license,"CC-BY-4.0");
assert.equal(s.assetRights.productionPromotion,"BLOCKED_PENDING_EMBEDDED_SOURCE_RIGHTS");
assert.ok(s.repository.startsWith("https://github.com/"));
assert.equal(POSES.length,4);
assert.equal(new Set(POSES.map(x=>x.pose)).size,4);
assert.ok(POSES.every(x=>Number.isInteger(x.pose)&&x.pose>=0&&x.pose<=28));
const root=process.argv[2];
if(root){
 const {riv,source,model,report}=getAdmissionInformation(root);
 assert.equal(riv.subarray(0,4).toString("ascii"),"RIVE");
 assert.ok(source.length>10000);
 assert.ok(model.shapes.length>=100&&model.animations.length>=65);
 assert.equal(report.status,"SOURCE_BYTES_VERIFIED_NOT_YET_RENDERED");
 assert.equal(report.sha256.riv.length,64);
 assert.ok(!report.status.includes("PRODUCTION"));
}
console.log("external Kabi CC BY source admission: PASS (work-level license plus editable source geometry, no unsupported redistribution claim)");
