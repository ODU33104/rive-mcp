// SOLSTICE: an original layered editorial watch reveal, authored with the existing Rive writer.
// After npm run build: node scripts/build-motion-atlas-gold.mjs [output.riv] [--preview]
// --preview uses the repo's locally bundled official Rive runtime and Chromium.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRiv } from "../dist/rivWriter.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SETTINGS = join(ROOT, "samples", "motion-atlas-gold", "scene.json");
const PALETTE = JSON.parse(readFileSync(SETTINGS, "utf8"));

const solid = (color) => ({ color });
const gradient = (a, b, x0, y0, x1, y1) => ({
  gradient: { type: "linear", stops: [{ color: a, position: 0 }, { color: b, position: 1 }],
    start: { x: x0, y: y0 }, end: { x: x1, y: y1 } }
});
const shape = (id, type, x, y, width, height, fill, z, more = {}) => ({
  id, type, x, y, width, height, z, ...(fill ? { fill } : {}), ...more
});
const ellipse = (id, x, y, width, height, fill, z, more) =>
  shape(id, "ellipse", x, y, width, height, fill, z, more);
const rect = (id, x, y, width, height, fill, z, more = {}) =>
  shape(id, "rect", x, y, width, height, fill, z, more);
const polygon = (id, points, fill, z, more = {}) =>
  ({ id, type: "polygon", x: 0, y: 0, points, z, ...(fill ? { fill } : {}), ...more });
const stroke = (id, x1, y1, x2, y2, color, thickness, z, more = {}) =>
  polygon(id, [{ x: x1, y: y1 }, { x: x2, y: y2 }], null, z,
    { closed: false, stroke: { color, thickness, cap: "round" }, ...more });
const track = (target, property, frames) => ({
  target, property, keyframes: frames.map(([frame, value, easing]) =>
    ({ frame, value, ...(easing ? { easing } : {}) }))
});
const text = (id, value, x, y, width, size, color, z, parent, align = "left") => ({
  id, x, y, width, align, z, ...(parent ? { parent } : {}),
  runs: [{ text: value, font: "inter", fontSize: size, color }]
});

