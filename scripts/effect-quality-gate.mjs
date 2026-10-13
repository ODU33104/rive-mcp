// Fail-closed promotion from genuine Rive image-difference receipts.
// Numerical effect presence is necessary but nowhere near sufficient for aesthetic approval.
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
const db=JSON.parse(readFileSync(new URL("../data/effect-quality/native-impact-20261014.v1.json",import.meta.url),"utf8"));
export function classifyForPromotion(row){
 if(!row||typeof row.id!=="string"||!Number.isFinite(row.maxChangedPercent))
  throw Error("Invalid effect QA input");
 if(row.maxChangedPercent<0||row.maxChangedPercent>100)throw Error("Invalid percent");
 if(row.maxChangedPercent<.05||row.gate!=="VISIBLY_APPLIED")
  return {id:row.id,stage:"quarantine-insufficient-effect",reason:"no perceptible sampled pixel impact at configured threshold"};
 return {id:row.id,stage:"technical-visual-candidate",reason:"source pixels changed, no aesthetic or license clearance implied"};
}
export function validatedObservedCatalog(){
 if(db.schema!=="native-rive-effect-screen-impact/v1")throw Error("Unknown impact evidence schema");
 if(db.rows.length!==8||new Set(db.rows.map(x=>x.id)).size!==8)
  throw Error("Unexpected impact candidate inventory");
 for(const row of db.rows){
  const x=classifyForPromotion(row);
  if(x.stage!==row.stage)throw Error("Inconsistent gate result "+row.id);
  if(row.aestheticHumanRating!=="NOT_EVALUATED")
   throw Error("Fabricated aesthetic clearance "+row.id);
 }
 const pass=db.rows.filter(x=>x.stage==="technical-visual-candidate");
 const fail=db.rows.filter(x=>x.stage==="quarantine-insufficient-effect");
 return {sourceRunId:db.runId,sourceCommit:db.commit,rendered:db.rows.length,
  technicallyVisible:pass.length,quarantined:fail.length,
  visibleCandidates:pass.map(x=>x.id),rejected:fail.map(x=>x.id),
  productionReady:0,aestheticIndependentRatings:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 console.log(JSON.stringify(validatedObservedCatalog()));
