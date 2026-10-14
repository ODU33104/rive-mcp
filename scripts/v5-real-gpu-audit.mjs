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
 const contrasts=samples.flatMap((a,i)=>samples.slice(i+1).map(b=>
  Math.max(...[0,1,2].map(k=>Math.abs(a.color[k]-b.color[k])))));
 const max=Math.max(...contrasts);
 if(max<24)throw Error("GPU GLB geometry visually absent (flat pixel output)");
 const timeline=pixelDifference(join(r,"early.png"),join(r,"late.png"),16);
 if(timeline.changedPercent<.035)throw Error("Native GLB 3D asset did not visibly move");
 const proof={schema:"real-CC0-external-GLB-native-Rive-GPU-proof/v1",
  artDirection:id,native3D:true,sourceModel:"Khronos WaterBottle",
  modelSha256:glb.glbSha256,compiledRiveSha256:hash(riv),rivBytes:riv.length,
  sourceTriangles:receipt.sourceMeshTriangles,originalMaterialFactors:glb.materialEntries,
  previewEvidence:"RIVE_FIRST_PARTY_CLI_NATIVE_GPU",
  nativeFramebufferColorRange:max,nativeMotion:timeline,samples,
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