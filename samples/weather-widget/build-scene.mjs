// "Weather Widget" — 全天気アートがプロ製Twemoji (CC-BY 4.0, (c) Twitter/X contributors)
// 晴れ→雨→晴れを1本のループタイムラインで演出するUIウィジェット。
// アートは riv_import_svg 相当の importSvg() で取り込み、動きはトークン+プリセット。
// 実行: node samples/weather-widget/build-scene.mjs (リポジトリのルートから)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const R = join(HERE, "..", "..");
const S = HERE;
// Windows の絶対パスは file:// URL にしないと ESM import できない
const D = (f) => pathToFileURL(join(R, "dist", f)).href;
const [{ createRiv }, { generateTokens }, { importSvg }, { RiveHost }, { PAGE_SCRIPT }, { computeMetrics }] =
  await Promise.all([
    import(D("rivWriter.js")), import(D("designTokens.js")), import(D("svgImport.js")),
    import(D("riveHost.js")), import(D("pageScript.js")), import(D("critique.js")),
  ]);

const T = generateTokens({ mood: "calm", scheme: "dark" });
const P = T.palette;
// 余白を絞った小さめアートボード (APNGサイズ削減)
const W = 380, H = 316;
const CX = W / 2, CY = H / 2, CW = 340, CH = 280;
const TOP = CY - CH / 2;
const SKY_Y = TOP + 88; // 天気アートの中心

const load = (code, prefix) => importSvg(readFileSync(`${S}/assets/${code}.svg`, "utf8"), { idPrefix: prefix });
const sun = load("2600", "su_");     // 正面向きの光線つき太陽
const cloud = load("2601", "cl_");   // 正面向きの雲 (雨は自作パーティクルに任せる)
const bolt = load("26a1", "bo_");    // 稲妻

// 10秒 = 600f ループ。晴れ(0-150) → 雨(210-420) → 晴れ(480-600)。f0とf600は同状態
const scene = {
  artboard: { name: "WeatherWidget", width: W, height: H },
  fonts: [{ id: "inter", bytes: new Uint8Array(readFileSync(join(R, "assets", "inter.ttf"))) }],
  groups: [
    { id: "sunPos", x: CX, y: SKY_Y },
    { id: "cloudPos", x: CX, y: SKY_Y - 14 }, // xはトラックで駆動(初期値は上書きされる)
    { id: "boltPos", x: CX - 10, y: SKY_Y + 52 },
  ],
  shapes: [
    { id: "card", type: "rect", x: CX, y: CY, width: CW, height: CH, cornerRadius: 26, z: 0,
      fill: { gradient: { type: "linear", stops: [
        { color: P.surface, position: 0 }, { color: P.bgDeep, position: 1 } ],
        start: { x: 0, y: -CH / 2 }, end: { x: 0, y: CH / 2 } } },
      stroke: { color: P.outline, thickness: 1.5 } },
    // 空のほのかなグロー (境界の輪郭はカード外に追い出してクリップで消す)
    { id: "skyGlow", type: "ellipse", x: CX, y: SKY_Y - 10, width: CW * 1.5, height: 260, z: 5, opacity: 0.3, clipBy: "card",
      fill: { gradient: { type: "radial", stops: [
        { color: P.primarySoft, position: 0 }, { color: P.bgDeep, position: 1 } ],
        start: { x: 0, y: 0 }, end: { x: CW * 0.75, y: 0 } } } },
  ],
  texts: [
    { id: "temp23", x: CX - CW / 2, y: TOP + 190, width: CW, align: "center", z: 900,
      runs: [{ text: "23°", fontSize: 46, color: P.text, font: "inter" }] },
    { id: "temp18", x: CX - CW / 2, y: TOP + 190, width: CW, align: "center", z: 901,
      runs: [{ text: "18°", fontSize: 46, color: P.text, font: "inter" }] },
    { id: "labelSun", x: CX - CW / 2, y: TOP + 244, width: CW, align: "center", z: 902,
      runs: [{ text: "Sunny · TOKYO", fontSize: 13, color: P.textMuted, font: "inter" }] },
    { id: "labelRain", x: CX - CW / 2, y: TOP + 244, width: CW, align: "center", z: 903,
      runs: [{ text: "Rain · TOKYO", fontSize: 13, color: P.textMuted, font: "inter" }] },
  ],
  animations: [
    { name: "weather", duration: 600, fps: 60, loop: "loop",
      presets: [
        // cycleSeconds はループ全長(10s)を割り切る値にしてループ整合させる
        { preset: "spin", target: "sunSpin", cycleSeconds: 10 },          // 600fで丁度1回転
        { preset: "glow-pulse", target: "sunPos", cycleSeconds: 2.5 },     // 600/150=4周期
        { preset: "float", target: "cloudPos", cycleSeconds: 2.5, intensity: 0.6 },
      ],
      tracks: [] }, // 下でJS生成
  ],
};

// ---- プロ製フラグメントをカード内にクリップして配置 ----
const place = (frag, gid, parent, x, y, scale, z) => {
  scene.groups.push({ id: gid, x, y, parent, scaleX: scale, scaleY: scale });
  frag.shapes.forEach((s, i) => scene.shapes.push({
    ...s, x: s.x - frag.width / 2, y: s.y - frag.height / 2, parent: gid, z: z + i, clipBy: "card",
  }));
};
scene.groups.push({ id: "sunFade", x: 0, y: 0, parent: "sunPos" }); // opacity手書き用(glow-pulseはsunPos側)
scene.groups.push({ id: "sunSpin", x: 0, y: 0, parent: "sunFade" });
place(sun, "sunArt", "sunSpin", 0, 0, 3.6, 300);
place(cloud, "cloudArt", "cloudPos", 0, 0, 5.2, 400);
place(bolt, "boltArt", "boltPos", 0, 0, 1.7, 450); // 雲の下端から突き出す(雲より前面)

