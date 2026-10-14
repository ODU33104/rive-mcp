// RML styleframe-first gate: render three genuinely different official RML scenes,
// compare *visible pixels* and supply a human review board before any promotion.
// A/B pixel divergence is NOT a beauty score or a substitute for human direction.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {pixelDifference} from "./rml-evidence-audit.mjs";
import {STYLEFRAMES} from "./rml-direct-authoring.mjs";
const sha=b=>createHash("sha256").update(b).digest("hex");
function xhtml(s){return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");}
export function buildRMLStyleframeReview(artifactRoot,outDir){
 const dir=resolve(outDir),root=resolve(artifactRoot);
 mkdirSync(dir,{recursive:true});
 const entries=[];
 for(const id of STYLEFRAMES){
  const a=join(root,"official-rml-proof",id);
  const project=join(root,"official-rml",id);
  const proof=JSON.parse(readFileSync(join(a,"rml-direct-proof.json"),"utf8"));
  const rml=readFileSync(join(project,"scene.rml"));
  if(proof.sourceSha256!==sha(rml)||proof.status!=="OFFICIAL_CLI_BUILD_RENDER_PASS")
   throw Error("Unverified actual official RML artifact "+id);
  if(!proof.animationVisible||proof.pixelChanges.length!==2||proof.pixelChanges.some(d=>d.changedPercent<.02))
   throw Error("Frame visual motion unverified in "+id);
  if(proof.subjectiveVisualQuality!=="NOT_EVALUATED")
   throw Error("Fabricated human artistic score "+id);
  const files=[];
  for(let i=0;i<3;i++){
   const f="t"+i+".png",dest=id+"-"+f;
   copyFileSync(join(a,f),join(dir,dest));
   files.push(dest);
  }
  entries.push({id,sourceHash:proof.sourceSha256,route:"OFFICIAL_RML",files,
   owner:"repo-original",comparisonStatus:"READY_TO_REVIEW",
   humanTaste:"NOT_EVALUATED",approved:false});
 }
 const pairs=[];
 for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
  const a=entries[i],b=entries[j];
  const d=pixelDifference(join(dir,a.files[1]),join(dir,b.files[1]),18);
  if(d.changedPercent<1.0)throw Error("RML styleframes visually near duplicates");
  pairs.push({a:a.id,b:b.id,at:"1.2s",pixelDivergencePercent:d.changedPercent});
 }
 const results={schema:"source-styleframe-review/v1",candidates:entries.length,
  framesPerCandidate:3,sourceRoute:"OFFICIAL_RIVE_CLI_RML",
  differentCompositionsConfirmed:true,pairs,
  subjectiveWinner:"NOT_SELECTED",humanRating:"NOT_EVALUATED",
  productionApproval:"BLOCKED_UNTIL_MANUAL_STYLEFRAME_SELECTION",
  comparisonNote:"Different pixels do not imply better composition or design"};
 writeFileSync(join(dir,"review-evidence.json"),JSON.stringify(results,null,2)+"\n");
 const cards=entries.map(e=>'<section><h2>'+xhtml(e.id.toUpperCase())+
  ' <small>NOT EVALUATED</small></h2><figure>'+e.files.map((p,i)=>
  '<img src="'+xhtml(p)+'" alt="'+xhtml(e.id)+' official Rive CLI native capture '+i+'"/>').join("")+
  '</figure><p>Original vector RML; human visual approval required, not granted.</p></section>').join("\n");
 const html='<!doctype html><html lang="en"><meta charset="utf-8"><title>Three Official Rive RML Styleframes</title>'+
  '<style>body{font:15px system-ui;background:#0d151e;color:#e7f1f5;padding:24px}h1{font-size:28px}h2{font-size:20px}small{font-size:11px;color:#ffca7b}section{margin-bottom:25px}figure{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0}img{width:100%;border:1px solid #425264}p{opacity:.75}</style>'+
  '<h1>First-party RML styleframe review — not a quality endorsement</h1>'+
  '<p>Three original candidate source scenes compiled and pictured by Rive CLI. 0/3 approved; animation quality and premium styling remain untested.</p>'+cards+
  '</html>';
 writeFileSync(join(dir,"index.html"),html);
 console.log(JSON.stringify({realCLIProjects:3,pairedVisualDivergences:pairs,approved:0}));
 return results;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 buildRMLStyleframeReview(process.argv[2],process.argv[3]);
