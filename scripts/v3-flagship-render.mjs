// Actual official Rive Canvas Advanced runtime capture; do not substitute node-canvas/vector screenshots.
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {FLAGSHIP_IDS,buildFlagshipScene} from "./v3-flagship-scenes.mjs";
import {RiveHost} from "../dist/riveHost.js";
import {PAGE_SCRIPT} from "../dist/pageScript.js";
const digest=data=>createHash("sha256").update(data).digest("hex");
const COUNT=90,FPS=18;
export async function renderFlagship(id,output){
  if(!FLAGSHIP_IDS.includes(id))throw Error("Unknown flagship scene "+id);
  const dir=resolve(output);mkdirSync(dir,{recursive:true});
  const {scene,meta,bytes,warnings}=buildFlagshipScene(id);
  if(warnings.length)throw Error("Native writer warnings: "+JSON.stringify(warnings));
  const src=Buffer.from(bytes);
  const filename=id+".riv";writeFileSync(join(dir,filename),src);
  const host=new RiveHost(PAGE_SCRIPT);
  try{
    const inspection=await host.inspect(src);
    const board=inspection.artboards.find(x=>x.name==="Flagship_"+id);
    if(!board||!board.animations?.some(x=>x.name==="Direction"))throw Error("Official Rive inspect missing animation: "+JSON.stringify(inspection));
    const r=await host.renderFrames(src,{animation:"Direction",startTime:0,frameCount:COUNT,fps:FPS,width:960,format:"png"});
    if(r.frames.length!==COUNT)throw Error("Expected 90 runtime frames; got "+r.frames.length);
    const hashes=[];
    for(let i=0;i<COUNT;i++){
      const b=Buffer.from(r.frames[i],"base64");
      if(b.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")throw Error("Invalid PNG at "+i);
      const name="frame-"+String(i).padStart(3,"0")+".png";
      writeFileSync(join(dir,name),b);
      hashes.push({frame:i,timeSeconds:Number((i/FPS).toFixed(4)),sha256:digest(b),bytes:b.length});
    }
    const distinct=new Set(hashes.map(x=>x.sha256));
    if(distinct.size<35)throw Error("Insufficient mid-motion variation: "+distinct.size+" unique PNG hashes");
    const snapshots=[0,12,24,36,48,60,72,89];
    if(new Set(snapshots.map(n=>hashes[n].sha256)).size<6)throw Error("Temporal snapshots are nearly static");
    writeFileSync(join(dir,id+"-poster.png"),Buffer.from(r.frames[89],"base64"));
    const rights=readFileSync(resolve("LICENSE"),"utf8");
    const fontProof=/Inter font:\s*SIL Open Font License 1\.1/.test(rights);
    if(!fontProof)throw Error("Repository does not declare bundled Inter OFL 1.1");
    const evidence={
      id,createdAtUTC:new Date().toISOString(),artifactType:"native_editable_rive",
      source:"original-authored-script; no third-party media incorporated",
      sourceSha256:digest(readFileSync(new URL("./v3-flagship-scenes.mjs",import.meta.url))),
      fontSha256:digest(readFileSync(resolve("assets/inter.ttf"))),
      fontLicenseDeclaration:"Repository root LICENSE: Inter font — SIL Open Font License 1.1",
      fontLicenseNoticeFile:"NOT_VERIFIED (a separate upstream font notice should be retained for redistributed binaries)",
      clipAndTrackProof:meta.nativeReveal,
      animatedFamilies:meta.animatedFamilies,
      motionScript:{opening:meta.initialMotion,closing:meta.closingMotion},
      geometrySha256:digest(Buffer.from(JSON.stringify(scene.shapes))),
      rivSha256:digest(src),rivBytes:src.length,rivFile:filename,
      runtime:"official @rive-app/canvas-advanced, RiveHost/PAGE_SCRIPT",
      officialInspection:inspection,animation:"Direction",fps:FPS,
      frameCount:COUNT,frameHashes:hashes,snapshots,
      nativeFrameProof:"PASS",aestheticHumanBlindReview:"NOT_EVALUATED",
      manualVisualInspection:"NOT_EVALUATED",riveEditorClickThrough:"NOT_EVALUATED",
      noBitmapAssets:scene.images?.length===0,
      state:"Automated native/runtime evidence only. A human must examine all eight contact-sheet states before public showcase."
    };
    writeFileSync(join(dir,"evidence.json"),JSON.stringify(evidence,null,2)+"\n");
    console.log(JSON.stringify({id,rv:digest(src),frames:COUNT,uniqueFrames:distinct.size,runtime:"official",humanAesthetics:"NOT_EVALUATED"}));
    return evidence;
  }finally{await host.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  await renderFlagship(process.argv[2],process.argv[3]??"test/tmp/v3-flagship/"+process.argv[2]);
}
