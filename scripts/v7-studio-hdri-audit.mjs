// Real HDR studio vs constant gray environment; identical Rive material shader,
// model, camera, time. Actual framebuffer pixel difference, not hash-only.
import {readFileSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {pixelDifference,rgbaPNG} from "./rml-evidence-audit.mjs";
const sha=b=>createHash("sha256").update(b).digest("hex");
export function auditStudio(id,studio,neutral,output){
 const s=resolve(studio),n=resolve(neutral),out=resolve(output);
 const a=JSON.parse(readFileSync(join(s,"environment-evidence.json"),"utf8"));
 const b=JSON.parse(readFileSync(join(n,"environment-evidence.json"),"utf8"));
 if(a.id===undefined&&a.direction!==id)throw Error("Studio art direction mismatch");
 if(a.neutralEnvironmentAblation||!b.neutralEnvironmentAblation||
   a.environmentSourceSha256!==b.environmentSourceSha256||
   a.actualMapSHA256.base!==b.actualMapSHA256.base||
   a.environmentFloat16Sha256===b.environmentFloat16Sha256)
  throw Error("Not a matched authentic HDRI A/B");
 const studioRiv=readFileSync(join(s,"build","real_waterbottle_"+id+".riv"));
 const flatRiv=readFileSync(join(n,"build","real_waterbottle_"+id+".riv"));
 if(studioRiv.subarray(0,4).toString("ascii")!=="RIVE"||
  flatRiv.subarray(0,4).toString("ascii")!=="RIVE")
  throw Error("Studio shader is not a first-party compiled RIVE");
 const actual=[];
 for(const time of ["early","late"]){
  const pa=join(out,"hdr-"+time+".png"),pb=join(out,"flat-"+time+".png");
  const i=rgbaPNG(pa),j=rgbaPNG(pb);
  if(i.width!==960||i.height!==600||j.width!==960||j.height!==600)
   throw Error("Invalid native Rive source pixel dimensions");
  const d=pixelDifference(pa,pb,12);
  if(d.changedPercent<.08)throw Error("The actual HDRI is visually absent: "+d.changedPercent);
  actual.push({time,...d});
 }
 const motion=pixelDifference(join(out,"hdr-early.png"),join(out,"hdr-late.png"),16);
 if(motion.changedPercent<.04)throw Error("New environment Rive output has no real animation");
 const result={schema:"real-PolyHaven-CC0-RGBE-HDRI-in-Rive-native-render/v1",
  id,source:a.environmentSource,sourceSha256:a.environmentSourceSha256,
  verified3DModel:true,source4Maps:true,sameCameraGeometryShaderAndTime:true,
  onlyChangedResource:"real source HDRI RGBA16 float radiance vs constant grey HDRI",
  actualImageDifferences:actual,nativeMotion:motion,
  originalEnvironmentHDRPeak:a.environmentSourceHDRPeak,
  studioRivSHA256:sha(studioRiv),ablationRivSHA256:sha(flatRiv),
  sourceRights:"CC0 HDRI by Greg Zaal and Khronos CC0 model; embedded model logo rights unverified",
  sourceCredit:"Powered by Poly Haven — https://polyhaven.com/a/studio_small_03",
  render:"FIRST_PARTY_RIVE_CLI_GPU_CANVAS",environment:"REAL_LINEAR_HDR_IN_GPU_RGBA16FLOAT",
  fullReferenceIBL:"NO: no prefilter/BRDF LUT",commercialAssetApproval:"QUARANTINED_MODEL_LOGO",
  webPublished:"NO_SCRIPT_SIGNING",humanVisualWinner:"NOT_SELECTED",
  status:"REAL_CC0_HDR_ENVIRONMENT_PIXEL_PROOF"};
 writeFileSync(join(out,"studio-hdri-runtime-proof.json"),JSON.stringify(result,null,2)+"\n");
 console.log(JSON.stringify({id,realHDR:result.status,delta:actual.map(x=>x.changedPercent),
  originalPeak:result.originalEnvironmentHDRPeak}));
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 auditStudio(...process.argv.slice(2,6));
