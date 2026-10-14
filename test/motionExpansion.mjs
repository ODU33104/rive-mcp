// Smoke coverage for the expanded recipes: distinctive catalog phrases should retrieve
// their own executable choreography. This is *not* a human holdout benchmark.
import assert from "node:assert/strict";
import {loadCatalog,selectRecipes,compileRecipe,validateCatalog} from "../scripts/motion-recipe.mjs";
const catalog=loadCatalog();
assert.deepEqual(validateCatalog(catalog),[]);
assert.equal(catalog.recipes.length,60);
const newRecipes=catalog.recipes.filter(r=>r.expansionVersion==="v2");
assert.equal(newRecipes.length,42);
let top1=0;
for(const recipe of newRecipes){
 const cue=recipe.terms[0];
 const matches=selectRecipes(catalog,cue,{limit:3});
 if(matches[0]?.id===recipe.id)top1++;
 else console.warn("No matching top1 for "+recipe.id+" ("+cue+"): "+matches.map(x=>x.id));
 assert.ok(matches.some(x=>x.id===recipe.id),"Expanded recipe unsearchable for "+cue);
 const bindings=Object.fromEntries(recipe.roles.map(role=>[role,{target:"test-"+role,base:{x:200,y:130,rotation:0,scaleX:1,scaleY:1,opacity:1}}]));
 const compiled=compileRecipe(recipe,bindings,{fps:60});
 assert.ok(compiled.tracks.length>0);
 assert.ok(compiled.tracks.every(t=>t.keyframes.every(k=>Number.isInteger(k.frame)&&Number.isFinite(k.value))));
}
assert.ok(top1>=40,"Expanded recipe exact-phrase retrieval regression: "+top1+"/42");
console.log("motion expansion smoke: PASS ("+top1+"/42 exact cue Top-1; all 42 compile)");
