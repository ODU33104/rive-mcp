// "Night Delivery" — プロ製.riv(Rive公式 vehicles.riv)を riv_decompile で取り込みリミックス
// アートワークは全てプロ製アセットの取り込み:
//   truck: samples/vehicles.riv (Rive official example) / moon+stars: Twemoji (CC-BY 4.0)
// 実行: node samples/night-delivery/build-scene.mjs (リポジトリのルートから)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const R = join(HERE, "..", "..");
const S = HERE;
// Windows の絶対パスは file:// URL にしないと ESM import できない
const D = (f) => pathToFileURL(join(R, "dist", f)).href;
const [{ createRiv }, { generateTokens }, { importSvg }, { decompileRiv }, { RiveHost }, { PAGE_SCRIPT }, { computeMetrics }] =
  await Promise.all([
    import(D("rivWriter.js")), import(D("designTokens.js")), import(D("svgImport.js")),
    import(D("rivDecompile.js")), import(D("riveHost.js")), import(D("pageScript.js")),
    import(D("critique.js")),
  ]);

const T = generateTokens({ mood: "calm", scheme: "dark" });
const P = T.palette;
const W = 480, H = 360;

// --- プロ製トラックの取り込み (vehicles.riv 第1アートボード) ---
const { scene: veh } = decompileRiv(new Uint8Array(readFileSync(join(R, "samples", "vehicles.riv"))));
const truck = veh.artboards[0];
// トラックはアイソメ(右奥→左下向き)で描かれている。
// 落とすのは: ボーン駆動で復元できない煙エフェクト + 路面ストリーク(road_texture)。
// ストリークの原アニメは帰還パス(逆走区間)が丸見えになり「行ったり来たり」に見える
// ため流用せず、進行方向が一目で分かる自作の道路+センターライン破線に置き換える。
const DROP = /^(smoke_effect|road_texture)/;
const groups = truck.groups.filter((g) => !DROP.test(g.id));
const gids = new Set(groups.map((g) => g.id));
const shapes = truck.shapes.filter((s) => s.id !== "__background" && (!s.parent || gids.has(s.parent) || truck.shapes.some((o) => o.id === s.parent)));
const sids = new Set(shapes.map((s) => s.id));
const validTarget = (t) => gids.has(t) || sids.has(t);
// トラック本来の idle (バウンス+車輪+路面ストリーク) を流用。消したパーツ向けトラックは除去
const truckIdle = truck.animations.find((a) => a.name === "idle");
const truckTracks = truckIdle.tracks.filter((t) => validTarget(t.target));
console.log("truck: groups", groups.length, "shapes", shapes.length, "idle tracks kept", truckTracks.length, "/", truckIdle.tracks.length);

