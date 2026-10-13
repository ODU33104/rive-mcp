// Build an offline, anonymized, blind-ready (not independently blinded) review pack.
// node scripts/v3-judge-pack.mjs --audit test/tmp/v3-judge/audit.json
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createHash,randomBytes} from "node:crypto";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const hash=v=>createHash("sha256").update(v).digest("hex");
const stable=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==="object"&&!Array.isArray(x)?
  Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const esc=s=>String(s).replace(/[&<>"']/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]));
function equalBudget(a,b){return Boolean(a&&b)&&stable(a)===stable(b);}
function assetIdentity(a){return a?.map(x=>({hash:x.hash,rights:x.rights,path:x.path})).sort((x,y)=>String(x.path).localeCompare(String(y.path)));}
export function comparability(a,b){
  const failed=[];
  if(!a?.promptId||a.promptId!==b?.promptId)failed.push("different or unspecified prompt");
  if(!a.holdoutMembership||!b.holdoutMembership)failed.push("reference prompts are not frozen holdout trials");
  if(a.fallbackFrom||b.fallbackFrom)failed.push("fallback-attributed candidate");
  if(!Number.isFinite(a.durationSeconds)||a.durationSeconds<=0||
    a.durationSeconds!==b.durationSeconds)failed.push("duration not explicitly matched");
  if(!["finished-scene-edit","typed-slot","new-generation"].includes(a.route)||
    !["finished-scene-edit","typed-slot","new-generation"].includes(b.route)||
    a.route===b.route)failed.push("must compare different specified generation routes");
  const requiredBudget=["model","tokenCap","candidates","repairs","wallTimeCapMs"];
  if(!equalBudget(a.budget,b.budget)||requiredBudget.some(k=>a.budget?.[k]===undefined||b.budget?.[k]===undefined))
    failed.push("budget/model/candidate/repair mismatch or missing");
  if(!a.source?.hash||!b.source?.hash||!a.riv?.hash||!b.riv?.hash)
    failed.push("source or generated binary hash missing");
  if(a.rights?.assetsDeclaredComplete!==true||b.rights?.assetsDeclaredComplete!==true)
    failed.push("incomplete embedded-asset inventory");
  if(!a.assets||!b.assets||a.assets.some(x=>!x.hash)||b.assets.some(x=>!x.hash)||
      stable(assetIdentity(a.assets))!==stable(assetIdentity(b.assets)))failed.push("assets/rights identity mismatch or missing hashes");
  if(a.render?.status!=="PASS"||b.render?.status!=="PASS")failed.push("real rendered frames missing");
  if(!a.png?.length||!b.png?.length)failed.push("captures missing");
  if(!a.gif?.sha256||!b.gif?.sha256)failed.push("official runtime GIF evidence missing");
  return {status:failed.length?"NOT_COMPARABLE":"COMPARABLE_ON_DECLARED_CONTROLS",
    reasons:failed,warning:"Comparability does not imply aesthetic superiority or independent human blinding"};
}
const csvRow=xs=>xs.map(x=>'"'+String(x??"").replaceAll('"','""')+'"').join(",");
export function makePack(auditPath,outputDir){
  const audit=JSON.parse(readFileSync(auditPath,"utf8"));
  if(audit.schema!=="v3-judge-audit/v1")throw Error("wrong audit schema");
  const out=resolve(outputDir||join(dirname(auditPath),"review-pack"));mkdirSync(out,{recursive:true});
  const attempts=audit.attempts||[];
  if(new Set(attempts.map(a=>a.id)).size!==attempts.length)throw Error("duplicate candidate IDs");
  // A fresh cryptographic seed avoids deterministic route-to-slot leaks.
  const seed=randomBytes(32).toString("hex");
  const sorted=[...attempts].sort((a,b)=>hash(seed+"::"+a.id).localeCompare(hash(seed+"::"+b.id)));
  const names=new Map(sorted.map((a,i)=>[a.id,"Candidate "+String(i+1).padStart(2,"0")]));
  const columns=["candidate","prompt_id","typography_1_to_5","composition_1_to_5","motion_1_to_5","semantic_1_to_5","editability_1_to_5","preference","reviewer_code","notes"];
  const forms=[csvRow(columns)];
  const sections=[],map={};
  for(const a of sorted){
    const label=names.get(a.id);map[label]={id:a.id,route:a.route,promptId:a.promptId};
    forms.push(csvRow([label,a.promptId,"","","","","","","",""]));
    const imageNodes=(a.png||[]).map(p=>{
      const bytes=readFileSync(resolve(dirname(auditPath),p.path));
      if(bytes.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")throw Error("invalid real PNG "+p.path);
      return '<figure><img alt="Rive frame" src="data:image/png;base64,'+bytes.toString("base64")+'"><figcaption>'+esc(p.timeSeconds)+" s</figcaption></figure>";
    }).join("");
    if(a.gif?.path){
      const source=resolve(dirname(auditPath),a.gif.path),dest=join(out,label.replace(" ","-")+".gif");
      if(!existsSync(source)||hash(readFileSync(source))!==a.gif.sha256)
        throw Error("missing/mismatched real GIF for "+label);
      copyFileSync(source,dest);
    }
    if(a.riv?.path){
      const source=resolve(dirname(auditPath),a.riv.path),dest=join(out,label.replace(" ","-")+".riv");
      if(!existsSync(source)||hash(readFileSync(source))!==a.riv.hash)
        throw Error("missing/mismatched editable native binary for "+label);
      copyFileSync(source,dest);
    }
    const gif=a.gif?.path?'<p><img alt="Official-runtime animation" src="'+esc(label.replace(" ","-"))+'.gif"></p>':"";
    sections.push('<section><h2>'+esc(label)+'</h2><div class="frames">'+imageNodes+'</div>'+gif+'</section>');
  }
  const comparisons=[];
  for(let i=0;i<sorted.length;i++)for(let j=i+1;j<sorted.length;j++){
    comparisons.push({candidateA:names.get(sorted[i].id),candidateB:names.get(sorted[j].id),
      ...comparability(sorted[i],sorted[j])});
  }
  const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Blind-ready Rive review</title>'+
    '<style>body{font:15px system-ui;color:#e8eef3;background:#111b25;margin:30px}h1{font-size:25px}section{margin:24px 0;padding:20px;border:1px solid #4d6375;border-radius:10px}.frames{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}figure{margin:0}img{width:100%;background:#fff}figcaption{padding:7px;color:#bdd1de}small{color:#a5bac8}</style>'+
    '<h1>Rive scene tournament — anonymous frames</h1><p><strong>Unscored evidence for human review.</strong> Frames are rendered by Rive; no scores have been collected. Score only after confirming same-prompt, same-assets, same-budget comparability; ineligible candidates cannot be promoted.</p>'+
    '<small>Generated candidate IDs are opaque to reviewers here. This pack is blind-ready, NOT proof of an independently blinded panel. Keep audit and sealed key away from reviewers.</small>'+
    sections.join("")+'</html>';
  writeFileSync(join(out,"review.html"),html);
  writeFileSync(join(out,"human-ratings-blank.csv"),forms.join("\n")+"\n");
  writeFileSync(join(out,"comparisons.json"),JSON.stringify({schema:"v3-judge-comparison/v1",comparisons,
    humanRatings:"NOT_EVALUATED",eligibleForAestheticRanking:false,
    method:"pair same prompts/assets/declared budget; hard gating in audit"},null,2)+"\n");
  // Deliberately outside review-pack. Do not upload to the anonymous review artifact.
  writeFileSync(join(dirname(out),"sealed-blind-key.json"),JSON.stringify({schema:"v3-judge-blind-key/v1",seed,mapping:map},null,2)+"\n");
  return {candidates:sorted.length,pairs:comparisons.length,comparable:comparisons.filter(x=>x.status.startsWith("COMPARABLE")).length,dir:out};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const a=process.argv.slice(2),val=k=>a.includes(k)?a[a.indexOf(k)+1]:null;
  const audit=resolve(val("--audit")||"test/tmp/v3-judge/audit.json");
  console.log(JSON.stringify(makePack(audit,val("--out")||null)));
}
