// Real V3 portfolio director: typed art-direction reframe + licensed existing scene FX.
// This composes 2 separately existing SceneSpec authoring sources, not binary .riv splicing.
// Strictly bounded to four semantic combinations; never claims general open-vocabulary art.
import {writeFileSync,mkdirSync} from "node:fs";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {createRiv} from "../dist/rivWriter.js";
import {createArtDirectedScene} from "./studio-direction-experiments.mjs";
import {extractExistingEffect} from "./effect-capsule-reuse.mjs";

const CONCEPTS={
 optics:{sourceScene:"spectra",directionId:"cinematic-spectra",effectId:"spectral-beams",
  targets:["camera","lens","optical","カメラ","レンズ","光学"],effectTerms:["refraction","refracted","spectral","プリズム","分光","屈折"],root:{x:-10,y:-6,scale:.75,z:40},
  artifactFamily:"CINEMATIC OPTICAL STUDIO"},
 crystal:{sourceScene:"prism",directionId:"square-prism",effectId:"organic-dew",
  targets:["prism","crystal","クリスタル","プリズム","結晶"],effectTerms:["glint","droplet","sparkle","specular","光沢","きらめ","反射"],root:{x:0,y:0,scale:.88,z:24},
  artifactFamily:"CRYSTAL MATERIAL STUDY"},
 celestial:{sourceScene:"orbital",directionId:"square-orbital",effectId:"instrument-indices",
  targets:["planet","orbit","celestial","天体","惑星","軌道"],effectTerms:["calibration","instrument","dial","計測","目盛","計器"],root:{x:0,y:0,scale:.95,z:28},
  artifactFamily:"CELESTIAL NAVIGATION"},
 silicon:{sourceScene:"quantum",directionId:"cinematic-quantum",effectId:"system-beacon",
  targets:["chip","processor","silicon","semiconductor","半導体","チップ","プロセッサ"],effectTerms:["beacon","signal","pulse","telemetry","光点","信号","脈動"],root:{x:0,y:0,scale:1.0,z:48},
  artifactFamily:"COMPUTATION DETAIL"}
};
export const DIRECTOR_CONCEPTS=Object.freeze(Object.keys(CONCEPTS));
const norm=x=>x.normalize("NFKC").toLowerCase().trim();
function containsAny(s,words){return words.some(w=>s.includes(norm(w)));}
function noFX(s){return /(?:no (?:effect|fx|glow|glint|sparkles?)|without (?:fx|effects?|sparkles?)|光の効果(?:なし|不要|禁止)|エフェクト(?:なし|禁止)|光らせない|きらめかせない)/iu.test(s);}
function noSpinning(s){return /(?:no spin|without spin|no rotation|do not rotate|回転(?:なし|禁止|させない)|回さない)/iu.test(s);}
function noBounce(s){return /(?:no bounce|without bounce|バウンス(?:なし|禁止)|弾ませない|跳ねさせない)/iu.test(s);}
function exclusive(s){return /(?:only (?:the )?(?:lens|planet|object|chip|camera)|だけ動かす|以外は動かさない)/iu.test(s);}
function unsupported(s){return /(?:photorealistic|real-?time physics|ray.?tracing|物理シミュレーション|リアル3D|写真そっくり)/iu.test(s);}
const abstain=(reason)=>({status:"ABSTAIN",reason});
export function planPortfolioPrompt(prompt){
 if(typeof prompt!=="string"||!prompt.trim())return abstain("Empty prompt");
 const s=norm(prompt);
 if(unsupported(s))return abstain("Unsupported photoreal/physics request, cannot counterfeit result");
 const matches=Object.entries(CONCEPTS).filter(([,c])=>containsAny(s,c.targets));
 if(matches.length!==1)return abstain(matches.length===0?"Unknown art subject":"Ambiguous multiple objects");
 if(noSpinning(s)||noBounce(s)||exclusive(s))
  return abstain("The existing authoring choreography has motion lanes not yet proven to honor the hard restriction");
 const [id,c]=matches[0];
 const indicated=containsAny(s,c.effectTerms);
 if(noFX(s)&&indicated)return abstain("Contradictory requested and prohibited effects");
 const applyFX=indicated&&!noFX(s);
 if(!applyFX&&/effect|fx|glow|エフェクト|光の効果/iu.test(s)&&!noFX(s))
  return abstain("Requested effect has no source-verified transferable capsule for this subject");
 return {status:"PLANNED",schema:"portfolio-director-plan/v3",id,
  direction:c.directionId,sourceScene:c.sourceScene,effectId:applyFX?c.effectId:null,
  effectSource:applyFX?"EXISTING_STUDIO_SOURCE_SHAPES_AND_KEYS":"none",
  composition:c.artifactFamily,hardRestrictions:[],
  support:"closed taxonomy, original editable Studio shapes; not a general generative designer",
  authoredPrompt:prompt,beauty:"NOT_EVALUATED"};
}
function deep(v){return structuredClone(v);}
function sha(b){return createHash("sha256").update(b).digest("hex");}
function addExistingEffectToDirection(base,plan){
 const c=CONCEPTS[plan.id];
 const source=extractExistingEffect(c.effectId);
 if(!source.spec.compatibleScenes.includes(plan.sourceScene))
  throw Error("Source FX semantic compatibility failed");
 if(!source.shapes.length)throw Error("Zero source FX geometry");
 const ns="directorFx__"+source.id.replaceAll("-","_");
 const allIds=new Set([...base.groups,...base.shapes,...base.texts].map(x=>x.id));
 if(allIds.has(ns))throw Error("FX group already exists");
 const hero=base.groups.find(g=>g.id==="hero");
 if(!hero||hero.scaleX===0||hero.scaleY===0)throw Error("No valid native host hero origin");
 const {x,y,scale,z}=c.root;
 if(![x,y,scale,z].every(Number.isFinite)||scale<=0||scale>1.5)throw Error("Bad FX attachment");
 // This group is deliberately HERO-LOCAL. Effects are copied in their actual source
 // hero/ambient-local frame, not incorrectly zeroed from arbitrary world positions.
 base.groups.push({id:ns,parent:"hero",x,y,scaleX:scale,scaleY:scale,rotation:0,opacity:1});
 const idMap=new Map();
 for(const s of source.shapes){
  if(s.parent!==source.spec.sourceParent)
   throw Error("Unsupported non-flat source effect hierarchy: "+s.id);
  const id=ns+"__"+s.id;
  if(allIds.has(id)||idMap.has(s.id))throw Error("Duplicate imported component ID");
  idMap.set(s.id,id);
  base.shapes.push({...deep(s),id,parent:ns,z:(s.z??0)+z});
 }
 const anim=base.animations.find(x=>x.name==="Reveal");
 if(!anim)throw Error("Native Studio timebase not found");
 for(const t of source.tracks){
  const target=t.target==="__ROOT__"?ns:idMap.get(t.target);
  if(!target)throw Error("Source animation target is not present");
  if(!["rotation","opacity","x","y","scaleX","scaleY","width","height","trimEnd"].includes(t.property))
   throw Error("Unverified property lane "+t.property);
  if(t.keyframes.some(k=>k.frame<0||k.frame>anim.duration))
   throw Error("Out-of-range source keyframe");
  anim.tracks.push({...deep(t),target});
 }
 const nodes=[...base.groups,...base.shapes,...base.texts];
 const nodeIds=new Set(nodes.map(n=>n.id));
 if(nodeIds.size!==nodes.length||nodes.some(n=>n.parent&&!nodeIds.has(n.parent)))
  throw Error("Broken semantic parent/unique id constraint");
 const lanes=anim.tracks.map(t=>t.target+"."+t.property);
 if(new Set(lanes).size!==lanes.length)throw Error("Duplicate motion property lanes");
 return {effectRoot:ns,importedNodes:idMap.size,importedTracks:source.tracks.length,
  originalSourceScene:source.provenance.sourceScene,
  originalGeometryHash:source.provenance.sourceGeometryHash,attachment:c.root,
  knownLicense:"repo-original Studio source; external Kabi is not added via this path"};
}
export function buildPortfolioScene(prompt){
 const plan=planPortfolioPrompt(prompt);
 if(plan.status!=="PLANNED")return {plan};
 const {scene,provenance}=createArtDirectedScene(plan.direction);
 const before=createRiv(scene);
 const fx=plan.effectId?addExistingEffectToDirection(scene,plan):null;
 const after=createRiv(scene);
 if((before.warnings??[]).length||(after.warnings??[]).length)throw Error("Native Rive writer warning");
 const bytes=Buffer.from(after.bytes),beforeBytes=Buffer.from(before.bytes);
 if(bytes.subarray(0,4).toString("ascii")!=="RIVE")throw Error("Not a native Rive binary");
 if(plan.effectId&&bytes.equals(beforeBytes))throw Error("Imported FX changed no real Rive source");
 const evidence={schema:"v3-director-authored-evidence/v1",plan,artboard:scene.artboard,
   baseScene:provenance.source,layoutMode:provenance.mode,
   sourceGeometry:"original Studio art and reused authored tracks",fx:fx||null,
   realNativeRiveSha256:sha(bytes),baselineSha256:sha(beforeBytes),
   nodes:scene.groups.length+scene.shapes.length+scene.texts.length,
   animations:scene.animations.map(x=>({name:x.name,tracks:x.tracks.length})),
   renderStatus:"NOT_RENDERED_BY_BUILDER",blindHumanQuality:"NOT_EVALUATED",
   status:"BUILT_NOT_AESTHETICALLY_APPROVED"};
 return {plan,scene,bytes,beforeBytes,evidence};
}
const INPUTS={
 optics:"Cinematic optical camera lens with subtle spectral refraction",
 crystal:"正方形のプリズム結晶、光沢と繊細な反射",
 celestial:"Celestial planet navigation with dial calibration marks",
 silicon:"半導体チップ、精密な信号の脈動を添える"
};
export const PORTFOLIO_FIXTURES=Object.freeze(INPUTS);
export async function renderPortfolioConcept(id,outDir){
 if(!Object.hasOwn(INPUTS,id))throw Error("No approved portfolio concept "+id);
 const built=buildPortfolioScene(INPUTS[id]);
 const dir=resolve(outDir);mkdirSync(dir,{recursive:true});
 writeFileSync(join(dir,id+"-director.riv"),built.bytes);
 writeFileSync(join(dir,id+"-without-fx.riv"),built.beforeBytes);
 const [{RiveHost},{PAGE_SCRIPT}]=await Promise.all([
  import("../dist/riveHost.js"),import("../dist/pageScript.js")
 ]);
 const host=new RiveHost(PAGE_SCRIPT);
 try{
  const inspect=await host.inspect(built.bytes);
  const ab=inspect.artboards.find(x=>x.name===built.scene.artboard.name);
  if(!ab||!ab.animations.some(x=>x.name==="Reveal"))
   throw Error("Official runtime cannot inspect generated portfolio native RIVE");
  const sampleTimes=[.5,1,1.6,2.5,3.5];
  const realDiffs=[];
  for(const time of sampleTimes){
   const v=await host.visualDiff(built.beforeBytes,built.bytes,{animation:"Reveal",time,
    width:built.scene.artboard.width,height:built.scene.artboard.height,threshold:16});
   const fraction=v.diffPixels/v.totalPixels;
   if(!Number.isFinite(fraction))throw Error("Invalid native runtime image difference");
   realDiffs.push({time,changedPercent:+(100*fraction).toFixed(5),diffPixels:v.diffPixels});
  }
  // A source component can be technically copied while entirely obscured.
  const peak=Math.max(...realDiffs.map(x=>x.changedPercent));
  const pass=peak>=.05;
  const r=await host.renderFrames(built.bytes,{animation:"Reveal",startTime:0,
   frameCount:46,fps:10,width:built.scene.artboard.width,format:"png"});
  if(r.frames.length!==46)throw Error("Official runtime frame count mismatch");
  for(const [index,frame] of r.frames.entries()){
   const b=Buffer.from(frame,"base64");
   if(b.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")throw Error("Missing genuine PNG frame");
   writeFileSync(join(dir,"frame-"+String(index).padStart(3,"0")+".png"),b);
  }
  writeFileSync(join(dir,id+"-poster.png"),Buffer.from(r.frames.at(-1),"base64"));
  const evidence={...built.evidence,renderStatus:"ACTUAL_NATIVE_RIVE_RUNTIME",
   officialFrameCount:r.frames.length,effectPixelImpact:realDiffs,
   effectVisibilityGate:pass?"VISIBLE_CANDIDATE":"QUARANTINE_INVISIBLE_OR_SUBTHRESHOLD",
   artQuality:"NOT_EVALUATED",provenance:"No external copyright-restricted art transferred"};
  writeFileSync(join(dir,"director-evidence.json"),JSON.stringify(evidence,null,2)+"\n");
  if(!pass)throw Error("Effect insufficiently visible: "+JSON.stringify(realDiffs));
  console.log(JSON.stringify({id,artboard:built.scene.artboard,FX:built.plan.effectId,
   importedFX:built.evidence.fx?.importedNodes,changedPixelsPeak:peak,
   frames:r.frames.length,quality:"NOT_EVALUATED"}));
  return evidence;
 }finally{await host.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const id=process.argv[2];
 if(!Object.hasOwn(INPUTS,id))throw Error("Usage: node scripts/v3-director-composition.mjs optics|crystal|celestial|silicon <dir> --render");
 const dir=process.argv[3]??"test/tmp/v3-director/"+id;
 if(process.argv.includes("--render"))await renderPortfolioConcept(id,dir);
 else{
  const v=buildPortfolioScene(INPUTS[id]);mkdirSync(dir,{recursive:true});
  writeFileSync(join(dir,id+"-director.riv"),v.bytes);
  writeFileSync(join(dir,"director-evidence.json"),JSON.stringify(v.evidence,null,2)+"\n");
  console.log(JSON.stringify({id,bytes:v.bytes.length,fx:v.plan.effectId}));
 }
}