// Original vector mechanisms, deliberately restricted to the repository's Rive scene schema.
// Geometry is in local pixels; transform validation happens before node emission.
export const RIG_IDS = Object.freeze([
  "precision-watch", "earbuds-case", "studio-camera", "optical-lens",
  "audio-equalizer", "celestial-atlas", "botanical-form", "progress-ring",
  "abstract-emote", "kinetic-wordmark"
]);

const META = {
 "precision-watch": {semantic:"analog timekeeping instrument",domains:["horology"],pivot:"minute"},
 "earbuds-case": {semantic:"wireless earbuds in charging enclosure",domains:["audio"],pivot:"lid"},
 "studio-camera": {semantic:"photographic capture camera",domains:["photography"],pivot:"dial"},
 "optical-lens": {semantic:"focusing optical element",domains:["photography","astronomy"],pivot:"focus"},
 "audio-equalizer": {semantic:"frequency-band level display",domains:["audio"],pivot:"pulse"},
 "celestial-atlas": {semantic:"orbital spatial reference diagram",domains:["astronomy"],pivot:"satellite"},
 "botanical-form": {semantic:"rooted botanical silhouette",domains:["botany"],pivot:"sway"},
 "progress-ring": {semantic:"bounded fractional completion indicator",domains:["interface"],pivot:"trace"},
 "abstract-emote": {semantic:"fictional expressive character",domains:["illustration"],pivot:"blink"},
 "kinetic-wordmark": {semantic:"typographic identity mark",domains:["identity"],pivot:"letter"}
};

export const STYLES = Object.freeze({
 nocturne:{ink:"#101C2D",paper:"#EDF2E5",metal:"#BCA678",subtle:"#778B9A",accent:"#E3C77F",shadow:"#030914",surface:"#26384B",glint:"#FDF5CF"},
 porcelain:{ink:"#263747",paper:"#FAF8EF",metal:"#B7C4CC",subtle:"#7396A0",accent:"#D57752",shadow:"#3A5361",surface:"#D8E6E5",glint:"#FFFFFF"},
 aurora:{ink:"#0C1C2B",paper:"#D8EFEB",metal:"#8DBBBC",subtle:"#608A9F",accent:"#79E2C3",shadow:"#02151A",surface:"#1C4051",glint:"#F4FFF8"}
});

