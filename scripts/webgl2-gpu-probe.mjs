// Rive Renderer WebGL2 proof. GPU Canvas flag is enabled on the *Rive instance*.
// IMPORTANT: This probe's original Solstice .riv contains no GPU Canvas shader.
// A successful render demonstrates the compatible WebGL2 runtime and opt-in path,
// NOT a genuine WGSL/PBR/GLB demonstration. Never conflate the two.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {createServer} from "node:http";
import {createRequire} from "node:module";
import {chromium} from "playwright-core";
import {buildGold} from "./build-motion-atlas-gold.mjs";
const require=createRequire(import.meta.url);
const hash=b=>createHash("sha256").update(b).digest("hex");
const HTML='<!doctype html><html><meta charset="utf-8"><style>html,body{margin:0;background:#09151b}canvas{width:720px;height:458px;display:block}</style><canvas id="view" width="720" height="458"></canvas><script src="/rive.js"></script><script>'+
'window.__proof={loaded:false,webgl2:!!document.createElement("canvas").getContext("webgl2"),error:null};'+
'window.addEventListener("error",e=>window.__proof.error=String(e.message));'+
'window.__instance=new window.rive.Rive({src:"/scene.riv",canvas:document.getElementById("view"),autoplay:true,stateMachines:"Showcase",artboard:"SolsticeChronograph",enableGPUCanvas:true,useOffscreenRenderer:false,onLoad:()=>window.__proof.loaded=true,onLoadError:e=>window.__proof.error=String(e)});'+
'</script></html>';
export function checkGPUCanvasUse(renderer,opts,hasActualGpuShader=false){
 if(renderer!=="webgl2")return {status:"UNSUPPORTED",reason:"GPU Canvas requires WebGL2"};
 if(opts?.enableGPUCanvas!==true)return {status:"DISABLED"};
 if(opts?.useOffscreenRenderer!==false)return {status:"INVALID_SHARED_CONTEXT"};
 return hasActualGpuShader?
  {status:"SHADER_TEST_ELIGIBLE"}:
  {status:"RENDERER_READY_ONLY",reason:"No authored GPU Canvas/GLB/WGSL scene in this probe"};
}
function packageAssets(){
 let js;
 try{js=require.resolve("@rive-app/webgl2");}
 catch{throw Error("Pinned @rive-app/webgl2 dependency unavailable");}
 if(!existsSync(js))throw Error("Rive WebGL2 JS entry not found");
 const d=dirname(js);
 const wasm=[join(d,"rive.wasm"),join(dirname(d),"rive.wasm"),join(d,"dist","rive.wasm")].find(existsSync);
 if(!wasm)throw Error("Official Rive WASM not found beside its pinned npm runtime");
 return {js,wasm};
}
export async function inspectWebGL2Capture(outDir){
 const out=resolve(outDir);
 mkdirSync(out,{recursive:true});
 const {js,wasm}=packageAssets();
 const original=Buffer.from(buildGold().bytes);
 if(original.subarray(0,4).toString("ascii")!=="RIVE")
  throw Error("Did not compile original baseline Rive");
 const server=createServer((req,res)=>{
  const url=(req.url||"/").split("?")[0];
  let content,contentType;
  if(url==="/"){content=Buffer.from(HTML);contentType="text/html";}
  else if(url==="/rive.js"){content=readFileSync(js);contentType="text/javascript";}
  else if(url==="/rive.wasm"){content=readFileSync(wasm);contentType="application/wasm";}
  else if(url==="/scene.riv"){content=original;contentType="application/octet-stream";}
  else{res.writeHead(404);res.end();return;}
  res.writeHead(200,{"Content-Type":contentType,"Cache-Control":"no-store"});
  res.end(content);
 });
 await new Promise((ok,fail)=>{server.once("error",fail);server.listen(0,"127.0.0.1",ok)});
 let browser;
 try{
  browser=await chromium.launch({headless:true,
   args:["--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--disable-gpu-sandbox"]});
  const page=await browser.newPage({viewport:{width:720,height:458},deviceScaleFactor:1});
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("http://127.0.0.1:"+server.address().port,{waitUntil:"load",timeout:45000});
  await page.waitForFunction(()=>window.__proof?.loaded||window.__proof?.error,null,{timeout:45000});
  const meta=await page.evaluate(()=>window.__proof);
  if(!meta.loaded||!meta.webgl2||meta.error||errors.length)
   throw Error("WebGL2 Rive load not verified: "+JSON.stringify({meta,errors}));
  const rendered=[];
  for(const [i,ms] of [0,400,1100,1950].entries()){
   if(i>0)await page.waitForTimeout(ms-([0,400,1100,1950][i-1]));
   const fname="webgl-"+i+".png";
   const b=await page.locator("#view").screenshot({type:"png"});
   if(b.subarray(0,8).toString("hex")!=="89504e470d0a1a0a"||b.length<2000)
    throw Error("Invalid WebGL2 composited canvas screenshot");
   writeFileSync(join(out,fname),b);
   rendered.push({filename:fname,sha256:hash(b),bytes:b.length,nominalMs:ms});
  }
  if(new Set(rendered.map(x=>x.sha256)).size<2)
   throw Error("WebGL2 runtime loaded yet no animation changed visually");
  const status=checkGPUCanvasUse("webgl2",{enableGPUCanvas:true,useOffscreenRenderer:false});
  const proof={schema:"rive-gpu-webgl2-runtime/v1",policy:status.status,
   runtime:"@rive-app/webgl2",pinnedRuntimeVersion:"2.44.2",
   flags:{enableGPUCanvas:true,useOffscreenRenderer:false},
   nativeArtboard:"SolsticeChronograph",
   sourceRivSha256:hash(original),frames:rendered,
   authoredShaderOr3D:false,shaderRenderingTest:"NOT_RUN",
   trueGPUCanvasVisualProof:"NOT_AVAILABLE_WITH_THIS_RIVE_SOURCE",
   browser:meta,errors,rendererType:"Chromium WebGL2 + Rive Renderer",
   aestheticRating:"NOT_EVALUATED",fontOrExternalAssetRights:"original repo sources"};
  writeFileSync(join(out,"webgl2-probe.json"),JSON.stringify(proof,null,2)+"\n");
  console.log(JSON.stringify({state:proof.policy,webglLoaded:meta.loaded,
   distinctScreenFrames:new Set(rendered.map(x=>x.sha256)).size,shaderTest:"NOT_RUN"}));
  await page.close();
  return proof;
 }finally{
  if(browser)await browser.close();
  await new Promise(ok=>server.close(ok));
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 await inspectWebGL2Capture(process.argv[2]??"test/tmp/webgl2-gpu-probe");
