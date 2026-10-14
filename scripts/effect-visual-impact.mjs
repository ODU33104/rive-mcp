// Real official-runtime image impact, not shape counts or hash-only "change".
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {RiveHost} from "../dist/riveHost.js";
import {PAGE_SCRIPT} from "../dist/pageScript.js";
import {VARIANTS,renderVariantScene} from "./effect-capsule-reuse.mjs";
const FRAME_TIMES=[0.5,1.0,1.6,2.4,3.4];
export const IMPACT_TIMES=Object.freeze(FRAME_TIMES);
function finite01(n){return typeof n==="number"&&Number.isFinite(n)&&n>=0&&n<=100;}
export function summarizeEffectImpact(samples){
 if(!samples.length||samples.some(x=>!finite01(x.changedPercent)||!Number.isInteger(x.diffPixels)))
  throw Error("Invalid official Rive frame-difference samples");
 const max=Math.max(...samples.map(s=>s.changedPercent)),mean=samples.reduce((a,s)=>a+s.changedPercent,0)/samples.length;
 const changed=samples.filter(s=>s.changedPercent>=.05).length;
 // Predeclared visual diagnostic buckets; subjectively beautiful is NOT inferred.
 const classification=max<.015?"NEGLIGIBLE":max<.15?"MICRO":max<2?"SUBTLE":max<12?"VISIBLE":"EXTENSIVE";
 const portabilityGate=changed>0?"VISIBLY_APPLIED":"INSUFFICIENT_PIXEL_EVIDENCE";
 return {maxChangedPercent:+max.toFixed(4),meanChangedPercent:+mean.toFixed(4),
  framesAbove005Pct:changed,sampledFrames:samples.length,
  classification,portabilityGate,
  aestheticQuality:"NOT_EVALUATED",semanticAppropriateness:"MANUAL_REVIEW_REQUIRED"};
}
const digest=x=>createHash("sha256").update(x).digest("hex");
export async function assessVariant(id,dir){
 if(!VARIANTS.includes(id))throw Error("Unknown effect transfer "+id);
 const v=renderVariantScene(id);
 const output=resolve(dir);
 mkdirSync(output,{recursive:true});
 writeFileSync(join(output,id+"-with-fx.riv"),Buffer.from(v.bytes));
 const host=new RiveHost(PAGE_SCRIPT);
 try{
  const samples=[];
  for(const [index,time] of IMPACT_TIMES.entries()){
   const diff=await host.visualDiff(Buffer.from(v.baselineBytes),Buffer.from(v.bytes),
    {animation:"Reveal",time,width:720,height:460,threshold:16});
   if(diff.totalPixels!==720*460||diff.width!==720||diff.height!==460)
    throw Error("Rive images unexpectedly resized");
   const changedPercent=100*diff.diffPixels/diff.totalPixels;
   const b=Buffer.from(diff.diffImage,"base64");
   if(b.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")throw Error("Missing actual diff PNG");
   const fname="effect-pixel-diff-"+String(index).padStart(2,"0")+".png";
   writeFileSync(join(output,fname),b);
   samples.push({time,changedPercent:+changedPercent.toFixed(6),diffPixels:diff.diffPixels,
    threshold:diff.threshold,image:fname,diffPngSha256:digest(b)});
  }
  const scoring=summarizeEffectImpact(samples);
  const report={schema:"effect-visual-impact/v1",id,sourceCapsule:v.evidence.capsuleId,
   sourceScene:v.evidence.sourceScene,targetScene:v.evidence.targetScene,
   recordedWith:"native Rive Canvas advanced, same frame/time renderer and identical host background",
   ...scoring,materialHash:digest(Buffer.from(v.bytes)),samples,
   note:"The numerator is pixel change, NOT art quality. A giant change can be destructive; a subtle highlight may be desirable."};
  writeFileSync(join(output,"impact-evidence.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({id,classification:scoring.classification,max:scoring.maxChangedPercent,
   mean:scoring.meanChangedPercent,gate:scoring.portabilityGate}));
  return report;
 }finally{await host.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 await assessVariant(process.argv[2],process.argv[3]??"test/tmp/effect-impact/"+process.argv[2]);
}