import assert from "node:assert/strict";
import {createRiv} from "../dist/rivWriter.js";
import {RIG_IDS,instantiateRig,validateBinding,validateRigScene,STYLES} from "../scripts/v3-rig-grammar.mjs";
import {buildAll,makeComposition,worldMatrix,COMPOSITIONS} from "../scripts/v3-rig-build.mjs";
assert.equal(RIG_IDS.length,15);
assert.equal(Object.keys(STYLES).length,3);
for(const id of RIG_IDS){
 const n=id.replace(/[^a-z]/g,"").slice(0,12);
 const rig=instantiateRig(id,{namespace:"test-"+n,x:100,y:110,scale:1.0,style:"nocturne"});
 assert.ok(rig.shapes.length>=6,id+" must be real original vector geometry");
 assert.ok(rig.manifest.nodeIds.length>=rig.shapes.length+1);
 assert.ok(rig.manifest.semantic&&rig.manifest.allowedMotion.length);
 assert.ok(rig.groups.some(g=>g.id===rig.manifest.root));
 assert.ok([...rig.groups,...rig.shapes].some(g=>g.id===rig.manifest.pivot),id+" pivot must physically exist");
 assert.ok(new Set(rig.manifest.nodeIds).size===rig.manifest.nodeIds.length);
}
const options={namespace:"contract",style:"nocturne"};
for(const scale of [-1,0,0.31,2.51,Infinity,NaN])
 assert.throws(()=>instantiateRig("precision-watch",{...options,scale}),/scale|nonfinite/);
for(const unit of ["mm","pt","dp","%"])
 assert.throws(()=>instantiateRig("precision-watch",{...options,unit}),/unit/);
assert.throws(()=>instantiateRig("precision-watch",{...options,pivot:"case"}),/pivot/);
assert.throws(()=>instantiateRig("precision-watch",{...options,domain:"photography"}),/domain/);
assert.throws(()=>instantiateRig("optical-lens",{...options,domain:"music"}),/domain/);
assert.throws(()=>instantiateRig("optical-lens",{...options,namespace:"../unsafe"}),/namespace/);
assert.throws(()=>validateBinding("imaginary",options),/unknown rig/);
const lensPhoto=instantiateRig("optical-lens",{...options,namespace:"photolens",domain:"photography"});
const lensAstro=instantiateRig("optical-lens",{...options,namespace:"astrolens",domain:"astronomy"});
assert.equal(lensPhoto.manifest.semantic,lensAstro.manifest.semantic);
assert.equal(lensPhoto.shapes.length,lensAstro.shapes.length);
assert.ok(lensPhoto.shapes.some(s=>s.id.endsWith("aperture-7")));
assert.ok(lensAstro.shapes.some(s=>s.id.endsWith("focus-groove-35")));
for(const comp of COMPOSITIONS){
 const {scene,result}=makeComposition(comp);
 if(comp.style==="porcelain"){
   for(const suffix of ["heading","brand","numeral"]){
     const n=scene.texts.find(t=>t.id===suffix||t.id.endsWith("--"+suffix));
     if(suffix==="heading")assert.ok(n,"required high-contrast heading");
     if(!n)continue;
     assert.equal(n.runs[0].color,STYLES.porcelain.ink,"light-theme text contrast "+suffix);
   }
 }
 assert.equal(result.status,"PASS");
 assert.equal(result.worldTransform,"PASS");
 assert.equal(result.frameWitnesses.length,5);
 for(const witness of result.frameWitnesses){
   assert.ok([0,36,72,108,180].includes(witness.frame));
   assert.equal(Object.keys(witness.matrices).length,comp.placements.length);
 }
 assert.equal(scene.stateMachine.name,"RigShowcase");
 assert.ok(scene.stateMachine.listeners.every(l=>l.target&&l.actions.length>0));
 assert.equal(scene.artboard.width,960);
 assert.ok(scene.animations[0].tracks.length>=6);
 assert.ok(scene.shapes.some(s=>s.fill?.gradient));
 for(const m of result.bindingContracts){
   const root=scene.groups.find(g=>g.id===m.root);
   assert.ok(root);
   const nodes=new Map([...scene.groups,...scene.shapes,...scene.texts].map(n=>[n.id,n]));
   const M=worldMatrix(m.root,nodes);
   assert.ok(Math.abs(M[4]-root.x)<1e-3);
   assert.ok(Math.abs(M[5]-root.y)<1e-3);
 }
 const corrupt=structuredClone({...scene,fonts:undefined});
 corrupt.animations[0].tracks.push({target:result.bindingContracts[0].root,
    property:"rotation",keyframes:[{frame:0,value:0},{frame:180,value:25}]});
 assert.throws(()=>validateRigScene(corrupt,result.bindingContracts),/forbidden rig motion/);
 const brokenClip=structuredClone({...scene,fonts:undefined});
 if(brokenClip.shapes.some(s=>s.clipBy)){
   brokenClip.shapes.find(s=>s.clipBy).clipBy="not-real";
   assert.throws(()=>validateRigScene(brokenClip,result.bindingContracts),/missing clip source|incorrect clipping mask/);
 }
 const binary=createRiv(scene);
 assert.equal(Buffer.from(binary.bytes).subarray(0,4).toString("ascii"),"RIVE");
 for(const manifest of result.bindingContracts){
   assert.ok(Buffer.from(binary.bytes).includes(Buffer.from(manifest.root)));
   assert.ok(Buffer.from(binary.bytes).includes(Buffer.from(manifest.pivot)));
   assert.equal(manifest.frame.unit,"px");
   assert.equal(manifest.attachments.localPivot,manifest.pivot);
   assert.ok(manifest.materials.some(x=>["solid","gradient","stroke"].includes(x.material)));
 }
 const binary2=createRiv(scene);
 assert.deepEqual(Buffer.from(binary.bytes),Buffer.from(binary2.bytes));
}
const build=buildAll();
assert.deepEqual(build.transferred["optical-lens"].sort(),["astronomy","photography"]);
assert.deepEqual(build.transferred["satellite-dish"].sort(),["radio-astronomy","telecommunications"]);
assert.ok(["abstract-emote","pendant-lamp","progress-ring"].every(id=>build.semanticInteractions.includes(id)));
assert.equal(build.comparativeBaseline.fullSceneEditingVisualComparison,"NOT_EVALUATED");
assert.equal(build.outputs.length,6);
assert.ok(build.outputs.every(o=>o.result.status==="PASS"));
assert.ok(build.outputs.every(o=>o.result.rigs>=3));
assert.equal(build.outputs.reduce((n,o)=>n+o.scene.shapes.length,0)>350,true);
const mutated=makeComposition(COMPOSITIONS[0]);
const idx=new Map([...mutated.scene.groups,...mutated.scene.shapes,...mutated.scene.texts].map(n=>[n.id,n]));
idx.get(mutated.result.bindingContracts[0].root).scaleX=0.01;
assert.throws(()=>validateRigScene(mutated.scene,mutated.result.bindingContracts),/scale\/unit witness/);
const wrongShadow=makeComposition(COMPOSITIONS[0]);
const m=wrongShadow.result.bindingContracts.find(x=>x.shadow.allowedId);
wrongShadow.scene.shapes.find(s=>s.id===m.shadow.allowedId).opacity=1;
assert.throws(()=>validateRigScene(wrongShadow.scene,wrongShadow.result.bindingContracts),/contact shadow/);
const brokenGlint=makeComposition(COMPOSITIONS[0]);
const glint=brokenGlint.result.bindingContracts[0].glints[0];
brokenGlint.scene.shapes.find(s=>s.id===glint).stroke.trim.end=.9;
assert.throws(()=>validateRigScene(brokenGlint.scene,brokenGlint.result.bindingContracts),/invalid glint/);
console.log("visual rig structural + geometry/binding + native binary tests: PASS");

