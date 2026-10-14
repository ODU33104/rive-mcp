// Effect work intake: references != downloadable source != transferable Rive effects.
// Fail-closed gates for stage changes and rights operations.
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
const DATA="data/effect-scout/marketplace-effects.v1.json";
export function loadEffects(path=DATA){
 const d=JSON.parse(readFileSync(path,"utf8"));
 if(d.schema!=="rive-effect-scout/v1"||d.entries.length!==d.count)
  throw Error("Invalid effect discovery catalog");
 const ids=new Set(),urls=new Set();
 for(const e of d.entries){
  if(ids.has(e.id)||urls.has(e.sourceUrl))throw Error("Duplicate ID or URL "+e.id);
  ids.add(e.id);urls.add(e.sourceUrl);
  const u=new URL(e.sourceUrl);
  if(u.protocol!=="https:"||!["rive.app","www.rive.app"].includes(u.hostname)||
   !u.pathname.includes("/marketplace/")&&!u.pathname.includes("/community/files/"))
   throw Error("Untrusted third-party effect source "+e.id);
  if(e.stage!=="reference-only"||e.downloadedAssetHash!==null||
   e.importedComponentIds.length!==0||e.runtimeEvidence!=="NOT_RUN")
   throw Error("Unverified effect masquerades as reusable "+e.id);
  if(e.rights.redistribution!=="BLOCKED_UNTIL_REVIEW"||e.rights.embeddedAssetClearance!=="UNKNOWN")
   throw Error("Unreviewed rights must be gated "+e.id);
 }
 return d;
}
// Explicit action rights, source source-hashes, referenced components, pinned renderer, and evidence.
export function evaluateAcquisitionPromotion(source,receipt){
 if(!source||source.stage!=="reference-only")return {status:"DENY",reason:"unknown source stage"};
 if(!receipt||typeof receipt!=="object")return {status:"DENY",reason:"no acquisition receipt"};
 const required=[
  ["approvedAdaptation",receipt.workRights?.approvedAdaptation===true],
  ["approvedRedistribution",receipt.workRights?.approvedRedistribution===true],
  ["embeddedAssetsCleared",receipt.assets?.every?.(a=>a.sha256&&a.distributionAllowed===true)&&
    Array.isArray(receipt.assets)&&receipt.assets.length>0],
  ["retrievedSourceSha256",/^[0-9a-f]{64}$/i.test(receipt.source?.sha256??"")],
  ["retrievedEditableSource",receipt.source?.fileType==="rev"||receipt.source?.fileType==="rml"],
  ["componentNodeIDs",Array.isArray(receipt.import?.nodeIds)&&receipt.import.nodeIds.length>0],
  ["RiveRuntimeSuccess",receipt.runtime?.verified===true&&receipt.runtime?.pngSha256?.length===64],
  ["nativeEditedScene",receipt.runtime?.rivSha256?.length===64],
  ["attributionRecorded",receipt.attribution?.author===source.author&&receipt.attribution?.url===source.sourceUrl],
  ["noOpenLicenseConflicts",receipt.workRights?.openThirdPartyClaims===false],
 ];
 const failed=required.filter(([_,ok])=>!ok).map(([name])=>name);
 return failed.length?{status:"DENY",failed}:{status:"ELIGIBLE_FOR_HUMAN_VISUAL_REVIEW",
  sourceId:source.id,note:"Not production approved until style/domain/behavior review"};
}
export function discoverySummary(d=loadEffects()){
 const byCategory={};
 for(const e of d.entries)byCategory[e.effect.category]=(byCategory[e.effect.category]??0)+1;
 return {referenceCount:d.entries.length,editableDownloaded:0,
  codeImported:0,readyToReuse:0,byCategory,notified:"This catalog DOES NOT import third-party FX assets"};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const res=discoverySummary();
 console.log(JSON.stringify(res,null,2));
}