export function makeGoldScene() {
  const cfg = PALETTE;
  const C = cfg.palette, W = cfg.artboard.width, H = cfg.artboard.height;
  if (cfg.schema !== "motion-atlas-gold/v1" || W < 480 || H < 320)
    throw Error("Invalid motion gold scene config");
  const shapes = [], texts = [];
  const groups = [
    { id: "atmosphere", x: 0, y: 0, opacity: 1 },
    { id: "orbit", x: 517, y: 232, opacity: 1, scaleX: 1, scaleY: 1 },
    { id: "watchShadow", x: 521, y: 414, opacity: 1, scaleX: 1, scaleY: 1 },
    { id: "watch", x: 522, y: 233, opacity: 1, rotation: 0, scaleX: 1, scaleY: 1 },
    { id: "indices", x: 0, y: 0, parent: "watch", opacity: 1 },
    { id: "minuteHand", x: 0, y: 0, parent: "watch", rotation: -20 },
    { id: "hourHand", x: 0, y: 0, parent: "watch", rotation: -95 },
    { id: "dialSignature", x: 0, y: 0, parent: "watch", opacity: 1 },
    { id: "masthead", x: 0, y: 0, opacity: 1 },
    { id: "headlineA", x: 0, y: 0, opacity: 1 },
    { id: "headlineB", x: 0, y: 0, opacity: 1 },
    { id: "caption", x: 0, y: 0, opacity: 1 },
    { id: "footer", x: 0, y: 0, opacity: 1 },
  ];

  // I. Architecture: ink-paper gradient, receding horizontal rules, twilight bloom.
  shapes.push(rect("nightGradient", W/2, H/2, W, H,
    gradient(C.deepBlue, C.shadow, -W/2, -H/2, W/2, H/2), 0));
  shapes.push(ellipse("atmosphericBloom", 501, 240, 610, 500,
    gradient("#253F46", C.midnight, -270, -170, 230, 150), 2,
    { parent: "atmosphere", opacity: 0.43 }));
  shapes.push(ellipse("ambientGlass", 540, 190, 380, 320,
    gradient("#285058", "#10212D", -170, -110, 150, 140), 3,
    { parent: "atmosphere", opacity: 0.35 }));
  // A few measured, subdued registration lines create depth without visual noise.
  for (let i = 0; i < 5; i++) {
    const y = 95 + i * 64;
    shapes.push(stroke("architecturalRule" + i, 350, y, 718, y, C.grid, 0.65, 4 + i,
      { parent: "atmosphere", opacity: i === 2 ? 0.38 : 0.22 }));
  }
  shapes.push(stroke("topEdge", 58, 89, 662, 89, "#426066", 0.9, 8, { opacity: 0.4 }));
  shapes.push(stroke("bottomEdge", 58, 398, 662, 398, "#45636B", 0.8, 8, { opacity: 0.44 }));
  shapes.push(rect("bottomShade", 360, 445, W, 30,
    gradient("#0A1720", C.shadow, 0, -16, 0, 16), 9));

  // II. Spatial optical rings: trim paths, not an arbitrary pop-in.
  shapes.push(ellipse("orbitHalo", 0, 0, 366, 366, null, 17, {
    parent: "orbit", opacity: 0.26, stroke: { color: C.aqua, thickness: 1.1 }
  }));
  shapes.push(ellipse("orbitTrace", 0, 0, 320, 320, null, 19, {
    parent: "orbit", opacity: 0.8,
    stroke: { color: C.champagne, thickness: 1.25, trim: { start: 0, end: 0 } }
  }));
  shapes.push(ellipse("orbitSatellite", 0, 0, 349, 349, null, 20, {
    parent: "orbit", opacity: 0.55,
    stroke: { color: C.goldLight, thickness: 2.6, cap: "round",
      trim: { start: 0, end: 0.052, offset: 0 } }
  }));
  shapes.push(ellipse("groundShadow", 0, 0, 254, 22, solid("#020910"), 24, {
    parent: "watchShadow", opacity: 0.83
  }));
  shapes.push(ellipse("groundPenumbra", 0, 0, 310, 37, solid("#132934"), 23, {
    parent: "watchShadow", opacity: 0.35
  }));

  // III. Original watch illustration: strap, chamfered metal, crown and precision dial.
  // All pieces remain editable vector shapes. The watch is a coherent object, not clip-art.
  const parent = "watch";
  shapes.push(polygon("strapUpper", [
    {x:-61,y:-100},{x:61,y:-100},{x:56,y:-204},{x:41,y:-216},
    {x:-41,y:-216},{x:-56,y:-204}
  ], gradient("#1B3540", "#0B1D29", -65, 0, 65, 0), 50, {parent}));
  shapes.push(polygon("strapLower", [
    {x:-61,y:98},{x:61,y:98},{x:55,y:190},{x:38,y:215},
    {x:-38,y:215},{x:-55,y:190}
  ], gradient("#0B1D29", "#254450", -60, 0, 60, 0), 50, {parent}));
  shapes.push(stroke("strapUpperSeamL", -48, -111, -43, -190, "#67818A", 1, 51, {parent, opacity:0.36}));
  shapes.push(stroke("strapUpperSeamR", 48, -111, 43, -190, "#67818A", 1, 51, {parent, opacity:0.36}));
  shapes.push(stroke("strapLowerSeamL", -49, 112, -43, 193, "#67818A", 1, 51, {parent, opacity:0.36}));
  shapes.push(stroke("strapLowerSeamR", 49, 112, 43, 193, "#67818A", 1, 51, {parent, opacity:0.36}));
  shapes.push(rect("crownNeck", 123, 0, 25, 24, solid(C.goldDark), 58, {parent, cornerRadius:4}));
  shapes.push(rect("crown", 142, 0, 19, 35,
    gradient(C.goldLight, C.goldDark, -8, -14, 8, 14), 59,
    {parent, cornerRadius:6}));
  for (let i = -2; i <= 2; i++) {
    shapes.push(stroke("crownFlute" + (i+2), 149, i*5.5, 152, i*5.5,
      C.goldLight, 1, 60, {parent, opacity:0.67}));
  }
  shapes.push(ellipse("caseDepth", 4, 7, 257, 257, solid("#020A10"), 54, {parent, opacity:0.8}));
  shapes.push(ellipse("caseMetal", 0, 0, 255, 255,
    gradient(C.goldDark, C.goldLight, -125, 70, 125, -90), 61, {parent}));
  shapes.push(ellipse("caseChamfer", 0, 0, 239, 239,
    gradient("#F6E1B7", "#866948", -100, -100, 100, 100), 62, {parent}));
  shapes.push(ellipse("caseGasket", 0, 0, 229, 229, solid("#061018"), 63, {parent}));
  shapes.push(ellipse("dialPlate", 0, 0, 211, 211,
    gradient("#1C3540", "#07141F", -90, -98, 105, 110), 64, {parent}));
  shapes.push(ellipse("dialInnerRing", 0, 0, 186, 186, null, 65, {
    parent, opacity:0.52, stroke: {color:C.champagne,thickness:0.7}
  }));
  shapes.push(ellipse("subDial", 0, 45, 65, 65,
    gradient("#0A141E", "#1F3942", -30, -30, 20, 35), 66, {parent}));
  shapes.push(ellipse("subDialRim", 0, 45, 55, 55, null, 67, {
    parent, opacity:0.7, stroke:{color:C.champagne, thickness:0.8}
  }));
  // Minute indices: shorter between 12 heavier cardinal indices.
  for (let i = 0; i < 60; i++) {
    const theta = i * Math.PI / 30 - Math.PI/2;
    const major = i % 5 === 0, r0 = major ? 77 : 84, r1 = 91;
    const p0 = {x:+(Math.cos(theta)*r0).toFixed(3),y:+(Math.sin(theta)*r0).toFixed(3)};
    const p1 = {x:+(Math.cos(theta)*r1).toFixed(3),y:+(Math.sin(theta)*r1).toFixed(3)};
    shapes.push(stroke("index"+i,p0.x,p0.y,p1.x,p1.y,
      major ? C.goldLight : "#769293", major ? 2.0 : 0.85, 71,
      {parent:"indices",opacity:major?0.96:0.5}));
  }
  // An original sculpted lance pair with small highlight facets.
  shapes.push(polygon("hourNeedle", [
    {x:-4.6,y:9},{x:-3,y:-42},{x:0,y:-52},{x:3,y:-42},{x:4.6,y:9}
  ], solid(C.goldLight), 81, {parent:"hourHand"}));
  shapes.push(polygon("hourNeedleFacet", [
    {x:0,y:-49},{x:0,y:7},{x:3,y:8},{x:2.5,y:-40}
  ], solid(C.goldDark), 82, {parent:"hourHand",opacity:0.75}));
  shapes.push(polygon("minuteNeedle", [
    {x:-3.2,y:14},{x:-2,y:-64},{x:0,y:-77},{x:2,y:-64},{x:3.2,y:14}
  ], solid("#F7E9CC"), 83, {parent:"minuteHand"}));
  shapes.push(stroke("minuteNeedleSpine", 0, -61, 0, 8, C.goldDark, 0.75, 84,
    {parent:"minuteHand",opacity:0.75}));
  shapes.push(ellipse("centerPinOuter", 0, 0, 12, 12, solid(C.goldDark), 85,{parent}));
  shapes.push(ellipse("centerPin", 0, 0, 5, 5, solid(C.goldLight), 86,{parent}));
  shapes.push(stroke("smallSeconds", 0, 66, 10, 34, C.champagne, 1.1, 87,{parent}));
  shapes.push(ellipse("smallSecondsPin", 0, 45, 4, 4, solid(C.champagne), 88,{parent}));

  // IV. Optical glint, engraved branding, editorial text and a restrained ticker.
  shapes.push(ellipse("bezelGlint", 0, 0, 248, 248, null, 89,{
    parent,opacity:0.85,
    stroke:{color:C.porcelain,thickness:2.5,cap:"round",trim:{start:0,end:0.075,offset:0}}
  }));
  texts.push(text("dialLabel",cfg.copy.dial,-81,-54,162,12,C.goldLight,92,"dialSignature","center"));
  texts.push(text("dialFooter",cfg.copy.dialFooter,-70,73,140,8,C.muted,92,"dialSignature","center"));
  texts.push(text("brand",cfg.copy.brand,61,53,308,16,C.goldLight,740,"masthead"));
  texts.push(text("edition",cfg.copy.edition,63,75,300,10,C.muted,740,"masthead"));
  texts.push(text("heroLine1",cfg.copy.heading1,59,149,335,63,C.porcelain,750,"headlineA"));
  texts.push(text("heroLine2",cfg.copy.heading2,62,216,335,43,C.porcelain,751,"headlineB"));
  shapes.push(rect("captionAccent",63,306,0,3,solid(C.champagne),753,
    {parent:"caption",cornerRadius:1}));
  texts.push(text("subheading",cfg.copy.subheading,60,320,353,14,C.goldLight,757,"caption"));
  texts.push(text("features",cfg.copy.details,61,349,353,11,C.muted,759,"caption"));
  texts.push(text("footerLeft",cfg.copy.bottomLeft,61,417,415,11,C.muted,760,"footer"));
  texts.push(text("footerRight",cfg.copy.bottomRight,563,417,112,11,C.goldLight,761,"footer","right"));
  shapes.push(rect("progressTrack",596,390,146,1,solid("#405A5F"),25,{opacity:0.65}));
  shapes.push(rect("progressFill",523,390,0,2,solid(C.champagne),26,{cornerRadius:1}));

  // V. Direction, not random entrance presets: depth arrival -> craftsmanship -> message -> glint -> rest.
  const F = cfg.durationFrames, E = "emphasized-decel";
  const tracks = [
    track("atmosphere","x",[[0,-17,E],[150,0,"ease-out"],[F,0]]),
    track("orbit","scaleX",[[0,0.86,E],[106,1.045,"ease-out"],[168,1,"ease-in-out"],[F,1]]),
    track("orbit","scaleY",[[0,0.86,E],[106,1.045,"ease-out"],[168,1,"ease-in-out"],[F,1]]),
    track("orbit","opacity",[[0,0],[22,0],[85,1,"ease-out"],[F,1]]),
    track("orbitTrace","trimEnd",[[0,0],[32,0,E],[180,1,"ease-in-out"],[F,1]]),
    track("orbitSatellite","trimOffset",[[0,0],[32,0,"linear"],[240,1,"linear"],[F,1]]),
    track("watch","x",[[0,600],[33,600,E],[101,517,"ease-out-back"],[145,522],[F,522]]),
    track("watch","y",[[0,292],[33,292,E],[104,226,"ease-out"],[158,233],[F,233]]),
    track("watch","rotation",[[0,-12],[33,-12,E],[103,3,"ease-in-out"],[165,0],[F,0]]),
    track("watch","scaleX",[[0,0.83],[33,0.83,E],[103,1.028,"ease-out"],[161,1],[F,1]]),
    track("watch","scaleY",[[0,0.83],[33,0.83,E],[103,1.028,"ease-out"],[161,1],[F,1]]),
    track("watch","opacity",[[0,0],[30,0,E],[83,1],[F,1]]),
    track("watchShadow","opacity",[[0,0],[60,0,E],[134,1],[F,1]]),
    track("watchShadow","scaleX",[[0,0.66,E],[138,1],[F,1]]),
    track("indices","opacity",[[0,0],[106,0,E],[166,1],[F,1]]),
    track("dialSignature","opacity",[[0,0],[142,0,E],[183,1],[F,1]]),
    track("hourHand","rotation",[[0,-145],[101,-145,"ease-in-out"],[194,-95],[F,-95]]),
    track("minuteHand","rotation",[[0,-125],[101,-125,"ease-in-out"],[194,-20],[F,-20]]),
    track("bezelGlint","trimOffset",[[0,0],[168,0,"linear"],[242,0.9,"linear"],[F,0.9]]),
    track("masthead","y",[[0,11],[31,11,E],[86,0],[F,0]]),
    track("masthead","opacity",[[0,0],[31,0,E],[82,1],[F,1]]),
    track("headlineA","y",[[0,31],[80,31,E],[133,0],[F,0]]),
    track("headlineA","opacity",[[0,0],[80,0,E],[129,1],[F,1]]),
    track("headlineB","y",[[0,27],[113,27,E],[162,0],[F,0]]),
    track("headlineB","opacity",[[0,0],[113,0,E],[158,1],[F,1]]),
    track("caption","y",[[0,12],[166,12,E],[202,0],[F,0]]),
    track("caption","opacity",[[0,0],[165,0,E],[210,1],[F,1]]),
    track("captionAccent","width",[[0,0],[164,0,E],[210,62],[F,62]]),
    track("footer","opacity",[[0,0],[169,0,E],[218,1],[F,1]]),
    track("progressFill","width",[[0,0],[36,0,"linear"],[238,146,"linear"],[F,146]])
  ];
  const animations = [{name:"Reveal",duration:F,fps:cfg.fps,loop:"oneShot",tracks}];
  return {
    artboard:{...cfg.artboard},
    fonts:[{id:"inter",bytes:new Uint8Array(readFileSync(join(ROOT,"assets","inter.ttf")))}],
    groups, shapes, texts, animations,
    stateMachine:{name:"Showcase",states:[{name:"RevealState",animation:"Reveal"}],
      transitions:[{from:"entry",to:"RevealState"}]}
  };
}

