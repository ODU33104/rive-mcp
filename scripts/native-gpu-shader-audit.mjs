// Fail-closed true WGSL shader rendering evidence on headless FIRST-PARTY CLI.
// Pixel-color diversity distinguishes a real shader field from only a line on flat background.
import {readFileSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {rgbaPNG,pixelDifference} from "./rml-evidence-audit.mjs";
import {gpuSourceFixture} from "./native-rml-gpu-shader.mjs";
const sha=b=>createHash("sha256").update(b).digest("hex");
const at=(p,u,v)=>{
 const x=Math.floor(p.width*u),y=Math.floor(p.height*v);
 const i=(y*p.width+x)*4;
 return [p.rgba[i],p.rgba[i+1],p.rgba[i+2],p.rgba[i+3]];
};
export function auditNativeShader(projectDir,proofDir){
 const p=resolve(projectDir),out=resolve(proofDir);
 const source=gpuSourceFixture().receipt;
 const disk=JSON.parse(readFileSync(join(p,"source-proof.json"),"utf8"));
 const shader=readFileSync(join(p,"PrismMaterial.wgsl")),script=readFileSync(join(p,"main.luau"));
 if(source.shaderHash!==sha(shader)||source.scriptHash!==sha(script)||
    disk.shaderHash!==source.shaderHash||disk.scriptHash!==source.scriptHash)
  throw Error("Actual shader source did not match audited program");
 const riv=readFileSync(join(p,"build","gpu_prism_study.riv"));
 if(riv.subarray(0,4).toString("ascii")!=="RIVE")
  throw Error("No native first-party generated shader RIVE");
 const png0=rgbaPNG(join(out,"gpu-early.png")),png1=rgbaPNG(join(out,"gpu-late.png"));
 if(png0.width!==640||png0.height!==480)throw Error("GPU preview wrong screenshot geometry");
 const candidates=[
  at(png1,.1,.1),at(png1,.5,.2),at(png1,.81,.79),at(png1,.15,.84)
 ];
 const chroma=s=>Math.max(s[0],s[1],s[2])-Math.min(s[0],s[1],s[2]);
 if(candidates.filter(a=>chroma(a)>15).length<2)
  throw Error("GPU shader field not found: actual rendering resembles a monochrome fallback");
 let largest=0;
 for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++)
  largest=Math.max(largest,Math.max(...[0,1,2].map(k=>Math.abs(candidates[i][k]-candidates[j][k]))));
 if(largest<24)throw Error("Expected original WGSL procedural gradient, got near-flat background");
 const timeline=pixelDifference(join(out,"gpu-early.png"),join(out,"gpu-late.png"),12);
 if(timeline.changedPercent<.004)throw Error("Native vector timing did not animate inside GPU scene");
 const inspect=JSON.parse(readFileSync(join(out,"inspect.json"),"utf8"));
 if(inspect.problems?.some(x=>x.severity==="error"))throw Error("Native CLI inspect found shader errors");
 const report={schema:"rive-cli-actual-gpucanvas-wgsl-proof/v1",
  officialCLI:readFileSync(join(out,"rive-version.txt"),"utf8").trim(),
  originalShaderHash:source.shaderHash,originalLuauHash:source.scriptHash,
  compiledNativeRivHash:sha(riv),compiledBytes:riv.length,
  gpuCanvasCreatedInSource:true,shaderAssetNamed:"PrismMaterial",
  nativeScriptAndShaderSource:"DIRECT_FIRST_PARTY_CLI",
  pixelGradientRange:largest,pixels:candidates,realAnimatedVectorDelta:timeline,
  previewStatus:"ACTUAL_GPU_SHADER_CLI_CAPTURED",
  webGPUCanvasScriptPublication:"NOT_TESTED_SIGNING_REQUIRED",
  publicRuntimeShaderPlayback:"NOT_TESTED",
  editorRevExport:"NOT_TESTED_LOGIN_REQUIRED",
  aestheticScore:"NOT_EVALUATED"};
 writeFileSync(join(out,"native-gpu-shader-proof.json"),JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify({nativeShader:report.previewStatus,compiledBytes:riv.length,gradientRange:largest,
  motionPercent:timeline.changedPercent,signedWeb:false}));
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 auditNativeShader(process.argv[2],process.argv[3]);