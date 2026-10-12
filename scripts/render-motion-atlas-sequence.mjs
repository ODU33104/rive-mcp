// Render an actual Rive animation to a contiguous PNG frame sequence.
// Usage: npm run build && RIVE_MCP_CHROME=/path/to/chromium node scripts/render-motion-atlas-sequence.mjs [output-directory]
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {buildGold} from "./build-motion-atlas-gold.mjs";
import {RiveHost} from "../dist/riveHost.js";
import {PAGE_SCRIPT} from "../dist/pageScript.js";
const FPS=18,FRAME_COUNT=82;
export async function renderSequence(outDir){
 const dir=resolve(outDir);
 mkdirSync(dir,{recursive:true});
 const {bytes,scene}=buildGold();
 const rivPath=join(dir,"solstice.riv");
 writeFileSync(rivPath,Buffer.from(bytes));
 const host=new RiveHost(PAGE_SCRIPT);
 try {
  const inspect=await host.inspect(Buffer.from(bytes));
  if(!inspect.artboards.some(a=>a.name===scene.artboard.name&&
       a.animations.some(anim=>anim.name==="Reveal")))throw Error("Official Rive runtime could not identify animation Reveal");
  const output=await host.renderFrames(Buffer.from(bytes),{
   animation:"Reveal",startTime:0,frameCount:FRAME_COUNT,fps:FPS,width:720,format:"png"
  });
  if(output.frames.length!==FRAME_COUNT)throw Error("Runtime frame count mismatch "+output.frames.length);
  for(let i=0;i<FRAME_COUNT;i++){
   const bytes=Buffer.from(output.frames[i],"base64");
   if(bytes.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")
    throw Error("Non-PNG frame "+i);
   writeFileSync(join(dir,"frame-"+String(i).padStart(3,"0")+".png"),bytes);
  }
  writeFileSync(join(dir,"SOLSTICE-poster.png"),Buffer.from(output.frames[FRAME_COUNT-1],"base64"));
  writeFileSync(join(dir,"frame-info.json"),JSON.stringify({
   source:"Official @rive-app/canvas-advanced runtime",
   animation:"Reveal",frames:FRAME_COUNT,fps:FPS,
   elapsedSeconds:(FRAME_COUNT-1)/FPS,
   scene:scene.artboard,output:"frame-%03d.png"
  },null,2)+"\n");
  console.log(JSON.stringify({frames:FRAME_COUNT,fps:FPS,directory:dir,bytes:bytes.length}));
 }finally{await host.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{await renderSequence(process.argv[2]??"test/tmp/motion-atlas-showcase");}
 catch(e){console.error(e);process.exitCode=1;}
}
