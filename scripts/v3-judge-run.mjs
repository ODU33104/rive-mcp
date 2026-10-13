// Tournament ingest + audit. Usage after npm run build:
// node scripts/v3-judge-run.mjs --gold --out test/tmp/v3-judge
// node scripts/v3-judge-run.mjs --input attempts.json --out test/tmp/v3-judge
import {readFileSync,writeFileSync,mkdirSync,existsSync} from "node:fs";
import {resolve,dirname,join,relative} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {PASS,FAIL,UNKNOWN,evaluate,rightsDisposition,stopGate} from "./v3-judge-verify.mjs";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const digest=b=>createHash("sha256").update(b).digest("hex");
const fileDigest=p=>existsSync(p)?digest(readFileSync(p)):null;
const pngOk=b=>b.subarray(0,8).toString("hex")==="89504e470d0a1a0a";
const readJSON=p=>JSON.parse(readFileSync(resolve(ROOT,p),"utf8"));
const abs=p=>resolve(ROOT,p);
const repoPath=p=>p?relative(ROOT,abs(p)).replaceAll("\\","/"):null;
const status=(status,reason)=>({status,reason});
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
export async function runTournament({input=null,gold=false,out="test/tmp/v3-judge"}={}){
  const dir=abs(out);mkdirSync(dir,{recursive:true});
  const dataset=readJSON("data/v3-judge/frozen-prompts.v1.json");
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
        actual:{nodes:null,tracks:null,sourceClaims:null,binaryTrackAgreement:UNKNOWN,decompileCoverage:null,editableStructure:UNKNOWN,renderer:"@rive-app/canvas-advanced via Chromium"},
        binaryStructural:status(UNKNOWN,"binary not independently decoded"),
        render:status(UNKNOWN,"not run"),structural:status(UNKNOWN,"scene spec not supplied"),
        semantic:status(UNKNOWN,"no independently verified semantic object-class mapping"),
        editability:status(UNKNOWN,"editable in official Rive Editor not measured"),
        licensing:rightsDisposition(a.rights,a.assets),restrictions:[],missingFields:missing,
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
          const claims=(scene.animations||[]).flatMap(x=>x.tracks||[]).map(t=>({target:t.target,property:t.property,keyframes:t.keyframes}));
          record.actual.sourceClaims={nodes:nodes.map(n=>({id:n.id,parent:n.parent||null,type:n.type||(n.runs?"text":"group")})),tracks:claims};
          record.actual.editableStructure={shapes:(scene.shapes||[]).length,texts:(scene.texts||[]).length,tracks:claims.length,verifiedInEditor:false};
          record.structural=evaluate(scene,a.constraints||{},a.observations||{});
        }
        try {
          // Read actual property tracks back from .riv. Authored SceneSpec is only a claim.
          const {decompileRiv}=await import("../dist/rivDecompile.js");
          const decoded=decompileRiv(new Uint8Array(bytes));
          const artboards=decoded.scene.artboards||[decoded.scene];
          const binaryTracks=artboards.flatMap(ab=>ab.animations||[]).flatMap(an=>an.tracks||[]);
          record.actual.tracks=binaryTracks.map(t=>({target:t.target,property:t.property,keyframes:t.keyframes}));
          record.actual.nodes=artboards.flatMap(ab=>[...(ab.groups||[]),...(ab.shapes||[]),...(ab.texts||[])]).map(n=>({id:n.id,parent:n.parent||null,type:n.type||(n.runs?"text":"group")}));
          record.actual.decompileCoverage=decoded.coverage;
          if(record.actual.sourceClaims){
            const signatures=new Set(binaryTracks.map(t=>t.target+"."+t.property));
            const expected=record.actual.sourceClaims.tracks.map(t=>t.target+"."+t.property);
            record.actual.binaryTrackAgreement=expected.every(k=>signatures.has(k))&&expected.length===binaryTracks.length?
              "SIGNATURES_MATCH_VALUES_NOT_CERTIFIED":"UNKNOWN_OR_MISMATCH";
          }
          if(artboards.length===1){
            record.binaryStructural=evaluate(decoded.scene,a.constraints||{},a.observations||{});
            const coverageIncomplete=Object.values(decoded.coverage.skipped||{}).some(n=>n>0)||
              (decoded.coverage.warnings||[]).length>0;
            if(coverageIncomplete&&record.binaryStructural.status===PASS)
              record.binaryStructural=status(UNKNOWN,"binary decoder coverage incomplete; positive claims not certified");
            if(record.binaryStructural.status===FAIL)record.structural=record.binaryStructural;
            else if(record.structural.status===PASS&&record.binaryStructural.status!==PASS)
              record.structural=status(UNKNOWN,"binary property reconstruction not sufficient to confirm source assertion");
          }
        }catch(decompileError){
          record.actual.decompileError=String(decompileError);
          if(record.structural.status===PASS)
            record.structural=status(UNKNOWN,"source authored constraints not linked to independently extracted binary");
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
        // Real official-runtime animation frames. Never synthesize a GIF from
        // hand-painted mockups, placeholders, or a file signature alone.
        const filmDir=join(dir,record.id.replace(/[^a-zA-Z0-9_-]/g,"_")+"-sequence");
        mkdirSync(filmDir,{recursive:true});
        const sequence=await host.renderFrames(bytes,{animation,startTime:0,frameCount:24,
          fps:8,width:a.width||720,format:"png"});
        if(sequence.frames?.length!==24)throw Error("official runtime produced insufficient GIF source frames");
        for(const [i,b64] of sequence.frames.entries()){
          const frame=Buffer.from(b64,"base64");
          if(!pngOk(frame))throw Error("invalid official-runtime motion frame "+i);
          writeFileSync(join(filmDir,"frame-"+String(i).padStart(3,"0")+".png"),frame);
        }
        const gifFile=join(dir,record.id.replace(/[^a-zA-Z0-9_-]/g,"_")+".gif");
        const encode=spawnSync("ffmpeg",["-nostdin","-loglevel","error","-y","-framerate","8",
          "-i",join(filmDir,"frame-%03d.png"),"-vf","fps=8","-loop","0",gifFile],
          {encoding:"utf8",timeout:120000});
        if(encode.status!==0||!existsSync(gifFile))throw Error("real-frame GIF encoding failed: "+(encode.stderr||encode.error));
        const gifBytes=readFileSync(gifFile);
        if(gifBytes.subarray(0,3).toString("ascii")!=="GIF")
          throw Error("not an encoded GIF");
        record.gif={path:relative(dir,gifFile),sha256:digest(gifBytes),
          provenance:"24 PNG frames from bundled official Rive canvas-advanced runtime; ffmpeg encoded"};
        record.render=status(PASS,"real Rive canvas-advanced frames from Chromium; not an aesthetic score");
      }catch(e){
        record.render=status(FAIL,String(e));record.restrictions.push(status(FAIL,String(e)));runtimeFailed=true;
      }
      if(record.fallbackFrom)record.restrictions.push(status(UNKNOWN,"fallback success not attributed to requested route"));
      if(!record.holdoutMembership)record.restrictions.push(status(UNKNOWN,"reference or external prompt; excluded from frozen holdout metrics"));
      if(!a.constraints||Object.keys(a.constraints).length===0)record.restrictions.push(status(UNKNOWN,"semantic constraints missing"));
      record.objectiveStopGate=stopGate(record);
      record.candidateGate=record.objectiveStopGate.status;
      record.aestheticQuality="NOT_EVALUATED";
      record.elapsedMs=Number(process.hrtime.bigint()-startedNs)/1e6;
      audits.push(record);
    }
  }finally{await host.close();}
  const output={schema:"v3-judge-audit/v1",generatedAt:new Date().toISOString(),
    protocol:{dataset:"data/v3-judge/frozen-prompts.v1.json",holdoutAuthoring:dataset.authoring,
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
