import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {TARGETS,cubicSvgPolygon,importKabiSparkles} from "../scripts/ccby-kabi-sparkle-port.mjs";
assert.deepEqual(TARGETS,["luma","zenith"]);
assert.throws(()=>cubicSvgPolygon("M0 0 Q10 2 5 3 Z"),/Unsupported original SVG command|Lossy imported path/);
assert.throws(()=>cubicSvgPolygon("M0 0L5 5Z"),/Unsupported original SVG command/);
assert.throws(()=>cubicSvgPolygon("M0 0C1 2 3 4 5 6",10),/Unsupported/);
assert.throws(()=>cubicSvgPolygon("M0 0C1 2 3 4 5 6Z",2),/Unsupported/);
const source=process.argv[2];
if(source){
 const bytes=readFileSync(source);
 const variants=TARGETS.map(id=>importKabiSparkles(bytes,id));
 const before=new Set(),after=new Set();
 for(const [i,v] of variants.entries()){
  const id=TARGETS[i];
  assert.equal(v.evidence.importedShapes.length,5);
  assert.equal(v.evidence.originalMotionTracks.length,15);
  assert.equal(v.evidence.targetScene,id);
  assert.equal(v.evidence.license,"CC-BY-4.0");
  assert.equal(v.evidence.qualityReview,"NOT_EVALUATED");
  assert.equal(v.evidence.sourceRightsStatus,"SCOPE_RESTRICTED_REVIEW");
  assert.ok(v.evidence.importedShapes.every(s=>s.pathSha256.length===64));
  assert.equal(v.scene.shapes.filter(s=>s.id.startsWith("kabiCCBY__")).length,5);
  assert.equal(v.scene.animations[0].tracks.filter(s=>s.target.startsWith("kabiCCBY__")).length,15);
  assert.equal(v.after.subarray(0,4).toString("ascii"),"RIVE");
  assert.notDeepEqual(v.before,v.after);
  before.add(v.before.toString("hex"));after.add(v.after.toString("hex"));
  const all=[...v.scene.groups,...v.scene.shapes,...v.scene.texts];
  const names=new Set(all.map(x=>x.id));
  assert.equal(all.length,names.size);
  for(const n of all)if(n.parent)assert.ok(names.has(n.parent),id+" has orphaned source import");
 }
 assert.equal(before.size,2);
 assert.equal(after.size,2);
 assert.throws(()=>importKabiSparkles(bytes,"archive"),/invalid/);
 assert.throws(()=>importKabiSparkles(Buffer.concat([bytes,Buffer.from("x")]),"luma"),/hash changed/);
}
console.log("source-Kabi sparkle port: PASS, 5 licensed vector contours and 15 real animation tracks per host");
