import assert from "node:assert/strict";
import {loadCatalog,selectRecipes,validateCatalog,compileRecipe} from "../scripts/motion-recipe.mjs";

const catalog=loadCatalog();
assert.deepEqual(validateCatalog(catalog),[]);
assert.equal(catalog.recipes.length,18);
assert.equal(catalog.sources.length,18);
assert.equal(selectRecipes(catalog,"高級で洗練された商品紹介")[0].id,"premium-product-intro");
assert.equal(selectRecipes(catalog,"かわいい読み込みアニメ")[0].id,"loading-breathe");
assert.notEqual(selectRecipes(catalog,"派手すぎない成功演出")[0].id,"reward-reveal");
assert.deepEqual(selectRecipes(catalog,"別件で無関係な指示"),[]);
for(const recipe of catalog.recipes){
 const bindings=Object.fromEntries(recipe.roles.map(role=>[
  role,{target:"test-"+role,base:{x:100,y:100,rotation:0,scaleX:1,scaleY:1,opacity:1}}
 ]));
 const animation=compileRecipe(recipe,bindings,{fps:60});
 assert.equal(animation.name,recipe.id);
 assert.ok(animation.tracks.length>0);
 assert.ok(animation.tracks.every(t=>t.keyframes.every(k=>Number.isFinite(k.value)&&k.frame>=0&&k.frame<animation.duration)));
 assert.ok(animation.tracks.every(t=>t.keyframes.every((k,i,ks)=>i===0||k.frame>ks[i-1].frame)));
 assert.ok(animation.tracks.every(t=>["x","y","rotation","scaleX","scaleY","opacity"].includes(t.property)));
}
const example=catalog.recipes.find(r=>r.id==="success-burst");
assert.throws(()=>compileRecipe(example,{}),/Missing bound target/);
assert.throws(()=>compileRecipe(example,Object.fromEntries(example.roles.map(role=>[role,{target:role}])),{fps:0}),/fps must be positive/);
const invalid=structuredClone(catalog);
invalid.recipes[0].structure.steps[0].role="does-not-exist";
assert.match(validateCatalog(invalid).join(" "),/unknown role/);
assert.equal(compileRecipe(catalog.recipes.find(r=>r.id==="loading-breathe"),{mark:{target:"mark"}}).loop,"loop");
console.log("motion recipe atlas: PASSED ("+catalog.recipes.length+" recipes, "+catalog.sources.length+" sources)");
