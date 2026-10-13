// Structural and evidence-gate regression suite; does not pretend to blind-rate artwork.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {analyzeCatalog,buildClusters,promotionDecision,promote} from "../scripts/motif-distill-core.mjs";
import {materialize} from "../scripts/motif-distill-catalog.mjs";
import {makeIntervention,measureIntervention,MOTIFS,DOMAINS} from "../scripts/motif-distill-ablate.mjs";
import {createRiv} from "../dist/rivWriter.js";

const catalog=JSON.parse(readFileSync(new URL("../data/motion-recipes/catalog.v1.json",import.meta.url)));
const discoveries=JSON.parse(readFileSync(new URL("../data/motion-motifs/discovery.v1.json",import.meta.url)));
const all=analyzeCatalog(catalog);
assert.equal(catalog.recipes.length,60);
assert.equal(all.length,60);
assert.equal(new Set(all.map(x=>x.id)).size,60);
assert.equal(materialize().analyses.length,60);
assert.ok(buildClusters(all).every(x=>x.relation==="similar-signature-not-equivalent"));
for(const a of all){
 assert.equal(a.stage,"discovery-only");
 assert.equal(a.roles.length,catalog.recipes.find(r=>r.id===a.provenance.recipeId).roles.length);
 assert.equal(a.timeline.edgeMeaning,"ordering-only-not-dependency-proof");
 assert.ok(a.roles.every(x=>x.primitiveGeometry.status==="unknown"));
 assert.ok(a.timeline.edges.every(x=>x.causality==="unverified"));
 assert.equal(a.evidence.blindHumanRating,"NOT_EVALUATED");
 assert.equal(promotionDecision(a,"buildable").allowed,false);
}
assert.equal(discoveries.entries.length,36);
assert.equal(new Set(discoveries.entries.map(x=>x.id)).size,36);
assert.ok(new Set(discoveries.entries.map(x=>x.discipline)).size>=10);
assert.ok(discoveries.entries.every(x=>x.stage==="discovery-only" &&
 x.references.length===0 && x.evidence.rendering==="NOT_EVALUATED"));
assert.throws(()=>analyzeCatalog({recipes:[catalog.recipes[0],catalog.recipes[0]]}),/Duplicate recipe/);

const blank=structuredClone(all[0]);
assert.equal(promotionDecision(blank,"cross-domain-tested").allowed,false);
const hashes="a".repeat(64);
const fixture={id:"synthetic",stage:"discovery-only",
 provenance:{sourceSha256:hashes,sourceRights:{reviewed:true,status:"self-authored",evidenceSha256:hashes,
  grants:{adapt:true,render:true,embed:true,redistribute:true}},
  embeddedAssets:[{sha256:hashes,rightsEvidenceSha256:hashes,licenseReviewed:false,grants:{embed:true,redistribute:true}}]},
 geometry:{status:"verified",editableSourcePath:"synthetic.rml"},
 causal:{interventions:[{remove:"glint"}]}};
assert.match(promotionDecision(fixture,"buildable").errors.join(" "),/rights/);
fixture.provenance.embeddedAssets[0].licenseReviewed=true;
assert.equal(promotionDecision(fixture,"buildable").allowed,true);
const built=promote(fixture,"buildable");
assert.equal(promotionDecision(built,"cross-domain-tested").allowed,false,"no skipped stages");
assert.match(promotionDecision(built,"rendered").errors.join(" "),/runtime/);
built.renderEvidence={riveSha256:hashes,runtimeVersion:"2.42.1",inspectPassed:true,
 frames:[{sha256:hashes},{sha256:hashes}]};
const rendered=promote(built,"rendered");
rendered.transferTrials=["instrument","parcel-card"].map(domain=>({domain,verified:true,
 ablationEffect:{measured:true,absoluteDifference:1},controlRivSha256:hashes,ablationRivSha256:hashes,
 blindHumanRating:{status:"NOT_EVALUATED",ballots:[]}}));
assert.equal(promotionDecision(rendered,"cross-domain-tested").allowed,false);
rendered.transferTrials.forEach(t=>{t.blindHumanRating={
 status:"EVALUATED",blinded:true,protocolSha256:hashes,ballotEvidenceSha256:hashes,
 ballots:[{raterPseudonym:"r1",choice:"control"},
  {raterPseudonym:"r2",choice:"control"},
  {raterPseudonym:"r3",choice:"ablation"}]};});
assert.equal(promotionDecision(rendered,"cross-domain-tested").allowed,true);
assert.equal(promote(rendered,"cross-domain-tested").stage,"cross-domain-tested");

for(const domain of DOMAINS)for(const motif of MOTIFS){
 const control=makeIntervention(domain,motif,false),ablated=makeIntervention(domain,motif,true);
 assert.equal(control.scene.artboard.name,ablated.scene.artboard.name);
 assert.deepEqual(control.scene.shapes,ablated.scene.shapes,"same art and geometry");
 const unaffected=a=>a.scene.animations[0].tracks.filter(t=>
  !ablated.intervention.changedTracks.includes(t.target+"."+t.property));
 assert.deepEqual(unaffected(control),unaffected(ablated),"only the intended lane can differ");
 const measure=measureIntervention(domain,motif);
 assert.ok(measure.absoluteDifference>0,motif+" must measure distinct interventions");
 assert.equal(measure.blindHumanRating,"NOT_EVALUATED");
 for(const item of [control,ablated]){
  const result=createRiv(item.scene);
  assert.equal(Buffer.from(result.bytes).subarray(0,4).toString("ascii"),"RIVE");
  assert.ok(result.bytes.length>500);
 }
}
console.log("motif distillation: PASS, 60 catalog analyses, 36 discoveries, 12 native Rive variants");
