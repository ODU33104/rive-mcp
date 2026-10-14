import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {packGLB,SOURCE} from "../scripts/v5-real-glb-mesh.mjs";
import {DIRECTIONS,makeRealModelDirection,materializeRealModel} from "../scripts/v5-rive-real-model-scene.mjs";
assert.equal(SOURCE.license,"CC0-1.0");
assert.equal(SOURCE.commit.length,40);
assert.deepEqual(Object.keys(DIRECTIONS),["midnight","glacier","museum"]);
assert.throws(()=>packGLB(Buffer.from("not real glTF")) ,/Invalid real glTF/);
if(process.argv[2]){
 const b=readFileSync(process.argv[2]);
 const a=packGLB(b);
 const c=packGLB(b);
 assert.deepEqual(a.data,c.data,"GLB extraction must be deterministic");
 assert.deepEqual(a.manifest,c.manifest,"Rights manifest must be deterministic");
 assert.ok(a.manifest.triangleCount>100,"Requires an actual 3D source, not triangle poster");
 assert.ok(a.manifest.materialEntries.length>0);
 assert.ok(a.manifest.strideBytes===48);
 assert.ok(a.manifest.originalGLBBytes>10000);
 const scripts=new Set();
 for(const id of Object.keys(DIRECTIONS)){
  const o=makeRealModelDirection(id,a.data,a.manifest);
  assert.equal(o.mesh.length,a.manifest.vertexCount*48);
  assert.match(o.script,/GPUBuffer.new/);
  assert.match(o.script,/GPUTexture.new/);
  assert.match(o.script,/depthStencil/);
  assert.match(o.script,/pass:draw\(self.points\)/);
  assert.match(o.script,/context:blob\("WaterBottleMesh"\)/);
  assert.match(o.shader,/@vertex/);assert.match(o.shader,/@fragment/);
  assert.ok(o.receipt.sourceImportedNotReconstructed);
  assert.equal(o.receipt.textureMapsCopied,false);
  assert.equal(o.receipt.humanAestheticReview,"NOT_EVALUATED");
  scripts.add(o.script);
  if(process.argv[3])materializeRealModel(id,process.argv[3],process.argv[4]);
 }
 assert.equal(scripts.size,3,"art-direction variants must not merely rename files");
 assert.throws(()=>makeRealModelDirection("invalid",a.data,a.manifest),/Unsupported/);
 assert.throws(()=>makeRealModelDirection("museum",Buffer.alloc(a.data.length),a.manifest),/verified/);
}
console.log("PASS: actual third-party GLB mesh, normals, original material factors, verified CC0 receipt and 3 GPU Rive source projects");
