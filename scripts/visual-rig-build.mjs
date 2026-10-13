// Compose the editable rig library into three deliberately different artboards.
// node scripts/visual-rig-build.mjs [directory] [--render]
// --render MUST use official RiveHost runtime; no synthetic screenshots allowed.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createRiv} from "../dist/rivWriter.js";
import {instantiateRig,validateRigScene,STYLES,RIG_IDS} from "./visual-rig-library.mjs";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const SPEC=JSON.parse(readFileSync(join(ROOT,"samples/visual-rigs/compositions.json"),"utf8"));
export const COMPOSITIONS=SPEC.compositions;
const fmt=n=>+n.toFixed(5);
function mat(n){
 const a=(n.rotation||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
 return [c*(n.scaleX??1),s*(n.scaleX??1),-s*(n.scaleY??1),c*(n.scaleY??1),n.x||0,n.y||0];
}
function mul(a,b){
 return [fmt(a[0]*b[0]+a[2]*b[1]),fmt(a[1]*b[0]+a[3]*b[1]),
 fmt(a[0]*b[2]+a[2]*b[3]),fmt(a[1]*b[2]+a[3]*b[3]),
 fmt(a[0]*b[4]+a[2]*b[5]+a[4]),fmt(a[1]*b[4]+a[3]*b[5]+a[5])];
}
export function worldMatrix(id,idx,seen=new Set()){
 if(seen.has(id))throw Error("cyclic parent transform "+id);
 const n=idx.get(id);
 if(!n)throw Error("missing transform "+id);
 seen.add(id);
 const result=n.parent?mul(worldMatrix(n.parent,idx,seen),mat(n)):mat(n);
 seen.delete(id);
 return result;
}
function track(target,property,steps){
 return {target,property,keyframes:steps.map(([frame,value,easing])=>(
 {frame,value,...(easing?{easing}:{})}))};
}
export function makeComposition(c){
 if(!c||!STYLES[c.style])throw Error("invalid composition");
 if(!Array.isArray(c.placements)||c.placements.length<2)throw Error("multi-rig artboard required");
 const T=STYLES[c.style],w=960,h=560;
 const groups=[{id:"stage",x:0,y:0,opacity:1}],shapes=[],texts=[];
 const bg={id:"backdrop",type:"rect",x:w/2,y:h/2,width:w,height:h,z:0,
   fill:{gradient:{type:"linear",stops:[{color:c.background[0],position:0},{color:c.background[1],position:1}],
     start:{x:-w/2,y:-h/2},end:{x:w/2,y:h/2}}}};
 shapes.push(bg);
 const line=(id,x1,y1,x2,y2,color,z=2)=>{
   shapes.push({id,type:"polygon",x:0,y:0,points:[{x:x1,y:y1},{x:x2,y:y2}],
     closed:false,stroke:{color,thickness:1,cap:"round"},z});
 };
 line("header-rule",49,113,911,113,T.subtle);
 line("footer-rule",49,515,911,515,T.subtle);
 const font=content=>[{text:content,font:"inter"}];
 const addText=(id,str,x,y,width,size,color,align="left")=>
  texts.push({id,x,y,width,z:8000,align,
    runs:[{...font(str)[0],fontSize:size,color}]});
 addText("heading",c.heading,50,29,820,37,c.style==="porcelain"?T.ink:T.paper);
 addText("subheading",c.subtitle,52,82,825,13,T.accent);
 addText("folio","ORIGINAL VECTOR ASSEMBLIES   /   "+c.id.toUpperCase(),51,529,750,12,T.subtle);
 addText("counter","0"+c.placements.length+"  OBJECTS",765,532,150,11,T.accent,"right");
 const manifests=[],animationTracks=[],expected={};
 for(const [i,placement] of c.placements.entries()){
  const prefix=c.id+"-"+placement.rig.replace(/[^a-z]/g,"").slice(0,10)+"-"+i;
  const props={namespace:prefix,x:placement.x,y:placement.y,scale:placement.scale,
   rotation:placement.rotation||0,unit:"px",pivot:placement.pivot,domain:placement.domain,
   style:c.style,parent:"stage",zBase:50+i*300};
  const r=instantiateRig(placement.rig,props);
  groups.push(...r.groups);
  shapes.push(...r.shapes);
  texts.push(...r.texts);
  manifests.push(r.manifest);
  const root=r.manifest.root,pivot=r.manifest.pivot;
  expected[root]={x:placement.x,y:placement.y,scale:placement.scale,rotation:placement.rotation||0};
  // Each mechanism has a typed local motion and a staged artboard entrance.
  const start=12+i*19,end=108+i*12;
  animationTracks.push(track(root,"opacity",[[0,0],[start,0,"hold"],[start+31,1,"ease-out"],[180,1]]));
  animationTracks.push(track(root,"y",[[0,placement.y+24],[start,placement.y+24,"hold"],
    [start+57,placement.y,"ease-out"],[180,placement.y]]));
  if(placement.rig==="abstract-emote"){
    animationTracks.push(track(pivot,"scaleY",[[0,1],[94,1],[99,.10],[105,1],[180,1]]));
  }else if(placement.rig==="audio-equalizer"){
    animationTracks.push(track(pivot,"opacity",[[0,.35],[66,.9],[100,.5],[end,.9],[180,.65]]));
  }else{
    const degrees=placement.rig==="precision-watch"?55:
      placement.rig==="celestial-atlas"?42:placement.rig==="optical-lens"?25:
      placement.rig==="earbuds-case"?8:placement.rig==="studio-camera"?20:
      placement.rig==="botanical-form"?3:placement.rig==="progress-ring"?130:6;
    const base=placement.rig==="precision-watch"?35:placement.rig==="celestial-atlas"?-25:0;
    animationTracks.push(track(pivot,"rotation",[[0,base],[35+i*14,base,"hold"],
       [end,base+degrees,"ease-in-out"],[180,base+degrees]]));
  }
 }
 const scene={artboard:{name:"VisualRig_"+c.id,width:w,height:h},
   fonts:[{id:"inter",bytes:new Uint8Array(readFileSync(join(ROOT,"assets/inter.ttf")))}],
   groups,shapes,texts,
   animations:[{name:"Reveal",duration:180,fps:60,loop:"oneShot",tracks:animationTracks}],
   stateMachine:{name:"RigShowcase",states:[{name:"Start",animation:"Reveal"}],
     transitions:[{from:"entry",to:"Start"}]}};
 const validation=validateRigScene(scene,manifests);
 if(validation.clips< (c.id==="observatory"?0:1))throw Error("clip coverage missing");
 // Matrix witness tests full parent world transform: translation + uniform scale + rotation.
 const idx=new Map([...groups,...shapes,...texts].map(n=>[n.id,n]));
 for(const [root,witness] of Object.entries(expected)){
  const M=worldMatrix(root,idx);
  const angle=witness.rotation*Math.PI/180;
  const tolerance=.002;
  if(Math.abs(M[4]-witness.x)>tolerance||Math.abs(M[5]-witness.y)>tolerance||
    Math.abs(M[0]-witness.scale*Math.cos(angle))>tolerance||
    Math.abs(M[1]-witness.scale*Math.sin(angle))>tolerance)
    throw Error("world matrix witness failed "+root);
 }
 const result={...validation,artboard:scene.artboard.name,
   rigIds:manifests.map(m=>m.rig),
   bindingContracts:manifests,transferDomain:c.domain,worldTransform:"PASS"};
 return {scene,result};
}
export function buildAll(){
 if(COMPOSITIONS.length<3)throw Error("must render at least three different scene compositions");
 const seen=new Set(),domains=new Map(),outputs=[];
 for(const c of COMPOSITIONS){
  const b=makeComposition(c);
  const bin=createRiv(b.scene);
  assert.equal(Buffer.from(bin.bytes).subarray(0,4).toString("ascii"),"RIVE");
  if(bin.bytes.length<1000)throw Error("suspiciously tiny RIVE "+c.id);
  c.placements.forEach(p=>{
   seen.add(p.rig);
   if(!domains.has(p.rig))domains.set(p.rig,new Set());
   domains.get(p.rig).add(p.domain);
  });
  outputs.push({id:c.id,...b,bytes:bin.bytes,warnings:bin.warnings});
 }
 for(const id of RIG_IDS)if(!seen.has(id))throw Error("uncovered rig "+id);
 const transferred=Object.fromEntries([...domains].filter(([,v])=>v.size>1).map(([id,v])=>[id,[...v]]));
 if(!transferred["optical-lens"]||!transferred["optical-lens"].includes("photography")||
    !transferred["optical-lens"].includes("astronomy"))throw Error("semantic transfer not covered");
 return {outputs,transferred};
}
export async function renderEvidence(build,outputDir){
 const [{RiveHost},{PAGE_SCRIPT}]=await Promise.all([
   import("../dist/riveHost.js"),import("../dist/pageScript.js")]);
 const host=new RiveHost(PAGE_SCRIPT);
 const pngSignature="89504e470d0a1a0a";
 try{
  for(const o of build.outputs){
   const inspection=await host.inspect(Buffer.from(o.bytes));
   if(!inspection.artboards.some(a=>a.name===o.scene.artboard.name&&
     a.animations.some(x=>x.name==="Reveal")&&
     a.stateMachines.some(x=>x.name==="RigShowcase")))
     throw Error("official Rive runtime inspection failed: "+o.id);
   const r=await host.renderFrames(Buffer.from(o.bytes),{
     animation:"Reveal",startTime:0,frameCount:31,fps:10,width:960,format:"png"});
   if(r.frames.length!==31)throw Error("invalid runtime frame count "+o.id);
   const path=join(outputDir,o.id);
   mkdirSync(path,{recursive:true});
   for(const [i,frame] of r.frames.entries()){
     const buf=Buffer.from(frame,"base64");
     if(buf.subarray(0,8).toString("hex")!==pngSignature||buf.length<1000)
       throw Error("invalid official runtime PNG "+o.id+" #"+i);
     writeFileSync(join(path,"frame-"+String(i).padStart(3,"0")+".png"),buf);
     if([0,15,30].includes(i))writeFileSync(join(outputDir,o.id+"-"+i+".png"),buf);
   }
  }
 }finally{await host.close();}
 const safe=s=>s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll('"',"&quot;");
 const blocks=build.outputs.map(o=>
  '<article><h2>'+safe(o.id)+'</h2><p>'+o.result.rigIds.join(" · ")+'</p>'+
  '<img alt="Actual Rive runtime image for '+safe(o.id)+'" src="'+safe(o.id)+'-30.png">'+
  '<img alt="Actual official-runtime GIF animation" src="'+safe(o.id)+'.gif">'+
  '<p>Artboard: '+safe(o.scene.artboard.name)+' · binary: <code>'+safe(o.id)+'.riv</code></p></article>').join("");
 writeFileSync(join(outputDir,"index.html"),'<!doctype html><html lang="en"><meta charset="utf-8">'+
 '<title>Visual rig runtime evidence index</title><style>body{background:#101d27;color:#e0e9e9;'+
 'font:16px system-ui;margin:35px}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));'+
 'gap:25px}article{background:#223540;padding:24px}img{max-width:100%;display:block;margin:12px 0}'+
 'p{color:#a7cbc6}</style><h1>Reusable Rive vector assemblies</h1>'+
 '<p>Only actual official runtime PNG captures / GIFs from those frames; no synthetic posters.</p>'+
 '<main>'+blocks+'</main></html>');
 return {status:"PASS",runtime:"official RiveHost",framesPerComposition:31};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const dir=resolve(process.argv[2]??"test/tmp/visual-rigs");
 mkdirSync(dir,{recursive:true});
 const build=buildAll();
 for(const o of build.outputs)writeFileSync(join(dir,o.id+".riv"),Buffer.from(o.bytes));
 const summary={schema:"visual-rig-evidence/v1",rigs:RIG_IDS.length,
   compositions:build.outputs.map(o=>o.result),transferred:build.transferred,
   officialRuntime:"NOT_RUN"};
 if(process.argv.includes("--render"))summary.officialRuntime=await renderEvidence(build,dir);
 writeFileSync(join(dir,"summary.json"),JSON.stringify(summary,null,2)+"\n");
 console.log(JSON.stringify({status:"PASS",rigs:summary.rigs,scenes:summary.compositions.length,
   transfer:summary.transferred,officialRuntime:summary.officialRuntime}));
}
