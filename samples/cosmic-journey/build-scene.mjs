// "Cosmic Journey" — 全アートワークがプロ製Twemoji (CC-BY 4.0, (c) Twitter/X contributors)
// アートワークは全てプロ製アセットの取り込み:
//   Twemoji SVG (npm @twemoji/svg) -> riv_import_svg 相当の importSvg()
// 実行: node samples/cosmic-journey/build-scene.mjs (リポジトリのルートから)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const R = join(HERE, "..", "..");
const S = HERE;
const [{ createRiv }, { generateTokens }, { importSvg }, { RiveHost }, { PAGE_SCRIPT }, { computeMetrics }] =
  await Promise.all([
    import(join(R, "dist") + "/rivWriter.js"), import(join(R, "dist") + "/designTokens.js"), import(join(R, "dist") + "/svgImport.js"),
    import(join(R, "dist") + "/riveHost.js"), import(join(R, "dist") + "/pageScript.js"), import(join(R, "dist") + "/critique.js"),
  ]);

const T = generateTokens({ mood: "tech", scheme: "dark" });
const P = T.palette;
const W = 480, H = 360;

const load = (code, prefix) => importSvg(readFileSync(`${S}/assets/${code}.svg`, "utf8"), { idPrefix: prefix });
const rocket = load("1f680", "rk_");   // 36x36 viewBox, 斜め45°上向きデザイン
const planet = load("1fa90", "pl_");
const moon = load("1f319", "mo_");
const star = load("1f31f", "st_");
const comet = load("2604", "cm_");

