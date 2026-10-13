// Constructive, deterministic prompt -> typed plan -> newly authored geometry.
// Kept independent of the GOLD/watch scene and recipe catalog. Node >=20.
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createHash} from "node:crypto";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const F=150;
const lex={
  earbuds:/(?:イヤホン|イヤーバッド|earbuds?|earphones?|charging case|充電ケース)/iu,
  instrument:/(?:軌道|計器|天体|オービタル|orbital|instrumentation|instrument panel|radar|oscilloscope)/iu,
  poster:/(?:タイポグラフィ|ポスター|文字組|typograph(?:y|ic)|poster|editorial type)/iu,
  transit:/(?:urban transit|transit (?:diagram|map)|subway map|metro (?:diagram|map)|rail(?:way)? diagram|地下鉄|路線図|鉄道路線|交通路線図)/iu
};
const unsupported=/(?:photorealistic|photo-?real|realistic 3d|3d model|mesh shader|particle simulation|音声|サウンド|効果音|audio|lip.?sync|リアルな3d|写真のよう|画像を貼|動画を埋め)/iu;
const longText=/(?:長文|日本語本文|長い日本語|long japanese text|japanese paragraph)/iu;
const norm=s=>s.normalize("NFKC").toLowerCase().replace(/\s+/gu," ").trim();
const abstain=(reason,capability)=>({status:"ABSTAIN",reason,capability});
function h8(s){return createHash("sha256").update(s).digest("hex").slice(0,8);}
export function planConstructiveScene(prompt){
  if(typeof prompt!=="string"||!prompt.trim())return abstain("empty prompt","parser");
  const p=norm(prompt);
  if(unsupported.test(p))return abstain("unsupported media, photorealism or 3D pipeline","unsupported-medium");
  if(longText.test(p)||/[「"][^」"]{58,}[」"]/.test(p))
    return abstain("long Japanese/glyph-heavy typesetting is not verified with bundled Inter","font-coverage");
  const matches=Object.entries(lex).filter(([,re])=>re.test(p)).map(([key])=>key);
  if(matches.length!==1)return abstain(matches.length?"ambiguous subjects: "+matches.join(","):"unknown subject","subject");
  const domain=matches[0];
  const noBounce=/(?:バウンス(?:なし|禁止|しない)|跳ね(?:ない|させない)|弾ませない|no[ -]?bounce|without bounce|don't bounce|do not bounce)/iu.test(p);
  const noSpin=/(?:回転(?:させない|しない|なし|禁止)|回さない|don't spin|do not spin|no spin|without spinning)/iu.test(p);
  const onlyCase=/(?:ケースだけ|ケースのみ|only (?:the )?(?:earbud|charging )?case|case only)/iu.test(p);
  const onlySeconds=/(?:秒針だけ|秒針のみ|only (?:the )?seconds?(?: hand)?)/iu.test(p);
  if(onlySeconds)return abstain("seconds-hand-only belongs to an analog watch, not these generated domains","semantic-slot");
  if(onlyCase&&domain!=="earbuds")return abstain("case-only requested outside earbuds domain","semantic-slot");
  const stationMatch=p.match(/(\d{1,3})\s*(?:stations?|stops?|駅)/iu);
  const stationCount=stationMatch?Number(stationMatch[1]):6;
  if(domain==="transit"&&(stationCount<4||stationCount>10))
    return abstain("transit graph supports 4..10 stations; requested count cannot be constructed","topology-capacity");
  const layout=/(?:対角|斜め|diagonal|dynamic angle)/iu.test(p)?"diagonal":
    /(?:左右|分割|split|two.column)/iu.test(p)?"split":"center";
  const language=/(?:高級|上質|premium|luxury|polished)/iu.test(p)?"premium":
    /(?:精密|計測|tech|technical|計器)/iu.test(p)?"technical":
    /(?:大胆|bold|強烈)/iu.test(p)?"bold":"minimal";
  const energy=/(?:energetic|high.energy|劇的|大胆な動き|ダイナミック|勢いよく|活発)/iu.test(p)?"high":"low";
  const mode=domain==="earbuds"
    ? (/(?:開く|開いた|開いて|開け|open|floating|浮遊)/iu.test(p)?"open":"closed")
    : domain==="instrument"
      ? (/(?:scan|スキャン|oscilloscope|波形)/iu.test(p)?"scan":"orbital")
      : domain==="poster" ? (/(?:grid|グリッド|整列)/iu.test(p)?"grid":"modular")
      : (/(?:環状|環状線|loop|circular|ring route)/iu.test(p)?"loop":"linear");
  const design={
    domain,layout,language,energy,mode,
    geometry:domain==="earbuds"?{stems:2,caseLid:mode==="open",facets:language==="technical"?5:3}:
      domain==="instrument"?{rings:mode==="scan"?2:4,ticks:mode==="scan"?18:36,beams:energy==="high"?5:3}:
      domain==="poster"?{bands:mode==="grid"?7:5,columns:layout==="split"?2:1,slant:layout==="diagonal"?12:0}:
      {stations:stationCount,edges:mode==="loop"?stationCount:stationCount-1,interchange:layout==="split"},
    material:language==="premium"?"champagne/graphite":language==="bold"?"coral/ink":
      language==="technical"?"cyan/navy":"porcelain/ink",
    motion:{durationFrames:F,fps:60,curve:noBounce?"ease-out":"ease-in-out",
      prohibited:[...(noBounce?["bounce","overshoot"]:[]),...(noSpin?["root.rotation"]:[]),
        ...(onlyCase?["earbud.* motion"]:[])]},
    constraints:{noBounce,noSpin,onlyCase},slug:h8(p),
    camera:{width:domain==="transit"?1200:domain==="instrument"?1024:domain==="poster"?900:1080,
      height:domain==="transit"?746:domain==="instrument"?637:domain==="poster"?560:672},
    components:({
      earbuds:[["earbud.case","hinged-shell","scene:px","caseRig"],["earbud.case-lid","rotating-cover","parent:px","lidRig"],
        ["earbud.body","acoustic-pod","scene:px","budL|budR"],["earbud.stem","stem","parent:px","stemL|stemR"]],
      instrument:[["instrument.root","concentric-dial","scene:px","instrumentRig"],
        ["instrument.needle","rotary-sensor","parent:px","sensorRig"]],
      poster:[["poster.composition","typographic-panel","scene:px","typeBlockRig"],
        ["poster.band","editorial-band","parent:px","bandRig*"]],
      transit:[["transit.network","metro-network","scene:px","networkRig"],
        ["transit.station","station-marker","parent:px","stationRig*"]]
    })[domain].map(([role,geometryTemplate,anchorUnits,rigIds])=>({
      role,geometryTemplate,anchorUnits,rigIds,coordinates:"explicit",
      fillTypes:["solid","linear-gradient"],fxCompatible:["opacity"],sourceId:"original:procedural-v3",
      editable:true,allowedTracks:["x","y","opacity","rotation"]})),
    sourceManifest:{geometry:{id:"original:procedural-v3",kind:"original-parametric",externalMedia:false},
      font:{id:"repo:assets/inter.ttf",license:"SIL-OFL-1.1",textCoverage:"Latin, not verified for Japanese long copy"}},
    editorial:{copyLanguage:"en",font:"Inter",hierarchy:["eyebrow","headline","subline"],longJapanese:"ABSTAIN"}
  };
  return {status:"PLANNED",schema:"constructive-scene-plan/v1",originalPrompt:prompt,
    languageDetected:/[\u3040-\u30ff\u3400-\u9fff]/u.test(prompt)?"ja":"en",
    design,capability:"three-domain vector authoring; no arbitrary objects or glyph guarantees"};
}
const solid=color=>({color});
const grad=(a,b,x0=-100,y0=-80,x1=120,y1=110)=>({gradient:{type:"linear",
  stops:[{color:a,position:0},{color:b,position:1}],start:{x:x0,y:y0},end:{x:x1,y:y1}}});
function builder(plan){
  const d=plan.design;
  const palettes={
    premium:["#07131D","#D9BE8B","#F6E6CB","#69888A","#102734"],
    technical:["#061521","#47D5CF","#D7F6F0","#456D86","#0B2D3B"],
    minimal:["#111B27","#B4D3DA","#F1F2E8","#7594A0","#1F3340"],
    bold:["#161427","#FF7B67","#FFEAD7","#8758A2","#362A49"]
  };
  const [ink,accent,light,muted,surface]=palettes[d.language];
  const scene={artboard:{name:"Constructive_"+d.domain+"_"+d.slug,width:900,height:560,backgroundColor:ink},
    fonts:[],groups:[],shapes:[],texts:[],animations:[],stateMachine:null};
  const slots=[];
  let z=0;
  const group=(id,x,y,parent)=>{scene.groups.push({id,x,y,opacity:1,scaleX:1,scaleY:1,
    ...(parent?{parent}:{})});return id;};
  const shape=(id,type,x,y,w,h,fill,parent,extra={})=>{
    scene.shapes.push({id,type,x,y,width:w,height:h,z:++z,sourceId:"original:procedural-v3",...(fill?{fill}:{}),
      ...(parent?{parent}:{}),...extra});
  };
  const rect=(id,x,y,w,h,fill,parent,extra)=>shape(id,"rect",x,y,w,h,fill,parent,extra);
  const ell=(id,x,y,w,h,fill,parent,extra)=>shape(id,"ellipse",x,y,w,h,fill,parent,extra);
  const polygon=(id,pts,fill,parent,extra={})=>{
    shape(id,"polygon",0,0,0,0,fill,parent,{points:pts,...extra});};
  const line=(id,a,b,color,thick,parent,opacity=1)=>polygon(id,[a,b],null,parent,
    {closed:false,stroke:{color,thickness:thick,cap:"round"},opacity});
  const slot=(role,id,parent,anchor,members)=>{
    slots.push({type:"rig-slot/v1",role,rigId:id,parentId:parent??null,
      anchor:{...anchor},members:[...members]});};
  const text=(id,s,x,y,size,color,width=360,align="left",parent=null)=>{
    scene.texts.push({id,x,y,width,z:800+scene.texts.length,align,
      ...(parent?{parent}:{}),
      runs:[{text:s,font:"inter",fontSize:size,color}]});};
  rect("canvas",450,280,900,560,solid(ink),null);
  ell("ambient",600,270,620,430,grad(surface,ink,-220,-100,240,150),null,{opacity:0.92});
  for(let i=0;i<5;i++)line("rule"+i,{x:52,y:110+i*83},{x:844,y:110+i*83},muted,.65,null,.17);
  line("topRule",{x:54,y:64},{x:844,y:64},accent,1,null,.64);
  text("eyebrow",d.domain==="earbuds"?"ACOUSTIC / OBJECT":d.domain==="instrument"?
    "MEASUREMENT / SYSTEM":d.domain==="transit"?"URBAN / SYSTEMS":"EDITORIAL / TYPE",56,48,14,accent);
  text("headline",d.domain==="earbuds"?"SOUND\nIN FORM":d.domain==="instrument"?
    "ORBITAL\nSTUDIES":d.domain==="transit"?"CITY\nIN LINES":"TYPE\nIN MOTION",55,192,53,light,380);
  text("subline",d.domain==="earbuds"?"CONSTRUCTED HARDWARE":d.domain==="instrument"?
    "DYNAMIC READOUT":d.domain==="transit"?"CONNECTED DESTINATIONS":"COMPOSITIONAL SERIES",57,325,14,accent);
  text("issue","EDITION  /  "+d.slug.toUpperCase(),57,502,12,muted);
  const track=(id,prop,keyframes)=>({target:id,property:prop,keyframes:
    keyframes.map(([frame,value,easing])=>({frame,value,...(easing?{easing}:{})}))});
  const tracks=[],ease=d.motion.curve;
  const enter=(rig,fromY=30,delay=0)=>{const g=scene.groups.find(x=>x.id===rig);
    tracks.push(track(rig,"y",[[0,g.y+fromY],[delay+20,g.y+fromY],[delay+103,g.y,ease],[F,g.y]]));
    tracks.push(track(rig,"opacity",[[0,0],[delay+20,0],[delay+95,1,"ease-out"],[F,1]]));};
  if(d.domain==="earbuds"){
    const px=d.layout==="diagonal"?610:598,py=d.layout==="split"?337:352;
    group("caseRig",px,py);
    ell("caseShadow",0,116,312,39,solid("#020810"),"caseRig",{opacity:.7});
    rect("caseBody",0,4,280,168,grad("#334B55","#071821"),"caseRig",{cornerRadius:75});
    rect("caseSeam",0,-37,263,55,grad(accent,"#51606B"),"caseRig",{cornerRadius:26,opacity:.75});
    rect("caseShell",0,24,263,116,grad(d.language==="premium"?"#E8D8BD":"#66969F",surface,-140,-20,100,70),
      "caseRig",{cornerRadius:57});
    rect("caseInner",0,-7,247,29,solid("#10202B"),"caseRig",{cornerRadius:14});
    ell("caseStatus",0,67,5,5,solid(accent),"caseRig");
    group("lidRig",0,-70,"caseRig");
    rect("lidBack",0,-23,279,75,grad("#E9DAC0","#62777B"),"lidRig",{cornerRadius:37});
    rect("lidInset",0,-14,252,51,grad("#233643","#091A25"),"lidRig",{cornerRadius:25,opacity:.9});
    slot("earbud.case","caseRig",null,{x:px,y:py},["caseBody","caseShell","caseStatus"]);
    slot("earbud.case-lid","lidRig","caseRig",{x:0,y:-70},["lidBack","lidInset"]);
    const side=d.layout==="diagonal"?12:0;
    for(const [i,x,y] of [["L",-85,-126-side],["R",84,-126+side]]){
      const id="bud"+i,stem="stem"+i;
      group(id,x+px,y+py);
      ell(id+"headShadow",0,-30,74,75,solid("#091B26"),id);
      ell(id+"head",0,-37,64,69,grad("#E5E9E0","#748B91"),id);
      ell(id+"speaker",-13,-48,22,31,solid("#182632"),id,{rotation:-18});
      group(stem,13,0,id);
      rect(id+"stem",0,23,17,71,grad("#C4D9D5","#5D7F88"),stem,{cornerRadius:9});
      ell(id+"tip",0,58,16,10,solid(accent),stem);
      line(id+"highlight",{x:10,y:1},{x:10,y:46},light,1.4,stem,.8);
      slot("earbud.stem",stem,id,{x:13,y:0},[id+"stem",id+"tip"]);
      slot("earbud.body",id,null,{x:x+px,y:y+py},[id+"head",id+"speaker"]);
    }
    enter("caseRig",d.energy==="high"?90:36);
    if(!d.constraints.onlyCase){
      enter("budL",d.energy==="high"?-92:-42,14);
      enter("budR",d.energy==="high"?-102:-44,26);
    }
    if(d.mode==="open"&&!d.constraints.onlyCase&&!d.constraints.noSpin)
      tracks.push(track("lidRig","rotation",[[0,-9],[84,-9],[135,-23,ease],[F,-23]]));
    if(d.mode==="open"&&d.constraints.onlyCase&&!d.constraints.noSpin)
      tracks.push(track("lidRig","rotation",[[0,-9],[84,-9],[135,-23,ease],[F,-23]]));
    if(d.geometry.facets===5){
      for(let i=-2;i<=2;i++)line("caseMachining"+(i+2),
        {x:-92+i*18,y:61},{x:-87+i*18,y:65},light,.7,"caseRig",.5);
    }
  }else if(d.domain==="instrument"){
    const cx=d.layout==="diagonal"?623:605,cy=284;
    group("instrumentRig",cx,cy);
    ell("outerWell",0,0,374,374,grad(surface,ink),"instrumentRig");
    ell("bezel",0,0,349,349,null,"instrumentRig",
      {stroke:{color:accent,thickness:5},opacity:.95});
    ell("innerWell",0,0,318,318,grad("#143741","#04111D"),"instrumentRig");
    for(let k=0;k<d.geometry.rings;k++)ell("ring"+k,0,0,282-40*k,282-40*k,null,
      "instrumentRig",{stroke:{color:k%2?muted:accent,thickness:k===0?1.8:1},
        opacity:k===0?.85:.4});
    for(let i=0;i<d.geometry.ticks;i++){
      const a=i*2*Math.PI/d.geometry.ticks,outer=161,inner=i%3===0?146:154;
      line("tick"+i,{x:Math.cos(a)*inner,y:Math.sin(a)*inner},
        {x:Math.cos(a)*outer,y:Math.sin(a)*outer},accent,i%3===0?2:1,"instrumentRig",.75);
    }
    group("sensorRig",18,-4,"instrumentRig");
    line("sensorNeedle",{x:-115,y:0},{x:105,y:0},light,2.6,"sensorRig");
    ell("sensorHub",0,0,15,15,solid(accent),"sensorRig");
    ell("sensorCore",0,0,5,5,solid(ink),"sensorRig");
    if(d.mode==="scan"){
      for(let i=0;i<d.geometry.beams;i++){
        const pts=Array.from({length:9},(_,j)=>({
          x:-110+j*28,y:Math.sin((j+i*.6)*1.4)*((i+1)*10)
        }));
        polygon("wave"+i,pts,null,"instrumentRig",
          {closed:false,stroke:{color:i%2?muted:accent,thickness:1.4},opacity:.65});
      }
    }else{
      for(let i=0;i<d.geometry.beams;i++){
        const a=i*Math.PI*2/d.geometry.beams;
        ell("orbitDot"+i,Math.cos(a)*126,Math.sin(a)*126,8+i*2,8+i*2,
          solid(i%2?light:accent),"instrumentRig");
      }
    }
    slot("instrument.root","instrumentRig",null,{x:cx,y:cy},
      ["outerWell","bezel","innerWell"]);
    slot("instrument.needle","sensorRig","instrumentRig",{x:18,y:-4},
      ["sensorNeedle","sensorHub"]);
    enter("instrumentRig",d.energy==="high"?73:30);
    if(!d.constraints.noSpin)tracks.push(track("sensorRig","rotation",
      [[0,-42],[28,-42],[124,d.energy==="high"?160:34,ease],[F,d.energy==="high"?160:34]]));
    else tracks.push(track("sensorRig","opacity",[[0,.25],[55,.25],[133,1,"ease-out"],[F,1]]));
  }else if(d.domain==="transit"){
    const cx=d.layout==="diagonal"?626:605,cy=290;
    group("networkRig",cx,cy);
    rect("mapPlate",0,0,372,382,grad(surface,ink),"networkRig",{cornerRadius:17});
    rect("mapFrame",0,0,357,367,null,"networkRig",
      {stroke:{color:accent,thickness:1},opacity:.6,cornerRadius:12});
    const n=d.geometry.stations;
    const pts=Array.from({length:n},(_,i)=>{
      if(d.mode==="loop"){
        const a=(i/n)*Math.PI*2-Math.PI/2;
        return {x:Math.cos(a)*125,y:Math.sin(a)*139};
      }
      const x=-145+290*i/(n-1),y=(i%2===0?-56:56)+(d.layout==="diagonal"?x*.20:0);
      return {x,y};
    });
    for(let i=0;i<(d.mode==="loop"?n:n-1);i++){
      const a=pts[i],b=pts[(i+1)%n];
      line("routeHalo"+i,a,b,muted,12,"networkRig",.36);
      line("routeLine"+i,a,b,accent,5,"networkRig",.95);
    }
    for(let i=0;i<n;i++){
      const pt=pts[i],id="stationRig"+i;
      group(id,pt.x,pt.y,"networkRig");
      ell("stationOuter"+i,0,0,i===0||i===n-1?25:18,i===0||i===n-1?25:18,
        solid(light),id);
      ell("stationCore"+i,0,0,9,9,solid(i===0?ink:accent),id);
      if(i===Math.floor(n/2)&&d.geometry.interchange)
        ell("transferRing"+i,0,0,35,35,null,id,{stroke:{color:accent,thickness:2}});
      text("stationLabel"+i,"S"+String(i+1).padStart(2,"0"),-12,17,11,light,36,"left",id);
      slot("transit.station",id,"networkRig",{x:pt.x,y:pt.y},["stationOuter"+i,"stationCore"+i]);
      tracks.push(track(id,"opacity",[[0,0],[i*8,0],[Math.min(F,i*8+35),1,"ease-out"],[F,1]]));
    }
    slot("transit.network","networkRig",null,{x:cx,y:cy},["mapPlate","mapFrame"]);
    enter("networkRig",d.energy==="high"?75:30);
    text("networkFooter",d.mode==="loop"?"CIRCULAR / NETWORK":"LINEAR / NETWORK",
      -144,159,12,accent,288,"left","networkRig");
  }else{
    const cx=d.layout==="diagonal"?628:593,cy=287;
    group("typeBlockRig",cx,cy);
    rect("posterPanel",0,0,339,396,grad(surface,ink),"typeBlockRig",{cornerRadius:12});
    rect("posterFrame",0,0,325,383,null,"typeBlockRig",
      {stroke:{color:accent,thickness:1},opacity:.66});
    const n=d.geometry.bands;
    for(let i=0;i<n;i++){
      const dy=-145+i*(d.mode==="grid"?32:42);
      group("bandRig"+i,0,dy,"typeBlockRig");
      const w=(d.mode==="grid"?255:276)-(i%3)*34;
      const x=d.layout==="diagonal"?(i%2?23:-23):0;
      if(d.mode==="modular"){
        polygon("band"+i,[{x:x-w/2,y:-17},{x:x+w/2,y:-17},
          {x:x+w/2+d.geometry.slant,y:17},{x:x-w/2+d.geometry.slant,y:17}],
          solid(i%2?accent:light),"bandRig"+i);
      }else{
        rect("band"+i,x,0,w,24,solid(i%2?accent:light),"bandRig"+i,{cornerRadius:2});
        rect("mark"+i,x+w/2+9,0,6,24,solid(muted),"bandRig"+i);
      }
      slot("poster.band","bandRig"+i,"typeBlockRig",{x:0,y:dy},
        ["band"+i]);
      tracks.push(track("bandRig"+i,"x",[[0,d.energy==="high"?(i%2?125:-125):-62],
        [i*8, d.energy==="high"?(i%2?125:-125):-62],
        [92+i*6,0,ease],[F,0]]));
    }
    // Editable typographic hierarchy inside the poster, not only decorative bars.
    rect("posterDivider",0,71,278,1,solid(accent),"typeBlockRig",{opacity:.7});
    text("posterTitle",d.mode==="grid"?"GRID":"SHIFT",-133,89,58,light,268,"left","typeBlockRig");
    text("posterMeta",d.mode==="grid"?"SYSTEM / 07":"MODULAR / 05",-129,157,12,accent,220,"left","typeBlockRig");
    ell("posterDisc",130,153,30,30,solid(accent),"typeBlockRig");
    slot("poster.composition","typeBlockRig",null,{x:cx,y:cy},
      ["posterPanel","posterDisc"]);
    enter("typeBlockRig",d.energy==="high"?54:22);
  }
  scene.fonts=[{id:"inter",bytes:new Uint8Array(readFileSync(join(ROOT,"assets","inter.ttf")))}];
  scene.animations=[{name:"Reveal",duration:F,fps:60,loop:"oneShot",tracks}];
  scene.stateMachine={name:"Playback",states:[{name:"RevealState",animation:"Reveal"}],
    transitions:[{from:"entry",to:"RevealState"}]};
  return {scene,slots};
}
function mult(a,b){return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],
  a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],
  a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
function local(g){const a=(g.rotation??0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  return [c*(g.scaleX??1),s*(g.scaleX??1),-s*(g.scaleY??1),c*(g.scaleY??1),g.x,g.y];}
function world(id,nodes,seen=new Set()){
  if(!id)return [1,0,0,1,0,0];
  if(seen.has(id))throw Error("cycle: "+id);
  const g=nodes.get(id);if(!g)throw Error("missing parent "+id);
  seen.add(id);const m=mult(world(g.parent,nodes,seen),local(g));
  seen.delete(id);return m;
}
const pos=(m,x=0,y=0)=>({x:m[0]*x+m[2]*y+m[4],y:m[1]*x+m[3]*y+m[5]});
export function validateConstructiveSlots(scene,slots){
  const all=[...scene.groups,...scene.shapes,...scene.texts];
  const ids=all.map(n=>n.id),unique=new Set(ids);
  if(unique.size!==ids.length)throw Error("duplicate scene node IDs");
  const nodes=new Map(all.map(n=>[n.id,n]));
  const results=[];
  for(const slot of slots){
    const g=nodes.get(slot.rigId);
    if(!g||!scene.groups.includes(g)||g.parent!==slot.parentId && !(slot.parentId===null&&!g.parent))
      throw Error("semantic rig missing/parent mismatch: "+slot.rigId);
    if(!Number.isFinite(slot.anchor.x)||!Number.isFinite(slot.anchor.y))
      throw Error("non-finite anchor");
    const M=world(slot.rigId,nodes);
    const E=pos(world(slot.parentId,nodes),slot.anchor.x,slot.anchor.y);
    const A=pos(M);
    const dist=Math.hypot(A.x-E.x,A.y-E.y);
    if(dist>1e-6)throw Error("slot pivot shifted: "+slot.rigId+" ("+dist+")");
    for(const member of slot.members){
      let n=nodes.get(member),found=false;const seen=new Set();
      while(n?.parent){if(seen.has(n.id))throw Error("member ancestry cycle");
        seen.add(n.id);if(n.parent===slot.rigId){found=true;break;}
        n=nodes.get(n.parent);}
      if(!found)throw Error("missing semantic member "+member+" of "+slot.rigId);
    }
    results.push({role:slot.role,rig:slot.rigId,pivotWorld:A,
      localAnchor:slot.anchor,memberCount:slot.members.length});
  }
  return results;
}
export function makeConstructiveScene(plan){
  if(plan?.status!=="PLANNED"||plan.schema!=="constructive-scene-plan/v1")
    throw Error("only validated plans may be constructed");
  const {scene,slots}=builder(plan);
  const verifiedSlots=validateConstructiveSlots(scene,slots);
  const tracks=scene.animations[0].tracks;
  if(tracks.some(t=>!scene.groups.some(g=>g.id===t.target)))
    throw Error("non-rig animation target");
  if(plan.design.constraints.noSpin&&tracks.some(t=>t.property==="rotation"))
    throw Error("no-spin prohibition violated");
  if(plan.design.constraints.onlyCase&&tracks.some(t=>!["caseRig","lidRig"].includes(t.target)))
    throw Error("only-case prohibition violated");
  if(plan.design.constraints.noBounce&&tracks.some(t=>t.keyframes.some(
    k=>/back|elastic|bounce/iu.test(k.easing??""))))
    throw Error("no-bounce prohibition violated");
  return {scene,slots,verifiedSlots};
}
export async function writeConstructiveScene(prompt,out,{render=false}={}){
  const plan=planConstructiveScene(prompt);
  if(plan.status!=="PLANNED")return {plan,output:null};
  const {scene,slots,verifiedSlots}=makeConstructiveScene(plan);
  const {createRiv}=await import("../dist/rivWriter.js");
  const encoded=createRiv(scene),bytes=Buffer.from(encoded.bytes);
  if(bytes.subarray(0,4).toString()!=="RIVE")throw Error("writer did not emit RIVE");
  mkdirSync(dirname(resolve(out)),{recursive:true});
  writeFileSync(out,bytes);
  const evidence={plan,sceneHash:createHash("sha256").update(JSON.stringify(
    {...scene,fonts:scene.fonts.map(f=>({id:f.id,bytes:"bundled Inter"}))})).digest("hex"),
    riveSha256:createHash("sha256").update(bytes).digest("hex"),
    slots,verifiedSlots,shapeCount:scene.shapes.length,
    animationTargets:[...new Set(scene.animations[0].tracks.map(t=>t.target))],
    warnings:encoded.warnings,renderStatus:"NOT_RENDERED",
    visualQuality:"NOT_EVALUATED",blindedAesthetics:"NOT_EVALUATED",
    camera:plan.design.camera,sourceManifest:plan.design.sourceManifest};
  if(render){
    const [{RiveHost},{PAGE_SCRIPT}]=await Promise.all([
      import("../dist/riveHost.js"),import("../dist/pageScript.js")]);
    const host=new RiveHost(PAGE_SCRIPT);
    try{
      const info=await host.inspect(bytes);
      if(!info.artboards.some(a=>a.name===scene.artboard.name&&a.animations.some(
        x=>x.name==="Reveal")))throw Error("official Rive runtime cannot inspect generated scene");
      const rendered=await host.renderFrames(bytes,
        {animation:"Reveal",startTime:0,frameCount:31,fps:12,
          width:plan.design.camera.width,height:plan.design.camera.height,format:"png"});
      if(rendered.frames.length!==31)throw Error("missing official runtime frames");
      const folder=dirname(resolve(out));
      for(let i=0;i<25;i++){
        const b=Buffer.from(rendered.frames[i],"base64");
        if(b.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")
          throw Error("invalid PNG frame "+i);
        writeFileSync(join(folder,"frame-"+String(i).padStart(3,"0")+".png"),b);
      }
      writeFileSync(join(folder,"poster.png"),Buffer.from(rendered.frames.at(-1),"base64"));
      evidence.renderStatus="OFFICIAL_RIVE_RUNTIME_PNG";
    }catch(e){evidence.renderStatus="FAILED: "+String(e);throw e;}
    finally{await host.close();writeFileSync(out+".evidence.json",JSON.stringify(evidence,null,2)+"\n");}
  }else writeFileSync(out+".evidence.json",JSON.stringify(evidence,null,2)+"\n");
  return {plan,output:resolve(out),evidence};
}
async function cli(args){
  const outflag=args.indexOf("--out"),directory=resolve(outflag<0?
    "test/tmp/constructive-scene":args[outflag+1]);
  const batch=args.indexOf("--batch"),render=args.includes("--render");
  const positional=args.filter((a,i)=>!a.startsWith("--")&&
    !(outflag>=0&&i===outflag+1)&&!(batch>=0&&i===batch+1));
  const items=batch>=0?JSON.parse(readFileSync(resolve(args[batch+1]),"utf8")):
    [{id:"single",prompt:positional.join(" ")}];
  let failures=0;
  for(const item of items){
    try{
      if(!/^[a-z][a-z0-9-]{0,40}$/i.test(item.id))throw Error("unsafe fixture ID");
      const dir=join(directory,item.id),result=await writeConstructiveScene(item.prompt,
        join(dir,item.id+".riv"),{render});
      if(result.plan.status!=="PLANNED"){failures++;mkdirSync(dir,{recursive:true});
        writeFileSync(join(dir,"abstention.json"),JSON.stringify(result.plan,null,2));}
      console.log(JSON.stringify({id:item.id,status:result.plan.status,
        file:result.output,reason:result.plan.reason??null}));
    }catch(error){failures++;console.error(item.id+" FAILED "+String(error));}
  }
  if(failures)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  await cli(process.argv.slice(2));
