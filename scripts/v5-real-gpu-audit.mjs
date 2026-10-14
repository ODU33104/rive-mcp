import {readFileSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {rgbaPNG,pixelDifference} from "./rml-evidence-audit.mjs";
import {DIRECTIONS} from "./v5-rive-real-model-scene.mjs";
const hash=b=>createHash("sha256").update(b).digest("hex");
export function auditReal3DRive(id,source,render){
 if(!Object.hasOwn(DIRECTIONS,id))throw Error("Unsupported 3D candidate");
 const root=resolve(source),r=resolve(render);
 const receipt=JSON.parse(readFileSync(join(root,"source-licence.json"),"utf8"));
 const mesh=readFileSync(join(root,"WaterBottleMesh.bin"));
 const glb=JSON.parse(readFileSync(join(r,"mesh-manifest.json"),"utf8"));
 const riv=readFileSync(join(root,"build","real_waterbottle_"+id+".riv"));
 if(receipt.source.license!=="CC0-1.0"||receipt.modelGLBSha256!==glb.glbSha256||
  mesh.length!==receipt.sourceMeshTriangles*3*48||
  hash(mesh)!==glb.packedSha256||riv.subarray(0,4).toString("ascii")!=="RIVE")
  throw Error("Real GLB source provenance or native Rive binary invalid");
 const first=rgbaPNG(join(r,"early.png")),last=rgbaPNG(join(r,"late.png"));
 if(first.width!==960||first.height!==600||last.width!==960||last.height!==600)
  throw Error("Not a 960x600 authentic Rive studio frame");
 const sample=(png,u,v)=>{const i=(Math.floor(png.height*v)*png.width+Math.floor(png.width*u))*4;
  return [...png.rgba.subarray(i,i+4)];};
 const locations=[[.5,.5],[.55,.32],[.50,.75],[.12,.12],[.8,.8]];
 const samples=locations.map(([x,y])=>({x,y,color:sample(last,x,y)}));
 // The 3 editorial art-directions deliberately move the product off-centre:
 // fixed 0.5/0.5 sampling falsely rejected the LEFT-aligned museum composition.
 // Scan the entire actual framebuffer against its sampled background instead.
 const background=sample(last,.02,.02);
 let max=0,visibleGeometryGridCells=0;
 for(let y=16;y<last.height-16;y+=20)for(let x=16;x<last.width-16;x+=20){
  const c=sample(last,x/last.width,y/last.height);
  const delta=Math.max(...[0,1,2].map(k=>Math.abs(c[k]-background[k])));
  max=Math.max(max,delta);
  if(delta>32)visibleGeometryGridCells++;
 }
 if(max<24||visibleGeometryGridCells<30)
  throw Error("GPU GLB geometry visually absent (flat pixel output): "+visibleGeometryGridCells);
 const timeline=pixelDifference(join(r,"early.png"),join(r,"late.png"),16);
 if(timeline.changedPercent<.035)throw Error("Native GLB 3D asset did not visibly move");
 const proof={schema:"real-CC0-external-GLB-native-Rive-GPU-proof/v1",
  artDirection:id,native3D:true,sourceModel:"Khronos WaterBottle",
  modelSha256:glb.glbSha256,compiledRiveSha256:hash(riv),rivBytes:riv.length,
  sourceTriangles:receipt.sourceMeshTriangles,originalMaterialFactors:glb.materialEntries,
  previewEvidence:"RIVE_FIRST_PARTY_CLI_NATIVE_GPU",
  nativeFramebufferColorRange:max,nativeMotion:timeline,samples,
  visibleGeometryGridCells,
  modelTransferred:"ACTUAL_GLTF_TRIANGLES_NORMALS_AND_PBR_FACTORS",
  sourceTextures:"NOT_REPRODUCED",fullPBR:"NO: analytic BRDF approximation",
  hdrEnvironment:"NOT_IMPLEMENTED",
  browserDeployment:"NOT_PUBLISHED_UNSIGN_SCRIPT",editorRevision:"NOT_TESTED",
  aestheticJudgement:"NOT_EVALUATED",
  status:"NATIVE_REAL_MESH_PRESENT"};
 writeFileSync(join(r,"real-glb-runtime-proof.json"),JSON.stringify(proof,null,2)+"\n");
 console.log(JSON.stringify({id,meshes:glb.triangleCount,contrast:max,motion:timeline.changedPercent,sourceActual:true}));
 return proof;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 auditReal3DRive(process.argv[2],process.argv[3],process.argv[4]);