// Run after the official-runtime render workflow. This benchmark never fabricates RML outputs.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {performance} from "node:perf_hooks";
import {planSolsticePrompt} from "./prompt-solstice.mjs";
import {planConstructiveScene,writeConstructiveScene} from "./v3-construct-agent.mjs";

export async function compareSix({output="test/tmp/v3-construct/comparison.json",
  evidenceDir="test/tmp/v3-construct"}={}){
  const fixtures=JSON.parse(readFileSync(new URL("../samples/v3-construct/prompts.json",import.meta.url),"utf8")).slice(0,6);
  const rows=[];
  for(const f of fixtures){
    const nativeReceipt=join(resolve(evidenceDir),f.id,f.id+".riv.evidence.json");
    const native=existsSync(nativeReceipt)?JSON.parse(readFileSync(nativeReceipt,"utf8")):null;
    const t0=performance.now();
    const plan=planConstructiveScene(f.prompt);
    // Time plan + writer in the same process. Rendering is checked separately by CI receipts.
    const res=plan.status==="PLANNED"
      ? await writeConstructiveScene(f.prompt,join(resolve("test/tmp/v3-benchmark"),f.id+".riv"))
      : null;
    const buildMs=Math.round((performance.now()-t0)*100)/100;
    const adapted=planSolsticePrompt(f.prompt);
    rows.push({
      id:f.id,prompt:f.prompt,subject:f.domain,
      constraints:plan.status==="PLANNED"?plan.design.constraints:null,
      comparisonMatchedRequest:true,
      completedSceneAdaptation:{
        status:adapted.status==="ABSTAIN"?"UNSUPPORTED_DOMAIN":"AVAILABLE",
        reason:adapted.reason??null,timeMs:null,rendered:false
      },
      constructive:{
        status:res?.output?"RIVE_WRITTEN":plan.status,
        timeMs:buildMs,timingScope:"plan + binary serialization only",
        sha256:res?.evidence?.riveSha256??null,
        officialRuntime: native?.renderStatus??"NOT_MEASURED",
        visuallyRated:false
      },
      directOfficialRML:{
        status:"UNSUPPORTED",reason:"No verified direct official RML authoring/execution adapter in this repository",
        timeMs:null,rendered:false
      },
      fairness:"Identical prompt; unsupported baseline never counted as failure of visual quality",
      aestheticBlindComparison:"NOT_EVALUATED"
    });
  }
  mkdirSync(dirname(resolve(output)),{recursive:true});
  writeFileSync(resolve(output),JSON.stringify({
    schema:"v3-comparison/v1",dateSource:"CI execution",count:rows.length,
    evidenceDefinition:"Constructive writing and official runtime receipts are distinct; no visual superiority implied",
    rows
  },null,2)+"\n");
  return rows;
}
if(import.meta.url===new URL("file://"+resolve(process.argv[1]??"")).href)
  await compareSix();
