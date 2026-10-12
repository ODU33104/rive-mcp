// Run after npm run build: node test/motionAtlasGold.mjs
// Tests binary determinism and structural contracts, then uses the official bundled
// Rive runtime if a working Chromium browser is installed.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { makeGoldScene } from "../scripts/build-motion-atlas-gold.mjs";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const directory=resolve(ROOT,"test/tmp/motion-atlas-gold");
mkdirSync(directory,{recursive:true});
const scene=makeGoldScene();
assert.deepEqual(scene.artboard,{name:"SolsticeChronograph",width:720,height:460});
assert.ok(scene.shapes.length>=95,"An illustrated dial and environment, not a placeholder");
assert.ok(scene.groups.length>=10);
assert.ok(scene.texts.length>=8);
assert.ok(scene.shapes.some(s=>s.fill?.gradient),"Metal/atmosphere gradient required");
assert.ok(scene.shapes.filter(s=>s.id.startsWith("index")).length===60,"Minute markers required");
assert.ok(scene.shapes.some(s=>s.stroke?.trim),"Native Rive trim path required");

const ids=new Set([...scene.groups,...scene.shapes,...scene.texts].map(x=>x.id));
assert.equal(ids.size,scene.groups.length+scene.shapes.length+scene.texts.length,"Duplicate ids");
for(const shape of scene.shapes)if(shape.parent)assert.ok(ids.has(shape.parent),shape.id+" parent");
for(const item of [...scene.groups,...scene.texts])if(item.parent)assert.ok(ids.has(item.parent),item.id+" parent");

assert.equal(scene.animations.length,1);
const animation=scene.animations[0];
assert.equal(animation.fps,60);
assert.equal(animation.duration,270);
const signatures=new Set();
for(const track of animation.tracks){
  assert.ok(ids.has(track.target),"Unknown animated target: "+track.target);
  assert.ok(track.keyframes.length>=2,"Track too short: "+track.target+"."+track.property);
  const sig=track.target+"."+track.property;
  assert.ok(!signatures.has(sig),"Duplicate property track: "+sig);
  signatures.add(sig);
  for(const [i,k] of track.keyframes.entries()){
    assert.ok(Number.isFinite(k.value) && Number.isInteger(k.frame),"Non-finite keyframe: "+sig);
    assert.ok(k.frame>=0 && k.frame<=animation.duration,"Frame outside clip: "+sig);
    if(i)assert.ok(k.frame>track.keyframes[i-1].frame,"Unordered/duplicate frames: "+sig);
  }
}
assert.ok(animation.tracks.length>=24,"Choreography must have independently timed layers");

function generate(filename){
  const path=resolve(directory,filename);
  const run=spawnSync(process.execPath,["scripts/build-motion-atlas-gold.mjs",path],{
    cwd:ROOT,encoding:"utf8",timeout:120_000,maxBuffer:1024*1024*4
  });
  assert.equal(run.status,0,
    "Generation failed (first run npm run build):\n"+run.stdout+"\n"+run.stderr);
  const bytes=readFileSync(path);
  assert.equal(bytes.subarray(0,4).toString("ascii"),"RIVE");
  assert.ok(bytes.length>3000,"Binary unexpectedly small");
  const report=JSON.parse(run.stdout.trim().split("\n").at(-1));
  assert.equal(report.shapes,scene.shapes.length);
  assert.equal(report.tracks,animation.tracks.length);
  return {path,bytes,report};
}
const a=generate("solstice-a.riv");
const b=generate("solstice-b.riv");
assert.deepEqual(a.bytes,b.bytes,"Two compiles must be byte-identical");
console.log("motion gold: deterministic RIVE binary PASS ("+a.bytes.length+" bytes, "+
  scene.shapes.length+" shapes, "+animation.tracks.length+" native property tracks)");

const [{RiveHost},{PAGE_SCRIPT}]=await Promise.all([
  import("../dist/riveHost.js"),import("../dist/pageScript.js")
]);
const host=new RiveHost(PAGE_SCRIPT);
try{
  let runtime;
  try { runtime=await host.inspect(a.bytes); }
  catch(error){
    if(/No Chromium-based browser found/.test(String(error))){
      console.log("motion gold: official runtime inspection SKIPPED (Chromium unavailable).");
      console.log("Run with RIVE_MCP_CHROME=/path/to/chrome to inspect/render actual frames.");
      runtime=null;
    }else throw error;
  }
  if(runtime){
    assert.ok(runtime.artboards.some(ab=>
      ab.name===scene.artboard.name &&
      ab.animations.some(anim=>anim.name==="Reveal") &&
      ab.stateMachines.some(sm=>sm.name==="Showcase")),
      "Official Rive runtime rejected expected animation/state machine");
    console.log("motion gold: official Rive runtime inspection PASS");
    const images=await host.renderFrames(a.bytes,{
      animation:"Reveal",startTime:0,frameCount:4,fps:1,width:720,format:"png"
    });
    assert.equal(images.frames.length,4);
    for(const frame of images.frames)assert.equal(
      Buffer.from(frame,"base64").subarray(0,8).toString("hex"),
      "89504e470d0a1a0a","Official runtime frame must be PNG");
    console.log("motion gold: official Rive runtime PNG render PASS (4 frames; not a subjective quality verdict)");
  }
}finally{await host.close();}
