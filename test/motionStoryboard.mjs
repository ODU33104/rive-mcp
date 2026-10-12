import assert from "node:assert/strict";
import { compileStoryboard } from "../scripts/motion-storyboard.mjs";
import { loadCatalog } from "../scripts/motion-recipe.mjs";
import { createRiv } from "../dist/rivWriter.js";

const catalog=loadCatalog();
const binding=(target,base={})=>({target,base:{x:0,y:0,scaleX:1,scaleY:1,opacity:1,rotation:0,...base}});
const demo={
 name:"ComposedReactions",
 fps:60,
 cues:[
  {recipeId:"success-burst",atMs:0,bindings:{
   hero:binding("hero"),halo:binding("halo"),caption:binding("caption")
  }},
  {recipeId:"error-nudge",atMs:900,bindings:{
   panel:binding("panel"),hint:binding("hint")
  }}
 ]
};
const result=compileStoryboard(demo,{catalog});
assert.equal(result.animation.name,"ComposedReactions");
assert.equal(result.animation.loop,"oneShot");
assert.equal(result.timeline.length,2);
assert.equal(result.timeline[1].startFrame,54);
assert.deepEqual(result.requiredTargets,["caption","halo","hero","hint","panel"]);
assert.ok(result.animation.tracks.every(t=>t.keyframes.every((key,i,a)=>i===0||a[i-1].frame<key.frame)));
assert.ok(result.animation.duration>result.timeline[1].endFrame);
const noVisuals={artboard:{name:"Storyboard",width:480,height:320},groups:[
 {id:"hero",x:100,y:100},{id:"halo",x:100,y:100},
 {id:"caption",x:240,y:240},{id:"panel",x:230,y:130},{id:"hint",x:240,y:260}
],shapes:[
 {id:"bg",type:"rect",x:240,y:160,width:480,height:320,fill:{color:"#101828"}},
 {id:"check",type:"ellipse",x:0,y:0,width:80,height:80,parent:"hero",fill:{color:"#16BA92"}},
 {id:"haloDisc",type:"ellipse",x:0,y:0,width:115,height:115,parent:"halo",fill:{color:"#236D92"}},
 {id:"captionBox",type:"rect",x:0,y:0,width:200,height:18,parent:"caption",fill:{color:"#FFFFFF"}},
 {id:"panelBox",type:"rect",x:0,y:0,width:100,height:80,parent:"panel",fill:{color:"#D65C66"}},
 {id:"hintBox",type:"rect",x:0,y:0,width:100,height:20,parent:"hint",fill:{color:"#E8EDF5"}}
],animations:[result.animation]};
const {bytes}=createRiv(noVisuals);
assert.ok(bytes.length>128,"nonempty Rive binary with header and scene payload");
assert.equal(String.fromCharCode(...bytes.slice(0,4)),"RIVE");
const repeat={name:"RepeatedShake",fps:60,cues:[
 {recipeId:"error-nudge",atMs:0,bindings:{panel:binding("same-panel"),hint:binding("first-hint")}},
 {recipeId:"error-nudge",atMs:600,bindings:{panel:binding("same-panel"),hint:binding("second-hint")}}
]};
const repeatResult=compileStoryboard(repeat,{catalog});
const panel=repeatResult.animation.tracks.find(x=>x.target==="same-panel"&&x.property==="x");
assert.ok(panel);
assert.ok(panel.keyframes.some(k=>k.easing==="hold"),"gaps between cues must not tween");
const collide={name:"Collision",fps:60,cues:[
 {recipeId:"toggle-sweep",atMs:0,bindings:{knob:binding("knob"),track:binding("track")}},
 {recipeId:"toggle-sweep",atMs:100,bindings:{knob:binding("knob"),track:binding("track")}}
]};
assert.throws(()=>compileStoryboard(collide,{catalog}),/Overlapping motion cues/);
collide.cues[1].atMs=800;
assert.throws(()=>compileStoryboard(collide,{catalog}),/Discontinuous cue gap/);
collide.cues[1].bridgeMs=150;
const bridged=compileStoryboard(collide,{catalog});
assert.ok(bridged.animation.tracks.find(x=>x.target==="knob"&&x.property==="x").keyframes.length>=5);
collide.cues[1].bridgeMs=700;
assert.throws(()=>compileStoryboard(collide,{catalog}),/bridgeMs exceeds available time gap/);
const loopOnly={cues:[{recipeId:"loading-breathe",atMs:0,bindings:{mark:binding("mark")}}]};
assert.equal(compileStoryboard(loopOnly,{catalog}).animation.loop,"loop");
loopOnly.cues.push(demo.cues[0]);
assert.throws(()=>compileStoryboard(loopOnly,{catalog}),/Looping recipe/);
assert.throws(()=>compileStoryboard({cues:[{recipeId:"missing",bindings:{}}]},{catalog}),/Unknown recipe/);
assert.throws(()=>compileStoryboard({fps:0,cues:demo.cues},{catalog}),/fps/);
assert.throws(()=>compileStoryboard({cues:[]},{catalog}),/nonempty/);
console.log("motion storyboard: PASSED; "+result.animation.tracks.length+" tracks; "+bytes.length+" Rive bytes");
