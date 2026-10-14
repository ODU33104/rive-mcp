import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {importRealGLTFTextures,ROLES,SOURCE_SHA256} from "../scripts/v6-real-gltf-textures.mjs";
import {writeV6Scene,makeTexturedRive} from "../scripts/v6-textured-rive-project.mjs";
import {SOURCE} from "../scripts/v5-real-glb-mesh.mjs";
assert.equal(SOURCE.license,"CC0-1.0");
assert.equal(SOURCE_SHA256.length,64);
assert.deepEqual(ROLES,["base","orm","normal","emissive"]);
const [glb,legacy,texture,projects]=process.argv.slice(2);
if(!glb||!legacy||!texture||!projects)throw Error("Pass pinned source GLB, legacy packed mesh, texture out, project out");
const real=importRealGLTFTextures(readFileSync(glb),texture);
assert.equal(real.sourceSha256,SOURCE_SHA256);
assert.equal(real.triangleCount,4510,"genuine WaterBottle expected source triangle count");
assert.equal(real.vertexStride,72);
assert.equal(real.vertexCount,13530);
assert.ok(real.uvBounds.max.some((n,j)=>n-real.uvBounds.min[j]>.5));
assert.ok(real.originalMaterial.emissiveFactor.some(x=>x>0));
for(const role of ROLES){
 assert.equal(real.images[role].originalSha256.length,64);
 assert.equal(real.images[role].pixelSha256.length,64);
 assert.ok(real.images[role].originalSize.every(x=>x>=8));
 assert.equal(real.images[role].rawByteLength,real.images[role].uploadSize[0]*real.images[role].uploadSize[1]*4);
}
for(const id of ["midnight","glacier","museum"]){
 const full=writeV6Scene(id,legacy,texture,projects,false);
 const flat=writeV6Scene(id,legacy,texture,projects,true);
 assert.equal(full.receipt.modelSourceSha256,SOURCE_SHA256);
 assert.equal(full.receipt.neutralMapAblation,false);
 assert.equal(flat.receipt.neutralMapAblation,true);
 const s=readFileSync(full.dir+"/RealModel.wgsl","utf8");
 assert.match(s,/@group\(0\) @binding\(1\) var baseMap/);
 assert.match(s,/@group\(0\) @binding\(5\) var emissiveMap/);
 assert.match(s,/textureSample\(normalMap/);
 assert.match(s,/textureSample\(ormMap/);
 const luau=readFileSync(full.dir+"/main.luau","utf8");
 assert.match(luau,/GPUTexture.new/);
 assert.match(luau,/:upload\(/);
 assert.match(luau,/PbrEmissive/);
 assert.match(luau,/stride=72/);
 assert.match(luau,/slot=6,format="float32x4"/);
 assert.match(luau,/GPUBindGroup.new/);
 assert.match(luau,/context:blob\("WaterBottleTexturedMesh"\)/);
 assert.equal(full.receipt.sourceTriangles,4510);
 assert.equal(full.receipt.runtime,"NOT_YET_COMPILED");
 assert.equal(full.receipt.aestheticScore,"NOT_EVALUATED");
 for(const role of ROLES)assert.notEqual(full.receipt.actualMapSHA256[role],flat.receipt.actualMapSHA256[role],
  "Original source pixels must differ from the neutral material ablation: "+id+"/"+role);
 const legacyMeta=JSON.parse(readFileSync(legacy+"/mesh-manifest.json","utf8"));
 const legacyBytes=readFileSync(legacy+"/water-bottle-gpu.bin");
 const invalid={...legacyMeta,glbSha256:"0".repeat(64)};
 assert.throws(()=>makeTexturedRive(id,legacyBytes,invalid,texture),/provenance disagree/);
}
console.log(JSON.stringify({status:"PASS",originalMaps:ROLES,sourceGLBTriangles:4510,variants:3,
 actualRenderer:"NOT_YET_TESTED",humanArt:"NOT_EVALUATED"}));
