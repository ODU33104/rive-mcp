import assert from "node:assert/strict";
import {STYLEFRAMES,buildRMLStyleframe,materializeRMLStyleframe} from "../scripts/rml-direct-authoring.mjs";
const hashes=new Set(),bounds=[];
assert.deepEqual(STYLEFRAMES,["halo","origin","signal"]);
for(const id of STYLEFRAMES){
 const v=buildRMLStyleframe(id);
 assert.ok(v.rml.includes('<Rive version="1" kind="fragment">'));
 assert.ok(v.rml.includes('<StateMachine'));
 assert.ok(v.rml.includes('<LinearAnimation'));
 assert.equal((v.rml.match(/<KeyedObject /g)||[]).length,4);
 assert.equal((v.rml.match(/<Shape id=/g)||[]).length,4);
 assert.ok(v.rml.includes("frame=\"180\""));
 assert.ok(v.evidence.sourceSha256.length===64);
 assert.equal(v.evidence.subjectiveVisualQuality,"NOT_EVALUATED");
 hashes.add(v.evidence.sourceSha256);
 bounds.push(v.evidence.geometry.map(g=>g.x+":"+g.y));
 assert.deepEqual(buildRMLStyleframe(id),v);
}
assert.equal(hashes.size,3);
assert.equal(new Set(bounds.map(v=>v.join("/"))).size,3);
assert.throws(()=>buildRMLStyleframe("bad"),/Unsupported/);
assert.throws(()=>buildRMLStyleframe("../bad"),/Unsafe/);
const output=process.argv[2];
if(output){
 for(const id of STYLEFRAMES)
  assert.ok(materializeRMLStyleframe(id,output).directory.endsWith("/"+id));
}
console.log("PASS: three original distinct first-party RML source scenes with native state-machine animation");
