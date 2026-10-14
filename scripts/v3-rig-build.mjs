// Compose the editable rig library into three deliberately different artboards.
// node scripts/visual-rig-build.mjs [directory] [--render]
// --render MUST use official RiveHost runtime; no synthetic screenshots allowed.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createRiv} from "../dist/rivWriter.js";
import {instantiateRig,validateRigScene,STYLES,RIG_IDS} from "./v3-rig-grammar.mjs";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const SPEC=JSON.parse(readFileSync(join(ROOT,"data/v3-rigs/compositions.json"),"utf8"));
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
// Five scene-specification timestamp checks, not claims of native runtime transform roundtrip.
export function frameWitnesses(scene,manifests){
 const frames=[0,36,72,108,180],tracks=scene.animations.find(a=>a.name==="Reveal").tracks;
 const samples=[];
 function sample(ks,f){
  if(f<=ks[0].frame)return ks[0].value;
  for(let i=1;i<ks.length;i++){
   if(f<=ks[i].frame){
    const lo=ks[i-1],hi=ks[i];
    if(lo.easing==="hold")return lo.value;
    const t=(f-lo.frame)/(hi.frame-lo.frame);
    return lo.value+(hi.value-lo.value)*t;
   }
  }
  return ks.at(-1).value;
 }
 for(const frame of frames){
  const idx=new Map([...scene.groups,...scene.shapes,...scene.texts].map(n=>[n.id,{...n}]));
  for(const tr of tracks){
   if(!["x","y","rotation","scaleX","scaleY"].includes(tr.property))continue;
   idx.get(tr.target)[tr.property]=sample(tr.keyframes,frame);
  }
  const result={frame,matrices:{}};
  for(const m of manifests){
   const M=worldMatrix(m.root,idx);
   if(!M.every(Number.isFinite)||Math.abs(M[0]*M[3]-M[1]*M[2])<1e-5)
     throw Error("invalid timestamp transform "+m.rig+" @ "+frame);
   result.matrices[m.root]=M;
  }
  samples.push(result);
 }
 return samples;
}
export function makeComposition(c){
 if(!c||!STYLES[c.style])throw Error("invalid composition");
 if(!Array.isArray(c.placements)||c.placements.length<2)throw Error("multi-rig artboard required");
 const T=STYLES[c.style],w=960,h=560;
 const groups=[{id:"stage",x:0,y:0,opacity:1}],shapes=[],texts=[];
 const responsive=[],listeners=[],inputs=[],states=[{name:"Start",animation:"Reveal"}],
   transitions=[{from:"entry",to:"Start"}];
 const bg={id:"backdrop",type:"rect",x:w/2,y:h/2,width:w,height:h,z:0,
   fill:{gradient:{type:"linear",stops:[{color:c.background[0],position:0},{color:c.background[1],position:1}],
     start:{x:-w/2,y:-h/2},end:{x:w/2,y:h/2}}}};
 shapes.push(bg);
 const line=(id,x1,y1,x2,y2,color,z=2)=>{
   shapes.push({id,type:"polygon",x:0,y:0,points:[{x:x1,y:y1},{x:x2,y:y2}],
     closed:false,stroke:{color,thickness:1,cap:"round"},z});
 };
 // Six independent art-direction systems. Shared geometry contracts, not a shared poster.
 const font=content=>[{text:content,font:"inter"}];
 const addText=(id,str,x,y,width,size,color,align="left")=>
  texts.push({id,x,y,width,z:8000,align,
    runs:[{...font(str)[0],fontSize:size,color}]});
 const bright=c.style==="porcelain"?T.ink:T.paper;
 const textInk=c.style==="porcelain"?T.ink:T.glint;
 switch(c.artDirection){
  case "editorial":
   line("header-rule",48,118,913,118,T.subtle);
   line("footer-rule",48,512,913,512,T.subtle);
   addText("heading",c.heading,52,38,700,38,bright);
   addText("subheading",c.subtitle,52,88,820,12,T.accent);
   break;
  case "dashboard":
   for(let i=0;i<4;i++)line("column-rule-"+i,100+i*247,130,100+i*247,472,T.subtle);
   addText("heading",c.heading,50,26,720,39,bright);
   addText("subheading",c.subtitle,51,93,800,11,T.accent);
   break;
  case "star-chart":
   for(let i=0;i<9;i++){
    let x=70+i*99;
    line("star-grid-"+i,x,119,x,489,T.subtle);
   }
   for(let i=0;i<5;i++)line("star-horizon-"+i,40,145+i*79,916,145+i*79,T.subtle);
   addText("heading",c.heading,49,29,780,39,bright);
   addText("subheading",c.subtitle,51,88,825,13,T.accent);
   break;
  case "spotlight":
   for(let i=0;i<3;i++)shapes.push({id:"stage-cone-"+i,type:"polygon",x:0,y:0,
    points:[{x:170+i*285,y:0},{x:115+i*285,y:473},{x:272+i*285,y:473}],
    z:1,fill:{color:T.accent},opacity:.08});
   line("stage-floor",39,461,918,461,T.accent);
   addText("heading",c.heading,58,28,790,44,bright);
   addText("subheading",c.subtitle,60,92,800,12,T.accent);
   break;
  case "field-notes":
   for(let i=0;i<10;i++)line("ruled-"+i,41,149+i*35,918,149+i*35,T.subtle);
   addText("heading",c.heading,52,25,740,39,textInk);
   addText("subheading",c.subtitle,54,86,825,12,T.accent);
   break;
  case "radar":
   for(let i=0;i<4;i++)
    shapes.push({id:"radar-orbit-"+i,type:"ellipse",x:477,y:286,
      width:210+i*165,height:210+i*165,z:3,
      stroke:{color:T.subtle,thickness:.8},opacity:.17});
   line("radar-baseline",52,476,913,476,T.glint);
   addText("heading",c.heading,51,24,820,41,bright);
   addText("subheading",c.subtitle,52,91,840,12,T.accent);
   break;
  default: throw Error("unknown art direction "+c.artDirection);
 }
 addText("folio","ORIGINAL EDITABLE VECTOR RIGS / "+c.id.toUpperCase(),51,526,725,12,T.subtle);
 addText("counter",String(c.placements.length).padStart(2,"0")+" MECHANISMS",768,527,154,11,T.accent,"right");
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
  const targets={
    "mechanical-metronome":"front-panel","pendant-lamp":"bell",
    "satellite-dish":"reflector-back","windmill":"hub",
    "abstract-emote":"head","progress-ring":"base-ring"
  };
  if(targets[placement.rig]){
    const input="activate"+i,state="Responsive"+i,anim="Response"+i;
    const prop=placement.rig==="abstract-emote"?"scaleY":"rotation";
    const base=placement.rig==="abstract-emote"?1:0;
    const swing=placement.rig==="mechanical-metronome"?26:
       placement.rig==="windmill"?70:placement.rig==="pendant-lamp"?12:32;
    const peak=prop==="scaleY"?.12:base+swing;
    responsive.push({name:anim,duration:72,fps:60,loop:"oneShot",tracks:[
      track(pivot,prop,[[0,base],[18,peak,"ease-out"],[44,base-(prop==="rotation"?swing*.3:0),"ease-in-out"],[72,base]])]});
    inputs.push({name:input,type:"trigger"});
    states.push({name:state,animation:anim});
    transitions.push({from:"any",to:state,condition:{input}});
    transitions.push({from:state,to:"Start",exitTimeMs:1200});
    listeners.push({target:r.manifest.nodeIds.find(n=>n.endsWith("--"+targets[placement.rig])),
      type:"click",actions:[{input}]});
    r.manifest.interaction={type:"native-trigger-click",input,state,animation:anim,
      target:listeners.at(-1).target,visualProperty:pivot+"."+prop};
  }

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
 const scene={artboard:{name:"V3Rig_"+c.id,width:w,height:h},
   fonts:[{id:"inter",bytes:new Uint8Array(readFileSync(join(ROOT,"assets/inter.ttf")))}],
   groups,shapes,texts,
   animations:[{name:"Reveal",duration:180,fps:60,loop:"oneShot",tracks:animationTracks},...responsive],
   stateMachine:{name:"RigShowcase",inputs,states,transitions,listeners}};
 const validation=validateRigScene(scene,manifests);
 const clipExpected=manifests.reduce((n,m)=>n+m.attachments.clipBindings.length,0);
 if(validation.clips!==clipExpected)throw Error("clip binding coverage changed");
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
 const result={...validation,artboard:scene.artboard.name,artDirection:c.artDirection,
   rigIds:manifests.map(m=>m.rig),
   bindingContracts:manifests,transferDomain:c.domain,worldTransform:"PASS",
   frameWitnesses:frameWitnesses(scene,manifests)};
 return {scene,result};
}
export function buildAll(){
 if(COMPOSITIONS.length<6)throw Error("must render six physically different compositions");
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
 const semanticInteractions=new Set(outputs.flatMap(x=>x.result.bindingContracts.filter(m=>m.interaction).map(m=>m.rig)));
 if(!["abstract-emote","pendant-lamp","progress-ring"].every(k=>semanticInteractions.has(k)))
   throw Error("three distinct reactive vector rigs required");
 const transferred=Object.fromEntries([...domains].filter(([,v])=>v.size>1).map(([id,v])=>[id,[...v]]));
 for(const [id,a,b] of [["optical-lens","photography","astronomy"],["satellite-dish","telecommunications","radio-astronomy"]]){
   if(!transferred[id]?.includes(a)||!transferred[id]?.includes(b))
     throw Error("genuine cross-domain transfer not covered "+id);
 }
 const shapeReuse=outputs.reduce((n,x)=>n+x.scene.shapes.length,0);
 const comparativeBaseline={kind:"structural only—not a perceptual visual quality claim",
   sourceTypes:seen.size,totalCompiledShapes:shapeReuse,
   compositionInstances:outputs.reduce((n,x)=>n+x.result.rigs,0),
   fullSceneEditingVisualComparison:"NOT_EVALUATED"};

 return {outputs,transferred,semanticInteractions:[...semanticInteractions],comparativeBaseline};
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
 const dir=resolve(process.argv[2]??"test/tmp/v3-rigs");
 mkdirSync(dir,{recursive:true});
 const build=buildAll();
 for(const o of build.outputs)writeFileSync(join(dir,o.id+".riv"),Buffer.from(o.bytes));
 const summary={schema:"v3-rig-native-evidence/v1",rigs:RIG_IDS.length,
   compositions:build.outputs.map(o=>o.result),transferred:build.transferred,baseline:build.comparativeBaseline,interactions:build.semanticInteractions,
   nativeTransformRoundtrip:"NOT_EVALUATED",aestheticBlindReview:"NOT_EVALUATED",
   officialRuntime:"NOT_RUN"};
 if(process.argv.includes("--render"))summary.officialRuntime=await renderEvidence(build,dir);
 writeFileSync(join(dir,"summary.json"),JSON.stringify(summary,null,2)+"\n");
 console.log(JSON.stringify({status:"PASS",rigs:summary.rigs,scenes:summary.compositions.length,
   transfer:summary.transferred,officialRuntime:summary.officialRuntime}));
}
