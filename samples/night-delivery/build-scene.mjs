// "Night Delivery" — プロ製.riv(Rive公式 vehicles.riv)を riv_decompile で取り込みリミックス
// アートワークは全てプロ製アセットの取り込み:
//   truck: samples/vehicles.riv (Rive official example) / moon+stars: Twemoji (CC-BY 4.0)
// 実行: node samples/night-delivery/build-scene.mjs (リポジトリのルートから)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const R = join(HERE, "..", "..");
const S = HERE;
const [{ createRiv }, { generateTokens }, { importSvg }, { decompileRiv }, { RiveHost }, { PAGE_SCRIPT }, { computeMetrics }] =
  await Promise.all([
    import(join(R, "dist") + "/rivWriter.js"), import(join(R, "dist") + "/designTokens.js"), import(join(R, "dist") + "/svgImport.js"),
    import(join(R, "dist") + "/rivDecompile.js"), import(join(R, "dist") + "/riveHost.js"), import(join(R, "dist") + "/pageScript.js"),
    import(join(R, "dist") + "/critique.js"),
  ]);

const T = generateTokens({ mood: "calm", scheme: "dark" });
const P = T.palette;
const W = 480, H = 360;

// --- プロ製トラックの取り込み (vehicles.riv 第1アートボード) ---
const { scene: veh } = decompileRiv(new Uint8Array(readFileSync(join(R, "samples", "vehicles.riv"))));
const truck = veh.artboards[0];
// トラックはアイソメ(右奥→左下向き)で描かれている。進行方向の表現は
// プロが作った斜めストリーク(road_texture)とそのアニメをそのまま使う。
// 落とすのはボーン駆動で復元できない煙エフェクトのみ。
const DROP = /^smoke_effect/;
const groups = truck.groups.filter((g) => !DROP.test(g.id));
const gids = new Set(groups.map((g) => g.id));
const shapes = truck.shapes.filter((s) => s.id !== "__background" && (!s.parent || gids.has(s.parent) || truck.shapes.some((o) => o.id === s.parent)));
const sids = new Set(shapes.map((s) => s.id));
const validTarget = (t) => gids.has(t) || sids.has(t);
// トラック本来の idle (バウンス+車輪+路面ストリーク) を流用。消したパーツ向けトラックは除去
const truckIdle = truck.animations.find((a) => a.name === "idle");
const truckTracks = truckIdle.tracks.filter((t) => validTarget(t.target));
// 夜景に合わせ、路面ストリークは減光し夜パレットの色に置換
for (const s of shapes) if (/^road_texture/.test(s.parent || "")) {
  s.opacity = (s.opacity ?? 1) * 0.45;
  s.fill = { color: "#5b6f80" };
  delete s.stroke;
}
const roadTexGroups = groups.filter((g) => /^road_texture/.test(g.id)).map((g) => g.id);
console.log("truck: groups", groups.length, "shapes", shapes.length, "idle tracks kept", truckTracks.length, "/", truckIdle.tracks.length);

// root を新シーンのラッパーへ載せ替え (rootの元transform(1032,796,scale0.8)は保持)
const TRUCK_SCALE = 0.26;
const TX = 1027, TY = 750; // トラックの見た目中心x / 車輪接地y (1920x1080座標)
const root = groups.find((g) => g.id === "root");
root.parent = "truckW";
const TRUCK_X = W * 0.45 - TX * TRUCK_SCALE; // ≈ -51
const TRUCK_Y = H * 0.765 - TY * TRUCK_SCALE; // 車輪を路面へ

const load = (code, prefix) => importSvg(readFileSync(`${S}/assets/${code}.svg`, "utf8"), { idPrefix: prefix });
const moon = load("1f319", "mo_");
const starFrag = () => load("1f31f", `tw${starN++}_`);
let starN = 0;

