import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {FLAGSHIP_IDS,createFlagshipScene,buildFlagshipScene} from "../scripts/v3-flagship-scenes.mjs";
const chosen=process.argv[2];
if(chosen)assert.ok(FLAGSHIP_IDS.includes(chosen), "Unknown scene");
assert.deepEqual(FLAGSHIP_IDS,["vessel","interstice","tidal"]);
const ids=[],geometry=[];
const hash=v=>createHash("sha256").update(v).digest("hex");
const rights=readFileSync(new URL("../LICENSE",import.meta.url),"utf8");
assert.match(rights,/Inter font:\s*SIL Open Font License 1\.1/);
for(const id of chosen?[chosen]:FLAGSHIP_IDS){
  const {scene,meta,bytes,warnings}=buildFlagshipScene(id);
  assert.deepEqual(warnings,[],id+" writer warnings");
  assert.equal(Buffer.from(bytes).subarray(0,4).toString("ascii"),"RIVE");
  assert.ok(bytes.length>4500,id+" native .riv is unexpectedly tiny");
  assert.equal(scene.artboard.width,960);
  assert.equal(scene.artboard.height,600);
  assert.equal(scene.animations.length,1);
  const animation=scene.animations[0]; assert.equal(animation.duration,300);
  assert.equal(animation.fps,60);
  assert.ok(meta.animatedFamilies.length>=4,id+" needs 4+ different families");
  assert.ok(meta.nativeReveal.length>0,id+" must use native reveal");
  assert.ok(meta.initialMotion.length>=2&&meta.closingMotion.length>=2);
  assert.ok(scene.shapes.length>=10,id+" requires nonempty vector geometry; shape count is not an aesthetic score");
  assert.ok(scene.texts.length>=4);
  assert.equal(scene.images?.length??0,0,"No bitmap composites");
  const nodes=[...scene.groups,...scene.shapes,...scene.texts],names=new Set(nodes.map(x=>x.id));
  assert.equal(names.size,nodes.length,id+" duplicate node IDs");
  const shapes=new Map(scene.shapes.map(x=>[x.id,x]));
  for(const node of nodes){
    if(node.parent)assert.ok(names.has(node.parent),id+": unknown parent "+node.parent);
    if(node.clipBy){assert.ok(shapes.has(node.clipBy),id+": missing mask "+node.clipBy);
      assert.ok(!shapes.get(node.clipBy).fill, id+": masks should not occlude artwork");}
    if(node.fill?.gradient)assert.equal(node.fill.gradient.stops.length,2);
    if(node.type==="polygon")assert.ok(node.points.length>=2,id+": empty path");
  }
  const masks=scene.shapes.filter(x=>x.clipBy);
  const trims=scene.shapes.filter(x=>x.stroke?.trim);
  assert.ok(masks.length>=1||trims.length>=2,id+" needs native vector masking/path reveals");
  if(id==="vessel")assert.ok(masks.length>=3,"glass must use optical masking");
  if(id==="interstice")assert.ok(masks.length>=1,"typographic aperture missing");
  if(id==="tidal")assert.ok(trims.length>=8,"survey contours must draw on");
  const seen=new Set(),targets=new Set(), properties=new Set(["x","y","rotation","scaleX","scaleY","opacity","width","height","trimEnd","trimStart","trimOffset"]);
  for(const t of animation.tracks){
    assert.ok(names.has(t.target),id+": unknown track target "+t.target);
    assert.ok(properties.has(t.property),id+": unsupported property "+t.property);
    if(t.property.startsWith("trim"))assert.ok(shapes.get(t.target)?.stroke?.trim,id+": trim target has no TrimPath");
    const lane=t.target+"."+t.property;
    assert.ok(!seen.has(lane),id+": duplicate lane "+lane);seen.add(lane);targets.add(t.target);
    assert.ok(t.keyframes.length>=2);
    assert.equal(t.keyframes[0].frame,0,id+" should encode an initial state");
    assert.equal(t.keyframes.at(-1).frame,300,id+" should encode an ending state");
    t.keyframes.forEach((p,i)=>{
      assert.ok(Number.isFinite(p.value)&&p.frame>=0&&p.frame<=300);
      if(i>0)assert.ok(p.frame>t.keyframes[i-1].frame,id+": overlapping frames");
    });
  }
  assert.ok(targets.size>=8,id+": choreography must animate independent objects");
  const vectorSignature=hash(JSON.stringify(scene.shapes.map(s=>({id:s.id,type:s.type,points:s.points,fill:s.fill,stroke:s.stroke,parent:s.parent}))));
  assert.equal(JSON.stringify(createFlagshipScene(id).scene.shapes),JSON.stringify(scene.shapes),id+" should be deterministic");
  geometry.push(vectorSignature);
  ids.push({id,rivBytes:bytes.length,shapes:scene.shapes.length,clips:masks.length,trimPaths:trims.length,targets:targets.size,tracks:animation.tracks.length,vectorSignature});
}
assert.equal(new Set(geometry).size,geometry.length,"Three designs must have different geometry");
console.log(JSON.stringify({result:"PASS",scenes:ids},null,2));
