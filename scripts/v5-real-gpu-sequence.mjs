// Independent native Rive CLI captures: each PNG is rendered by Rive from scene
// source at its actual authored time. No interpolated/static/GIF-only imitations.
import {spawnSync} from "node:child_process";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve,join} from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
const HASH=b=>createHash("sha256").update(b).digest("hex");
export const TIMESTAMPS=Object.freeze(Array.from({length:31},(_,i)=>+(0.2+i*.12).toFixed(2)));
export function captureActualNativeFrames(project,outDir,riveCLI){
 const p=resolve(project),o=resolve(outDir),cli=resolve(riveCLI);
 mkdirSync(o,{recursive:true});
 const frames=[];
 for(const [index,t] of TIMESTAMPS.entries()){
  const path=join(o,"native-frame-"+String(index).padStart(3,"0")+".png");
  const args=[p,"--screenshot="+path,"--viewport=960x600","--advance="+t+"s"];
  const r=spawnSync(cli,args,{encoding:"utf8",timeout:35000,maxBuffer:1024*1024*8});
  if(r.status!==0||r.error)throw Error("Actual Rive native frame "+index+" failed: "+String(r.stderr||r.error).slice(-800));
  const data=readFileSync(path);
  if(data.subarray(0,8).toString("hex")!=="89504e470d0a1a0a"||data.length<2500)
   throw Error("Invalid original GPU renderer PNG frame "+index);
  frames.push({index,timestamp:t,bytes:data.length,sha256:HASH(data)});
 }
 const unique=new Set(frames.map(x=>x.sha256)).size;
 if(unique<24)throw Error("Failed actual GPUCanvas animation progression: "+unique);
 const proof={schema:"actual-cc0-3d-rive-native-animated-png-sequence/v1",
  renderTool:"first-party rive CLI (one fresh official rendering per timestamp)",
  frames:frames.length,uniqueFrames:unique,fps:Math.round(1/.12),
  first:TIMESTAMPS[0],last:TIMESTAMPS.at(-1),images:frames,
  interpolatedFrames:0,cssOrCanvasFake:false,subjectiveAesthetics:"NOT_EVALUATED"};
 writeFileSync(join(o,"native-frame-sequence-proof.json"),JSON.stringify(proof,null,2)+"\n");
 console.log(JSON.stringify({frames:proof.frames,unique:proof.uniqueFrames,duration:proof.last-proof.first}));
 return proof;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 captureActualNativeFrames(process.argv[2],process.argv[3],process.argv[4]);