const scene = {
  artboard: { name: "CosmicJourney", width: W, height: H },
  fonts: [{ id: "inter", bytes: new Uint8Array(readFileSync(join(R, "assets", "inter.ttf"))) }],
  groups: [
    { id: "rocketG", x: W * 0.40, y: H * 0.46 },
    { id: "planetG", x: W * 0.80, y: H * 0.26 },
    { id: "moonG", x: W * 0.12, y: H * 0.20 },
    { id: "cometG", x: W + 80, y: -40 },
  ],
  shapes: [
    { id: "sky", type: "rect", x: W / 2, y: H / 2, width: W, height: H, z: 0,
      fill: { gradient: { type: "linear", stops: [
        { color: T.gradients.bg[0], position: 0 }, { color: T.gradients.bg[1], position: 1 } ],
        start: { x: 0, y: -H / 2 }, end: { x: 0, y: H / 2 } } } },
    { id: "nebula", type: "ellipse", x: W * 0.62, y: H * 0.70, width: W * 1.3, height: H * 0.9, z: 1, opacity: 0.30,
      fill: { gradient: { type: "radial", stops: [
        { color: P.primarySoft, position: 0 }, { color: T.gradients.bg[1], position: 1 } ],
        start: { x: 0, y: 0 }, end: { x: W * 0.65, y: 0 } } } },
  ],
  texts: [
    { id: "title", x: 0, y: H * 0.84, width: W, align: "center", z: 900,
      runs: [{ text: "COSMIC JOURNEY", fontSize: 26, color: P.text, font: "inter" }] },
    { id: "subtitle", x: 0, y: H * 0.925, width: W, align: "center", z: 901,
      runs: [{ text: "assets by Twemoji · motion by rive-mcp", fontSize: 12, color: P.textMuted, font: "inter" }] },
  ],
  animations: [
    { name: "intro", duration: 150, fps: 60, loop: "oneShot",
      presets: [
        { preset: "fade-in", targets: ["s0", "s1", "s2", "s3", "s4", "s5"], at: 0, stagger: 4 },
        { preset: "pop-in", target: "planetG", at: 46 },
        { preset: "rise-in", target: "moonG", at: 34 },
        { preset: "rise-in", target: "title", at: 78 },
        { preset: "fade-in", target: "subtitle", at: 96 },
      ],
      tracks: [
        // ロケットは斜め上向きデザイン → 左下から対角に進入
        { target: "rocketG", property: "x", keyframes: [
          { frame: 0, value: -90 }, { frame: 72, value: W * 0.40, easing: "emphasized-decel" }, { frame: 150, value: W * 0.40 } ] },
        { target: "rocketG", property: "y", keyframes: [
          { frame: 0, value: H + 90 }, { frame: 72, value: H * 0.46, easing: "emphasized-decel" }, { frame: 150, value: H * 0.46 } ] },
      ] },
    { name: "idle", duration: 300, fps: 60, loop: "loop",
      presets: [
        { preset: "float", target: "rocketG", cycleSeconds: 4 },
        { preset: "sway", target: "rocketG", cycleSeconds: 4, intensity: 0.5 },
        { preset: "glow-pulse", targets: ["s0", "s2", "s4"], cycleSeconds: 2.6 },
        { preset: "glow-pulse", targets: ["s1", "s3", "s5"], cycleSeconds: 3.4 },
        { preset: "breathing", target: "planetG", cycleSeconds: 5, intensity: 0.5 },
        { preset: "float", target: "moonG", cycleSeconds: 6, intensity: 0.5 },
      ],
      tracks: [
        // 彗星: 上空を浅い対角で横切る (ロケットより上・最背面。進行方向に合わせ回転)
        { target: "cometG", property: "x", keyframes: [
          { frame: 0, value: W + 90 }, { frame: 60, value: W + 90 },
          { frame: 150, value: -90, easing: "standard" }, { frame: 300, value: -90 } ] },
        { target: "cometG", property: "y", keyframes: [
          { frame: 0, value: 0 }, { frame: 60, value: 0 },
          { frame: 150, value: H * 0.35, easing: "standard" }, { frame: 300, value: H * 0.35 } ] },
        { target: "cometG", property: "opacity", keyframes: [
          { frame: 0, value: 0 }, { frame: 60, value: 0 }, { frame: 78, value: 1, easing: "standard" },
          { frame: 132, value: 1 }, { frame: 150, value: 0, easing: "standard" }, { frame: 300, value: 0 } ] },
      ] },
  ],
  stateMachine: {
    name: "Journey",
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

// プロ製フラグメントをマージ
const place = (frag, gid, parent, x, y, scale, z, rotation = 0) => {
  scene.groups.push({ id: gid, x, y, parent, scaleX: scale, scaleY: scale, ...(rotation ? { rotation } : {}) });
  frag.shapes.forEach((s, i) => scene.shapes.push({
    ...s, x: s.x - frag.width / 2, y: s.y - frag.height / 2, parent: gid, z: z + i,
  }));
};
place(rocket, "rocketArt", "rocketG", 0, 0, 3.4, 300);
place(planet, "planetArt", "planetG", 0, 0, 2.1, 200);
place(moon, "moonArt", "moonG", 0, 0, 1.5, 190);
place(comet, "cometArt", "cometG", 0, 0, 1.2, 60, 34);
// 星: 同じプロ製アセットをスケール違いで散らす
const starPos = [
  [0.10, 0.55, 0.55], [0.24, 0.10, 0.75], [0.52, 0.16, 0.5],
  [0.68, 0.58, 0.65], [0.90, 0.48, 0.5], [0.44, 0.62, 0.42],
];
starPos.forEach(([fx, fy, sc], i) => {
  const frag = load("1f31f", `s${i}_`);
  scene.groups.push({ id: `s${i}`, x: W * fx, y: H * fy });
  place(frag, `s${i}Art`, `s${i}`, 0, 0, sc, 100 + i * 10);
});

const { bytes, warnings } = createRiv(scene);
if (warnings.length) console.log("create warnings:", warnings.join("; "));
writeFileSync(join(S, "cosmic.riv"), Buffer.from(bytes));
console.log("cosmic.riv", bytes.length, "bytes");

const host = new RiveHost(PAGE_SCRIPT);
for (const t of [0.4, 1.0, 2.0, 3.2, 4.2, 5.2]) {
  const r = await host.renderFrames(Buffer.from(bytes), { stateMachine: "Journey", startTime: t, frameCount: 1, fps: 60, width: 480, format: "png" });
  writeFileSync(join(S, `preview-t${t}.png`), Buffer.from(r.frames[0], "base64"));
}
const m = computeMetrics(new Uint8Array(bytes));
console.log("metrics:", JSON.stringify({ vector: m.vector, motion: m.motion, lintNonInfo: m.lint.filter((f) => f.severity !== "info") }));
await host.close();