const solid = color => ({color});
const gradient = (a,b)=>({gradient:{type:"linear",stops:[{color:a,position:0},{color:b,position:1}],start:{x:-90,y:-90},end:{x:90,y:90}}});
const point = (x,y)=>({x,y});
const polar=(r,a)=>point(+((r*Math.cos(a)).toFixed(3)),+((r*Math.sin(a)).toFixed(3)));
function finite(n){return typeof n==="number"&&Number.isFinite(n);}
function nodeIndex(scene){return new Map([...scene.groups,...scene.shapes,...scene.texts].map(n=>[n.id,n]));}
export function validateBinding(id,opts={}){
 if(!META[id])throw Error("unknown rig: "+id);
 const {unit="px",scale=1,rotation=0,x=0,y=0,pivot=META[id].pivot,domain=META[id].domains[0]}=opts;
 if(unit!=="px")throw Error("rig unit must be px; explicit conversion required");
 if(![x,y,scale,rotation].every(finite))throw Error("nonfinite rig placement");
 if(scale<0.32||scale>2.5)throw Error("rig scale outside [0.32,2.5]");
 if(pivot!==META[id].pivot)throw Error("unsupported rig pivot: "+pivot);
 if(!META[id].domains.includes(domain))throw Error("rig semantic domain mismatch: "+domain);
 if(typeof opts.namespace!=="string"||!/^[a-z][a-z0-9-]{1,40}$/.test(opts.namespace))
   throw Error("stable namespace required");
 return true;
}
function builder(id,opts){
 const t=STYLES[opts.style||"nocturne"];
 if(!t)throw Error("unknown style: "+opts.style);
 const prefix=opts.namespace+"--", groups=[],shapes=[],texts=[],parts=[];
 const uid=s=>prefix+s;
 let z=opts.zBase??100;
 const g=(name,x=0,y=0,more={})=>{
   groups.push({id:uid(name),x,y,parent:more.parent?uid(more.parent):name==="root"?(opts.parent||undefined):uid("root"),
     rotation:more.rotation??0,scaleX:more.scaleX??1,scaleY:more.scaleY??1,opacity:more.opacity??1});
   return uid(name);
 };
 const s=(name,type,x,y,w,h,fill,extra={})=>{
   shapes.push({id:uid(name),type,x,y,width:w,height:h,z:z++,
     parent:uid(extra.parent||"root"),...(fill?{fill}:{}),
     ...(extra.rotation!==undefined?{rotation:extra.rotation}:{}),
     ...(extra.opacity!==undefined?{opacity:extra.opacity}:{}),
     ...(extra.cornerRadius!==undefined?{cornerRadius:extra.cornerRadius}:{}),
     ...(extra.clipBy?{clipBy:uid(extra.clipBy)}:{}),
     ...(extra.stroke?{stroke:extra.stroke}:{}),
     ...(extra.points?{points:extra.points,closed:extra.closed??true}:{})});
   return uid(name);
 };
 const ellipse=(n,x,y,w,h,c,e={})=>s(n,"ellipse",x,y,w,h,c,e);
 const rect=(n,x,y,w,h,c,e={})=>s(n,"rect",x,y,w,h,c,e);
 const poly=(n,points,c,e={})=>s(n,"polygon",0,0,undefined,undefined,c,{...e,points});
 const line=(n,x1,y1,x2,y2,color,width=1,e={})=>poly(n,[point(x1,y1),point(x2,y2)],null,{...e,closed:false,stroke:{color,thickness:width,cap:"round"}});
 const stroked=(n,x,y,w,h,color,width,trim,e={})=>s(n,"ellipse",x,y,w,h,null,{...e,stroke:{color,thickness:width,cap:"round",...(trim?{trim}: {})}});
 const label=(n,content,x,y,width,size,color,more={})=>{
   texts.push({id:uid(n),x,y,width,align:more.align||"center",
     parent:uid(more.parent||"root"),z:z++,runs:[{text:content,font:"inter",fontSize:size,color}]});
 };
 // Root is always a real geometry-bearing transform, never merely a label.
 g("root",opts.x??0,opts.y??0,{rotation:opts.rotation??0,scaleX:opts.scale??1,scaleY:opts.scale??1});
 const shadow=(x,y,w,h)=>ellipse("contact-shadow",x,y,w,h,solid(t.shadow),{opacity:.22});
 const glint=(n,x,y,w,h)=>stroked(n,x,y,w,h,t.glint,2,{start:0,end:.11,offset:0},{opacity:.82});
 switch(id){
 case "precision-watch":{
   shadow(0,116,170,16);
   rect("strap-upper",0,-108,75,110,gradient(t.surface,t.ink),{cornerRadius:10});
   rect("strap-lower",0,108,75,110,gradient(t.ink,t.surface),{cornerRadius:10});
   ellipse("case",0,0,194,194,gradient(t.metal,t.glint));
   ellipse("gasket",0,0,177,177,solid(t.ink));
   ellipse("dial",0,0,162,162,gradient(t.surface,t.ink));
   for(let i=0;i<24;i++){const a=i*Math.PI/12-Math.PI/2;const a0=polar(i%2?67:62,a),a1=polar(74,a);line("index-"+i,a0.x,a0.y,a1.x,a1.y,t.accent,i%2?.9:2);}
   g("hour",0,0,{rotation:-65});
   poly("hour-hand",[point(-4,8),point(-3,-42),point(0,-50),point(3,-42),point(4,8)],solid(t.metal),{parent:"hour"});
   g("minute",0,0,{rotation:35});
   poly("minute-hand",[point(-2,11),point(-2,-65),point(0,-76),point(2,-65),point(2,11)],solid(t.glint),{parent:"minute"});
   ellipse("center-pin",0,0,9,9,solid(t.accent));
   ellipse("crown",103,0,16,30,gradient(t.glint,t.metal));
   glint("bezel-glint",0,0,190,190);
   break;
 }
 case "earbuds-case":{
   shadow(0,91,170,14);
   rect("enclosure",0,26,194,117,gradient(t.metal,t.surface),{cornerRadius:45});
   rect("inner-recess",0,9,171,74,solid(t.ink),{cornerRadius:32});
   // Invisible mask source and an independently clipped luminous interior band.
   rect("recess-mask",0,9,167,69,null,{cornerRadius:30});
   rect("recess-shine",0,-12,178,23,gradient(t.glint,t.subtle),{clipBy:"recess-mask",opacity:.54,cornerRadius:8});
   for(const [side,x] of [["l",-43],["r",43]]){
     ellipse(side+"-bud",x,6,48,56,gradient(t.glint,t.metal));
     rect(side+"-stem",x+4,39,16,48,solid(t.metal),{cornerRadius:8});
     ellipse(side+"-port",x-6,0,15,12,solid(t.ink));
   }
   g("lid",0,-49);
   rect("hinged-lid",0,-21,191,53,gradient(t.surface,t.metal),{parent:"lid",cornerRadius:26});
   line("lid-seam",-78,4,78,4,t.glint,1,{parent:"lid"});
   ellipse("charge-light",0,78,7,7,solid(t.accent));
   glint("lid-glint",0,23,184,105);
   break;
 }
 case "studio-camera":{
   shadow(0,98,202,18);
   rect("body",0,5,200,125,gradient(t.surface,t.ink),{cornerRadius:15});
   rect("prism",0,-65,107,45,gradient(t.metal,t.surface),{cornerRadius:5});
   rect("handgrip",84,5,40,101,solid(t.ink),{cornerRadius:8});
   rect("viewfinder",0,-73,45,16,solid(t.ink),{cornerRadius:4});
   g("dial",-64,-65,{rotation:0});
   ellipse("dial-base",0,0,32,17,solid(t.metal),{parent:"dial"});
   for(let i=0;i<9;i++){const x=-13+i*3.25;line("dial-grip-"+i,x,-6,x,5,t.ink,.8,{parent:"dial"});}
   ellipse("lens-housing",0,13,103,103,gradient(t.metal,t.glint));
   ellipse("lens-glass",0,13,86,86,gradient(t.ink,t.surface));
   ellipse("lens-eye",-13,0,19,19,solid(t.subtle),{opacity:.45});
   ellipse("record-light",74,-42,10,10,solid(t.accent));
   line("top-engraving",-30,-55,35,-55,t.glint,2);
   glint("camera-glint",0,13,99,99);
   break;
 }
 case "optical-lens":{
   shadow(0,91,150,13);
   ellipse("lens-outer",0,0,178,178,gradient(t.metal,t.ink));
   ellipse("lens-rim",0,0,162,162,solid(t.surface));
   ellipse("glass",0,0,134,134,gradient(t.ink,t.subtle));
   ellipse("glass-mask",0,0,130,130,null);
   ellipse("optic-bloom",-31,-28,106,81,solid(t.glint),{opacity:.15,clipBy:"glass-mask"});
   for(let i=0;i<36;i++){let a=i*Math.PI/18;const u=polar(78,a),v=polar(83,a);line("focus-groove-"+i,u.x,u.y,v.x,v.y,t.glint,1);}
   g("focus",0,0);
   for(let i=0;i<8;i++){
     const a=i*Math.PI/4;
     poly("aperture-"+i,[polar(12,a),polar(63,a+.20),polar(63,a+.59)],
        solid(i%2?t.ink:t.surface),{parent:"focus",opacity:.94});
   }
   ellipse("optical-core",0,0,31,31,gradient(t.subtle,t.ink),{parent:"focus"});
   ellipse("reflection",-20,-21,25,13,solid(t.glint),{opacity:.31,rotation:-36});
   glint("lens-glint",0,0,174,174);
   break;
 }
 case "audio-equalizer":{
   rect("panel",0,0,203,162,gradient(t.surface,t.ink),{cornerRadius:16});
   rect("clip",0,0,175,114,null,{cornerRadius:6});
   for(let i=0;i<9;i++){
     const h=[37,82,61,103,71,94,48,76,41][i];
     rect("bar-"+i,-76+i*19,47-h/2,11,h,solid(i%2?t.metal:t.accent),
       {cornerRadius:4,clipBy:"clip"});
   }
   g("pulse",0,0);
   for(let i=0;i<5;i++)line("spectral-"+i,-83,-50+i*5,83,-50+i*5,t.glint,.65,{parent:"pulse",opacity:.38});
   rect("lower-rule",0,72,167,2,solid(t.accent));
   glint("panel-glint",0,0,201,160);
   break;
 }
 case "celestial-atlas":{
   ellipse("field",0,0,189,189,gradient(t.surface,t.ink),{opacity:.85});
   for(let i=0;i<3;i++)stroked("orbit-"+i,0,0,72+i*53,72+i*53,t.subtle,i===1?1.5:.9,null,{opacity:.8});
   ellipse("sun",0,0,39,39,gradient(t.accent,t.metal));
   const ps=[[66,0],[-30,-56],[-76,32],[37,71]];
   ps.forEach(([x,y],i)=>ellipse("planet-"+i,x,y,7+i*3,7+i*3,solid(i%2?t.glint:t.accent)));
   g("satellite",0,0,{rotation:-25});
   line("orbit-arm",0,0,83,0,t.glint,.8,{parent:"satellite",opacity:.4});
   ellipse("satellite-body",83,0,12,12,solid(t.glint),{parent:"satellite"});
   for(let i=0;i<13;i++){let x=((i*37)%174)-87,y=((i*71)%170)-85;
     ellipse("star-"+i,x,y,1.5+(i%3),1.5+(i%3),solid(t.glint),{opacity:.55});}
   glint("celestial-glint",0,0,181,181);
   break;
 }
 case "botanical-form":{
   shadow(0,110,150,11);
   g("sway",0,75);
   line("main-stem",0,24,0,-137,t.metal,4,{parent:"sway"});
   for(let i=0;i<6;i++){
     const yy=7-i*23,side=i%2?1:-1;
     line("branch-"+i,0,yy,side*56,yy-26,t.subtle,2,{parent:"sway"});
     ellipse("leaf-"+i,side*57,yy-27,66,28,gradient(t.accent,t.surface),
       {rotation:side*30,parent:"sway"});
     line("vein-"+i,side*32,yy-17,side*72,yy-36,t.ink,.8,{parent:"sway",opacity:.45});
   }
   ellipse("seed",0,-132,30,30,gradient(t.glint,t.accent),{parent:"sway"});
   rect("vessel",0,99,111,47,gradient(t.surface,t.metal),{cornerRadius:8});
   line("vessel-rim",-59,77,59,77,t.glint,3);
   break;
 }
 case "progress-ring":{
   stroked("base-ring",0,0,170,170,t.surface,16,null,{opacity:.95});
   stroked("trace",0,0,170,170,t.accent,16,{start:0,end:.72,offset:0});
   stroked("inner-bezel",0,0,142,142,t.subtle,1,null);
   for(let i=0;i<12;i++){const a=i*Math.PI/6-Math.PI/2,p0=polar(94,a),p1=polar(99,a);
     line("minute-notch-"+i,p0.x,p0.y,p1.x,p1.y,t.metal,i%3?1:2);}
   label("numeral","72%",-74,-23,148,43,t.glint);
   label("description","COMPLETE",-74,33,148,12,t.subtle);
   glint("progress-glint",0,0,188,188);
   break;
 }
 case "abstract-emote":{
   shadow(0,107,147,17);
   poly("ear-left",[point(-63,-55),point(-83,-123),point(-14,-86)],gradient(t.accent,t.surface));
   poly("ear-right",[point(63,-55),point(83,-123),point(14,-86)],gradient(t.accent,t.surface));
   ellipse("head",0,0,161,165,gradient(t.metal,t.surface));
   ellipse("cheek-left",-49,29,29,15,solid(t.accent),{opacity:.55});
   ellipse("cheek-right",49,29,29,15,solid(t.accent),{opacity:.55});
   g("blink",0,0);
   ellipse("eye-left",-31,-18,15,26,solid(t.ink),{parent:"blink"});
   ellipse("eye-right",31,-18,15,26,solid(t.ink),{parent:"blink"});
   poly("smile",[point(-20,26),point(0,37),point(20,26)],null,
       {closed:false,stroke:{color:t.ink,thickness:3,cap:"round"}});
   ellipse("highlight",-35,-45,32,12,solid(t.glint),{opacity:.35,rotation:-20});
   break;
 }
 case "kinetic-wordmark":{
   g("letter",0,0);
   for(let i=0;i<4;i++)rect("speed-"+i,-84+i*9,-44-i*7,66-i*8,3,solid(t.accent),
    {parent:"letter",cornerRadius:1});
   label("brand","VELOCITY",-126,-8,252,35,t.glint,{parent:"letter"});
   line("underline",-117,39,117,39,t.accent,2,{parent:"letter"});
   line("slash-left",-118,50,-103,63,t.accent,2,{parent:"letter"});
   line("slash-right",103,50,118,63,t.accent,2,{parent:"letter"});
   label("submark","KINETIC  /  STUDIO",-120,47,240,12,t.subtle);
   break;
 }
 default:throw Error("unimplemented rig: "+id);
 }
 const manifest={schema:"visual-rig-binding/v1",rig:id,namespace:opts.namespace,
   semantic:META[id].semantic,domain:opts.domain||META[id].domains[0],
   unit:"px",scale:opts.scale??1,style:opts.style||"nocturne",
   root:uid("root"),pivot:uid(META[id].pivot),
   pivotLocal:(()=>{const p=[...groups,...shapes].find(n=>n.id===uid(META[id].pivot));return p?{x:p.x,y:p.y,parent:p.parent}:null})(),
   allowedMotion:[uid(META[id].pivot)+".rotation",uid(META[id].pivot)+".scaleY",uid(META[id].pivot)+".opacity",
      uid("root")+".opacity",uid("root")+".y"],
   nodeIds:[...groups,...shapes,...texts].map(n=>n.id),
   geometry:{groups:groups.length,shapes:shapes.length,texts:texts.length},
   shadow:{maxOpacity:.35,allowedId:shapes.some(s=>s.id===uid("contact-shadow"))?uid("contact-shadow"):null},
   glints:shapes.filter(s=>s.id.endsWith("glint")).map(s=>s.id)};
 return {groups,shapes,texts,manifest};
}
export function instantiateRig(id,options){
 validateBinding(id,options);
 const rig=builder(id,options);
 const index=nodeIndex(rig);
 if(!index.has(rig.manifest.pivot))throw Error("pivot geometry missing: "+rig.manifest.pivot);
 if(index.get(rig.manifest.root)?.parent!==options.parent && options.parent)
  throw Error("root is not under requested parent");
 if(new Set(rig.manifest.nodeIds).size!==rig.manifest.nodeIds.length)throw Error("duplicate rig geometry");
 for(const n of [...rig.shapes,...rig.groups,...rig.texts]){
  if(n.parent&&!index.has(n.parent)&&n.parent!==options.parent)throw Error("unresolved local parent "+n.id);
  if(n.clipBy&&!index.has(n.clipBy))throw Error("unresolved clipping mask "+n.id);
 }
 return rig;
}
export function validateRigScene(scene,manifests){
 const idx=nodeIndex(scene), ids=[...scene.groups,...scene.shapes,...scene.texts].map(n=>n.id);
 if(new Set(ids).size!==ids.length)throw Error("scene has duplicate node IDs");
 const tracks=scene.animations.flatMap(a=>a.tracks);
 for(const m of manifests){
   const root=idx.get(m.root),pivot=idx.get(m.pivot);
   if(!root||!pivot||!scene.groups.includes(root)||!(scene.groups.includes(pivot)||scene.shapes.includes(pivot)))
     throw Error("invalid root/pivot attachment "+m.rig);
   if(root.scaleX!==m.scale||root.scaleY!==m.scale||m.unit!=="px")
     throw Error("rig scale/unit witness failed "+m.rig);
   if(!m.pivotLocal||pivot.x!==m.pivotLocal.x||pivot.y!==m.pivotLocal.y||pivot.parent!==m.pivotLocal.parent)
     throw Error("rig pivot geometry moved "+m.rig);
   const ownNodes=m.nodeIds.map(id=>idx.get(id));
   if(ownNodes.some(n=>!n))throw Error("missing bound vector geometry "+m.rig);
   const motion=new Set(m.allowedMotion);
   for(const track of tracks.filter(t=>m.nodeIds.includes(t.target))){
     if(!motion.has(track.target+"."+track.property) && !(track.target===m.pivot&&track.property==="rotation"))
       throw Error("forbidden rig motion "+track.target+"."+track.property);
   }
   for(const id of m.glints){const n=idx.get(id);
     if(!n.stroke?.trim || n.stroke.trim.end>0.12)throw Error("invalid glint "+id);
   }
   if(m.shadow.allowedId){let n=idx.get(m.shadow.allowedId);
     if(n.opacity>m.shadow.maxOpacity)throw Error("contact shadow opacity leak");
   }
 }
 for(const n of [...scene.groups,...scene.shapes,...scene.texts]){
   if(n.parent&&!idx.has(n.parent))throw Error("missing parent "+n.id);
   if(n.clipBy&&!idx.has(n.clipBy))throw Error("missing clip source "+n.id);
 }
 for(const a of scene.animations){
   for(const tr of a.tracks){
     if(!idx.has(tr.target))throw Error("orphan animation target "+tr.target);
     if(tr.keyframes.some((k,i)=>!Number.isFinite(k.value)||k.frame<0||k.frame>a.duration||(i&&k.frame<=tr.keyframes[i-1].frame)))
       throw Error("invalid temporal orchestration "+tr.target);
   }
 }
 return {status:"PASS",nodes:ids.length,rigs:manifests.length,tracks:tracks.length,
   clips:scene.shapes.filter(s=>s.clipBy).length};
}
export function rigMeta(id){return {...META[id],id};}
