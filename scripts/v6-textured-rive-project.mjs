// Same native camera and geometry for real maps vs neutral-map ablation.
// The only differences inside controlled A/B are ORIGINAL glTF image pixels.
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {DIRECTIONS,makeRealModelDirection} from "./v5-rive-real-model-scene.mjs";
import {ROLES} from "./v6-real-gltf-textures.mjs";
const sha=b=>createHash("sha256").update(b).digest("hex");
const MAP={base:"PbrBase",orm:"PbrORM",normal:"PbrNormal",emissive:"PbrEmissive"};
const originalShader=readFileSync(new URL("./v6-authentic-4map.wgsl",import.meta.url),"utf8");
function patch(s,a,b){
 if(!s.includes(a))throw Error("V5 source ABI changed, cannot automatically import actual maps: "+a.slice(0,90));
 return s.replace(a,b);
}
export function makeTexturedRive(id,legacyMesh,legacyManifest,dir,{flat=false}={}){
 if(!Object.hasOwn(DIRECTIONS,id))throw Error("Unknown V6 art direction");
 const root=resolve(dir),provenance=JSON.parse(readFileSync(join(root,"texture-provenance.json"),"utf8"));
 if(provenance.sourceSha256!==legacyManifest.glbSha256||
    provenance.vertexCount!==legacyManifest.vertexCount||
    provenance.triangleCount!==legacyManifest.triangleCount||
    provenance.vertexStride!==72)throw Error("Original source-model and GLB texture provenance disagree");
 const mesh=readFileSync(join(root,"WaterBottleTexturedMesh.bin"));
 if(sha(mesh)!==provenance.meshHash||mesh.length!==provenance.vertexCount*72)
  throw Error("True GLB UV source mesh bytes damaged");
 const images={};
 for(const role of ROLES){
  const name=MAP[role],raw=readFileSync(join(root,name+".bin")),r=provenance.images[role];
  if(sha(raw)!==r.pixelSha256||raw.length!==r.rawByteLength||
     raw.length!==r.uploadSize[0]*r.uploadSize[1]*4)throw Error("Source texture image bytes/dimensions invalid: "+role);
  if(flat){
   const constant={base:[255,255,255,255],orm:[255,255,255,255],
    normal:[128,128,255,255],emissive:[0,0,0,255]}[role];
   const blank=Buffer.alloc(raw.length);
   for(let i=0;i<blank.length;i+=4)for(let j=0;j<4;j++)blank[i+j]=constant[j];
   images[name]=blank;
  }else images[name]=raw;
 }
 const prior=makeRealModelDirection(id,legacyMesh,legacyManifest);
 let script=prior.script;
 script=patch(script,'context:blob("WaterBottleMesh")','context:blob("WaterBottleTexturedMesh")');
 script=patch(script,'blob.size/48','blob.size/72');
 script=patch(script,'self.points*48 ~= blob.size','self.points*72 ~= blob.size');
 script=patch(script,'stride=48,stepMode="vertex"','stride=72,stepMode="vertex"');
 script=patch(script,'{slot=4,format="float32",offset=40},',
  '{slot=4,format="float32",offset=40},\n   {slot=5,format="float32x2",offset=48},\n   {slot=6,format="float32x4",offset=56},');
 const textureSetup=ROLES.map(role=>{
  const name=MAP[role],width=provenance.images[role].uploadSize[0],
   height=provenance.images[role].uploadSize[1],gpu=role+"Tex";
  return ' local '+role+'Blob=context:blob("'+name+'")\n'+
   ' if not '+role+'Blob then error("GLB '+role+' source missing") end\n'+
   ' local '+gpu+'=GPUTexture.new({width='+width+',height='+height+',format="rgba8unorm"})\n'+
   ' '+gpu+':upload({data='+role+'Blob.data,width='+width+',height='+height+'})';
 }).join("\n");
 script=patch(script,' self.camera=cameraBuffer',
  ' self.camera=cameraBuffer\n'+textureSetup+
  '\n local atlasSampler=GPUSampler.new({min="linear",mag="linear",wrapU="repeat",wrapV="repeat"})');
 script=patch(script,
  'self.bindings=GPUBindGroup.new({layout=layout,ubos={{slot=0,buffer=cameraBuffer}}})',
  'self.bindings=GPUBindGroup.new({layout=layout,ubos={{slot=0,buffer=cameraBuffer}},\n'+
  '  textures={{slot=1,view=baseTex:view()},{slot=3,view=ormTex:view()},\n'+
  '   {slot=4,view=normalTex:view()},{slot=5,view=emissiveTex:view()}},\n'+
  '  samplers={{slot=2,sampler=atlasSampler}}})');
 script=patch(script,'print("REAL_CC0_GLB_GPU_TRIANGLES",self.points/3)',
  'print("REAL_CC0_GLB_4MAP_MATERIAL_READY",self.points/3)');
 const c=DIRECTIONS[id],factor=provenance.originalMaterial;
 let shader=originalShader.replaceAll("SCENE_PAN_X",c.pan<0?"(0.0 - "+Math.abs(c.pan)+")":String(c.pan));
 for(const [name,value] of Object.entries({LIGHT_TINT_R:c.accent[0],LIGHT_TINT_G:c.accent[1],
   LIGHT_TINT_B:c.accent[2],NORMAL_SCALE:factor.normalScale,
   AO_STRENGTH:factor.occlusionStrength,EMISSIVE_FACTOR:Math.max(...factor.emissiveFactor)}))
  shader=shader.replaceAll(name,String(value));
 const receipt={schema:"v6-original-glTF-4-textures-native-Rive/v1",direction:id,
  modelSourceSha256:provenance.sourceSha256,sourceUVGeometrySHA256:sha(mesh),
  sourceTriangles:provenance.triangleCount,images:provenance.images,
  actualMapSHA256:Object.fromEntries(ROLES.map(r=>[r,sha(images[MAP[r]])])),
  mapsUsed:ROLES,neutralMapAblation:flat,
  pbrTerms:"baseColor sRGB, ORM AO/R roughness/G metal/B, tangent normal, sRGB emissive",
  note:"Direct analytic GGX, no HDR environment/light probes; not glTF reference PBR parity",
  rights:"All four maps source from immutable CC0 WaterBottle GLB",
  program:"real Rive GPUTexture.upload/GPUTextureView/GPUBindGroup source",
  runtime:"NOT_YET_COMPILED",webPublish:"UNSIGNED",aestheticScore:"NOT_EVALUATED"};
 return {...prior,script,shader,mesh,images,receipt};
}
export function writeV6Scene(id,legacyDir,textureDir,root,flat=false){
 const legacyRoot=resolve(legacyDir),manifest=JSON.parse(readFileSync(join(legacyRoot,"mesh-manifest.json"),"utf8"));
 const mesh=readFileSync(join(legacyRoot,"water-bottle-gpu.bin"));
 const result=makeTexturedRive(id,mesh,manifest,textureDir,{flat});
 const dir=resolve(root,id+(flat?"-flat":"-textured"));
 mkdirSync(dir,{recursive:true});
 for(const [name,text] of Object.entries({
  "rive.yaml":result.yaml,"main.luau":result.script,"RealModel.wgsl":result.shader,
  "material-evidence.json":JSON.stringify(result.receipt,null,2)+"\n"}))
  writeFileSync(join(dir,name),text);
 writeFileSync(join(dir,"WaterBottleTexturedMesh.bin"),result.mesh);
 for(const [name,b] of Object.entries(result.images))writeFileSync(join(dir,name+".bin"),b);
 return {dir,receipt:result.receipt};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [id,legacy,texture,out]=process.argv.slice(2);
 const candidate=writeV6Scene(id,legacy,texture,out,false);
 const ablation=writeV6Scene(id,legacy,texture,out,true);
 console.log(JSON.stringify({texture:candidate.dir,ablation:ablation.dir,sourceGLB:candidate.receipt.modelSourceSha256}));
}
