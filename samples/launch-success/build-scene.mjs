// ショーケース: "Launch Success" — tokens + SVG import + presets + trim + SM
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const S = dirname(fileURLToPath(import.meta.url));
const R = join(S, "..", "..");
const [{ createRiv }, { generateTokens }, { importSvg }, { RiveHost }, { PAGE_SCRIPT }, { encodeApng }, { encodeGif }, { computeMetrics }] =
  await Promise.all([
    import(R + "/dist/rivWriter.js"), import(R + "/dist/designTokens.js"), import(R + "/dist/svgImport.js"),
    import(R + "/dist/riveHost.js"), import(R + "/dist/pageScript.js"), import(R + "/dist/apng.js"),
    import(R + "/dist/gif.js"), import(R + "/dist/critique.js"),
  ]);

const T = generateTokens({ mood: "tech", scheme: "dark" });
const P = T.palette;

// --- プロ品質のロケットSVG（ベジェ曲線・グラデ・複数パーツ。flameは別id） ---
const rocketSvg = `<svg viewBox="0 0 120 200" xmlns="http://www.w3.org/2000/svg">
<defs>
 <linearGradient id="body" x1="0" y1="0" x2="1" y2="0">
   <stop offset="0" stop-color="#e8eef4"/><stop offset="0.55" stop-color="#c3cdd8"/><stop offset="1" stop-color="#94a1b0"/>
 </linearGradient>
 <linearGradient id="nose" x1="0" y1="0" x2="1" y2="0.4">
   <stop offset="0" stop-color="${T.gradients.accent[0]}"/><stop offset="1" stop-color="${T.gradients.accent[1]}"/>
 </linearGradient>
 <linearGradient id="fin" x1="0" y1="0" x2="1" y2="1">
   <stop offset="0" stop-color="${T.gradients.primary[0]}"/><stop offset="1" stop-color="${T.gradients.primary[1]}"/>
 </linearGradient>
 <radialGradient id="glass" cx="0.35" cy="0.35" r="0.9">
   <stop offset="0" stop-color="#bfeaff"/><stop offset="1" stop-color="#2a6d94"/>
 </radialGradient>
</defs>
<path id="finL" d="M38 128 C24 138 18 156 16 174 C28 166 40 160 46 150 Z" fill="url(#fin)"/>
<path id="finR" d="M82 128 C96 138 102 156 104 174 C92 166 80 160 74 150 Z" fill="url(#fin)"/>
<path id="hull" d="M60 8 C78 30 88 62 88 96 C88 122 80 142 60 152 C40 142 32 122 32 96 C32 62 42 30 60 8 Z" fill="url(#body)"/>
<path id="noseCone" d="M60 8 C69 19 75 31 79 45 C67 39 53 39 41 45 C45 31 51 19 60 8 Z" fill="url(#nose)"/>
<circle id="winRim" cx="60" cy="82" r="17" fill="#7c8894"/>
<circle id="winGlass" cx="60" cy="82" r="12.5" fill="url(#glass)"/>
<path id="belt" d="M40 118 C53 124 67 124 80 118 L80 126 C67 132 53 132 40 126 Z" fill="#7c8894"/>
</svg>`;

const flameSvg = `<svg viewBox="0 0 60 90" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="fl" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#ffd76b"/><stop offset="0.45" stop-color="#ff9b3d"/><stop offset="1" stop-color="#f4512c"/>
</linearGradient>
<linearGradient id="flIn" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#fff6d8"/><stop offset="1" stop-color="#ffc255"/>
</linearGradient></defs>
<path id="flameOuter" d="M30 2 C44 18 52 38 50 56 C48 72 40 84 30 88 C20 84 12 72 10 56 C8 38 16 18 30 2 Z" fill="url(#fl)"/>
<path id="flameInner" d="M30 26 C37 36 41 48 40 58 C39 68 35 76 30 79 C25 76 21 68 20 58 C19 48 23 36 30 26 Z" fill="url(#flIn)"/>
</svg>`;

