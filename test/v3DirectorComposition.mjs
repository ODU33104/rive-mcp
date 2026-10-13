import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {DIRECTOR_CONCEPTS,PORTFOLIO_FIXTURES,planPortfolioPrompt,buildPortfolioScene} from "../scripts/v3-director-composition.mjs";
assert.deepEqual(DIRECTOR_CONCEPTS,["optics","crystal","celestial","silicon"]);
assert.deepEqual(Object.keys(PORTFOLIO_FIXTURES),DIRECTOR_CONCEPTS);
const hashes=new Set();
for(const id of DIRECTOR_CONCEPTS){
 const output=buildPortfolioScene(PORTFOLIO_FIXTURES[id]);
 assert.equal(output.plan.status,"PLANNED");
 assert.equal(output.plan.id,id);
 assert.ok(output.plan.effectId);
 assert.equal(output.bytes.subarray(0,4).toString("ascii"),"RIVE");
 assert.notDeepEqual(output.bytes,output.beforeBytes);
 assert.equal(output.evidence.fx.knownLicense.startsWith("repo-original"),true);
 assert.ok(output.evidence.fx.importedNodes>=1);
 assert.ok(output.evidence.fx.originalGeometryHash.length===64);
 assert.ok(output.evidence.fx.importedTracks>=0);
 assert.equal(output.evidence.renderStatus,"NOT_RENDERED_BY_BUILDER");
 assert.equal(output.evidence.blindHumanQuality,"NOT_EVALUATED");
 const a=[...output.scene.groups,...output.scene.shapes,...output.scene.texts];
 const names=new Set(a.map(n=>n.id));assert.equal(names.size,a.length);
 assert.ok(a.every(n=>!n.parent||names.has(n.parent)));
 const lanes=output.scene.animations[0].tracks.map(t=>t.target+"."+t.property);
 assert.equal(new Set(lanes).size,lanes.length);
 assert.ok(output.scene.shapes.some(s=>s.id.startsWith("directorFx__")));
 const digest=createHash("sha256").update(output.bytes).digest("hex");
 hashes.add(digest);
 assert.deepEqual(buildPortfolioScene(PORTFOLIO_FIXTURES[id]).bytes,output.bytes);
}
assert.equal(hashes.size,4);
for(const prompt of [
 "an unlicensed character", "camera and a planet together, spectral refraction",
 "camera, lens refraction, no glow", "camera, no bounce and spectral refraction",
 "prism crystal sparkle without spin", "an optical camera, physics simulation",
 "半導体チップだけ動かす", "", "camera, random particle system effect"
]){
 assert.equal(planPortfolioPrompt(prompt).status,"ABSTAIN",prompt);
}
const plain=buildPortfolioScene("Cinematic optical camera studio");
assert.equal(plain.plan.status,"PLANNED");
assert.equal(plain.evidence.fx,null);
assert.deepEqual(plain.bytes,plain.beforeBytes);
console.log(JSON.stringify({status:"PASS",genuineRiveCombinedScenes:4,
 visibleProof:"REQUIRES_NATIVE_CI_RUNTIME",outOfScopeAbstentionPrompts:9,
 humanQuality:"NOT_EVALUATED"}));
