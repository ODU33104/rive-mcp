// Real external Rive source admission. Existing third-party art is NOT regenerated.
// CI obtains the exact upstream commit artifact and editable source model.
// Copyright/attribution: Kabi by Bryl Lim, licensed CC BY 4.0.
// This tool does not imply arbitrary .riv files can be copied into another .riv.
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {join,resolve,dirname} from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {RiveHost} from "../dist/riveHost.js";
import {PAGE_SCRIPT} from "../dist/pageScript.js";

const manifest=JSON.parse(readFileSync(new URL("../data/external-rive-sources/kabi-v1.json",import.meta.url),"utf8"));
export const UPSTREAM=Object.freeze(manifest);
export const POSES=Object.freeze([
 {id:"idle",pose:0,mood:0,color:1},
 {id:"celebrate",pose:7,mood:1,color:3},
 {id:"thinking",pose:19,mood:0,color:5},
 {id:"boxing",pose:16,mood:2,color:6}
]);
const sha256=b=>createHash("sha256").update(b).digest("hex");
function ensureRemoteInputs(riv,model,license){
 if(riv.length<5000||riv.subarray(0,4).toString("ascii")!=="RIVE")
  throw Error("Downloaded upstream bytes are not real RIVE");
 if(model.format!=="kabi-model@30"||model.artboard?.name!=="Kabi")
  throw Error("Unexpected external editable model version");
 if(model.shapes?.length<100||model.nodes?.length<70||model.animations?.length<29)
  throw Error("Source model unexpectedly missing original vector rig");
 if(!model.stateMachines?.some(sm=>sm.name==="Kabi"&&sm.inputs?.length>=10))
  throw Error("Upstream state machine doesn't match provenance");
 if(!license.includes("Attribution 4.0 International"))
  throw Error("Creative Commons license was not acquired");
}
function checkResultPNG(base64){
 const b=Buffer.from(base64,"base64");
 if(b.subarray(0,8).toString("hex")!=="89504e470d0a1a0a"||b.length<1200)
  throw Error("Missing/invalid genuine official Rive runtime PNG");
 return b;
}
export function getAdmissionInformation(root){
 const riv=readFileSync(join(root,"kabi.riv"));
 const source=readFileSync(join(root,"kabi.model.json"));
 const license=readFileSync(join(root,"LICENSE"),"utf8");
 const parsed=JSON.parse(source.toString("utf8"));
 ensureRemoteInputs(riv,parsed,license);
 return {riv,source,model:parsed,report:{
  schema:"external-rive-admission-evidence/v1",
  sourceCommit:manifest.sourceCommit,sourceUrl:manifest.repository,
  author:manifest.author,attribution:manifest.attribution,
  license:manifest.license,productionPromotion:manifest.assetRights.productionPromotion,
  sourceModelFormat:parsed.format,stats:{
   editableRigNodes:parsed.nodes.length,sourceVectorShapes:parsed.shapes.length,
   originalAnimationCount:parsed.animations.length,
   sourceStateMachines:parsed.stateMachines.length
  },sha256:{riv:sha256(riv),sourceModel:sha256(source),license:sha256(Buffer.from(license))},
  status:"SOURCE_BYTES_VERIFIED_NOT_YET_RENDERED",
  humanAestheticRating:"NOT_EVALUATED"
 }};
}
export async function runExternalEvidence(inputDir,outputDir){
 const {riv,report}=getAdmissionInformation(resolve(inputDir));
 const dir=resolve(outputDir);
 mkdirSync(dir,{recursive:true});
 const host=new RiveHost(PAGE_SCRIPT);
 try{
  const inspection=await host.inspect(riv);
  const art=inspection.artboards.find(a=>a.name==="Kabi");
  if(!art)throw Error("External RIVE not recognized by official runtime");
  const state=art.stateMachines.find(s=>s.name==="Kabi");
  if(!state)throw Error("Kabi state machine not available to native runtime");
  for(const key of ["pose","mood","color"]){
   const x=state.inputs.find(i=>i.name===key);
   if(x?.type!=="number")throw Error("Missing semantic input "+key);
  }
  const outputs=[];
  const posters=[];
  for(const p of POSES){
   const out=join(dir,p.id);
   mkdirSync(out,{recursive:true});
   const steps=[
    {input:"pose",value:p.pose,advance:0.07,capture:true},
    {input:"mood",value:p.mood,advance:0.06,capture:true},
    {input:"color",value:p.color,advance:0.06,capture:true},
    ...Array.from({length:20},(_,i)=>({advance:0.11,capture:true}))
   ];
   const playback=await host.playStateMachine(riv,{
    artboard:"Kabi",stateMachine:"Kabi",width:600,height:720,
    background:"#151923",steps
   });
   if(playback.frames?.length!==steps.length)
    throw Error("Original state machine could not capture "+p.id);
   const frameHashes=[];
   for(const [i,b64] of playback.frames.entries()){
    const b=checkResultPNG(b64);
    writeFileSync(join(out,"frame-"+String(i).padStart(3,"0")+".png"),b);
    frameHashes.push(sha256(b));
   }
   const poster=checkResultPNG(playback.frames.at(-1));
   writeFileSync(join(out,p.id+"-poster.png"),poster);
   posters.push(frameHashes.at(-1));
   outputs.push({id:p.id,sourceInput:{pose:p.pose,mood:p.mood,color:p.color},
    frameCount:playback.frames.length,uniqueFrameHashes:new Set(frameHashes).size,
    posterSha256:frameHashes.at(-1),stateMachineReportSteps:playback.report?.length});
  }
  if(new Set(posters).size!==POSES.length)
   throw Error("External character poses are not visually distinguishable");
  const record={...report,status:"OFFICIAL_RUNTIME_PROTOTYPE_PASS",
   officialRiveArtboard:art.name,availableInputs:state.inputs.map(x=>x.name),
   poseRenders:outputs,sourceModelEditor:"upstream Kabi model JSON & browser editor",
   notProven:"native Editor re-editability, Part Atlas copy/paste, embedded rights beyond upstream project, artistic superiority",
   redistributability:"REVIEW_EMBEDDED_UPSTREAM_REFERENCE_ART_BEFORE_PRODUCTION"};
  writeFileSync(join(dir,"external-evidence.json"),JSON.stringify(record,null,2)+"\n");
  console.log(JSON.stringify({status:record.status,shapes:report.stats.sourceVectorShapes,
   animationCount:report.stats.originalAnimationCount,poses:outputs.map(x=>({id:x.id,frames:x.frameCount,unique:x.uniqueFrameHashes}))}));
  return record;
 }finally{await host.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(process.argv[2]==="--check"){
  const {report}=getAdmissionInformation(resolve(process.argv[3]??"test/tmp/external-kabi/source"));
  console.log(JSON.stringify(report));
 }else{
  await runExternalEvidence(process.argv[2]??"test/tmp/external-kabi/source",
   process.argv[3]??"test/tmp/external-kabi/output");
 }
}
