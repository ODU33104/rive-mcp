// Three independently composed, original, vector-only flagship scenes.
// Usage: node scripts/v3-flagship-scenes.mjs <vessel|interstice|tidal> <output.riv>
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createRiv} from "../dist/rivWriter.js";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const FONT=readFileSync(resolve(ROOT,"assets/inter.ttf"));
const W=960,H=600,DURATION=300;
export const FLAGSHIP_IDS=Object.freeze(["vessel","interstice","tidal"]);
const solid=color=>({color});
const grad=(a,b,x1=-90,y1=-100,x2=110,y2=130)=>({gradient:{type:"linear",stops:[{color:a,position:0},{color:b,position:1}],start:{x:x1,y:y1},end:{x:x2,y:y2}}});
const k=(frame,value,easing)=>({frame,value,...(easing?{easing}:{})});
function author(id){
  const groups=[],shapes=[],texts=[],tracks=[];
  const group=(id,x=0,y=0,extras={})=>(groups.push({id,x,y,...extras}),id);
  const shape=(id,type,x,y,width,height,fill,z,parent=null,extras={})=>{
    const s={id,type,x,y,width,height,z,...(parent?{parent}:{}),...(fill?{fill}:{}),...extras};
    shapes.push(s); return s;
  };
  const rect=(id,x,y,w,h,c,z,p,r=0,extra={})=>shape(id,"rect",x,y,w,h,c,z,p,{cornerRadius:r,...extra});
  const oval=(id,x,y,w,h,c,z,p,extra={})=>shape(id,"ellipse",x,y,w,h,c,z,p,extra);
  const poly=(id,points,c,z,p,extra={})=>(shapes.push({id,type:"polygon",x:0,y:0,z,closed:true,points:points.map(a=>Array.isArray(a)?{x:a[0],y:a[1]}:a),...(p?{parent:p}:{}),...(c?{fill:c}:{}),...extra}),id);
  const stroke=(id,pts,color,width,z,p,extra={})=>poly(id,pts,null,z,p,{closed:false,stroke:{color,thickness:width,cap:"round",join:"round",...extra}});
  const text=(id,value,x,y,width,size,color,z,parent,align="left")=>(texts.push({id,x,y,width,align,z,parent,runs:[{text:value,font:"inter",fontSize:size,color}]}),id);
  const lane=(target,property,frames)=>tracks.push({target,property,keyframes:frames.map(a=>k(...a))});
  const fade=(target,a,b,to=1)=>lane(target,"opacity",[[0,0],...(a>0?[[a,0,"hold"]]:[]),[b,to,"ease-out"],[DURATION,to]]);
  const sceneMeta={id,durationFrames:DURATION,fps:60,nativeReveal:[],animatedFamilies:[],initialMotion:[],closingMotion:[]};

  if(id==="vessel"){
    // A bottle on a dark, continuous cyclorama: fluid, optics and typography occupy
    // one visual field, not a poster with a text column and product column.
    const INK="#080F18",IVORY="#F2EDDE",MOSS="#B1CEB5",METAL="#D6C7A3";
    rect("cyclorama",480,300,960,600,grad("#14232C","#050A10",-500,-290,420,340),0);
    oval("warm-pool",486,355,690,430,grad("#38554E","#0A141B"),1,null,{opacity:.32});
    oval("falloff",480,558,480,38,solid("#01060C"),2,null,{opacity:.56});
    // Avoid decorative full-height light streaks: lighting must belong to the glass itself.
    group("object",477,380,{opacity:1,scaleX:1,scaleY:1});
    group("glass",0,0,{parent:"object"});
    group("fluid",0,0,{parent:"object",opacity:1});
    group("cap",0,-212,{parent:"object",opacity:1});
    group("etched",0,0,{parent:"object",opacity:1});
    group("lights",0,0,{parent:"object",opacity:1});
    group("productCaption",0,0,{opacity:1});
    group("heroWord",0,0,{opacity:1});
    group("folio",0,0,{opacity:1});

    const bottle=[[-102,-156],[102,-156],[127,-111],[134,134],[104,166],[-104,166],[-134,134],[-127,-111]];
    poly("vesselMask",bottle,null,9,"object"); // Geometry-only Rive clipping source
    poly("body-shadow",bottle,solid("#071118"),10,"glass",{opacity:.98});
    poly("outer-wall",bottle,grad("#A9D2BD","#172E3C",-130,-170,140,180),14,"glass",{opacity:.90});
    poly("inner-well",[[-91,-140],[91,-140],[109,-100],[113,119],[90,143],[-90,143],[-113,119],[-109,-100]],grad("#203D43","#0B222D",-100,-150,80,160),17,"glass",{opacity:.84});
    rect("liquid-volume",0,84,255,240,grad("#83A897","#102F39",-90,-110,90,145),19,"fluid",7,{clipBy:"vesselMask",opacity:.86});
    oval("meniscus",0,-36,246,22,grad("#D5E7D0","#3D7B75"),20,"fluid",{clipBy:"vesselMask",opacity:.74});
    poly("refracted-left",[[-115,-113],[-70,-140],[-51,127],[-81,156],[-119,120]],grad("#B8D9CA","#2F6570"),23,"glass",{opacity:.55});
    poly("refracted-right",[[111,-116],[121,-104],[121,121],[83,158],[69,135]],grad("#EEF3DD","#2B6C75"),25,"glass",{opacity:.69});
    rect("inner-matte",0,18,145,142,grad("#142B35","#071620"),26,"glass",12,{opacity:.58});
    // Optical edges are authored paths, not raster overlays or a shader claim.
    stroke("glass-left-rim",[[-101,-153],[-126,-112],[-131,129],[-103,160]],"#E2F7E3",2.5,29,"glass",{trim:{start:0,end:1},opacity:.88});
    stroke("glass-right-rim",[[103,-151],[125,-107],[131,130],[104,160]],"#A5DED6",2.6,29,"glass",{trim:{start:0,end:1},opacity:.84});
    stroke("inner-chamfer",[[-91,-134],[-107,-105],[-110,115],[-88,139]],"#618C88",1.2,29,"glass",{opacity:.68});
    rect("central-reflection",-57,-10,20,270,grad("#F7FFF0","#32555C"),30,"lights",10,{opacity:.14,rotation:11,clipBy:"vesselMask"});
    rect("moving-caustic",-115,12,18,292,grad("#FFFFFF","#477B85"),31,"lights",12,{opacity:.29,rotation:-13,clipBy:"vesselMask"});
    stroke("right-glisten",[[91,-130],[109,-97],[116,48]],"#F9FFEF",3,33,"lights",{trim:{start:0,end:1},opacity:.67});
    // Neck + cap: separate motion families, slightly asymmetric bevel and engraved flutes.
    rect("neck",0,-175,125,49,grad("#8AA9A4","#29434C"),35,"glass",14);
    rect("cap-shadow",7,10,156,106,solid("#07131B"),40,"cap",17,{opacity:.56});
    rect("cap-shell",0,0,155,100,grad("#E4D8B8","#63594F",-80,-60,80,60),42,"cap",15);
    rect("cap-face",0,-3,143,91,grad("#DDD2B6","#5E6562",-60,-40,80,55),43,"cap",13);
    for(let i=0;i<13;i++)rect("cap-flute-"+i,-59+i*10,-4,1.5,77,solid(i%2? "#F1E8CE":"#817F70"),44,"cap",.7,{opacity:i%2?.35:.53});
    rect("cap-crown",0,-48,141,4,solid("#F0EAD3"),45,"cap",2,{opacity:.74});
    text("brand-etch","M O R R O W",-45,-27,105,14,IVORY,49,"etched","center");
    text("batch-etch","E A U  /  0 1",-48,0,109,10,MOSS,49,"etched","center");
    stroke("bottle-engrave",[[-42,29],[42,29]],METAL,1,51,"etched",{trim:{start:0,end:1},opacity:.65});
    text("product-title","MORROW",65,23,834,86,IVORY,70,"heroWord");
    text("product-title-2","THE SHAPE OF SILENCE",70,135,343,22,MOSS,71,"heroWord");
    text("product-small","ATELIER / OLFACTORY STUDY",68,15,460,12,METAL,72,"folio");
    text("product-number","01 — 03",774,40,130,13,METAL,72,"folio","right");
    text("product-note","SMOKED GLASS  /  FILTERED LIGHT",69,552,500,12,MOSS,72,"productCaption");
    text("product-foot","FORM  /  MATERIAL  /  LIGHT",665,552,238,11,METAL,72,"productCaption","right");

    // Unfold and settle rather than a single global slide.
    lane("object","y",[[0,447],[65,416,"emphasized-decel"],[164,371,"ease-out"],[238,380,"ease-in-out"],[300,380]]);
    lane("object","scaleX",[[0,.87],[120,1.035,"emphasized-decel"],[212,1],[300,1]]);
    lane("object","scaleY",[[0,.87],[120,1.035,"emphasized-decel"],[212,1],[300,1]]);
    lane("glass","opacity",[[0,.12],[10,.12],[106,1],[300,1]]);lane("cap","y",[[0,-290],[58,-290,"hold"],[159,-218,"emphasized-decel"],[227,-212],[300,-212]]);
    fade("cap",32,85);
    lane("fluid","y",[[0,135],[67,135,"hold"],[207,0,"emphasized-decel"],[300,0]]);
    lane("fluid","opacity",[[0,.03],[85,.03],[218,1,"ease-out"],[300,1]]);
    lane("moving-caustic","x",[[0,-205],[81,-205,"hold"],[247,210,"ease-in-out"],[300,228]]);
    lane("moving-caustic","opacity",[[0,0],[96,0],[163,.28],[249,.08],[300,0]]);
    lane("glass-left-rim","trimEnd",[[0,0],[44,0],[184,1,"emphasized-decel"],[300,1]]);
    lane("right-glisten","trimEnd",[[0,0],[126,0],[266,1,"emphasized-decel"],[300,1]]);
    fade("etched",130,254);lane("heroWord","opacity",[[0,.45],[33,.45],[135,1],[300,1]]);fade("productCaption",203,280);
    lane("heroWord","x",[[0,-32],[102,-32],[201,0,"emphasized-decel"],[300,0]]);
    lane("falloff","scaleX",[[0,.7],[148,.86],[247,1],[300,1]]);
    sceneMeta.nativeReveal=["vesselMask: original vector clip geometry on fluid/refraction","glass-left-rim: native TrimPath reveal"];
    sceneMeta.animatedFamilies=["glass/object arrival","cap seating","liquid rise","caustic traverse","rim draw","typographic unveiling","ground shadow"];
    sceneMeta.initialMotion=["Silhouette lifts from darkness; only the optical rim is drawn","The cap hovers and editorial heading remains ghosted"];
    sceneMeta.closingMotion=["Liquid reaches its meniscus behind the vessel mask","Caustic clears the vessel; engraved brand and fine-print resolve"];
  } else if(id==="interstice"){
    // Editorial kinetic type: a large white field is sliced by a moving red index.
    // Word groups respond with unique timings; no shared global hero translation.
    const PAPER="#F4F0E7",BLACK="#10151B",RED="#D43A30",GREY="#787A76";
    rect("paper",480,300,960,600,solid(PAPER),0);
    rect("topBand",480,29,960,58,solid(BLACK),2);
    rect("verticalIndex",906,300,108,600,solid("#E8E3D8"),3);
    group("wordA",0,0,{opacity:1});
    group("wordB",0,0,{opacity:1});
    group("wordC",0,0,{opacity:1});
    group("slash",0,0,{opacity:1});
    group("indices",0,0,{opacity:1});
    group("rules",0,0,{opacity:1});
    group("annotation",0,0,{opacity:1});

    // Some letters are individual editable text entities, not a flattened poster.
    const letters=[["C",84],["U",192],["T",298]];
    for(const [ch,x] of letters)text("cut-"+ch,ch,x,92,120,177,BLACK,30,"wordA");
    text("THROUGH","THROUGH",67,261,795,132,BLACK,31,"wordB");
    text("SPACE","SPACE",144,432,675,121,BLACK,32,"wordC");
    rect("red-slash",489,271,1030,14,solid(RED),42,"slash",0,{rotation:-10});
    rect("slice-edge",486,257,1030,2,solid("#F1BDB4"),43,"slash",0,{rotation:-10,opacity:.76});
    // Counter-space masking is a real native clip, not a fake bitmap overlay.
    rect("aperture-mask",480,419,817,17,null,15);
    rect("red-index-reveal",480,419,816,15,solid(RED),16,"rules",0,{clipBy:"aperture-mask"});
    text("index-number","03",788,84,108,48,RED,60,"indices","right");
    text("micro-left","THE ART OF THE IN-BETWEEN",28,19,492,12,PAPER,61,"indices");
    text("micro-right","MOTION MANIFESTO / 2026",673,19,267,11,PAPER,62,"indices","right");
    text("vertical-label","F / 003",875,492,70,13,BLACK,62,"indices","center");
    text("issue","VOLUME 01   —   THE FRAME IS NOT FIXED",79,559,712,14,BLACK,62,"annotation");
    for(let i=0;i<6;i++){
      stroke("registration-"+i,[[59+i*143,54],[59+i*143,84]],GREY,i%2===0?1.4:.8,12,"rules",{trim:{start:0,end:1}});
    }
    stroke("gutter-rule",[[63,448],[856,448]],BLACK,1.4,17,"rules",{trim:{start:0,end:1}});
    stroke("baseline-rule",[[78,540],[850,540]],BLACK,1.2,17,"rules",{trim:{start:0,end:1}});
    oval("index-dot",806,496,10,10,solid(RED),65,"annotation");
    // Type takes turns *cutting* into the composition. Deliberate inter-word conflict.
    lane("wordA","opacity",[[0,.30],[80,1],[300,1]]);lane("wordA","x",[[0,-54],[68,-54,"hold"],[137,0,"emphasized-decel"],[300,0]]);
    lane("wordA","y",[[0,30],[127,7],[184,0],[300,0]]);
    fade("wordB",63,151);lane("wordB","x",[[0,160],[74,160],[165,-12,"emphasized-decel"],[230,0],[300,0]]);
    fade("wordC",140,229);lane("wordC","y",[[0,115],[143,115],[243,-14,"emphasized-decel"],[282,0],[300,0]]);
    lane("slash","x",[[0,-1180],[95,-1180,"hold"],[184,-55,"emphasized-decel"],[220,0],[300,0]]);
    lane("slash","opacity",[[0,0],[82,0,"hold"],[146,1],[300,1]]);
    lane("red-index-reveal","x",[[0,-870],[135,-870],[264,0,"emphasized-decel"],[300,0]]);
    fade("annotation",208,281);fade("indices",8,71);
    lane("gutter-rule","trimEnd",[[0,0],[169,0],[281,1,"emphasized-decel"],[300,1]]);
    lane("baseline-rule","trimEnd",[[0,0],[202,0],[293,1],[300,1]]);
    for(let i=0;i<6;i++)lane("registration-"+i,"trimEnd",[[0,0],[25+i*9,0],[89+i*13,1],[300,1]]);
    sceneMeta.nativeReveal=["red-index-reveal clipped to aperture-mask","gutter-rule native TrimPath draw-on"];
    sceneMeta.animatedFamilies=["individually authored CUT letterforms","THROUGH offset collision","SPACE vertical landing","diagonal red slash","aperture reveal","registration marks","editorial annotations"];
    sceneMeta.initialMotion=["Registration marks begin; opening CUT is absent","Empty typographic field reserves central negative space"];
    sceneMeta.closingMotion=["Diagonal index bisects three independently choreographed word planes","Masked red band, baseline and metadata settle after the type conflict"];
  } else if(id==="tidal"){
    // Flow cartography: non-product, no hero product and no side-panel split.
    // Hand-authored formulaic bathymetric contours with precise semantic bearings.
    const DEEP="#061C2C",INK="#092D3E",AQUA="#77C6B7",ICE="#DAF1DC",GOLD="#F4C585";
    rect("ocean",480,300,960,600,grad("#082C3C","#04121E",-540,-360,440,290),0);
    rect("recede",480,300,870,514,null,1,null,0,{stroke:{color:"#356477",thickness:1},opacity:.5});
    group("terrain",455,281,{opacity:1});
    group("sonar",455,281,{opacity:1});
    group("markers",455,281,{opacity:1});
    group("grid",0,0,{opacity:1});
    group("labels",0,0,{opacity:1});
    group("readout",0,0,{opacity:1});
    // Distorted contour rings generated from a deterministic bounded field.
    const pts=(rx,ry,phase)=>Array.from({length:32},(_,i)=>{
      const theta=(i/32)*Math.PI*2;
      const wave=1+.065*Math.sin(theta*3+phase)+.035*Math.cos(theta*7-phase);
      return [Math.cos(theta)*rx*wave,Math.sin(theta)*ry*wave];
    });
    for(let i=0;i<8;i++){
      const scale=1-i*.096, p=pts(348*scale,216*scale,i*.42);
      poly("contour-"+i,p,i===7?grad("#286676","#0F394A"):null,9+i,"terrain",{
        stroke:{color:i%3===0?ICE:AQUA,thickness:i%3===0?1.8:1.1,trim:{start:0,end:1}},
        opacity:.22+(i%4)*.14
      });
    }
    oval("sea-chamber",0,0,205,112,grad("#164E5C","#092634"),19,"terrain",{opacity:.9});
    for(let i=0;i<5;i++){
      const rad=i*2.39,rr=138+i*31;
      oval("buoy-"+i,Math.cos(rad)*rr,Math.sin(rad)*rr,6+i%2*3,6+i%2*3,solid(GOLD),31,"markers");
      stroke("buoy-tick-"+i,[[Math.cos(rad)*rr,Math.sin(rad)*rr],[Math.cos(rad)*(rr+16),Math.sin(rad)*(rr+16)]],ICE,1.2,32,"markers",{opacity:.78});
    }
    // A sweeping current vector and active acoustic ring.
    poly("sonar-arc",pts(255,161,.2),null,38,"sonar",{stroke:{color:GOLD,thickness:3,cap:"round",trim:{start:0,end:.0}},opacity:.85});
    stroke("transect",[[-350,-67],[-200,-42],[-82,-81],[34,-16],[170,-26],[340,55]],ICE,2,39,"sonar",{trim:{start:0,end:1},opacity:.90});
    stroke("transect-light",[[-350,-64],[-200,-39],[-82,-78],[34,-13],[170,-23],[340,58]],AQUA,2.5,38,"sonar",{opacity:0});
    stroke("cross-x",[[-27,0],[27,0]],GOLD,1.8,41,"sonar",{trim:{start:0,end:1}});
    stroke("cross-y",[[0,-27],[0,27]],GOLD,1.8,41,"sonar",{trim:{start:0,end:1}});
    oval("core",0,0,11,11,solid(GOLD),44,"sonar");
    for(let i=0;i<9;i++){
      const y=92+i*51;
      stroke("latitude-"+i,[[29,y],[932,y]],AQUA,.5,3,"grid",{opacity:.12});
    }
    for(let i=0;i<10;i++){
      const x=47+i*95;
      stroke("longitude-"+i,[[x,59],[x,546]],AQUA,.5,3,"grid",{opacity:.11});
    }
    rect("north-line",897,476,2,55,solid(GOLD),48,"labels");
    text("north","N",879,421,35,23,GOLD,50,"labels","center");
    text("heading","TIDAL",66,81,414,66,ICE,55,"labels");
    text("subheading","FIELD NOTES / 001",71,151,360,13,AQUA,55,"labels");
    text("depth","DEPTH — 4,280M",688,82,230,17,ICE,55,"readout","right");
    text("coordinate","38° 12' N    142° 09' E",612,110,306,12,AQUA,55,"readout","right");
    text("footer-a","THE OCEAN IS A MOVING MAP.",69,547,570,17,ICE,55,"labels");
    text("footer-b","HYDROGRAPHIC / EXPERIMENT 03",673,550,243,10,AQUA,56,"labels","right");
    // The *map* acts; the panel stays spatially stable.
    lane("terrain","rotation",[[0,-4],[126,0,"ease-in-out"],[247,2,"ease-in-out"],[300,0]]);
    lane("terrain","scaleX",[[0,.84],[157,1.016,"emphasized-decel"],[265,1],[300,1]]);
    lane("terrain","scaleY",[[0,.84],[157,1.016,"emphasized-decel"],[265,1],[300,1]]);
    lane("terrain","opacity",[[0,.20],[74,1],[300,1]]);
    for(let i=0;i<8;i++)lane("contour-"+i,"trimEnd",[[0,0],[27+i*12,0],[166+i*13,1,"emphasized-decel"],[300,1]]);
    lane("sonar-arc","trimEnd",[[0,0],[108,0],[261,.78,"ease-in-out"],[300,.86]]);
    lane("transect","trimEnd",[[0,0],[66,0],[217,1,"emphasized-decel"],[300,1]]);
    lane("transect-light","opacity",[[0,0],[50,0],[120,.09],[238,.12],[300,.12]]);
    lane("cross-x","trimEnd",[[0,0],[101,0],[178,1],[300,1]]);
    lane("cross-y","trimEnd",[[0,0],[119,0],[194,1],[300,1]]);
    lane("markers","rotation",[[0,-8],[165,5,"emphasized-decel"],[300,0]]);
    fade("markers",88,217);fade("readout",161,264);lane("labels","opacity",[[0,.7],[108,1],[300,1]]);
    lane("grid","opacity",[[0,0],[39,.2],[135,.8],[300,1]]);
    sceneMeta.nativeReveal=["contour-0..7 independently animated native TrimPath","sonar-arc partial circular native TrimPath sweep"];
    sceneMeta.animatedFamilies=["bathymetric contours","topography scale and drift","sonar beam sweep","transect draw","buoy station markers","grid exposure","readout and labels"];
    sceneMeta.initialMotion=["An empty deep-water field acquires a coordinate grid","Outer soundings draw first, as though sampled by a survey instrument"];
    sceneMeta.closingMotion=["Sonar trace and survey transect resolve at the crosshair","Numerical reading appears after the geometry has established orientation"];
  } else throw Error("Unknown flagship id: "+id);
  sceneMeta.nodeNames={groups:groups.map(x=>x.id),shapes:shapes.map(x=>x.id),texts:texts.map(x=>x.id)};
  return {scene:{artboard:{name:"Flagship_"+id,width:W,height:H},fonts:[{id:"inter",bytes:new Uint8Array(FONT)}],
    groups,shapes,texts,animations:[{name:"Direction",fps:60,duration:DURATION,loop:"oneShot",tracks}],
    stateMachine:{name:"Flagship",states:[{name:"DirectionState",animation:"Direction"}],transitions:[{from:"entry",to:"DirectionState"}]}},meta:sceneMeta};
}
export function createFlagshipScene(id){return author(id);}
export function buildFlagshipScene(id){
  const {scene,meta}=author(id); const {bytes,warnings}=createRiv(scene);
  return {scene,meta,bytes,warnings};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const id=process.argv[2];if(!FLAGSHIP_IDS.includes(id))throw Error("Usage: node scripts/v3-flagship-scenes.mjs <"+FLAGSHIP_IDS.join("|")+"> [output.riv]");
  const out=resolve(process.argv[3]??"test/tmp/v3-flagship/"+id+".riv");
  mkdirSync(dirname(out),{recursive:true});
  const {bytes,warnings}=buildFlagshipScene(id);
  if(warnings.length)throw Error("Native authoring warnings: "+JSON.stringify(warnings));
  writeFileSync(out,Buffer.from(bytes)); console.log(JSON.stringify({id,out,bytes:bytes.length}));
}
