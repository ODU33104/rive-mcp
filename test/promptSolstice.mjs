import assert from "node:assert/strict";
import {existsSync,mkdirSync,readFileSync} from "node:fs";
import {resolve} from "node:path";
import {planSolsticePrompt,writeOnePromptRive} from "../scripts/prompt-solstice.mjs";

const cases=[
 ["静かな腕時計。秒針だけを動かし、弾ませない","PLANNED","seconds-only"],
 ["Quiet premium wristwatch, only the second hand moves","PLANNED","seconds-only"],
 ["腕時計の美しい発表演出を作る","PLANNED","original"],
 ["Cinematic editorial watch launch reveal","PLANNED","original"],
 ["高級イヤホンの発表演出を作る","ABSTAIN",null],
 ["腕時計を弾ませないで発表したい","ABSTAIN",null],
 ["腕時計の秒針は動かさないで","ABSTAIN",null],
 ["秒針を動かす","ABSTAIN",null],
 ["","ABSTAIN",null]
];
for(const [prompt,status,variant] of cases){
 const result=planSolsticePrompt(prompt);
 assert.equal(result.status,status,JSON.stringify({prompt,result}));
 if(variant)assert.equal(result.variant,variant);
}
const outdir=resolve("test/tmp/scene-prompt");
mkdirSync(outdir,{recursive:true});
const routeA=writeOnePromptRive(cases[2][0],outdir+"/finished.riv");
const routeB=writeOnePromptRive(cases[0][0],outdir+"/second-hand.riv");
for(const x of [routeA,routeB]){
 assert.equal(x.plan.status,"PLANNED");
 const b=readFileSync(x.output);
 assert.equal(b.subarray(0,4).toString("ascii"),"RIVE");
 assert.ok(b.length>3000);
 const receipt=JSON.parse(readFileSync(x.output+".evidence.json","utf8"));
 assert.equal(receipt.renderStatus,"NOT_RENDERED_BY_THIS_COMMAND");
 assert.equal(receipt.originalUserPrompt,x.receipt.originalUserPrompt);
}
assert.notDeepEqual(readFileSync(routeA.output),readFileSync(routeB.output));
const unsupported=outdir+"/unsupported.riv";
const abstain=writeOnePromptRive("高級イヤホンの紹介",unsupported);
assert.equal(abstain.plan.status,"ABSTAIN");
assert.equal(abstain.output,null);
assert.equal(existsSync(unsupported),false);
console.log("solstice one-prompt restricted routing: PASS (9 prompts; 2 distinct genuine RIVE; unsupported requests abstain)");
