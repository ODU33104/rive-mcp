// Independent, fail-closed scene semantic and motion checks. Pure Node; no writer imports.
// SceneSpec coordinates/rotation follow existing writer convention (degrees).
export const PASS="PASS",FAIL="FAIL",UNKNOWN="UNKNOWN";
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const items=s=>[...(s.groups||[]),...(s.shapes||[]),...(s.texts||[])];
const result=(status,reason,extra={})=>({status,reason,...extra});
export function overall(checks){
  return checks.some(x=>x.status===FAIL)?FAIL:checks.some(x=>x.status!==PASS)?UNKNOWN:PASS;
}
export function inventory(scene){
  const found=new Map();const duplicate=[];
  for(const item of items(scene)){if(found.has(item.id))duplicate.push(item.id);else found.set(item.id,item);}
  return {found,duplicate};
}
function sample(track,frame){
  const k=track?.keyframes;
  if(!k?.length)return {status:UNKNOWN,reason:"missing keyframes"};
  const a=k.find(x=>x.frame===frame);
  if(a)return finite(a.value)?{status:PASS,value:a.value}:{status:UNKNOWN,reason:"nonfinite keyframe"};
  if(frame<k[0].frame||frame>k.at(-1).frame)return {status:UNKNOWN,reason:"outside animation range"};
  const i=k.findIndex(x=>x.frame>frame),prev=k[i-1],next=k[i];
  if(!prev||!next)return {status:UNKNOWN,reason:"no frame bracket"};
  // An unspecified or authored easing is not presumed linear.
  if(prev.easing!=="linear")return {status:UNKNOWN,reason:"intermediate easing unobserved"};
  return {status:PASS,value:prev.value+(next.value-prev.value)*(frame-prev.frame)/(next.frame-prev.frame)};
}
function prop(scene,id,p,frame){
  const element=inventory(scene).found.get(id);
  if(!element)return {status:UNKNOWN,reason:"node missing: "+id};
  const matches=(scene.animations||[]).flatMap(a=>a.tracks||[]).filter(t=>t.target===id&&t.property===p);
  if(matches.length>1)return {status:UNKNOWN,reason:"multiple tracks/layers not composed"};
  if(matches.length)return sample(matches[0],frame);
  const defaults={x:0,y:0,rotation:0,scaleX:1,scaleY:1,opacity:1};
  const value=element[p]??defaults[p];
  return finite(value)?{status:PASS,value}:{status:UNKNOWN,reason:"property unavailable: "+p};
}
const multiply=(a,b)=>[
 a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],
 a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],
 a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]
];
function matrix(scene,id,frame,visiting=new Set()){
  if(visiting.has(id))return {status:UNKNOWN,reason:"parent cycle"};
  const node=inventory(scene).found.get(id);
  if(!node)return {status:UNKNOWN,reason:"node not found: "+id};
  const values={};
  for(const p of ["x","y","rotation","scaleX","scaleY"]){
    const s=prop(scene,id,p,frame);
    if(s.status!==PASS)return s;
    values[p]=s.value;
  }
  const r=values.rotation*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
  const local=[c*values.scaleX,s*values.scaleX,-s*values.scaleY,c*values.scaleY,values.x,values.y];
  if(!node.parent)return {status:PASS,value:local};
  visiting.add(id);
  const parent=matrix(scene,node.parent,frame,visiting);
  visiting.delete(id);
  return parent.status===PASS?{status:PASS,value:multiply(parent.value,local)}:parent;
}
export function worldPoint(scene,id,point,frame){
  const m=matrix(scene,id,frame);
  if(m.status!==PASS)return m;
  if(!Array.isArray(point)||point.length!==2||!point.every(finite))return {status:UNKNOWN,reason:"invalid local point"};
  const v=m.value;
  return {status:PASS,value:[v[0]*point[0]+v[2]*point[1]+v[4],v[1]*point[0]+v[3]*point[1]+v[5]]};
}
export function pivotCheck(scene,c){
  const frames=c.frames?.length?c.frames:[0];
  const diffs=[];
  for(const frame of frames){
    const a=worldPoint(scene,c.nodePath,c.localPoint||[0,0],frame);
    const b=worldPoint(scene,c.referencePath,c.referenceLocalPoint||[0,0],frame);
    if(a.status!==PASS||b.status!==PASS)return result(UNKNOWN,"world transform not observable at frame "+frame+": "+(a.reason||b.reason),{frame});
    const distance=Math.hypot(a.value[0]-b.value[0],a.value[1]-b.value[1]);
    diffs.push({frame,distancePx:distance});
    if(distance>(c.tolerancePx??0.5))return result(FAIL,"world pivot separated",{frame,observedPx:distance,allowedPx:c.tolerancePx??0.5,diffs});
  }
  return result(PASS,"world pivots coincide on specified frames",{diffs});
}
function tracks(scene,target){return (scene.animations||[]).flatMap(a=>a.tracks||[]).filter(t=>t.target===target)}
export function motionCheck(scene,c,observations={}){
  const ts=tracks(scene,c.target),eps=c.epsilon??0.001;
  if(!inventory(scene).found.has(c.target))return result(UNKNOWN,"target absent");
  if(c.kind==="forbid-rotation"||c.kind==="forbid-motion"||c.kind==="only-x"){
    const blocked=c.kind==="forbid-rotation"?["rotation"]:
      c.kind==="only-x"?["y","rotation","scaleX","scaleY","width","height","opacity","trimStart","trimEnd","trimOffset"]:
      ["x","y","rotation","scaleX","scaleY","width","height","opacity","trimStart","trimEnd","trimOffset"];
    const moving=ts.filter(t=>blocked.includes(t.property)&&new Set(t.keyframes?.map(k=>k.value)).size>1);
    if(moving.length)return result(FAIL,"forbidden animated property",{tracks:moving.map(t=>t.target+"."+t.property)});
    const unknown=ts.filter(t=>!["x","y","rotation","scaleX","scaleY","width","height","opacity","trimStart","trimEnd","trimOffset"].includes(t.property));
    return unknown.length?result(UNKNOWN,"unhandled track properties"):result(PASS,"no forbidden property track in SceneSpec");
  }
  if(c.kind==="no-bounce"){
    const trace=observations[c.target]?.[c.property||"x"];
    if(Array.isArray(trace)&&trace.length>=3&&trace.every(finite)){
      const start=trace[0],end=trace.at(-1),lo=Math.min(start,end)-eps,hi=Math.max(start,end)+eps;
      if(trace.some(v=>v<lo||v>hi))return result(FAIL,"sampled overshoot",{values:trace});
      const sign=Math.sign(end-start);
      if(trace.some((v,i)=>i&&sign*(v-trace[i-1])< -eps))return result(FAIL,"sampled reversal",{values:trace});
      return observations.coverage==="continuous-bounded"?result(PASS,"bounded continuous trace verified"):
        result(UNKNOWN,"samples cannot exclude unobserved extrema");
    }
    const t=ts.find(t=>t.property===(c.property||"x"));
    if(!t?.keyframes?.length)return result(UNKNOWN,"no track or measured trajectory");
    const values=t.keyframes.map(k=>k.value),lo=Math.min(values[0],values.at(-1))-eps,hi=Math.max(values[0],values.at(-1))+eps;
    if(values.some(v=>v<lo||v>hi))return result(FAIL,"keyframe overshoot",{values});
    const sign=Math.sign(values.at(-1)-values[0]);
    if(values.some((v,i)=>i&&sign*(v-values[i-1])< -eps))return result(FAIL,"keyframe direction reversal",{values});
    if(t.keyframes.slice(0,-1).some(k=>k.easing!=="linear"))
      return result(UNKNOWN,"nonlinear easing can overshoot between keyframes");
    return result(PASS,"monotonic linear keyframe segments");
  }
  return result(UNKNOWN,"unsupported motion constraint: "+c.kind);
}
function within(b,clip,margin){
  return b.x>=clip.x+margin&&b.y>=clip.y+margin&&b.x+b.width<=clip.x+clip.width-margin&&b.y+b.height<=clip.y+clip.height-margin;
}
export function visualCheck(scene,c,measurements={}){
  if(c.kind==="text-overflow"||c.kind==="visible-text-bounds"){
    const m=measurements[c.target];
    if(!m?.measuredGlyphBounds||!m?.visibleClipBounds||m.actualRiveRender!==true)
      return result(UNKNOWN,"runtime glyph/clip measurements unavailable");
    return within(m.measuredGlyphBounds,m.visibleClipBounds,c.marginPx||0)?
      result(PASS,"measured glyphs inside visible clip"):result(FAIL,"measured glyph overflow");
  }
  if(c.kind==="visible-region"||c.kind==="clip"){
    const m=measurements[c.target];
    if(!m?.actualRiveRender||!m.visiblePixelBounds||!m.expectedVisibleBounds)
      return result(UNKNOWN,"visible pixel/clip evidence unavailable");
    return within(m.visiblePixelBounds,m.expectedVisibleBounds,c.marginPx||0)?
      result(PASS,"measured pixels within specified region"):result(FAIL,"visible pixels escape region");
  }
  return result(UNKNOWN,"unsupported visual relation");
}
export function evaluate(scene,constraints={},observations={}){
  const checks=[];
  const {found,duplicate}=inventory(scene);
  checks.push(result(duplicate.length?FAIL:PASS,duplicate.length?"duplicate node IDs":"distinct node IDs",{duplicate}));
  for(const id of constraints.requiredNodes||[])checks.push(result(found.has(id)?PASS:FAIL,"required node: "+id));
  for(const id of constraints.forbiddenNodes||[])checks.push(result(found.has(id)?FAIL:PASS,"forbidden node: "+id));
  for(const p of constraints.pivots||[])checks.push({constraint:p,...pivotCheck(scene,p)});
  for(const m of constraints.motion||[])checks.push({constraint:m,...motionCheck(scene,m,observations.traces||{})});
  for(const v of constraints.visual||[])checks.push({constraint:v,...visualCheck(scene,v,observations.visual||{})});
  return {status:overall(checks),checks};
}
