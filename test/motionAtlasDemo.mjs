import assert from "node:assert/strict";
import {buildDemo} from "../scripts/build-motion-atlas-demo.mjs";
for(const id of ["success-burst","editorial-headline","premium-product-intro"]){
 const {bytes,warnings}=buildDemo(id);
 assert.ok(bytes.length>1000,"Rive binary must not be empty for "+id);
 assert.equal(String.fromCharCode(...bytes.slice(0,4)),"RIVE");
 assert.ok(Array.isArray(warnings));
 console.log(id+": "+bytes.length+" bytes; warnings: "+warnings.length);
}
console.log("motion atlas demo: PASSED");
