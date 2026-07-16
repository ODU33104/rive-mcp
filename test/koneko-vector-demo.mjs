// パーツ分割リグの実証: koneko をベクターで再構築し、部位ごとにアニメーション
// 目パチ（scaleY潰し）/ 尻尾振り（付け根ピボット回転）/ 耳ピクッ / 呼吸 / 首かしげ
import { writeFileSync } from "node:fs";
import { createRiv } from "../dist/rivWriter.js";
import { RiveHost } from "../dist/riveHost.js";
import { PAGE_SCRIPT } from "../dist/pageScript.js";
import { encodeGif } from "../dist/gif.js";

const CREAM = "#fff6ec", OUTLINE = "#8a6a55", INNER_EAR = "#f5b8a8",
  EYE = "#6b4226", PINK = "#e8a0a0", BLUSH = "#f8c8c8", FLUFF = "#fffdf8";

const spec = {
  artboard: { name: "KonekoVector", width: 500, height: 500 },
  backgroundColor: "#fdf6ec",
  // リグ: 各部位のピボット位置にグループを置く
  groups: [
    { id: "root", x: 250, y: 400 },
    { id: "tailG", x: -88, y: -6, parent: "root" },          // 尻尾の付け根
    { id: "headG", x: 0, y: -90, parent: "root" },           // 首
    { id: "earLG", x: -66, y: -152, parent: "headG" },       // 左耳の付け根
    { id: "earRG", x: 66, y: -152, parent: "headG" },
    { id: "eyeLG", x: -48, y: -90, parent: "headG" },        // 目（scaleYで目パチ）
    { id: "eyeRG", x: 48, y: -90, parent: "headG" },
  ],
  // 配列の後ろ = 前面
  shapes: [
    // 尻尾（tailG 回転で振る）
    { id: "tail", type: "ellipse", parent: "tailG", x: -48, y: -22, width: 115, height: 58,
      rotation: -35, fill: { color: CREAM }, stroke: { color: OUTLINE, thickness: 5 } },
    // 体
    { id: "body", type: "ellipse", parent: "root", x: 0, y: -15, width: 195, height: 165,
      fill: { color: CREAM }, stroke: { color: OUTLINE, thickness: 5 } },
    { id: "legL", type: "ellipse", parent: "root", x: -48, y: 58, width: 56, height: 40,
      fill: { color: CREAM }, stroke: { color: OUTLINE, thickness: 5 } },
    { id: "legR", type: "ellipse", parent: "root", x: 48, y: 58, width: 56, height: 40,
      fill: { color: CREAM }, stroke: { color: OUTLINE, thickness: 5 } },
    { id: "chest", type: "ellipse", parent: "root", x: 0, y: -42, width: 95, height: 75,
      fill: { color: FLUFF } },
    // 耳（頭の後ろに描く）
    { id: "earL", type: "polygon", parent: "earLG", x: 0, y: -26,
      points: [{ x: -34, y: 30, radius: 8 }, { x: 30, y: 26, radius: 8 }, { x: -14, y: -44, radius: 10 }],
      fill: { color: CREAM }, stroke: { color: OUTLINE, thickness: 5 } },
    { id: "earLIn", type: "polygon", parent: "earLG", x: -3, y: -18,
      points: [{ x: -18, y: 18, radius: 5 }, { x: 14, y: 15, radius: 5 }, { x: -8, y: -24, radius: 6 }],
      fill: { color: INNER_EAR } },
    { id: "earR", type: "polygon", parent: "earRG", x: 0, y: -26,
      points: [{ x: -30, y: 26, radius: 8 }, { x: 34, y: 30, radius: 8 }, { x: 14, y: -44, radius: 10 }],
      fill: { color: CREAM }, stroke: { color: OUTLINE, thickness: 5 } },
    { id: "earRIn", type: "polygon", parent: "earRG", x: 3, y: -18,
      points: [{ x: -14, y: 15, radius: 5 }, { x: 18, y: 18, radius: 5 }, { x: 8, y: -24, radius: 6 }],
      fill: { color: INNER_EAR } },
    // 頭
    { id: "head", type: "ellipse", parent: "headG", x: 0, y: -95, width: 230, height: 200,
      fill: { color: CREAM }, stroke: { color: OUTLINE, thickness: 5 } },
    // 頬
    { id: "blushL", type: "ellipse", parent: "headG", x: -82, y: -62, width: 34, height: 18,
      opacity: 0.65, fill: { color: BLUSH } },
    { id: "blushR", type: "ellipse", parent: "headG", x: 82, y: -62, width: 34, height: 18,
      opacity: 0.65, fill: { color: BLUSH } },
    // 目（eyeXG の scaleY で目パチ）
    { id: "eyeLW", type: "ellipse", parent: "eyeLG", x: 0, y: 0, width: 36, height: 46, fill: { color: EYE } },
    { id: "eyeLH", type: "ellipse", parent: "eyeLG", x: 6, y: -10, width: 13, height: 15, fill: { color: "#ffffff" } },
    { id: "eyeRW", type: "ellipse", parent: "eyeRG", x: 0, y: 0, width: 36, height: 46, fill: { color: EYE } },
    { id: "eyeRH", type: "ellipse", parent: "eyeRG", x: 6, y: -10, width: 13, height: 15, fill: { color: "#ffffff" } },
    // 鼻・口
    { id: "nose", type: "polygon", parent: "headG", x: 0, y: -56,
      points: [{ x: -8, y: -5, radius: 3 }, { x: 8, y: -5, radius: 3 }, { x: 0, y: 6, radius: 3 }],
      fill: { color: PINK } },
    { id: "mouth", type: "ellipse", parent: "headG", x: 0, y: -38, width: 22, height: 12,
      fill: { color: "#d98a8a" }, stroke: { color: OUTLINE, thickness: 3 } },
  ],
  animations: [
    // idle: 呼吸 + 首かしげ + 尻尾ゆらゆら + 目パチ（2回/4秒）
    { name: "idle", duration: 240, fps: 60, loop: "loop", tracks: [
      { target: "body", property: "scaleY", keyframes: [
        { frame: 0, value: 1 }, { frame: 120, value: 1.035, easing: "ease-in-out" }, { frame: 240, value: 1, easing: "ease-in-out" } ] },
      { target: "headG", property: "rotation", keyframes: [
        { frame: 0, value: 0 }, { frame: 70, value: 3, easing: "ease-in-out" },
        { frame: 160, value: -2.5, easing: "ease-in-out" }, { frame: 240, value: 0, easing: "ease-in-out" } ] },
      { target: "tailG", property: "rotation", keyframes: [
        { frame: 0, value: 0 }, { frame: 60, value: 10, easing: "ease-in-out" },
        { frame: 130, value: -4, easing: "ease-in-out" }, { frame: 200, value: 8, easing: "ease-in-out" },
        { frame: 240, value: 0, easing: "ease-in-out" } ] },
      { target: "eyeLG", property: "scaleY", keyframes: [
        { frame: 0, value: 1 }, { frame: 95, value: 1 }, { frame: 100, value: 0.08, easing: "ease-in" },
        { frame: 107, value: 1, easing: "ease-out" }, { frame: 200, value: 1 }, { frame: 205, value: 0.08, easing: "ease-in" },
        { frame: 212, value: 1, easing: "ease-out" }, { frame: 240, value: 1 } ] },
      { target: "eyeRG", property: "scaleY", keyframes: [
        { frame: 0, value: 1 }, { frame: 95, value: 1 }, { frame: 100, value: 0.08, easing: "ease-in" },
        { frame: 107, value: 1, easing: "ease-out" }, { frame: 200, value: 1 }, { frame: 205, value: 0.08, easing: "ease-in" },
        { frame: 212, value: 1, easing: "ease-out" }, { frame: 240, value: 1 } ] },
    ] },
    // happy: 尻尾ブンブン + 耳ピクピク + 頭かしげ + 弾み
    { name: "happy", duration: 90, fps: 60, loop: "oneShot", tracks: [
      { target: "tailG", property: "rotation", keyframes: [
        { frame: 0, value: 0 }, { frame: 12, value: -26, easing: "ease-in-out" }, { frame: 28, value: 24, easing: "ease-in-out" },
        { frame: 44, value: -26, easing: "ease-in-out" }, { frame: 60, value: 24, easing: "ease-in-out" },
        { frame: 76, value: -15, easing: "ease-in-out" }, { frame: 90, value: 0, easing: "ease-in-out" } ] },
      { target: "earLG", property: "rotation", keyframes: [
        { frame: 0, value: 0 }, { frame: 8, value: -14, easing: "ease-out" }, { frame: 20, value: 0, easing: "ease-in-out" },
        { frame: 32, value: -8, easing: "ease-out" }, { frame: 44, value: 0, easing: "ease-in-out" } ] },
      { target: "earRG", property: "rotation", keyframes: [
        { frame: 6, value: 0 }, { frame: 14, value: 14, easing: "ease-out" }, { frame: 26, value: 0, easing: "ease-in-out" },
        { frame: 38, value: 8, easing: "ease-out" }, { frame: 50, value: 0, easing: "ease-in-out" } ] },
      { target: "headG", property: "rotation", keyframes: [
        { frame: 0, value: 0 }, { frame: 25, value: 7, easing: "ease-in-out" }, { frame: 65, value: 7 },
        { frame: 90, value: 0, easing: "ease-in-out" } ] },
      { target: "root", property: "y", keyframes: [
        { frame: 0, value: 400 }, { frame: 12, value: 382, easing: "ease-out" }, { frame: 24, value: 400, easing: "ease-in" },
        { frame: 34, value: 388, easing: "ease-out" }, { frame: 44, value: 400, easing: "ease-in" }, { frame: 90, value: 400 } ] },
    ] },
  ],
  stateMachine: {
    name: "Character",
    inputs: [{ name: "happy", type: "trigger" }],
    states: [ { name: "idleS", animation: "idle" }, { name: "happyS", animation: "happy" } ],
    transitions: [
      { from: "entry", to: "idleS" },
      { from: "idleS", to: "happyS", condition: { input: "happy" } },
      { from: "happyS", to: "idleS", exitTimeMs: 1500 },
    ],
  },
};

const { bytes } = createRiv(spec);
writeFileSync("samples/koneko-vector.riv", Buffer.from(bytes));
console.log("koneko-vector.riv:", bytes.length, "bytes");

const host = new RiveHost(PAGE_SCRIPT);
try {
  const idle = await host.renderFrames(Buffer.from(bytes), {
    animation: "idle", frameCount: 60, fps: 15, width: 420, background: "#fdf6ec", format: "rgba" });
  writeFileSync("samples/koneko-vector-idle.gif",
    encodeGif(idle.frames.map((f) => Buffer.from(f, "base64")), idle.width, idle.height, 15));
  const happy = await host.renderFrames(Buffer.from(bytes), {
    animation: "happy", frameCount: 30, fps: 20, width: 420, background: "#fdf6ec", format: "rgba" });
  writeFileSync("samples/koneko-vector-happy.gif",
    encodeGif(happy.frames.map((f) => Buffer.from(f, "base64")), happy.width, happy.height, 20));
  const still = await host.renderFrames(Buffer.from(bytes), {
    animation: "idle", startTime: 0, frameCount: 1, format: "png" });
  writeFileSync("samples/koneko-vector.png", Buffer.from(still.frames[0], "base64"));
  console.log("done");
} finally {
  await host.close();
}