// --- 自作道路: トラックの進行軸(アイソメ左下)に沿う帯 + 後方へ流れる破線 ---
// 進行方向ベクトル(画面系)。元ファイルの速度線が飛んでいた後方 = (+0.838,-0.545) の逆
const DIRX = -0.838, DIRY = 0.545; // 前方(左下)
const ROAD_CX = 230, ROAD_CY = 292; // トラック車輪下を通る中心線の基準点
const DASH_D = 96; // センターライン破線の間隔(中心線上距離)

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
    { id: "dashRoad", x: 0, y: 0 }, // センターライン破線のスクロール台
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
    // 道路帯: 進行軸に沿う台形(手前ほど広い)。トラックの下、地面の上
    { id: "roadBand", type: "polygon", x: 0, y: 0, z: 3, opacity: 0.5,
      points: (() => {
        const NX = -DIRY, NY = DIRX; // 法線
        const far = { x: ROAD_CX - DIRX * 270, y: ROAD_CY - DIRY * 270 }; // 右奥
        const near = { x: ROAD_CX + DIRX * 270, y: ROAD_CY + DIRY * 270 }; // 左手前(画面外まで)
        const wf = 30, wn = 82; // 半幅: 奥ほど細い(パース)
        return [
          { x: far.x + NX * wf, y: far.y + NY * wf }, { x: far.x - NX * wf, y: far.y - NY * wf },
          { x: near.x - NX * wn, y: near.y - NY * wn }, { x: near.x + NX * wn, y: near.y + NY * wn } ];
      })(),
      fill: { gradient: { type: "linear", stops: [
        { color: P.surface, position: 0 }, { color: P.bgDeep, position: 1 } ],
        start: { x: ROAD_CX - DIRX * 270, y: ROAD_CY - DIRY * 270 },
        end: { x: ROAD_CX + DIRX * 270, y: ROAD_CY + DIRY * 270 } } } },
    // ヘッドライトビーム (screen合成)。左右ランプそれぞれの子 → 車体バウンスに追従
    ...["light_left", "light_right"].map((lamp, i) => ({
      id: `beam${i}`, type: "polygon", x: 0, y: 0, parent: lamp, z: 100200 + i,
      blendMode: "screen", opacity: 0.45,
      points: [
        { x: -34, y: -36 }, { x: -30, y: 26 },
        { x: -470, y: 320 }, { x: -520, y: 180 } ],
      fill: { gradient: { type: "linear", stops: [
        { color: "#7dfff3b0", position: 0 }, { color: "#00fff3b0", position: 1 } ],
        start: { x: -32, y: -5 }, end: { x: -490, y: 250 } } } })),
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
        { preset: "fade-in", targets: ["beam0", "beam1"], at: 96 },
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
        // 道路と破線はトラックが停止位置に着いてからフェードイン
        ...["roadBand", "dashRoad"].map((id) => ({
          target: id, property: "opacity",
          keyframes: [
            { frame: 0, value: 0 }, { frame: 96, value: 0 },
            { frame: 140, value: id === "roadBand" ? 0.5 : 1, easing: "smooth" } ],
        })),
      ] },
    { name: "idle", duration: 120, fps: 60, loop: "loop",
      presets: [
        { preset: "glow-pulse", targets: ["tws0", "tws2", "tws4"], cycleSeconds: 2 },
        { preset: "glow-pulse", targets: ["tws1", "tws3"], cycleSeconds: 1.6 },
      ],
      tracks: [
        // プロ製トラックの idle をそのまま移植 (車体バウンス+車輪)
        ...truckTracks,
        // ビームのゆらぎ (左右)
        ...[0, 1].map((i) => ({ target: `beam${i}`, property: "opacity", keyframes: [
          { frame: 0, value: 0.45 }, { frame: 30, value: 0.38, easing: "smooth" },
          { frame: 60, value: 0.45, easing: "smooth" }, { frame: 90, value: 0.4, easing: "smooth" },
          { frame: 120, value: 0.45, easing: "smooth" } ] })),
        // 破線を後方(右奥)へ流す。等間隔D×2ぶん移動して f0=f120 でシームレス
        // (画面スクロールの等速はループ素材の定石なので linear が正解)
        { target: "dashRoad", property: "x", keyframes: [
          { frame: 0, value: 0 }, { frame: 120, value: -DIRX * DASH_D * 2, easing: "linear" } ] },
        { target: "dashRoad", property: "y", keyframes: [
          { frame: 0, value: 0 }, { frame: 120, value: -DIRY * DASH_D * 2, easing: "linear" } ] },
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
// センターライン破線: 中心線に沿って等間隔。スクロールしても常に帯を満たすよう多めに並べ、
// 帯の外にはみ出た分は clipBy で消す
for (let i = -3; i <= 4; i++) {
  const t = i * DASH_D;
  scene.shapes.push({
    id: `dash${i + 3}`, type: "rect", clipBy: "roadBand",
    x: ROAD_CX + DIRX * t, y: ROAD_CY + DIRY * t,
    width: 34, height: 6, cornerRadius: 3, rotation: 147, z: 4,
    parent: "dashRoad", opacity: 0.6, fill: { color: P.textMuted },
  });
}

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