// ---- タイムライン (手書きは 雲x / 太陽フェード / 雨粒 / 稲妻 / テキストフェード のみ) ----
const TR = scene.animations[0].tracks;
const CLOUD_IN_X = CX, CLOUD_OFF_L = -220, CLOUD_OFF_R = W + 220;

// 雲: 左外→中央 (f150-205) → 停止 → 右外へ (f420-475)。風は終始右向き
TR.push({ target: "cloudPos", property: "x", keyframes: [
  { frame: 0, value: CLOUD_OFF_L }, { frame: 150, value: CLOUD_OFF_L },
  { frame: 205, value: CLOUD_IN_X, easing: "emphasized-decel" },
  { frame: 420, value: CLOUD_IN_X },
  { frame: 475, value: CLOUD_OFF_R, easing: "emphasized-accel" },
  { frame: 600, value: CLOUD_OFF_R } ] });

// 太陽: 雲が覆いきれない光線ごと雨区間はフェードアウト。復帰は雲が抜けてから
TR.push({ target: "sunFade", property: "opacity", keyframes: [
  { frame: 0, value: 1 }, { frame: 168, value: 1 },
  { frame: 208, value: 0, easing: "standard" }, { frame: 445, value: 0 },
  { frame: 500, value: 1, easing: "standard" }, { frame: 600, value: 1 } ] });

// 雨粒: 10本、雨区間(215-425)に周期落下 (等速落下はループ素材の定石なのでlinearが正解)
const DROP_TOP = SKY_Y + 46, DROP_BOT = SKY_Y + 106;
for (let i = 0; i < 10; i++) {
  const id = `drop${i}`;
  const jitter = [3, -6, 8, 0, -4, 6, -8, 2, 5, -2][i]; // 等間隔の機械臭さを崩す
  const dx = CX - 112 + i * 25 + jitter;
  const period = 52 + (i % 3) * 6; // 速度にもばらつき
  scene.shapes.push({ id, type: "rect", x: dx, y: DROP_TOP, width: 3.5, height: 11, cornerRadius: 2,
    z: 340, opacity: 0, clipBy: "card", rotation: 8, fill: { color: P.primary } });
  const offset = 215 + ((i * 17) % period);
  const yk = [{ frame: 0, value: DROP_TOP }], ok = [{ frame: 0, value: 0 }];
  for (let t = offset; t + period <= 435; t += period) {
    ok.push({ frame: t, value: 0, easing: "hold" }, { frame: t + 5, value: 0.9 },
             { frame: t + period - 18, value: 0.9 }, { frame: t + period - 6, value: 0 });
    yk.push({ frame: t, value: DROP_TOP, easing: "hold" },
             { frame: t + period - 6, value: DROP_BOT, easing: "linear" });
  }
  ok.push({ frame: 600, value: 0 });
  yk.push({ frame: 600, value: DROP_TOP, easing: "hold" });
  TR.push({ target: id, property: "y", keyframes: yk });
  TR.push({ target: id, property: "opacity", keyframes: ok });
}

// 稲妻: f296-320 に2連フラッシュ (hold/snapで鋭く)
TR.push({ target: "boltPos", property: "opacity", keyframes: [
  { frame: 0, value: 0 }, { frame: 296, value: 0, easing: "hold" },
  { frame: 298, value: 1, easing: "hold" }, { frame: 306, value: 0, easing: "hold" },
  { frame: 310, value: 1, easing: "hold" }, { frame: 320, value: 0, easing: "snap" },
  { frame: 600, value: 0 } ] });

// 温度・ラベルのクロスフェード (雨の到着/離脱に同期)
const xfade = (target, a, b) => TR.push({ target, property: "opacity", keyframes: [
  { frame: 0, value: a }, { frame: 165, value: a },
  { frame: 205, value: b, easing: "standard" }, { frame: 455, value: b },
  { frame: 500, value: a, easing: "standard" }, { frame: 600, value: a } ] });
xfade("temp23", 1, 0);
xfade("labelSun", 1, 0);
xfade("temp18", 0, 1);
xfade("labelRain", 0, 1);

const { bytes, warnings } = createRiv(scene);
if (warnings.length) console.log("create warnings:", warnings.join("; "));
writeFileSync(join(S, "weather.riv"), Buffer.from(bytes));
console.log("weather.riv", bytes.length, "bytes");

const host = new RiveHost(PAGE_SCRIPT);
for (const t of [0.5, 2.8, 3.6, 5.0, 5.1, 7.4, 8.2]) {
  const r = await host.renderFrames(Buffer.from(bytes), { animation: "weather", startTime: t, frameCount: 1, fps: 60, width: 480, format: "png" });
  writeFileSync(join(S, `preview-t${t}.png`), Buffer.from(r.frames[0], "base64"));
}
const m = computeMetrics(new Uint8Array(bytes));
console.log("metrics:", JSON.stringify({ vector: m.vector, motion: m.motion, lintNonInfo: m.lint.filter((f) => f.severity !== "info") }));
await host.close();
