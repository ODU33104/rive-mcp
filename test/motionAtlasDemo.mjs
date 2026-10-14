import assert from "node:assert/strict";
import {buildDemo} from "../scripts/build-motion-atlas-demo.mjs";
for(const id of ["success-burst","editorial-headline","premium-product-intro"]){
 const {bytes,warnings}=buildDemo(id);
 assert.ok(bytes.length>1000,"Rive binary must not be empty for "+id);
 assert.equal(String.fromCharCode(...bytes.slice(0,4)),"RIVE");
 assert.ok(Array.isArray(warnings));
 console.log(id+": "+bytes.length+" bytes; warnings: "+warnings.length);
}
const japanese=buildDemo("上品で洗練された商品紹介");
assert.equal(japanese.selectedRecipe,"premium-product-intro");
assert.ok(japanese.bytes.length>1000);
const success=buildDemo("成功したので祝福するアニメーション");
assert.equal(success.selectedRecipe,"success-burst");
assert.throws(()=>buildDemo("宇宙の無関係な特殊入力"),/No supported demo recipe/);
console.log("motion atlas demo: PASSED");