const rocket = importSvg(rocketSvg, { idPrefix: "rk_" });
const flame = importSvg(flameSvg, { idPrefix: "fl_" });
console.log("rocket warnings:", rocket.warnings.join(";") || "none", "| flame:", flame.warnings.join(";") || "none");

const W = 480, H = 360;
const rand = (seed => () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; })(7);
const stars = Array.from({ length: 9 }, (_, i) => ({
  id: `star${i}`, type: "ellipse",
  x: 24 + rand() * (W - 48), y: 20 + rand() * (H * 0.62),
  width: 2.5 + rand() * 3.5, height: 2.5 + rand() * 3.5,
  opacity: 0.35 + rand() * 0.45, fill: { color: i % 3 === 2 ? P.accentSoft : P.textMuted }, z: 2 + i,
}));

const scene = {
  artboard: { name: "LaunchSuccess", width: W, height: H },
  fonts: [{ id: "inter", bytes: new Uint8Array(readFileSync(R + "/assets/inter.ttf")) }],
  groups: [
    { id: "rocketG", x: W * 0.42, y: H * 0.50 },
    { id: "flameG", x: 0, y: 82, parent: "rocketG" },
    { id: "badgeG", x: W * 0.78, y: H * 0.30 },
  ],
  shapes: [
    // 背景（最背面）
    { id: "sky", type: "rect", x: W / 2, y: H / 2, width: W, height: H, z: 0,
      fill: { gradient: { type: "linear", stops: [
        { color: T.gradients.bg[0], position: 0 }, { color: T.gradients.bg[1], position: 1 } ],
        start: { x: 0, y: -H / 2 }, end: { x: 0, y: H / 2 } } } },
    // 月(地平の淡い円) — 奥行き
    { id: "planet", type: "ellipse", x: W / 2, y: H + 118, width: W * 1.7, height: 320, z: 1,
      fill: { gradient: { type: "linear", stops: [
        { color: P.primarySoft, position: 0 }, { color: T.gradients.bg[1], position: 1 } ],
        start: { x: 0, y: -160 }, end: { x: 0, y: 40 } } }, opacity: 0.55 },
    ...stars,
    // 成功バッジ: 円 + draw-on チェック
    { id: "badgeRing", type: "ellipse", x: 0, y: 0, parent: "badgeG", width: 64, height: 64, z: 500,
      stroke: { color: P.accent, thickness: 5 } },
    { id: "badgeFill", type: "ellipse", x: 0, y: 0, parent: "badgeG", width: 54, height: 54, z: 499,
      opacity: 0.18, fill: { color: P.accent } },
    { id: "tick", type: "polygon", x: 0, y: 1, parent: "badgeG", closed: false, z: 501,
      points: [{ x: -13, y: 0 }, { x: -4, y: 9 }, { x: 14, y: -10 }],
      stroke: { color: P.accent, thickness: 6, cap: "round", join: "round", trim: { start: 0, end: 0 } } },
  ],
  imports: [],
  texts: [
    { id: "title", x: 0, y: H * 0.80, width: W, align: "center", z: 900,
      runs: [{ text: "LAUNCH SUCCESS", fontSize: 30, color: P.text, font: "inter" }] },
    { id: "subtitle", x: 0, y: H * 0.90, width: W, align: "center", z: 901,
      runs: [{ text: "Mission Aurora is in orbit", fontSize: 15, color: P.textMuted, font: "inter" }] },
  ],
  particles: [
    { prefab: "sparks", count: 10, area: { x: W * 0.42 - 24, y: H * 0.50 + 96, width: 48, height: 36 },
      animation: "idle", fallDistance: 70, seed: 5 },
  ],
  animations: [
    { name: "intro", duration: 150, fps: 60, loop: "oneShot",
      presets: [
        { preset: "fade-in", targets: stars.map((s) => s.id), at: 0, stagger: 3 },
        { preset: "pop-in", target: "badgeG", at: 78 },
        { preset: "rise-in", target: "title", at: 60 },
        { preset: "rise-in", target: "subtitle", at: 72 },
      ],
      tracks: [
        { target: "rocketG", property: "y", keyframes: [
          { frame: 0, value: H + 180 }, { frame: 70, value: H * 0.50, easing: "emphasized-decel" }, { frame: 150, value: H * 0.50 } ] },
        { target: "rocketG", property: "rotation", keyframes: [
          { frame: 0, value: -7 }, { frame: 70, value: 0, easing: "emphasized-decel" } ] },
        { target: "tick", property: "trimEnd", keyframes: [
          { frame: 92, value: 0 }, { frame: 116, value: 1, easing: "emphasized-decel" }, { frame: 150, value: 1 } ] },
      ] },
    { name: "idle", duration: 240, fps: 60, loop: "loop",
      presets: [
        { preset: "float", target: "rocketG", cycleSeconds: 4 },
        { preset: "sway", target: "rocketG", cycleSeconds: 4, intensity: 0.5 },
        { preset: "glow-pulse", targets: stars.slice(0, 5).map((s) => s.id), cycleSeconds: 2.6 },
        { preset: "breathing", target: "badgeG", cycleSeconds: 3, intensity: 0.8 },
        { preset: "breathing", target: "flameG", cycleSeconds: 0.35, intensity: 3 },
      ],
      tracks: [] },
  ],
  stateMachine: {
    name: "Launch",
    states: [
      { name: "introS", animation: "intro" },
      { name: "idleS", animation: "idle" },
    ],
    transitions: [
      { from: "entry", to: "introS" },
      { from: "introS", to: "idleS", exitTimeMs: 2500 },
    ],
  },
};

