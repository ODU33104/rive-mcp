// Real studio HDR reflections on V6's actual glTF 4-map metal/normal material.
// Identical shader/model/camera/timing: real CC0 environment vs constant environment.
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve,join} from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {makeTexturedRive} from "./v6-textured-rive-project.mjs";
import {DIRECTIONS} from "./v5-rive-real-model-scene.mjs";
const sha=b=>createHash("sha256").update(b).digest("hex");
const envLook={
 midnight:{rotation:.16,intensity:.66},
 glacier:{rotation:1.38,intensity:.41},
 museum:{rotation:3.1,intensity:.48}
};
function patch(s,a,b){
 if(!s.includes(a))throw Error("Underlying verified V6 pipeline changed, no blind HDRI patch: "+a.slice(0,130));
 return s.replace(a,b);
}
export function makeStudioEnvironmentScene(id,legacy,legacyManifest,textureDir,hdrDir,{neutral=false}={}){
 if(!Object.hasOwn(envLook,id))throw Error("Unknown Studio HDR scene");
 const source=JSON.parse(readFileSync(join(resolve(hdrDir),"polyhaven-provenance.json"),"utf8"));
 const pixels=readFileSync(join(resolve(hdrDir),"StudioEnvironment.bin"));
 if(source.asset.license!=="CC0-1.0"||
  source.asset.id!=="studio_small_03"||
  sha(pixels)!==source.float16RGBASHA256||pixels.length!==512*256*8||
  source.sourceHDRPositivePixelsOverOne<200)throw Error("No genuine licensed RGBE HDR source");
 const baseline=makeTexturedRive(id,legacy,legacyManifest,textureDir,{flat:false});
 let uploaded=pixels;
 if(neutral){
  uploaded=Buffer.alloc(pixels.length);
  for(let i=0;i<uploaded.length;i+=8){
   for(let c=0;c<3;c++)uploaded.writeUInt16LE(0x3266,i+c*2); // f16 0.20
   uploaded.writeUInt16LE(0x3c00,i+6); // alpha 1
  }
 }
 let shader=baseline.shader,script=baseline.script;
 shader=patch(shader,
  '@group(0) @binding(5) var emissiveMap:texture_2d<f32>;',
  '@group(0) @binding(5) var emissiveMap:texture_2d<f32>;\n@group(0) @binding(6) var studioEnv:texture_2d<f32>;');
 const materialAnchor='let ambient=base*(1.0-metal)*0.22*ao+f0*0.06*ao;';
 shader=patch(shader,materialAnchor,
  'let reflection=reflect(eye * (-1.0),n);\n'+
  ' let azimuth=atan2(reflection.z,reflection.x)/6.283185307+0.5+ENV_ROTATION;\n'+
  ' let elevation=acos(clamp(reflection.y,-0.99999,0.99999))/3.14159265;\n'+
  ' let envSample=textureSample(studioEnv,texSampler,vec2<f32>(azimuth,elevation)).rgb;\n'+
  ' let glossEnvironment=envSample*F*(0.26+metal*0.74)*(1.0-rough*0.52)*ENV_STRENGTH;\n '+
  materialAnchor);
 shader=patch(shader,
  'let exposed=((diffuse+spec)*nl*keyColor*camera.key*3.2+ambient+fill+emission*EMISSIVE_FACTOR)*camera.exposure;',
  'let exposed=((diffuse+spec)*nl*keyColor*camera.key*3.2+ambient+fill+glossEnvironment+emission*EMISSIVE_FACTOR)*camera.exposure;');
 const look=envLook[id];
 shader=shader.replaceAll("ENV_ROTATION",Number(look.rotation).toFixed(6))
  .replaceAll("ENV_STRENGTH",Number(look.intensity).toFixed(6));
 script=patch(script,
  'local atlasSampler=GPUSampler.new({min="linear",mag="linear",wrapU="repeat",wrapV="repeat"})',
  'local atlasSampler=GPUSampler.new({min="linear",mag="linear",wrapU="repeat",wrapV="repeat"})\n'+
  ' local envBlob=context:blob("StudioEnvironment")\n'+
  ' if not envBlob then error("True Poly Haven studio radiance missing") end\n'+
  ' local environment=GPUTexture.new({width=512,height=256,format="rgba16float"})\n'+
  ' environment:upload({data=envBlob.data,width=512,height=256})');
 script=patch(script,
  '{slot=4,view=normalTex:view()},{slot=5,view=emissiveTex:view()}},',
  '{slot=4,view=normalTex:view()},{slot=5,view=emissiveTex:view()},\n'+
  '   {slot=6,view=environment:view()}},');
 script=patch(script,'print("REAL_CC0_GLB_4MAP_MATERIAL_READY",self.points/3)',
  'print("REAL_GLTF_4MAP_WITH_POLYHAVEN_HDRI_READY",self.points/3)');
 const receipt={...baseline.receipt,schema:"v7-real-HDR-studio-Rive-glTF-cc0/v1",
  environmentSource:source.asset,environmentSourceSha256:source.sourceSHA256,
  environmentSourceHDRPeak:source.sourcePeak,environmentFloat16Sha256:sha(uploaded),
  identicalOriginalModelUVAndFourMaps:true,
  sameShaderCameraAndTimingAsNeutralAblation:true,neutralEnvironmentAblation:neutral,
  environmentParams:look,runtime:"NOT_RENDERED_UNTIL_OFFICIAL_CLI",
  physicalLimit:"real studio RGBE radiance in half float, single lobe environment reflection (no roughness pre-filter or irradiance probes)",
  rights:"Poly Haven CC0 Studio Small 03, author Greg Zaal; Powered by Poly Haven API credit",
  web:"SIGNED_PUBLISH_NOT_RUN",beauty:"NOT_EVALUATED",
  sourceBrandLogo:"SOURCE_MODEL_LOGO_NOT_CLEARED_AS_TRADEMARK; TECHNICAL_PROOF_ONLY"};
 return {...baseline,shader,script,environment:uploaded,receipt};
}
export function writeV7Scene(id,legacyDir,textureDir,hdrDir,destination,neutral=false){
 const m=JSON.parse(readFileSync(join(resolve(legacyDir),"mesh-manifest.json"),"utf8"));
 const mesh=readFileSync(join(resolve(legacyDir),"water-bottle-gpu.bin"));
 const result=makeStudioEnvironmentScene(id,mesh,m,textureDir,hdrDir,{neutral});
 const path=resolve(destination,id+(neutral?"-neutral":"-studio"));
 mkdirSync(path,{recursive:true});
 for(const [name,b] of Object.entries({
  "rive.yaml":result.yaml,"main.luau":result.script,"RealModel.wgsl":result.shader,
  "environment-evidence.json":JSON.stringify(result.receipt,null,2)+"\n",
  "WaterBottleTexturedMesh.bin":result.mesh,"StudioEnvironment.bin":result.environment}))
  writeFileSync(join(path,name),b);
 for(const [name,b] of Object.entries(result.images))writeFileSync(join(path,name+".bin"),b);
 return {path,receipt:result.receipt};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [id,legacy,material,hdr,dest]=process.argv.slice(2);
 const real=writeV7Scene(id,legacy,material,hdr,dest,false);
 const neutral=writeV7Scene(id,legacy,material,hdr,dest,true);
 console.log(JSON.stringify({envRive:real.path,control:neutral.path,source:real.receipt.environmentSourceSha256}));
}
