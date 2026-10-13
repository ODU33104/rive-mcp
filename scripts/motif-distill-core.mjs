// Independent causal analyses of catalog timing; NEVER asserts rendered, licensed, or proven effects.
import {createHash} from "node:crypto";

export const MOTIF_SCHEMA="causal-motif/v1";
export const STAGES=["discovery-only","buildable","rendered","cross-domain-tested"];
const hash=x=>createHash("sha256").update(typeof x==="string"?x:JSON.stringify(x)).digest("hex");
const roleKind=r=>{
 if(/shadow|floor|ground/i.test(r))return "grounding-decoration";
 if(/glint|spark|halo|glow|orbit|trail|ring|particle/i.test(r))return "decorative-accent";
 if(/caption|title|headline|label|copy|text|letter|word/i.test(r))return "semantic-copy";
 if(/hero|product|card|panel|character|icon|mark|button|object/i.test(r))return "primary-component-candidate";
 return "unknown";
};
export function analyzeRecipe(recipe){
 if(!recipe || !recipe.id || !Array.isArray(recipe.roles) || !Array.isArray(recipe.structure?.steps))
  throw Error("Recipe requires id, roles and structure.steps");
 const steps=recipe.structure.steps.map((s,i)=>({
  index:i,role:s.role,property:s.property,from:s.from,to:s.to,
  startMs:s.atMs,endMs:s.atMs+s.durationMs,easing:s.easing??"unknown"
 }));
 const roles=recipe.roles.map(id=>{
  const lane=steps.filter(x=>x.role===id);
  return {id,semanticRole:roleKind(id),roleInterpretation:"heuristic-unverified",
   animatedProperties:[...new Set(lane.map(s=>s.property))].sort(),
   firstMotionMs:lane.length?Math.min(...lane.map(s=>s.startMs)):null,
   finalMotionMs:lane.length?Math.max(...lane.map(s=>s.endMs)):null,
   primitiveGeometry:{status:"unknown",shape:null,source:"timing-catalog-has-no-geometry"},
   localPivot:{status:"unknown"},attachment:{status:"unknown"}};
 });
 const edges=[];
 for(const a of roles)for(const b of roles){
  if(a.id===b.id || a.firstMotionMs===null || b.firstMotionMs===null)continue;
  if(a.firstMotionMs < b.firstMotionMs)
   edges.push({from:a.id,to:b.id,kind:"observed-start-precedence",
    offsetMs:b.firstMotionMs-a.firstMotionMs,causality:"unverified"});
 }
 edges.sort((a,b)=>a.from.localeCompare(b.from)||a.to.localeCompare(b.to));
 const signature=recipe.roles.map(r=>roleKind(r)).sort().join(",")+"|"+
  steps.map(s=>s.property+":"+Math.sign(s.to-s.from)).sort().join(",");
 return {
  schema:MOTIF_SCHEMA,id:"catalog-"+recipe.id,title:recipe.title,
  lane:"catalog-analysis",stage:"discovery-only",
  provenance:{kind:"catalog-derived",catalogPath:"data/motion-recipes/catalog.v1.json",
   recipeId:recipe.id,recipeSha256:hash(recipe),originClaim:recipe.origin??"unknown",
   referenceIds:recipe.referenceIds??[],referenceReuse:"reference-only; no work or embedded-asset grant inferred",
   sourceGeometryObserved:false,maturity:"timing-source-only"},
  causalHypothesis:{trigger:"unknown",controlledRoles:recipe.roles,
   manipulationCandidates:steps.map(s=>({role:s.role,property:s.property,atMs:s.startMs})),
   intendedVisualFunction:recipe.goals??[],motionEnergy:recipe.energy??"unknown",
   stylisticIntent:recipe.styles??[],humanVerified:false,
   aestheticHazards:["overlap-or-clipping-not-evaluated","false-semantic-transfer","easing-not-render-tested"],
   prohibitions:{status:"unknown",domains:[]},
   transferEligibleDomains:{status:"unknown",domains:[]}},
  timeline:{durationMs:recipe.durationMs,loop:recipe.loop,stages:recipe.structure.stages??[],
   steps,edges,edgeMeaning:"ordering-only-not-dependency-proof"},
  roles,clusterKey:hash(signature).slice(0,16),
  evidence:{ablation:"NOT_EVALUATED",blindHumanRating:"NOT_EVALUATED",rendering:"NOT_EVALUATED"},
  rights:{status:"unknown",sourcePermission:"not-inferred-from-referenceIds",
   embeddedAssets:"unknown"},
  promotion:{eligible:false,reason:"geometry, permissions, independent effect and transfer unverified"}
 };
}
export function analyzeCatalog(catalog){
 if(!Array.isArray(catalog?.recipes))throw Error("Missing recipe catalog");
 const ids=new Set();
 return catalog.recipes.map(r=>{
  if(ids.has(r.id))throw Error("Duplicate recipe "+r.id);
  ids.add(r.id);return analyzeRecipe(r);
 });
}
export function buildClusters(records){
 const groups=new Map();
 for(const m of records){
  const key=m.clusterKey??"unknown";
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(m.id);
 }
 return [...groups].map(([key,ids])=>({key,ids:ids.sort(),count:ids.length,
  relation:"similar-signature-not-equivalent",independentProof:false})).sort((a,b)=>a.key.localeCompare(b.key));
}
const verifiedHash=v=>typeof v==="string"&&/^[a-f0-9]{64}$/i.test(v);
const completeRights=m=>{
 const p=m?.provenance;
 if(!p || !verifiedHash(p.sourceSha256) || !p.sourceRights?.reviewed)return false;
 if(!(["self-authored","verified-work-license"].includes(p.sourceRights.status)))return false;
 for(const op of ["adapt","render","embed","redistribute"]){
  if(p.sourceRights.grants?.[op]!==true)return false;
 }
 if(!Array.isArray(p.embeddedAssets))return false;
 return p.embeddedAssets.every(a=>verifiedHash(a.sha256) &&
  a.licenseReviewed===true && a.grants?.embed===true && a.grants?.redistribute===true);
};
export function promotionDecision(motif,target){
 if(!STAGES.includes(target))throw Error("Unknown stage: "+target);
 const errors=[];
 const pos=STAGES.indexOf(target);
 if(pos>0){
  if(!completeRights(motif))errors.push("source-or-embedded-asset-rights-unverified");
  if(motif?.geometry?.status!=="verified"||!motif?.geometry?.editableSourcePath)
   errors.push("geometry-or-editable-source-unverified");
  if(!Array.isArray(motif?.causal?.interventions)||!motif.causal.interventions.length)
   errors.push("missing-specific-intervention");
 }
 if(pos>1){
  const e=motif?.renderEvidence;
  if(!verifiedHash(e?.riveSha256)||!e?.runtimeVersion||e?.inspectPassed!==true||
     !Array.isArray(e?.frames)||e.frames.length<2||!e.frames.every(f=>verifiedHash(f.sha256)))
   errors.push("actual-pinned-runtime-and-frame-evidence-missing");
 }
 if(pos>2){
  const trials=motif?.transferTrials??[];
  if(new Set(trials.filter(t=>t.verified===true && t.ablationEffect?.measured===true &&
    t.blindHumanRating?.status==="EVALUATED" && t.blindHumanRating.n>=3)
   .map(t=>t.domain)).size<2)errors.push("two-independent-blind-rated-domains-missing");
 }
 const current=STAGES.indexOf(motif?.stage??"discovery-only");
 if(pos>current+1)errors.push("skip-stage-not-allowed");
 if(pos<current)errors.push("stage-regression-not-allowed");
 return {allowed:errors.length===0,target,errors};
}
export function promote(motif,target){
 const d=promotionDecision(motif,target);
 if(!d.allowed)throw Error("Promotion denied: "+d.errors.join(","));
 return {...motif,stage:target};
}
