// Render one distinct studio scene with the official Rive canvas runtime.
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {buildStudioScene,SCENE_IDS} from "./studio-foundry-scenes.mjs";
import {RiveHost} from "../dist/riveHost.js";
import {PAGE_SCRIPT} from "../dist/pageScript.js";

export async function renderStudio(id,outDir){
 if(!SCENE_IDS.includes(id))throw Error("Unknown scene: "+id);
 const directory=resolve(outDir);mkdirSync(directory,{recursive:true});
 const {scene,bytes,warnings}=buildStudioScene(id);
 if(warnings.length)throw Error("Writer warnings: "+warnings.join(", "));
 const src=Buffer.from(bytes);
 writeFileSync(join(directory,id+".riv"),src);
 const host=new RiveHost(PAGE_SCRIPT);
 try{
  const info=await host.inspect(src);
  const ab=info.artboards.find(a=>a.name==="Studio_"+id);
  if(!ab||!ab.animations.some(a=>a.name==="Reveal"))
   throw Error("Official Rive inspect failed: "+JSON.stringify(info));
  const r=await host.renderFrames(src,{animation:"Reveal",startTime:0,
   frameCount:46,fps:10,width:720,format:"png"});
  if(r.frames.length!==46)throw Error("Bad frame count");
  const chosen=[0,7,15,25,35,44],frames=[];
  for(let n=0;n<r.frames.length;n++){
   const b=Buffer.from(r.frames[n],"base64");
   if(b.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")throw Error("bad PNG "+n);
   writeFileSync(join(directory,"frame-"+String(n).padStart(3,"0")+".png"),b);
   if(chosen.includes(n))frames.push({t:n/10,filename:"frame-"+String(n).padStart(3,"0")+".png"});
  }
  writeFileSync(join(directory,id+"-poster.png"),Buffer.from(r.frames[44],"base64"));
  const proof={id,source:"original/hand-authored",runtime:"official @rive-app/canvas-advanced",
   animation:"Reveal",inspect:info,scene:{shapes:scene.shapes.length,
    texts:scene.texts.length,groups:scene.groups.length,tracks:scene.animations[0].tracks.length},
   generatedBytes:src.length,frames:46,fps:10,selectedFrames:frames,
   aestheticEvaluation:"NOT_BLIND_RATED",rights:"self-authored vector, bundled local font; check font permissions for redistribution",
   visualInspection:"MANUAL_REVIEW_REQUIRED"};
  writeFileSync(join(directory,id+"-proof.json"),JSON.stringify(proof,null,2)+"\n");
  console.log(JSON.stringify({id,bytes:src.length,shapeCount:scene.shapes.length,frames:r.frames.length}));
  return proof;
 }finally{await host.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 await renderStudio(process.argv[2],process.argv[3]??"test/tmp/studio-foundry/"+process.argv[2]);
}