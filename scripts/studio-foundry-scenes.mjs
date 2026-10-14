// Studio Foundry: 12 originally authored vector art directions, not 12 renamed recipes.
// node scripts/studio-foundry-scenes.mjs <scene-id> <output.riv>
// Emits editable native Rive with source-created layered vector shapes and temporal tracks.
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createRiv} from "../dist/rivWriter.js";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const FONT=readFileSync(resolve(ROOT,"assets/inter.ttf"));
const W=720,H=460;
const THEMES={
 vesper:{title:"VESPER",subtitle:"WIRELESS, REIMAGINED.",micro:"STUDIO / 01",foot:"FORM MEETS SILENCE",bg:"#071B22",dark:"#061019",light:"#F2E3CB",muted:"#8DADB0",glow:"#2D8583",accent:"#E9B979",kind:"earbuds",hero:[514,230],copy:[56,149]},
 spectra:{title:"SPECTRA",subtitle:"CAPTURE THE UNSEEN.",micro:"OPTICS / 02",foot:"PRECISION SERIES • F/1.4",bg:"#11171F",dark:"#080C13",light:"#F6F2E9",muted:"#A9B1C1",glow:"#506E86",accent:"#E66C4B",kind:"camera",hero:[515,224],copy:[54,149]},
 orbital:{title:"ORBITAL",subtitle:"BEYOND THE HORIZON.",micro:"DEEP SPACE / 03",foot:"THE DISTANCE BETWEEN WORLDS",bg:"#0B1432",dark:"#05071A",light:"#EEF4FF",muted:"#8B9CC9",glow:"#4D79DB",accent:"#F7B989",kind:"planet",hero:[506,225],copy:[54,149]},
 luma:{title:"LUMA",subtitle:"SAY HELLO TO WONDER.",micro:"COMPANIONS / 04",foot:"A SMALL SPARK OF JOY",bg:"#2A143A",dark:"#120920",light:"#F9F0FF",muted:"#D5ABDB",glow:"#9E67C8",accent:"#FFD784",kind:"mascot",hero:[520,226],copy:[54,149]},
 bassline:{title:"BASSLINE",subtitle:"FEEL EVERY FREQUENCY.",micro:"SOUND LAB / 05",foot:"ANALOG SOUL / DIGITAL MIND",bg:"#21131F",dark:"#100A14",light:"#F9E9DB",muted:"#D2A8B2",glow:"#B95275",accent:"#FFBD86",kind:"vinyl",hero:[512,235],copy:[54,149]},
 meridian:{title:"MERIDIAN",subtitle:"SIGNAL OVER NOISE.",micro:"INTELLIGENCE / 06",foot:"LIVE SYSTEMS • 99.97%",bg:"#0B1924",dark:"#050D15",light:"#F3F9FA",muted:"#8EAABF",glow:"#315A71",accent:"#5DE5C0",kind:"dashboard",hero:[506,225],copy:[54,149]},
 archive:{title:"ARCHIVE",subtitle:"THE ART OF STILLNESS.",micro:"EDITION / 07",foot:"COLLECTED FOR THE FUTURE",bg:"#302B27",dark:"#171411",light:"#F2E4D1",muted:"#C0B4A6",glow:"#8B7156",accent:"#D1B07F",kind:"book",hero:[506,229],copy:[54,149]},
 botanica:{title:"BOTANICA",subtitle:"LIFE FINDS A WAY.",micro:"NATURE / 08",foot:"A STUDY IN ORGANIC MOTION",bg:"#0D241B",dark:"#05140D",light:"#E3F4D9",muted:"#A8CBB3",glow:"#27684A",accent:"#BEDE85",kind:"botanical",hero:[513,225],copy:[54,149]},
 prism:{title:"PRISM",subtitle:"LIGHT HAS LANGUAGE.",micro:"OPTICAL / 09",foot:"CHROMATIC EXPERIMENTS",bg:"#12102B",dark:"#070714",light:"#F6F5FF",muted:"#A7A2D5",glow:"#595BA5",accent:"#79D9FF",kind:"prism",hero:[516,233],copy:[54,149]},
 atlas:{title:"ATLAS",subtitle:"FIND YOUR NORTH.",micro:"EXPLORATION / 10",foot:"60° N / 24° E",bg:"#142B30",dark:"#081417",light:"#ECF3EB",muted:"#AEC3B9",glow:"#3F7770",accent:"#E5B874",kind:"compass",hero:[511,228],copy:[54,149]},
 zenith:{title:"ZENITH",subtitle:"MAKE AN ENTRANCE.",micro:"MOTION / 11",foot:"A TYPOGRAPHIC MANIFESTO",bg:"#261112",dark:"#100809",light:"#FFF2E8",muted:"#CBA6A1",glow:"#8D343A",accent:"#FF8667",kind:"monogram",hero:[510,222],copy:[54,149]},
 quantum:{title:"QUANTUM",subtitle:"THE FUTURE IS BUILT.",micro:"COMPUTATION / 12",foot:"PARALLEL BY DESIGN",bg:"#081B2C",dark:"#040C18",light:"#E6F5FF",muted:"#A1C1D8",glow:"#225B81",accent:"#55D9E8",kind:"circuit",hero:[514,226],copy:[54,149]}
};
export const SCENE_IDS=Object.freeze(Object.keys(THEMES));
const SOLID=color=>({color});
const GRAD=(a,b,dx=0,dy=-90)=>({gradient:{type:"linear",stops:[{color:a,position:0},{color:b,position:1}],start:{x:-120+dx,y:-110+dy},end:{x:120+dx,y:130+dy}}});
function shape(id,type,x,y,w,h,fill,z,parent=null,other={}){
 return {id,type,x,y,width:w,height:h,z,...(parent?{parent}:{}),...(fill?{fill}:{}),...other};
}
function rect(id,x,y,w,h,fill,z,parent,rad=0,other={}){
 return shape(id,"rect",x,y,w,h,fill,z,parent,{cornerRadius:rad,...other});
}
function oval(id,x,y,w,h,fill,z,parent,other={}){
 return shape(id,"ellipse",x,y,w,h,fill,z,parent,other);
}
function poly(id,pts,fill,z,parent,other={}){
 return {id,type:"polygon",x:0,y:0,z,closed:true,points:pts.map(([x,y])=>({x,y})),...(parent?{parent}:{}),...(fill?{fill}:{}),...other};
}
function line(id,x1,y1,x2,y2,color,z,parent,width=1,other={}){
 return poly(id,[[x1,y1],[x2,y2]],null,z,parent,{closed:false,stroke:{color,thickness:width,cap:"round"},...other});
}
function text(id,value,x,y,w,fontSize,color,z,parent="detail",align="left"){
 return {id,x,y,width:w,align,z,parent,runs:[{text:value,font:"inter",fontSize,color}]};
}
function mkTrack(target,property,stops){
 return {target,property,keyframes:stops.map(([frame,value,easing])=>({frame,value,...(easing?{easing}:{})}))};
}
export function createStudioScene(id){
 const C=THEMES[id];if(!C)throw Error("Unknown studio scene "+id);
 const groups=[
  {id:"atmosphere",x:0,y:0,opacity:1},
  {id:"hero",x:C.hero[0],y:C.hero[1],opacity:1,rotation:0,scaleX:1,scaleY:1},
  {id:"accent",x:C.hero[0],y:C.hero[1],opacity:1,rotation:0},
  {id:"heading",x:C.copy[0],y:C.copy[1],opacity:1},
  {id:"detail",x:C.copy[0],y:260,opacity:1},
  {id:"footer",x:0,y:0,opacity:1}
 ];
 const shapes=[],texts=[];const add=s=>shapes.push(s),say=t=>texts.push(t);
 add(rect("canvas",360,230,720,460,GRAD(C.bg,C.dark,-50,-60),0));
 add(oval("ambientLight",C.hero[0],C.hero[1],405,345,GRAD(C.glow,C.dark),1,"atmosphere",{opacity:.43}));
 for(let i=0;i<7;i++)add(line("grid-horizontal-"+i,345,67+56*i,684,67+56*i,C.muted,2,"atmosphere",.48,{opacity:.22}));
 add(line("separation",51,100,668,100,C.muted,11,null,.8,{opacity:.42}));
 add(line("baseline",51,405,668,405,C.muted,11,null,.8,{opacity:.46}));
 add(rect("micro-rule",C.copy[0]+31,129,62,2,SOLID(C.accent),60,"heading",1));
 say(text("eyebrow",C.micro,0,-42,320,12,C.accent,800,"heading"));
 say(text("headline",C.title,0,0,382,C.title.length>=9?51:C.title.length>=7?59:70,C.light,801,"heading"));
 say(text("strapline",C.subtitle,1,92,385,17,C.light,802,"heading"));
 say(text("series","ORIGINAL / MOTION STUDIES",0,7,410,12,C.muted,805,"detail"));
 say(text("descriptor",C.foot,0,35,412,13,C.accent,806,"detail"));
 say(text("footleft","STUDIO FOUNDRY   /   2026",51,419,380,11,C.muted,850,"footer"));
 say(text("footright",String(SCENE_IDS.indexOf(id)+1).padStart(2,"0")+"   /   12",579,419,88,11,C.accent,851,"footer","right"));
 add(oval("ground-shadow",0,161,234,25,SOLID(C.dark),15,"hero",{opacity:.72}));

 // Custom art for each concept; all local to the hero for meaningful independent transformations.
 if(C.kind==="earbuds"){
  add(oval("case-outer",0,53,240,166,GRAD("#BFD4CC","#3A6262",0,140),65,"hero"));
  add(oval("case-inset",0,40,221,143,GRAD("#172C32","#467774"),66,"hero"));
  add(rect("case-hinge",0,-22,178,12,SOLID("#E5E7DB"),67,"hero",6,{opacity:.9}));
  add(oval("case-inner",0,62,188,93,GRAD("#153034","#0C181B"),68,"hero"));
  for(const sign of [-1,1]){
   const p="bud"+(sign<0?"L":"R");
   add(oval(p+"-shadow",sign*64,-9,77,102,SOLID("#163035"),72,"hero",{opacity:.7}));
   add(oval(p+"-shell",sign*64,-19,51,72,GRAD("#F8F4E7","#9FB8B0"),77,"hero"));
   add(oval(p+"-ear",sign*64+sign*8,-42,36,24,SOLID("#F4F1E7"),78,"hero"));
   add(rect(p+"-stem",sign*64,-1,18,100,GRAD("#F9F9EF","#A3BBB5"),79,"hero",9));
   add(oval(p+"-mesh",sign*64,-39,17,10,SOLID("#324B4C"),80,"hero"));
   add(line(p+"-facet",sign*64-5,-27,sign*64-5,37,"#FFFFFF",81,"hero",1.5,{opacity:.6}));
  }
  add(rect("indicator-led",0,120,31,3,SOLID(C.accent),83,"hero",1.5));
 } else if(C.kind==="camera"){
  add(rect("camera-grip",3,4,278,184,GRAD("#313D4C","#0D131D"),52,"hero",25));
  add(rect("leather-inset",4,11,254,164,GRAD("#1B2835","#070B10"),53,"hero",17));
  add(rect("top-plate",-3,-95,185,23,GRAD("#9CA5AD","#293946"),54,"hero",7));
  add(rect("shutter",88,-100,48,16,GRAD("#B7C1C7","#3D5263"),55,"hero",5));
  add(rect("sensor",97,30,49,95,GRAD("#3F505D","#141D27"),56,"hero",9));
  for(let i=0;i<5;i++)add(oval("lens-ring-"+i,-36,2,196-i*24,196-i*24,i%2?GRAD("#172C3B","#67889A"):GRAD("#99ACB8","#24384A"),62+i,"hero"));
  add(oval("glass", -36,2,91,91,GRAD("#386791","#080E23",-40,0),69,"hero"));
  add(oval("aperture",-43,-3,45,45,GRAD("#12233E","#4188A4"),70,"hero"));
  add(oval("lens-reflection",-52,-18,19,25,SOLID("#BCEEF0"),71,"hero",{opacity:.36}));
  for(let i=0;i<24;i++){const a=i*Math.PI/12,rad=92;add(line("iris-tick-"+i,-36+Math.cos(a)*rad,2+Math.sin(a)*rad,-36+Math.cos(a)*(rad+4),2+Math.sin(a)*(rad+4),"#D9E4E6",73,"hero",1.1,{opacity:.65}));}
  add(oval("status",106,-71,8,8,SOLID(C.accent),77,"hero"));
 } else if(C.kind==="planet"){
  add(oval("outer-haze",0,0,318,318,GRAD("#2E65C1","#10194D"),40,"hero",{opacity:.37}));
  add(oval("planet-body",0,0,244,244,GRAD("#F5B981","#3D417E",0,50),50,"hero"));
  add(oval("planet-shadow",36,32,179,192,GRAD("#182459","#14264A",80,60),51,"hero",{opacity:.8}));
  add(oval("planet-cloud", -50,-53,82,47,GRAD("#F8D7A3","#9874A8"),53,"hero",{opacity:.7}));
  add(oval("planet-rim",0,0,267,267,null,57,"hero",{stroke:{color:"#8AC5EF",thickness:1.4},opacity:.75}));
  add(oval("orbit-arc",0,5,355,150,null,63,"accent",{rotation:-22,stroke:{color:C.accent,thickness:4.5,trim:{start:0,end:.91}}}));
  add(oval("orbit-arc-fine",0,7,390,176,null,63,"accent",{rotation:-22,stroke:{color:"#83A9F1",thickness:1.0},opacity:.55}));
  for(let i=0;i<30;i++){const a=i*2.39996,rr=156+((i*29)%92);add(oval("star-"+i,Math.cos(a)*rr,Math.sin(a)*rr,1.6+(i%4),1.6+(i%4),SOLID(i%3?C.light:C.accent),30,"hero",{opacity:.15+(i%5)*.14}));}
 } else if(C.kind==="mascot"){
  add(oval("character-silhouette",0,0,225,235,GRAD("#FFF8E2","#BEA2F5"),60,"hero"));
  add(oval("face-panel",0,4,184,152,GRAD("#ECF6FA","#BACFF0"),63,"hero"));
  add(oval("left-eye",-47,-3,28,43,SOLID("#2E2057"),70,"hero"));
  add(oval("right-eye",47,-3,28,43,SOLID("#2E2057"),70,"hero"));
  add(oval("left-spark",-52,-12,9,15,SOLID("#FFFFFF"),72,"hero"));
  add(oval("right-spark",42,-12,9,15,SOLID("#FFFFFF"),72,"hero"));
  add(oval("left-blush",-73,42,30,14,SOLID("#FC8BBD"),73,"hero",{opacity:.74}));
  add(oval("right-blush",73,42,30,14,SOLID("#FC8BBD"),73,"hero",{opacity:.74}));
  add(poly("smile",[[-25,43],[-10,56],[7,58],[26,41]],null,75,"hero",{closed:false,stroke:{color:"#534276",thickness:5.5,cap:"round",join:"round"}}));
  add(rect("antenna",0,-135,10,40,SOLID("#EBCFF6"),59,"hero",5));
  add(oval("antenna-star",0,-156,27,27,SOLID(C.accent),77,"hero"));
  for(let i=0;i<9;i++){const a=i*Math.PI*2/9;add(oval("confetti-star-"+i,Math.cos(a)*166,Math.sin(a)*138,9+i%3*3,9+i%3*3,SOLID(i%2?C.accent:"#B0EAFF"),44,"accent",{opacity:.8}));}
 } else if(C.kind==="vinyl"){
  add(rect("turntable-deck",0,8,310,260,GRAD("#43323C","#15151B"),40,"hero",22));
  add(oval("disc-base",-31,4,215,215,SOLID("#080A11"),44,"hero"));
  for(let i=0;i<10;i++)add(oval("vinyl-groove-"+i,-31,4,209-i*17,209-i*17,null,50+i,"hero",{stroke:{color:i%3? "#897883":"#E3AE83",thickness:.65},opacity:.5}));
  add(oval("record-label",-31,4,76,76,GRAD("#F8B87D","#A64B66"),63,"hero"));
  add(oval("record-hole",-31,4,10,10,SOLID("#22202A"),65,"hero"));
  add(oval("tonearm-joint",114,-90,27,27,SOLID("#DCC4B1"),67,"hero"));
  add(line("tonearm",114,-90,88,61,"#D9D1C6",71,"hero",6));
  add(poly("needle",[[86,59],[98,65],[98,79],[88,76]],SOLID(C.accent),72,"hero"));
  for(let i=0;i<6;i++)add(rect("meter-"+i,104+i*8,102,4,7+(i%4)*8,SOLID(i%2?C.accent:"#E9D4BC"),74,"accent",2));
 } else if(C.kind==="dashboard"){
  add(rect("dashboard-surface",0,0,339,248,GRAD("#253D50","#071725"),35,"hero",18));
  add(rect("graph-container",-51,-26,210,147,SOLID("#091D2E"),39,"hero",11));
  for(let i=0;i<5;i++)add(line("graph-rule-"+i,-146,-91+i*34,48,-91+i*34,C.muted,41,"hero",.6,{opacity:.24}));
  const vals=[39,46,24,30,-1,10,-36,-48,-64];
  for(let i=0;i<vals.length-1;i++)add(line("graph-slope-"+i,-145+i*23,vals[i],-145+(i+1)*23,vals[i+1],C.accent,58,"hero",2.8));
  for(let i=0;i<8;i++)add(rect("side-bars-"+i,105,-76+i*25,63-(i%3)*11,6,SOLID(i%3===0?C.accent:"#587589"),52,"hero",3));
  add(oval("graph-beacon",41,-64,10,10,SOLID(C.accent),62,"hero"));
  add(rect("bottom-metric",-45,88,217,28,SOLID("#233F50"),52,"hero",7));
  add(rect("status-pill",105,92,61,29,SOLID("#29515B"),54,"hero",14));
  add(oval("status-dot",85,92,8,8,SOLID(C.accent),56,"hero"));
  say(text("metric-copy","+28.6%",-139,81,165,18,C.light,831,"hero"));
 } else if(C.kind==="book"){
  add(rect("book-shadow",20,12,235,295,SOLID("#0E1210"),30,"hero",7,{opacity:.6}));
  add(rect("book-pages",6,2,233,296,GRAD("#EEE4D2","#C6B8A5"),32,"hero",2));
  add(rect("book-spine",-108,2,16,293,GRAD("#6D5644","#201916"),34,"hero",3));
  add(rect("book-cover",0,-1,223,291,GRAD("#44392F","#1C2422"),38,"hero",2));
  add(rect("book-outline",0,-1,198,265,null,39,"hero",0,{stroke:{color:"#D7B38C",thickness:1.2}}));
  add(oval("emboss",0,-8,129,129,null,50,"hero",{stroke:{color:C.accent,thickness:1.8}}));
  add(oval("emboss-inner",0,-8,83,83,null,51,"hero",{stroke:{color:C.accent,thickness:.9},opacity:.8}));
  for(let i=0;i<13;i++){const a=i*Math.PI*2/13;add(line("sunray-"+i,Math.cos(a)*44,Math.sin(a)*44-8,Math.cos(a)*61,Math.sin(a)*61-8,C.accent,53,"hero",1.2))}
  say(text("book-mark","A", -31,-58,65,90,C.light,830,"hero","center"));
  say(text("book-caption","A SERIES OF SMALL WONDERS",-83,96,165,10,C.light,831,"hero","center"));
 } else if(C.kind==="botanical"){
  add(oval("botanical-halo",0,0,330,330,null,34,"hero",{stroke:{color:"#7DC69E",thickness:1.1},opacity:.58}));
  add(line("stem",0,148,0,-90,"#A8C86E",42,"hero",9));
  add(poly("left-leaf",[[-3,51],[-82,-12],[-127,-96],[-45,-81],[5,12]],GRAD("#A7D979","#1F7D5A"),48,"hero"));
  add(poly("right-leaf",[[3,76],[84,16],[116,-73],[42,-55],[0,30]],GRAD("#C2E8B3","#2A8D68"),49,"hero"));
  add(poly("top-leaf",[[-3,-57],[-42,-115],[0,-168],[41,-115],[2,-57]],GRAD("#D4EF9B","#287B51"),50,"hero"));
  add(line("left-vein",-2,51,-92,-62,"#EAF5C6",54,"hero",2,{opacity:.68}));
  add(line("right-vein",2,75,90,-38,"#EAF5C6",54,"hero",2,{opacity:.68}));
  add(line("top-vein",0,-57,0,-147,"#EAF5C6",54,"hero",2,{opacity:.68}));
  for(let i=0;i<9;i++){const a=i*2.1;add(oval("dew-"+i,Math.cos(a)*148,Math.sin(a)*126,4+i%3*3,4+i%3*3,SOLID(C.accent),58,"accent",{opacity:.65}));}
 } else if(C.kind==="prism"){
  add(poly("prism-shadow",[[-120,112],[16,-143],[144,108]],GRAD("#5540A0","#0C1730"),34,"hero"));
  add(poly("prism-face-a",[[-101,100],[11,-132],[18,85]],GRAD("#F0E7FF","#4498D2"),48,"hero",{opacity:.89}));
  add(poly("prism-face-b",[[11,-132],[133,97],[18,85]],GRAD("#7794FB","#642AA1"),50,"hero",{opacity:.9}));
  add(poly("prism-face-c",[[-101,100],[18,85],[133,97]],GRAD("#54D7E9","#F3C5FF"),52,"hero"));
  add(line("beam-entry",-200,5,-102,5,"#E2E4FF",55,"accent",3));
  for(let i=0;i<8;i++)add(line("refraction-"+i,35+i*2,22+i*7,205,-56+i*24,[C.accent,"#F9A5C5","#D6B1FF","#FFF1A3"][i%4],60,"accent",1.5,{opacity:.78}));
  add(oval("focal-core",18,85,17,17,SOLID("#FFFFFF"),70,"hero"));
 } else if(C.kind==="compass"){
  add(oval("compass-shadow",0,0,305,305,GRAD("#6B8D83","#152C30"),39,"hero"));
  add(oval("compass-bezel",0,0,278,278,GRAD("#D3D9C2","#607E76"),48,"hero"));
  add(oval("compass-dial",0,0,251,251,GRAD("#1C4549","#091C25"),50,"hero"));
  for(let i=0;i<48;i++){const a=i*Math.PI/24,inner=i%4===0?103:115,outer=123;add(line("compass-tick-"+i,Math.cos(a)*inner,Math.sin(a)*inner,Math.cos(a)*outer,Math.sin(a)*outer,i%4===0?C.accent:"#85A7A0",55,"hero",i%4===0?2.2:.8));}
  add(poly("north-arrow",[[0,-98],[-19,18],[0,0],[19,18]],GRAD("#F1D7A4","#B76F58"),70,"hero"));
  add(poly("south-arrow",[[0,98],[-19,-18],[0,0],[19,-18]],GRAD("#83B2AE","#1F5860"),69,"hero"));
  add(oval("compass-center",0,0,16,16,SOLID(C.accent),71,"hero"));
  say(text("north-label","N",-15,-145,30,18,C.light,825,"hero","center"));
 } else if(C.kind==="monogram"){
  add(rect("poster-ground",0,0,280,290,GRAD("#7C262E","#31111C"),37,"hero",12));
  add(oval("poster-ring",0,0,234,234,null,45,"hero",{stroke:{color:C.accent,thickness:2},opacity:.8}));
  add(oval("poster-second",0,0,206,206,null,47,"hero",{stroke:{color:"#FFCDC0",thickness:.6},opacity:.45}));
  add(poly("letter-z",[[-75,-91],[78,-91],[78,-59],[-17,62],[78,62],[78,99],[-79,99],[-79,66],[23,-59],[-75,-59]],GRAD("#FFF2E8","#F9A491"),70,"hero"));
  for(let i=0;i<15;i++)add(line("rays-"+i,-167+i*9,-141,60+i*9,147,i%3? "#FF7868":"#FFB59B",21,"accent",.8,{opacity:.17}));
  add(rect("monogram-accent",0,134,74,5,SOLID(C.accent),80,"hero",2));
 } else if(C.kind==="circuit"){
  add(rect("board",0,0,288,272,GRAD("#163E52","#071727"),37,"hero",20));
  add(rect("chip-socket",0,0,194,194,GRAD("#668CA1","#10334A"),44,"hero",11));
  add(rect("processor",0,0,166,166,GRAD("#1F668A","#071C39"),51,"hero",8));
  add(rect("silicon",0,0,124,124,GRAD("#386F9D","#122A58"),54,"hero",5));
  add(oval("chip-core",0,0,75,75,GRAD("#76E4E3","#245886"),64,"hero"));
  add(oval("core-inner",0,0,48,48,GRAD("#C5FAFC","#3F91A5"),67,"hero"));
  for(let i=0;i<14;i++)for(const side of [-1,1]){
   const v=-95+i*14.5;
   add(rect("pin-x-"+i+"-"+side,side*106,v,33,5,SOLID(i%3?C.muted:C.accent),57,"hero",1.5));
   add(rect("pin-y-"+i+"-"+side,v,side*106,5,33,SOLID(i%3?C.muted:C.accent),57,"hero",1.5));
  }
  for(let i=0;i<8;i++){const a=i*Math.PI/4;add(line("trace-"+i,Math.cos(a)*128,Math.sin(a)*128,Math.cos(a)*170,Math.sin(a)*170,C.accent,59,"accent",2.2,{opacity:.7}));}
 }
 // Camera/target can vary by scene, while shared temporal grammar is deliberately restrained.
 const gx=C.hero[0],gy=C.hero[1],tx=C.copy[0],ty=C.copy[1];
 const E="emphasized-decel";
 const tracks=[
  mkTrack("atmosphere","x",[[0,-18,E],[150,0,"ease-out"],[270,0]]),
  mkTrack("hero","x",[[0,gx+75,E],[124,gx-4,"ease-out"],[176,gx],[270,gx]]),
  mkTrack("hero","y",[[0,gy+18,E],[122,gy-3,"ease-out"],[172,gy],[270,gy]]),
  mkTrack("hero","rotation",[[0,-9,E],[140,2,"ease-in-out"],[190,0],[270,0]]),
  mkTrack("hero","scaleX",[[0,.82,E],[137,1.03,"ease-out"],[190,1],[270,1]]),
  mkTrack("hero","scaleY",[[0,.82,E],[137,1.03,"ease-out"],[190,1],[270,1]]),
  mkTrack("hero","opacity",[[0,0],[24,0,E],[115,1],[270,1]]),
  mkTrack("heading","y",[[0,ty+27],[66,ty+27,E],[135,ty],[270,ty]]),
  mkTrack("heading","opacity",[[0,0],[65,0,E],[130,1],[270,1]]),
  mkTrack("detail","y",[[0,285],[141,285,E],[206,260],[270,260]]),
  mkTrack("detail","opacity",[[0,0],[139,0,E],[207,1],[270,1]]),
  mkTrack("accent","rotation",[[0,-30],[75,-30,"ease-in-out"],[224,12],[270,0]]),
  mkTrack("accent","opacity",[[0,0],[65,0,E],[160,1],[270,1]]),
  mkTrack("footer","opacity",[[0,0],[168,0,E],[231,1],[270,1]])
 ];

 // Scene-specific secondary choreography: actual independent part motions, not only a common hero preset.
 switch(C.kind){
  case "earbuds":
   tracks.push(mkTrack("indicator-led","width",[[0,0],[115,0,"emphasized-decel"],[192,31],[270,31]]));
   tracks.push(mkTrack("budL-shell","y",[[0,-44],[35,-44,"emphasized-decel"],[133,-19],[270,-19]]));
   tracks.push(mkTrack("budR-shell","y",[[0,-48],[52,-48,"emphasized-decel"],[153,-19],[270,-19]]));
   break;
  case "camera":
   tracks.push(mkTrack("glass","opacity",[[0,.45],[84,.45,"ease-out"],[160,1],[270,1]]));
   tracks.push(mkTrack("lens-reflection","opacity",[[0,0],[144,0,"ease-out"],[216,.36],[270,.36]]));
   tracks.push(mkTrack("aperture","scaleX",[[0,.75],[60,.75,"ease-out"],[176,1],[270,1]]));
   tracks.push(mkTrack("aperture","scaleY",[[0,.75],[60,.75,"ease-out"],[176,1],[270,1]]));
   break;
  case "planet":
   tracks.push(mkTrack("orbit-arc","trimEnd",[[0,0],[57,0,"emphasized-decel"],[220,.91],[270,.91]]));
   tracks.push(mkTrack("orbit-arc-fine","rotation",[[0,-34],[140,-22,"linear"],[270,-14]]));
   tracks.push(mkTrack("planet-cloud","x",[[0,-64],[170,-50,"ease-out"],[270,-50]]));
   break;
  case "mascot":
   tracks.push(mkTrack("left-eye","scaleY",[[0,1],[202,1,"hold"],[209,.07,"linear"],[218,1],[270,1]]));
   tracks.push(mkTrack("right-eye","scaleY",[[0,1],[202,1,"hold"],[209,.07,"linear"],[218,1],[270,1]]));
   tracks.push(mkTrack("antenna-star","scaleX",[[0,.7],[102,1.1,"ease-out-back"],[170,1],[270,1]]));
   tracks.push(mkTrack("antenna-star","scaleY",[[0,.7],[102,1.1,"ease-out-back"],[170,1],[270,1]]));
   break;
  case "vinyl":
   for(let i=0;i<6;i++)tracks.push(mkTrack("meter-"+i,"height",[[0,2],[130+i*5,7+(i%4)*8,"ease-out"],[195,6+i%3*3],[270,7+(i%4)*8]]));
   tracks.push(mkTrack("needle","opacity",[[0,0],[83,0,"ease-out"],[192,1],[270,1]]));
   break;
  case "dashboard":
   for(let i=0;i<8;i++)tracks.push(mkTrack("side-bars-"+i,"width",[[0,2],[95+i*10,2,"ease-out"],[180+i*8,63-(i%3)*11],[270,63-(i%3)*11]]));
   tracks.push(mkTrack("graph-beacon","opacity",[[0,0],[140,0,"ease-out"],[210,1],[270,1]]));
   break;
  case "book":
   tracks.push(mkTrack("emboss","opacity",[[0,0],[115,0,"ease-out"],[206,1],[270,1]]));
   tracks.push(mkTrack("book-mark","opacity",[[0,0],[151,0,"ease-out"],[234,1],[270,1]]));
   tracks.push(mkTrack("book-spine","scaleX",[[0,.7],[111,.7,"ease-out"],[193,1],[270,1]]));
   break;
  case "botanical":
   tracks.push(mkTrack("left-leaf","rotation",[[0,-14],[108,-14,"ease-out"],[200,3],[270,0]]));
   tracks.push(mkTrack("right-leaf","rotation",[[0,10],[108,10,"ease-out"],[200,-2],[270,0]]));
   tracks.push(mkTrack("top-leaf","scaleY",[[0,.74],[80,.74,"emphasized-decel"],[200,1],[270,1]]));
   break;
  case "prism":
   tracks.push(mkTrack("prism-face-c","opacity",[[0,0],[96,0,"ease-out"],[197,1],[270,1]]));
   for(let i=0;i<8;i++)tracks.push(mkTrack("refraction-"+i,"opacity",[[0,0],[110+i*8,0,"ease-out"],[195+i*6,.78],[270,.78]]));
   break;
  case "compass":
   tracks.push(mkTrack("north-arrow","rotation",[[0,-48],[76,-48,"emphasized-decel"],[205,0],[270,0]]));
   tracks.push(mkTrack("south-arrow","rotation",[[0,-48],[76,-48,"emphasized-decel"],[205,0],[270,0]]));
   tracks.push(mkTrack("compass-center","opacity",[[0,0],[124,0,"ease-out"],[211,1],[270,1]]));
   break;
  case "monogram":
   tracks.push(mkTrack("letter-z","scaleX",[[0,.45],[90,.45,"ease-out-back"],[184,1.07],[225,1],[270,1]]));
   tracks.push(mkTrack("letter-z","scaleY",[[0,.45],[90,.45,"ease-out-back"],[184,1.07],[225,1],[270,1]]));
   tracks.push(mkTrack("poster-ring","opacity",[[0,.1],[128,.1,"ease-out"],[215,.8],[270,.8]]));
   break;
  case "circuit":
   tracks.push(mkTrack("core-inner","scaleX",[[0,.44],[103,.44,"ease-out-back"],[188,1.08],[245,1],[270,1]]));
   tracks.push(mkTrack("core-inner","scaleY",[[0,.44],[103,.44,"ease-out-back"],[188,1.08],[245,1],[270,1]]));
   for(let i=0;i<8;i++)tracks.push(mkTrack("trace-"+i,"opacity",[[0,0],[100+i*7,0,"ease-out"],[205+i*5,.7],[270,.7]]));
   break;
 }
 // Parent existence, render hierarchy and animation lanes remain fully editable.
 return {artboard:{name:"Studio_"+id,width:W,height:H},
  fonts:[{id:"inter",bytes:new Uint8Array(FONT)}],
  groups,shapes,texts,animations:[{name:"Reveal",fps:60,duration:270,loop:"oneShot",tracks}],
  stateMachine:{name:"StudioShowcase",states:[{name:"RevealState",animation:"Reveal"}],
   transitions:[{from:"entry",to:"RevealState"}]}};
}
export function buildStudioScene(id){
 const scene=createStudioScene(id),out=createRiv(scene);
 return {scene,bytes:out.bytes,warnings:out.warnings??[]};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const id=process.argv[2];if(!SCENE_IDS.includes(id))
  throw Error("Usage: node scripts/studio-foundry-scenes.mjs <"+SCENE_IDS.join("|")+"> <out.riv>");
 const out=resolve(process.argv[3]??"test/tmp/studio-foundry/"+id+".riv");
 mkdirSync(dirname(out),{recursive:true});
 const {bytes,scene,warnings}=buildStudioScene(id);
 writeFileSync(out,Buffer.from(bytes));
 console.log(JSON.stringify({id,file:out,bytes:bytes.length,shapes:scene.shapes.length,
  texts:scene.texts.length,groups:scene.groups.length,tracks:scene.animations[0].tracks.length,warnings}));
}