const scene = {
  artboard: { name: "NightDelivery", width: W, height: H },
  fonts: [{ id: "inter", bytes: new Uint8Array(readFileSync(join(R, "assets", "inter.ttf"))) }],
  groups: [
    { id: "truckW", x: TRUCK_X, y: TRUCK_Y, scaleX: TRUCK_SCALE, scaleY: TRUCK_SCALE },
    { id: "moonG", x: W * 0.85, y: H * 0.18 },
    ...groups,
  ],
  shapes: [
    { id: "sky", type: "rect", x: W / 2, y: H / 2, width: W, height: H, z: 0,
      fill: { gradient: { type: "linear", stops: [
        { color: T.gradients.bg[0], position: 0 }, { color: T.gradients.bg[1], position: 1 } ],
        start: { x: 0, y: -H / 2 }, end: { x: 0, y: H / 2 } } } },
    // 地面: 視点を固定しない柔らかい面 (水平線の帯はアイソメの車と矛盾するため置かない)
    { id: "ground", type: "ellipse", x: W * 0.42, y: H * 0.92, width: W * 1.5, height: H * 0.55, z: 2, opacity: 0.55,
      fill: { gradient: { type: "linear", stops: [
        { color: P.surface, position: 0 }, { color: T.gradients.bg[1], position: 1 } ],
        start: { x: 0, y: -H * 0.28 }, end: { x: 0, y: H * 0.1 } } } },
    // ヘッドライトビーム (screen合成 — 新機能)。truckWの子=トラックと一緒に入場
    { id: "beam", type: "polygon", x: 0, y: 0, parent: "truckW", z: 100200, blendMode: "screen", opacity: 0.5,
      points: [
        { x: 790, y: 620 }, { x: 790, y: 700 },
        { x: 210, y: 1000 }, { x: 210, y: 680 } ],
      fill: { gradient: { type: "linear", stops: [
        { color: "#7dfff3b0", position: 0 }, { color: "#00fff3b0", position: 1 } ],
        start: { x: 790, y: 660 }, end: { x: 230, y: 840 } } } },
    ...shapes,
  ],
  texts: [
    { id: "title", x: 0, y: H * 0.055, width: W, align: "center", z: 100500,
      runs: [{ text: "NIGHT DELIVERY", fontSize: 24, color: P.text, font: "inter" }] },
    { id: "subtitle", x: 0, y: H * 0.135, width: W, align: "center", z: 100501,
      runs: [{ text: "truck by Rive · moon by Twemoji · remix by rive-mcp", fontSize: 11, color: P.textMuted, font: "inter" }] },
  ],
  animations: [
    { name: "intro", duration: 150, fps: 60, loop: "oneShot",
      presets: [
        { preset: "fade-in", targets: ["tws0", "tws1", "tws2", "tws3", "tws4"], at: 0, stagger: 4 },
        { preset: "rise-in", target: "moonG", at: 20 },
        { preset: "rise-in", target: "title", at: 84 },
        { preset: "fade-in", target: "subtitle", at: 100 },
        { preset: "fade-in", target: "beam", at: 96 },
      ],
      tracks: [
        // 入場は素材の向き(アイソメ右奥→左下)に沿った対角線。真横移動はNG
        { target: "truckW", property: "x", keyframes: [
          { frame: 0, value: TRUCK_X + 330 }, { frame: 78, value: TRUCK_X, easing: "emphasized-decel" },
          { frame: 150, value: TRUCK_X } ] },
        { target: "truckW", property: "y", keyframes: [
          { frame: 0, value: TRUCK_Y - 165 }, { frame: 78, value: TRUCK_Y, easing: "emphasized-decel" },
          { frame: 150, value: TRUCK_Y } ] },
        // 奥(小さい)→手前(等倍): アイソメの奥行きを補強
        { target: "truckW", property: "scaleX", keyframes: [
          { frame: 0, value: TRUCK_SCALE * 0.78 }, { frame: 78, value: TRUCK_SCALE, easing: "emphasized-decel" } ] },
        { target: "truckW", property: "scaleY", keyframes: [
          { frame: 0, value: TRUCK_SCALE * 0.78 }, { frame: 78, value: TRUCK_SCALE, easing: "emphasized-decel" } ] },
        // 路面ストリークはidleでアニメが始まるまで隠す (intro中は凍結ポーズのため)
        ...roadTexGroups.map((id) => ({
          target: id, property: "opacity",
          keyframes: [
            { frame: 0, value: 0 }, { frame: 112, value: 0 },
            { frame: 148, value: 1, easing: "smooth" } ],
        })),
      ] },
    { name: "idle", duration: 120, fps: 60, loop: "loop",
      presets: [
        { preset: "glow-pulse", targets: ["tws0", "tws2", "tws4"], cycleSeconds: 2 },
        { preset: "glow-pulse", targets: ["tws1", "tws3"], cycleSeconds: 1.6 },
      ],
      tracks: [
        // プロ製トラックの idle をそのまま移植 (車体バウンス+車輪+斜めの路面ストリーク)
        ...truckTracks,
        // ビームのゆらぎ
        { target: "beam", property: "opacity", keyframes: [
          { frame: 0, value: 0.5 }, { frame: 30, value: 0.42, easing: "smooth" },
          { frame: 60, value: 0.5, easing: "smooth" }, { frame: 90, value: 0.44, easing: "smooth" },
          { frame: 120, value: 0.5, easing: "smooth" } ] },
      ] },
  ],
  stateMachine: {
    name: "Delivery",
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

// 月と星 (プロ製Twemoji)
const place = (frag, gid, parent, x, y, scale, z) => {
  scene.groups.push({ id: gid, x, y, parent, scaleX: scale, scaleY: scale });
  frag.shapes.forEach((s, i) => scene.shapes.push({
    ...s, x: s.x - frag.width / 2, y: s.y - frag.height / 2, parent: gid, z: z + i,
  }));
};
place(moon, "moonArt", "moonG", 0, 0, 1.3, 900);
[[0.07, 0.26, 0.5], [0.28, 0.36, 0.38], [0.55, 0.25, 0.55], [0.70, 0.44, 0.36], [0.93, 0.33, 0.45]]
  .forEach(([fx, fy, sc], i) => {
    scene.groups.push({ id: `tws${i}`, x: W * fx, y: H * fy });
    place(starFrag(), `tws${i}Art`, `tws${i}`, 0, 0, sc, 800 + i * 10);
  });

const { bytes, warnings } = createRiv(scene);
if (warnings.length) console.log("create warnings:", warnings.slice(0, 8).join("; "));
writeFileSync(join(S, "delivery.riv"), Buffer.from(bytes));
console.log("delivery.riv", bytes.length, "bytes");

const host = new RiveHost(PAGE_SCRIPT);
for (const t of [0.6, 1.6, 3.0, 4.0]) {
  const r = await host.renderFrames(Buffer.from(bytes), { stateMachine: "Delivery", startTime: t, frameCount: 1, fps: 60, width: 480, format: "png" });
  writeFileSync(join(S, `preview-t${t}.png`), Buffer.from(r.frames[0], "base64"));
}
const m = computeMetrics(new Uint8Array(bytes));
console.log("metrics:", JSON.stringify({ vector: m.vector, motion: m.motion, lintNonInfo: m.lint.filter((f) => f.severity !== "info") }));
await host.close();