// SVGインポート断片を直接マージ（ツール層のimports相当をインラインで）
for (const [frag, gid, dx, dy, scale, z] of [
  [flame, "flameG_art", 0, 0, 0.72, 90],
  [rocket, "rocketG_art", 0, 0, 0.92, 100],
]) {
  const parent = gid === "flameG_art" ? "flameG" : "rocketG";
  scene.groups.push({ id: gid, x: dx, y: dy, parent, scaleX: scale, scaleY: scale });
  frag.shapes.forEach((s, i) => {
    // SVG座標系(中心=viewBox中心付近)をグループ原点へ寄せる
    const cx = frag.width / 2, cy = frag.height / 2;
    scene.shapes.push({ ...s, x: s.x - cx, y: s.y - cy, parent: gid, z: z + i });
  });
}

const { bytes, warnings } = createRiv(scene);
if (warnings.length) console.log("create warnings:", warnings.join("; "));
writeFileSync(S + "/launch.riv", Buffer.from(bytes));
console.log("launch.riv", bytes.length, "bytes");

const host = new RiveHost(PAGE_SCRIPT);
const info = await host.inspect(Buffer.from(bytes));
console.log("runtime:", JSON.stringify(info.artboards[0].animations.map((a) => a.name)), "SM:", info.artboards[0].stateMachines.length);
// critique frames: SMはstartTimeでシークできないため、連続advanceで撮ってサンプルを保存
{
  const fps = 10;
  const r = await host.renderFrames(Buffer.from(bytes), { stateMachine: "Launch", startTime: 0, frameCount: 45, fps, width: 480, format: "png" });
  for (const t of [0.5, 1.2, 2.0, 3.5]) {
    writeFileSync(S + `/launch-t${t}.png`, Buffer.from(r.frames[Math.round(t * fps)], "base64"));
  }
  console.log("SM states:", JSON.stringify(r.states));
}
const m = computeMetrics(new Uint8Array(bytes));
console.log("metrics:", JSON.stringify({ vector: m.vector, color: { distinct: m.color.distinctFills, oversat: m.color.oversaturated, bw: m.color.pureBlackOrWhite }, motion: m.motion, lintWarn: m.lint.filter((f) => f.severity !== "info").length }));
console.log("lint non-info:", JSON.stringify(m.lint.filter((f) => f.severity !== "info")));
await host.close();
