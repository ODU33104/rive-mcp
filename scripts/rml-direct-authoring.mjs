// First-party Rive CLI/RML lane. Not a custom writer: official RML compiler owns .riv.
// Three original styleframe programs are text source; the official CLI validates and renders.
// Deliberately limited primitive set from official RML docs until schema verified.
import {writeFileSync,mkdirSync} from "node:fs";
import {resolve,join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
const themes={
 halo:{bg:"FF080F20",main:"FFDAF3F2",alt:"FF67BCD8",accent:"FFF7B76F",
   centers:[[620,260],[637,260],[652,260],[310,300]],sizes:[[295,335],[242,279],[191,220],[135,158]],
   rotations:[0.18,-0.21,0.42,1.1],title:"HALO / luminous layers"},
 origin:{bg:"FF0E1617",main:"FFECE0C6",alt:"FF9DBF9E",accent:"FFC9B08E",
   centers:[[510,215],[580,260],[658,295],[270,293]],sizes:[[340,325],[274,286],[218,228],[157,168]],
   rotations:[0.05,0.31,-.18,.85],title:"ORIGIN / material geometry"},
 signal:{bg:"FF10102A",main:"FFF2DDFF",alt:"FF77D7F1",accent:"FFEEA6DA",
   centers:[[407,250],[555,250],[699,250],[270,375]],sizes:[[245,260],[233,245],[221,230],[143,154]],
   rotations:[0.22,-0.27,0.18,1.2],title:"SIGNAL / spatial rhythms"}
};
export const STYLEFRAMES=Object.freeze(Object.keys(themes));
const sha=b=>createHash("sha256").update(b).digest("hex");
const clean = s=>{if(!/^[a-z][a-z0-9-]*$/.test(s))throw Error("Unsafe project ID");return s};
export function buildRMLStyleframe(kind){
 clean(kind);
 const c=themes[kind];if(!c)throw Error("Unsupported direct RML styleframe: "+kind);
 const lines=[
  '<Rive version="1" kind="fragment">',
  ' <Artboard id="0:2" name="Director" width="900" height="540" styleId="0:40" defaultStateMachineId="0:7">',
  '  <LayoutComponentStyle id="0:40" name="DirectorLayout"/>',
  '  <Fill name="Backdrop">',
  '   <SolidColor name="Ink" colorValue="'+c.bg+'"/>',
  '  </Fill>'
 ];
 const shapes=[];
 // Independent drawn objects + authored animated local motion; no flat PNGs.
 for(let i=0;i<c.centers.length;i++){
  const shapeId="0:"+(14+i);
  const name="Facet"+(i+1);
  const pos=c.centers[i];
  const dims=c.sizes[i];
  const fill=i===0?c.main:i===1?c.alt:c.accent;
  shapes.push({id:shapeId,name,x:pos[0],y:pos[1],width:dims[0],height:dims[1],
   primaryRotation:c.rotations[i],tint:fill});
  lines.push('  <Shape id="'+shapeId+'" name="'+name+'" x="'+pos[0]+'" y="'+pos[1]+'">');
  lines.push('   <Triangle name="OriginalVector'+(i+1)+'" originX="0.5" originY="0.5" width="'+dims[0]+'" height="'+dims[1]+'"/>');
  lines.push('   <Fill name="Solid'+(i+1)+'"><SolidColor name="Pigment'+(i+1)+'" colorValue="'+fill+'"/></Fill>');
  lines.push('  </Shape>');
 }
 lines.push('  <StateMachine id="0:7" name="DirectorSM">');
 lines.push('   <StateMachineLayer id="0:8" name="Main" >');
 lines.push('    <AnyState x="200" y="-120"/>');
 lines.push('    <ExitState x="400" y="-120"/>');
 lines.push('    <EntryState><StateTransition stateToId="0:12"/></EntryState>');
 lines.push('    <AnimationState id="0:12" x="200" animationId="0:6"/>');
 lines.push('   </StateMachineLayer>');
 lines.push('  </StateMachine>');
 lines.push('  <LinearAnimation id="0:6" name="Reveal" duration="180" loopValue="loop">');
 for(const [i,s] of shapes.entries()){
  const begin=s.primaryRotation-0.36-(i*.09),end=s.primaryRotation+0.23+i*.08;
  lines.push('   <KeyedObject objectId="'+s.id+'">');
  lines.push('    <KeyedProperty propertyKey="15">');
  lines.push('     <KeyFrameDouble value="'+begin.toFixed(5)+'" interpolationType="linear"/>');
  lines.push('     <KeyFrameDouble value="'+end.toFixed(5)+'" interpolationType="linear" frame="180"/>');
  lines.push('    </KeyedProperty>');
  lines.push('   </KeyedObject>');
 }
 lines.push('  </LinearAnimation>');
 lines.push(' </Artboard>');
 lines.push('</Rive>');
 const rml=lines.join("\n")+"\n";
 const yaml="name: rml_"+kind+"\nmain: Director\noutput:\n  dir: build\nlogs:\n  problems: build/problems.log\n";
 const evidence={kind,sceneTitle:c.title,studio:"RML direct official CLI route",
  artboard:"Director",animation:"Reveal",stateMachine:"DirectorSM",
  sourceShapeCount:shapes.length,geometry:shapes,sourceSha256:sha(Buffer.from(rml)),
  copyright:"Original scene primitives authored in this project",
  compile:"NOT_EXECUTED",render:"NOT_EXECUTED",subjectiveVisualQuality:"NOT_EVALUATED",
  limits:"Constrained triangular styleframes, not yet artistically persuasive premium work"};
 return {rml,yaml,evidence};
}
export function materializeRMLStyleframe(kind,targetRoot){
 const name=clean(kind),scene=buildRMLStyleframe(name);
 const dir=resolve(targetRoot,name);
 mkdirSync(dir,{recursive:true});
 writeFileSync(join(dir,"scene.rml"),scene.rml);
 writeFileSync(join(dir,"rive.yaml"),scene.yaml);
 writeFileSync(join(dir,"provenance.json"),JSON.stringify(scene.evidence,null,2)+"\n");
 return {directory:dir,...scene};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const kind=process.argv[2],out=process.argv[3]??"test/tmp/official-rml-projects";
 const m=materializeRMLStyleframe(kind,out);
 console.log(JSON.stringify({kind,project:m.directory,rmlSha256:m.evidence.sourceSha256,geometry:m.evidence.sourceShapeCount}));
}