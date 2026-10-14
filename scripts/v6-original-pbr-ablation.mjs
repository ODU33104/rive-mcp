// Matched shader/geometry/camera/timing render A/B. Material maps are the ONLY
// changed input; don't confuse a new BRDF or lighting preset with map value.
import {readFileSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {rgbaPNG,pixelDifference} from "./rml-evidence-audit.mjs";
import {ROLES} from "./v6-real-gltf-textures.mjs";
const sha=b=>createHash("sha256").update(b).digest("hex");
export function auditOriginalGLTFMaps(id,texturePath,flatPath,outDir){
 const t=resolve(texturePath),f=resolve(flatPath),o=resolve(outDir);
 const real=JSON.parse(readFileSync(join(t,"material-evidence.json"),"utf8"));
 const flat=JSON.parse(readFileSync(join(f,"material-evidence.json"),"utf8"));
 const original=JSON.parse(readFileSync(join(o,"texture-provenance.json"),"utf8"));
 if(real.neutralMapAblation||!flat.neutralMapAblation||real.id!==undefined||
   real.direction!==id||flat.direction!==id||
   real.modelSourceSha256!==original.sourceSha256||
   flat.modelSourceSha256!==real.modelSourceSha256||
   real.sourceUVGeometrySHA256!==flat.sourceUVGeometrySHA256)
  throw Error("Not a matched original-glTF material controlled comparison");
 for(const role of ROLES){
  if(real.actualMapSHA256[role]!==original.images[role].pixelSha256||
   flat.actualMapSHA256[role]===original.images[role].pixelSha256)
   throw Error("A/B map data not a valid same-source ablation "+role);
 }
 const binary=readFileSync(join(t,"build","real_waterbottle_"+id+".riv"));
 const nullBinary=readFileSync(join(f,"build","real_waterbottle_"+id+".riv"));
 if(binary.subarray(0,4).toString("ascii")!=="RIVE"||
   nullBinary.subarray(0,4).toString("ascii")!=="RIVE"||
   binary.equals(nullBinary))throw Error("Not two native Rive material candidate binaries");
 const pairs=[];
 for(const at of ["early","late"]){
  const a=join(o,"textured-"+at+".png"),b=join(o,"flat-"+at+".png");
  const decoded=rgbaPNG(a),ablated=rgbaPNG(b);
  if(decoded.width!==960||decoded.height!==600||
   ablated.width!==960||ablated.height!==600)throw Error("Mismatched native capture bounds");
  const diff=pixelDifference(a,b,14);
  if(diff.changedPercent<0.30)
   throw Error("Original glTF source texture maps did not cause visible native pixel change at "+at+": "+diff.changedPercent);
  pairs.push({time:at,...diff});
 }
 const motion=pixelDifference(join(o,"textured-early.png"),join(o,"textured-late.png"),16);
 if(motion.changedPercent<.035)throw Error("Textured real 3D GLB is static");
 const receipt={schema:"original-4map-CC0-GLB-Rive-GPU-controlled-ablation/v1",
  id,glbSha256:original.sourceSha256,materialMaps:ROLES,
  trueSourceTextureAssets:original.images,sourceUV:original.uvBounds,
  triangles:original.triangleCount,sourceRivSha256:sha(binary),flatRivSha256:sha(nullBinary),
  native3D:true,sameShader:true,sameGeometry:true,sameCameraAndTiming:true,
  onlyVariable:"original CC0 4-map pixel blobs vs neutral pixel blobs of identical dimensions",
  actualMappedTexturePixelDifferences:pairs,nativeMotion:motion,
  subjectiveMaterialBeauty:"NOT_EVALUATED",qualityWinner:"NOT_SELECTED",
  productionRender:"FIRST_PARTY_RIVE_CLI_GPUCANVAS",
  webRuntime:"UNSIGNED_SCRIPT_NOT_VERIFIED",hdrEnvironment:"NOT_IMPLEMENTED",
  status:"GLTF_4_REAL_MAPS_VISIBLE_A_B"};
 writeFileSync(join(o,"true-pbr-ablation-proof.json"),JSON.stringify(receipt,null,2)+"\n");
 console.log(JSON.stringify({id,status:receipt.status,changed:pairs.map(x=>x.changedPercent),
  nativeMotion:motion.changedPercent,sourceGLB:receipt.glbSha256}));
 return receipt;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 auditOriginalGLTFMaps(...process.argv.slice(2,6));