export function buildGold() {
  const scene = makeGoldScene();
  const out = createRiv(scene);
  return {...out, scene, config:PALETTE};
}

async function writePreview(bytes, directory) {
  const [{RiveHost},{PAGE_SCRIPT}] = await Promise.all([
    import("../dist/riveHost.js"), import("../dist/pageScript.js")
  ]);
  const host = new RiveHost(PAGE_SCRIPT);
  try {
    // Official runtime, not a synthetic diagram or guessed visual.
    const info = await host.inspect(Buffer.from(bytes));
    if (!info.artboards.some(a=>a.name===PALETTE.artboard.name))
      throw Error("Official runtime cannot inspect SolsticeChronograph");
    const r = await host.renderFrames(Buffer.from(bytes),{
      animation:"Reveal",startTime:0,frameCount:46,fps:10,width:720,format:"png"
    });
    const positions = [0,7,15,23,33,44], labels = ["00","07","15","23","33","44"];
    for (let i=0; i<positions.length; i++) {
      const buffer=Buffer.from(r.frames[positions[i]],"base64");
      if (buffer.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")
        throw Error("Official runtime did not return PNG frame " + positions[i]);
      writeFileSync(join(directory,"shot-"+labels[i]+".png"),buffer);
    }
    const frames=labels.map((l,i)=>'<figure><img alt="Official Rive frame '+positions[i]/10+'s" src="shot-'+l+'.png"><figcaption>'+
      (positions[i]/10).toFixed(1)+' s</figcaption></figure>').join("");
    const html='<!doctype html><html lang="en"><meta charset="utf-8"><title>SOLSTICE runtime frames</title>'+
      '<style>body{background:#09141d;color:#ead8b7;font:14px system-ui;padding:30px}'+
      'main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;max-width:1300px}'+
      'figure{margin:0}img{width:100%}figcaption{padding:8px}</style>'+
      '<h1>SOLSTICE — official Rive runtime</h1><p>Six frames, Reveal animation, 720px render.</p>'+
      '<main>'+frames+'</main></html>';
    writeFileSync(join(directory,"frame-strip.html"),html);
    console.log("Runtime preview: " + join(directory,"frame-strip.html"));
  } finally { await host.close(); }
}

if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const args=process.argv.slice(2);
  const output=resolve(args.find(a=>!a.startsWith("--"))??"test/tmp/motion-atlas-gold/solstice.riv");
  const {bytes,warnings,scene}=buildGold();
  mkdirSync(dirname(output),{recursive:true});
  writeFileSync(output,Buffer.from(bytes));
  console.log(JSON.stringify({file:output,bytes:bytes.length,artboard:scene.artboard,
    shapes:scene.shapes.length,texts:scene.texts.length,tracks:scene.animations[0].tracks.length,warnings}));
  if (args.includes("--preview")) {
    try { await writePreview(bytes,dirname(output)); }
    catch(e) { console.error("Runtime preview failed (Rive binary was written):",String(e)); process.exitCode=1; }
  }
}