// Adversarial failures: fail closed on 8px pivot corruption, static transform loss,
// wrong-but-existing mask, unsupported property lane, parent/ID and rights corruption.
const sample=makeComposition(COMPOSITIONS.find(c=>c.id==="signal"));
const model=()=>structuredClone({...sample.scene,fonts:undefined});
const manifests=()=>structuredClone(sample.result.bindingContracts);
function fails(mutator,expression){
 const sc=model(),ms=manifests();mutator(sc,ms);
 assert.throws(()=>validateRigScene(sc,ms),expression);
}
fails((sc,m)=>{const pivot=sc.groups.find(n=>n.id===m[0].pivot)||
 sc.shapes.find(n=>n.id===m[0].pivot);pivot.x+=8;},/pivot geometry moved/);
fails((sc,m)=>{sc.groups.find(n=>n.id===m[0].root).x=0;},/base transform witness/);
fails((sc,m)=>{sc.animations[0].tracks.push({target:m[0].pivot,property:"inventedVelocity",
 keyframes:[{frame:0,value:0},{frame:180,value:1}]});},/forbidden rig motion/);
fails((sc,m)=>{sc.shapes.find(n=>n.clipBy).clipBy="backdrop";},/incorrect clipping mask/);
fails((sc,m)=>{sc.groups.find(n=>n.id===m[0].root).parent="missing-parent";},/root attachment/);
fails((sc,m)=>{sc.shapes[1].id=sc.shapes[0].id;},/duplicate node IDs/);
fails((sc,m)=>{m[0].source.rights="unknown";},/broken source license/);
fails((sc,m)=>{m[0].source.embeddedMedia.push({license:"CC BY",permission:"unknown"});},/embedded asset rights blocked/);
fails((sc,m)=>{m.find(x=>x.rig==="earbuds-case").domain="illustration";},/absurd hand-to-earbud-stem semantics/);
for(const id of ["mechanical-metronome","pendant-lamp","satellite-dish","windmill","paper-kite"]){
 const scene=build.outputs.flatMap(o=>o.result.bindingContracts).find(r=>r.rig===id);
 assert.ok(scene&&scene.nodeIds.length>=8&&scene.pivotLocal);
}
console.log("v3 native-vector grammar, six compositions, timestamps and adversarial source/semantic contracts: PASS");
