// Deliberately narrow one-prompt proof: a watch launch or a seconds-only idle.
// Unsupported subjects and constraints abstain instead of producing false 'success'.
// Usage: npm run build && node scripts/prompt-solstice.mjs "静かな腕時計、秒針だけ動かす" output.riv
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {pathToFileURL} from "node:url";
import {buildAssemblyExperiment} from "./scene-assembly-lab.mjs";
export function planSolsticePrompt(prompt){
 if(typeof prompt!=="string"||!prompt.trim())return {status:"ABSTAIN",reason:"empty request"};
 const p=prompt.normalize("NFKC").toLowerCase();
 if(!/(?:時計|腕時計|ウォッチ|\bwatch\b|\bwristwatch\b)/u.test(p))
  return {status:"ABSTAIN",reason:"only watches supported: refusing unrelated object transfer"};
 if(/(?:秒針.{0,12}(?:動かさな|止め|禁止)|(?:no|don't|do not)\s+(?:second|seconds)\s+hand)/iu.test(p))
  return {status:"ABSTAIN",reason:"negative second-hand intent needs a distinct authored scene"};
 const second=/(?:秒針|(?:second|seconds)\s+hand)/u.test(p);
 const exclusive=/(?:だけ|のみ|以外は動か|only|nothing else)/u.test(p);
 const noBounce=/(?:跳ね(?:ない|させない)|バウンス(?:なし|禁止)|弾ませない|no[\s-]?bounce|without (?:a )?bounce)/u.test(p);
 const noConfetti=/(?:紙吹雪(?:なし|禁止)|no confetti|without confetti)/u.test(p);
 const wantsLaunch=/(?:発表|紹介|登場|公開|シネマ|launch|reveal|introduc|cinematic|editorial)/u.test(p);
 if(second&&exclusive){
  return {status:"PLANNED",route:"typed-slot",variant:"seconds-only",
   hard:["only-seconds-rig",...(noBounce?["no-bounce"]:[]),...(noConfetti?["no-confetti"]:[])],
   scope:"SOLSTICE analog watch",quality:"NOT_BLIND_RATED"};
 }
 if(second)return {status:"ABSTAIN",reason:"seconds hand mentioned without exclusive motion scope"};
 if(noBounce)return {status:"ABSTAIN",reason:"authored launch contains easing that may overshoot; cannot honor no-bounce"};
 if(wantsLaunch){
  return {status:"PLANNED",route:"finished-scene",variant:"original",
   hard:[...(noConfetti?["no-confetti"]:[])],scope:"SOLSTICE analog watch",quality:"NOT_BLIND_RATED"};
 }
 return {status:"ABSTAIN",reason:"no supported watch motion style specified"};
}
export function writeOnePromptRive(prompt,out){
 const plan=planSolsticePrompt(prompt);
 if(plan.status!=="PLANNED")return {plan,output:null};
 const {originalBytes,typedBytes}=buildAssemblyExperiment();
 const bytes=plan.variant==="seconds-only"?typedBytes:originalBytes;
 const output=resolve(out);
 mkdirSync(dirname(output),{recursive:true});
 writeFileSync(output,Buffer.from(bytes));
 const receipt={...plan,source:"self-authored SOLSTICE",
  output,format:"RIVE",editable:["shapes","texts","animations"],
  renderStatus:"NOT_RENDERED_BY_THIS_COMMAND",
  confidence:"LIMITED_SUPPORTED_DOMAIN",originalUserPrompt:prompt};
 writeFileSync(output+".evidence.json",JSON.stringify(receipt,null,2)+"\n");
 return {plan,output,receipt};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const prompt=process.argv[2]??"",file=process.argv[3]??"test/tmp/scene-assembly-evidence/prompt.riv";
 const out=writeOnePromptRive(prompt,file);
 console.log(JSON.stringify(out));
 if(out.plan.status!=="PLANNED")process.exitCode=2;
}
