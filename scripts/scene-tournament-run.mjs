// Tournament ingest + audit. Usage after npm run build:
// node scripts/scene-tournament-run.mjs --gold --out test/tmp/scene-tournament
// node scripts/scene-tournament-run.mjs --input attempts.json --out test/tmp/scene-tournament
import {readFileSync,writeFileSync,mkdirSync,existsSync} from "node:fs";
import {resolve,dirname,join,relative} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {PASS,FAIL,UNKNOWN,evaluate} from "./scene-tournament-verify.mjs";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const digest=b=>createHash("sha256").update(b).digest("hex");
const fileDigest=p=>existsSync(p)?digest(readFileSync(p)):null;
const pngOk=b=>b.subarray(0,8).toString("hex")==="89504e470d0a1a0a";
const readJSON=p=>JSON.parse(readFileSync(resolve(ROOT,p),"utf8"));
const abs=p=>resolve(ROOT,p);
const repoPath=p=>p?relative(ROOT,abs(p)).replaceAll("\\","/"):null;
const status=(status,reason)=>({status,reason});
function rightsCheck(rights={},assets=[]){
  const issues=[];
  if(!rights.sourceEvidence)issues.push("source permission evidence missing");
  if(rights.assetsDeclaredComplete!==true)issues.push("embedded asset list completeness unverified");
  for(const operation of ["inspect","render","adapt","embed","redistribute"])
    if(rights.operations?.[operation]!=="allow")issues.push(operation+" not explicitly allowed");
  for(const asset of assets)
    if(asset.rights!=="allow"||!asset.rightsEvidence)issues.push("asset rights unresolved: "+asset.path);
  return status(issues.length?UNKNOWN:PASS,issues.length?issues.join("; "):"explicit source/asset operation claims (not legal opinion)");
}
function completeness(a){
  const needed=["promptId","route","budget","rights","assets"];
  return needed.filter(k=>a[k]===undefined);
}
function goldAttempt(out){
  return {id:"solstice-observation",promptId:"gold-reference-not-holdout",route:"A",
    sourceKind:"gold",source:"scripts/build-motion-atlas-gold.mjs",
    budget:{model:"hand-authored",tokenCap:0,candidates:1,repairs:0,wallTimeCapMs:120000},
    assets:[{path:"assets/inter.ttf",rights:"UNKNOWN",rightsEvidence:null}],
    rights:{sourceEvidence:"samples/motion-atlas-gold/scene.json (self-authored declaration)",
      operations:{inspect:"allow",render:"allow",adapt:"allow",embed:"allow",redistribute:"UNKNOWN",train:"UNKNOWN"}},
    // Intentional failing constraint: gold actually animates the minute hand.
    constraints:{requiredNodes:["watch","minuteHand","hourHand","caseMetal"],
      pivots:[{nodePath:"minuteHand",referencePath:"watch",frames:[0,270],tolerancePx:0.5}],
      motion:[{kind:"forbid-rotation",target:"minuteHand"}],
      visual:[{kind:"text-overflow",target:"heroLine1"}]}
  };
}
export async function runTournament({input=null,gold=false,out="test/tmp/scene-tournament"}={}){
  const dir=abs(out);mkdirSync(dir,{recursive:true});
  const dataset=readJSON("data/motion-eval/frozen-prompts.v1.json");
  const ids=new Set(dataset.cases.map(c=>c.id));
  const attempts=gold?[goldAttempt(dir)]:readJSON(input).attempts;
  if(!Array.isArray(attempts)||!attempts.length)throw Error("non-empty attempts array required");
  const pkg=readJSON("package.json"),audits=[];
  const [{RiveHost},{PAGE_SCRIPT}]=await Promise.all([import("../dist/riveHost.js"),import("../dist/pageScript.js")]);
  const host=new RiveHost(PAGE_SCRIPT);let runtimeFailed=false;
  try{
    for(const a of attempts){
      const startedAt=new Date().toISOString(),startedNs=process.hrtime.bigint();
      const missing=completeness(a);
      const record={id:a.id||"UNKNOWN",promptId:a.promptId??null,
        holdoutMembership:ids.has(a.promptId),route:a.route??null,
        fallbackFrom:a.fallbackFrom??null,sourceKind:a.sourceKind||"riv",
        source:{path:repoPath(a.source),hash:fileDigest(a.source)},
        riv:{path:null,hash:null},gif:null,png:[],
        assets:(a.assets||[]).map(x=>({...x,hash:fileDigest(x.path)})),
        rights:a.rights??null,budget:a.budget??null,
        startedAt,elapsedMs:null,
        versions:{node:process.version,package:pkg.version,
          riveCanvasAdvanced:pkg.dependencies["@rive-app/canvas-advanced"],revision:process.env.GITHUB_SHA||"UNPINNED"},
        actual:{nodes:null,tracks:null,editableStructure:UNKNOWN,renderer:"@rive-app/canvas-advanced via Chromium"},
        render:status(UNKNOWN,"not run"),structural:status(UNKNOWN,"scene spec not supplied"),
        semantic:status(UNKNOWN,"no independently verified semantic object-class mapping"),
        editability:status(UNKNOWN,"editable in official Rive Editor not measured"),
        licensing:rightsCheck(a.rights,a.assets),restrictions:[],missingFields:missing,
        candidateGate:UNKNOWN};
      try{
        if(missing.length)throw Error("missing manifest fields: "+missing.join(", "));
        if(a.promptId?.startsWith("oos-"))record.restrictions.push(status(FAIL,"OOS request must abstain; submitted scene cannot count as success"));
        let bytes,scene=null;
        if(a.sourceKind==="gold"){
          const {buildGold}=await import("./build-motion-atlas-gold.mjs");
          const built=buildGold();bytes=Buffer.from(built.bytes);scene=built.scene;
        }else {
          if(!a.riv||!existsSync(abs(a.riv)))throw Error("RIV source missing");
          bytes=readFileSync(abs(a.riv));
          if(a.sceneSpec){scene=readJSON(a.sceneSpec);}
        }
        if(bytes.subarray(0,4).toString("ascii")!=="RIVE")throw Error("invalid RIVE binary magic");
        const rivFile=join(dir,(a.id||"candidate").replace(/[^a-zA-Z0-9_-]/g,"_")+".riv");
        writeFileSync(rivFile,bytes);
        record.riv={path:relative(dir,rivFile),hash:digest(bytes)};
        if(scene){
          const nodes=[...(scene.groups||[]),...(scene.shapes||[]),...(scene.texts||[])];
          record.actual.nodes=nodes.map(n=>({id:n.id,parent:n.parent||null,type:n.type||(n.runs?"text":"group")}));
          record.actual.tracks=(scene.animations||[]).flatMap(x=>x.tracks||[]).map(t=>({target:t.target,property:t.property,keyframes:t.keyframes}));
          record.actual.editableStructure={shapes:(scene.shapes||[]).length,texts:(scene.texts||[]).length,tracks:record.actual.tracks.length};
          record.structural=evaluate(scene,a.constraints||{},a.observations||{});
        }
        const verifiedReview=(claim)=>claim?.status===PASS&&claim.reviewer&&claim.evidencePath&&
          existsSync(abs(claim.evidencePath))&&claim.reviewedSourceSha256===record.riv.hash;
        if(verifiedReview(a.semanticReview))record.semantic=status(PASS,"source-hash-pinned reviewer evidence supplied; reviewer independence not authenticated");
        if(verifiedReview(a.editorReview))record.editability=status(PASS,"source-hash-pinned editor evidence supplied; UI editability not automatically proven");
        const observed=await host.inspect(bytes);
        record.actual.runtimeInspect={artboards:observed.artboards?.map(b=>({name:b.name,animations:b.animations?.map(x=>x.name),
          stateMachines:b.stateMachines?.map(x=>x.name)}))||[]};
        const animation=a.animation||scene?.animations?.[0]?.name||observed.artboards?.[0]?.animations?.[0]?.name;
        if(!animation)throw Error("animation cannot be determined for real Rive rendering");
        const times=a.captureSeconds||[0,1.5,3];
        for(const [i,t] of times.entries()){
          const rendered=await host.renderFrames(bytes,{animation,startTime:t,frameCount:1,fps:1,width:a.width||720,format:"png"});
          const frame=Buffer.from(rendered.frames?.[0]||"","base64");
          if(!pngOk(frame))throw Error("official runtime did not produce PNG at "+t+" s");
          const name=record.id.replace(/[^a-zA-Z0-9_-]/g,"_")+"-frame-"+String(i).padStart(2,"0")+".png";
          writeFileSync(join(dir,name),frame);
          record.png.push({path:name,timeSeconds:t,sha256:digest(frame),bytes:frame.length});
        }
        record.render=status(PASS,"real Rive canvas-advanced frames from Chromium; not an aesthetic score");
      }catch(e){
        record.render=status(FAIL,String(e));record.restrictions.push(status(FAIL,String(e)));runtimeFailed=true;
      }
      if(record.fallbackFrom)record.restrictions.push(status(UNKNOWN,"fallback success not attributed to requested route"));
      if(!record.holdoutMembership)record.restrictions.push(status(UNKNOWN,"reference or external prompt; excluded from frozen holdout metrics"));
      if(!a.constraints||Object.keys(a.constraints).length===0)record.restrictions.push(status(UNKNOWN,"semantic constraints missing"));
      record.candidateGate=record.render.status===PASS&&record.structural.status===PASS&&
        record.semantic.status===PASS&&record.editability.status===PASS&&record.licensing.status===PASS&&
        record.restrictions.every(r=>r.status===PASS)?PASS:
        [record.render,record.structural,record.licensing,...record.restrictions].some(x=>x.status===FAIL)?FAIL:UNKNOWN;
      record.elapsedMs=Number(process.hrtime.bigint()-startedNs)/1e6;
      audits.push(record);
    }
  }finally{await host.close();}
  const output={schema:"scene-tournament-audit/v1",generatedAt:new Date().toISOString(),
    protocol:{dataset:"data/motion-eval/frozen-prompts.v1.json",holdoutAuthoring:dataset.authoring,
      unknownDisposition:"REJECT",aestheticScores:"NOT_EVALUATED",costBasis:"declared budgets, not inferred"},
    attempts:audits};
  writeFileSync(join(dir,"audit.json"),JSON.stringify(output,null,2)+"\n");
  if(runtimeFailed)process.exitCode=1;
  return output;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2),arg=n=>args.includes(n)?args[args.indexOf(n)+1]:null;
  if(!args.includes("--gold")&&!arg("--input"))throw Error("specify --gold or --input attempts.json");
  const report=await runTournament({gold:args.includes("--gold"),input:arg("--input"),out:arg("--out")||undefined});
  console.log(JSON.stringify({attempts:report.attempts.length,rendered:report.attempts.filter(a=>a.render.status===PASS).length,gate:report.attempts.map(a=>a.candidateGate)}));
}
