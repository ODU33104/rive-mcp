import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {verifiedPolyHavenURL,convertHDRToNativeFloat16,ENV} from "../scripts/v7-polyhaven-hdri.mjs";
import {writeV7Scene} from "../scripts/v7-studio-ibl-rive.mjs";
const [hdr,apiJSON,legacy,materials,hdrOut,scenes]=process.argv.slice(2);
const url="https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_03_1k.hdr";
assert.equal(verifiedPolyHavenURL({hdri:{"1k":{hdr:{url}}}}).url,url);
assert.throws(()=>verifiedPolyHavenURL({hdri:{"1k":{hdr:{url:"https://example.com/fake.hdr"}}}}),/not an official/);
assert.equal(ENV.license,"CC0-1.0");
if(!hdr||!apiJSON||!legacy||!materials||!hdrOut||!scenes)throw Error("Actual CC0 RGBE/model/material inputs required");
const metadata=JSON.parse(readFileSync(apiJSON,"utf8"));
assert.equal(verifiedPolyHavenURL(metadata).url,url);
const r=convertHDRToNativeFloat16(hdr,metadata,hdrOut);
assert.equal(r.outputBytes,512*256*8);
assert.ok(r.sourcePeak>2);
assert.ok(r.sourceHDRPositivePixelsOverOne>200);
assert.equal(r.toneMapped,false);
for(const id of ["midnight","glacier","museum"]){
 const a=writeV7Scene(id,legacy,materials,hdrOut,scenes,false);
 const b=writeV7Scene(id,legacy,materials,hdrOut,scenes,true);
 assert.equal(a.receipt.environmentSourceSha256,b.receipt.environmentSourceSha256);
 assert.equal(a.receipt.identicalOriginalModelUVAndFourMaps,true);
 assert.equal(a.receipt.neutralEnvironmentAblation,false);
 assert.equal(b.receipt.neutralEnvironmentAblation,true);
 assert.notEqual(a.receipt.environmentFloat16Sha256,b.receipt.environmentFloat16Sha256);
 const shader=readFileSync(a.path+"/RealModel.wgsl","utf8");
 const lua=readFileSync(a.path+"/main.luau","utf8");
 assert.match(shader,/textureSample\(studioEnv/);
 assert.match(shader,/@binding\(6\) var studioEnv/);
 assert.match(shader,/envSample.*F/);
 assert.match(lua,/format="rgba16float"/);
 assert.match(lua,/environment:upload/);
 assert.match(lua,/slot=6,view=environment:view/);
 assert.equal(a.receipt.beauty,"NOT_EVALUATED");
 assert.equal(a.receipt.web,"SIGNED_PUBLISH_NOT_RUN");
}
console.log(JSON.stringify({test:"PASS",model:"real GLB + four maps",
 environment:"real Poly Haven HDR source",originalHdrPeak:r.sourcePeak,variants:3,
 render:"NEXT_OFFICIAL_RIVE_CLI"}));
