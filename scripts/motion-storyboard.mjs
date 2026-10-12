// Compose a small sequence of independently authored Motion Recipe Atlas cues.
// An AnimationSpec carries one keyframe track per target/property: collisions are errors.
// The official Rive writer receives the resulting AnimationSpec unchanged.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadCatalog, compileRecipe } from "./motion-recipe.mjs";

const EPSILON=1e-7;
const EASING=new Set([
 "hold","linear","ease","ease-in","ease-out","ease-in-out","ease-out-back",
 "ease-in-back","smooth","snap","emphasized-decel","emphasized-accel",
 "elastic-in","elastic-out","elastic-in-out"
]);
function sameValue(a,b){
 return typeof a==="number"&&typeof b==="number"&&Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<EPSILON;
}
function millisecondsToFrames(ms,fps){
 return Math.round(ms*fps/1000);
}
function validatedMs(value,label){
 if(!Number.isFinite(value)||value<0)throw Error(label+" must be a finite nonnegative number");
 return value;
}
function keyFor(track){return track.target+"\u0000"+track.property;}

/**
 * @param {object} storyboard
 *  name: string
 *  fps?: number
 *  cues: [{recipeId,atMs,bindings,bridgeMs?: number, bridgeEasing?: string}]
 * @param {object} options
 *  catalog?: {recipes:Array}
 * @returns {{animation:object,timeline:Array,requiredTargets:Array}}
 */
export function compileStoryboard(storyboard,options={}){
 if(!storyboard||typeof storyboard!=="object"||Array.isArray(storyboard))
  throw Error("storyboard must be an object");
 const catalog=options.catalog??loadCatalog();
 const fps=storyboard.fps??60;
 if(!Number.isInteger(fps)||fps<1||fps>240)
  throw Error("fps must be an integer between 1 and 240");
 const cues=storyboard.cues;
 if(!Array.isArray(cues)||cues.length<1)
  throw Error("storyboard.cues must be a nonempty array");
 const recipeIndex=new Map(catalog.recipes.map(recipe=>[recipe.id,recipe]));
 const tracksByKey=new Map();
 const timeline=[];
 const requiredTargets=new Set();
 let lastFrame=0;
 let loop="oneShot";
 for(const [index,cue] of cues.entries()){
  if(!cue||typeof cue!=="object")throw Error("cue "+index+" must be an object");
  const recipe=recipeIndex.get(cue.recipeId);
  if(!recipe)throw Error("Unknown recipe at cue "+index+": "+cue.recipeId);
  const atMs=validatedMs(cue.atMs??0,"cue "+index+" atMs");
  const bridgeMs=validatedMs(cue.bridgeMs??0,"cue "+index+" bridgeMs");
  const bridgeEasing=cue.bridgeEasing??"smooth";
  if(!EASING.has(bridgeEasing))throw Error("Invalid bridge easing: "+bridgeEasing);
  if(!cue.bindings||typeof cue.bindings!=="object"||Array.isArray(cue.bindings))
   throw Error("cue "+index+" requires a role-to-target bindings object");
  if(recipe.loop!=="oneShot"){
   // A single Rive AnimationSpec cannot loop one independent track while others
   // run a different one-shot sequence: use separate animations / SM layers.
   if(cues.length>1)throw Error("Looping recipe "+recipe.id+" must be isolated in its own Rive animation");
   loop=recipe.loop;
  }
  const offset=millisecondsToFrames(atMs,fps);
  const compiled=compileRecipe(recipe,cue.bindings,{fps});
  const incoming=compiled.tracks.map(track=>({
   target:track.target,
   property:track.property,
   keyframes:track.keyframes.map(frame=>({...frame,frame:frame.frame+offset}))
  }));
  for(const track of incoming){
   requiredTargets.add(track.target);
   const lane=keyFor(track);
   const existing=tracksByKey.get(lane);
   if(!existing){
    tracksByKey.set(lane,track);
    continue;
   }
   const prior=existing.keyframes;
   const next=track.keyframes;
   const last=prior[prior.length-1], first=next[0];
   const gap=first.frame-last.frame;
   const description=track.target+"."+track.property;
   if(gap<0)
    throw Error("Overlapping motion cues on "+description+" at cue "+index+"; use separate targets or reschedule");
   if(gap===0){
    if(!sameValue(last.value,first.value))
     throw Error("Discontinuous same-frame cue boundary on "+description+" at cue "+index);
    // Rive easing belongs to the departing keyframe: use the next cue's
    // first interpolation on this shared exact-boundary keyframe.
    last.easing=first.easing;
    prior.push(...next.slice(1));
    continue;
   }
   if(sameValue(last.value,first.value)){
    // Do not unintentionally tween between separate shots during the gap.
    last.easing="hold";
    prior.push(...next);
    continue;
   }
   const bridgeFrames=millisecondsToFrames(bridgeMs,fps);
   if(!bridgeFrames)
    throw Error("Discontinuous cue gap on "+description+" at cue "+index+"; specify bridgeMs or align values");
   if(bridgeFrames>gap)
    throw Error("bridgeMs exceeds available time gap on "+description+" at cue "+index);
   if(bridgeFrames===gap){
    last.easing=bridgeEasing;
   }else{
    last.easing="hold";
    prior.push({frame:first.frame-bridgeFrames,value:last.value,easing:bridgeEasing});
   }
   prior.push(...next);
  }
  const endFrame=offset+compiled.duration-1;
  lastFrame=Math.max(lastFrame,endFrame);
  timeline.push({
   index,
   recipeId:recipe.id,
   atMs,
   effectiveAtMs:Math.round(offset/fps*1000),
   durationMs:recipe.durationMs,
   startFrame:offset,
   endFrame,
   roles:recipe.roles.map(role=>({role,target:cue.bindings[role].target}))
  });
 }
 const tracks=[...tracksByKey.values()].sort((a,b)=>
  a.target.localeCompare(b.target)||a.property.localeCompare(b.property));
 for(const track of tracks)
  for(let i=1;i<track.keyframes.length;i++)
   if(track.keyframes[i].frame<=track.keyframes[i-1].frame)
    throw Error("Non-increasing frames in "+track.target+"."+track.property);
 const animation={
  name:storyboard.name??"MotionStoryboard",
  fps,
  duration:lastFrame+1,
  loop,
  tracks
 };
 return {animation,timeline,requiredTargets:[...requiredTargets].sort()};
}

function main(args){
 if(args[0]!=="compile"||!args[1]){
  console.log('Usage: node scripts/motion-storyboard.mjs compile storyboard.json');
  return;
 }
 const manifest=JSON.parse(readFileSync(resolve(args[1]),"utf8"));
 console.log(JSON.stringify(compileStoryboard(manifest),null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{main(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=1;}
}
