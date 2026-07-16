// 方式B: koneko_base.png をパーツ分割し、ボーン+リグで部位アニメーション
// 構成: 耳L/R・尻尾 = PNG切り出しパーツ（ピボット回転）、頭の傾き = 2ボーンスキンメッシュ、
//       目パチ = ベクターまぶたオーバーレイ、穴埋めパッチ = ベクター
import { readFileSync, writeFileSync } from "node:fs";
import { createRiv } from "../dist/rivWriter.js";
import { RiveHost } from "../dist/riveHost.js";
import { PAGE_SCRIPT } from "../dist/pageScript.js";
import { encodeGif } from "../dist/gif.js";

const S = 0.3; // 画像スケール
const C = { x: 300, y: 260 }; // base画像中心のワールド座標
const toWorld = (px, py) => ({ x: C.x + (px - 768) * S, y: C.y + (py - 512) * S });

const REGIONS = [
  { name: "earL", polygon: [[505, 360], [525, 150], [575, 140], [690, 335], [690, 360]] },
  { name: "earR", polygon: [[865, 335], [895, 265], [945, 115], [1005, 105], [1080, 335], [1050, 365]] },
  { name: "tail", polygon: [[495, 690], [660, 655], [750, 780], [735, 940], [530, 940]] },
];
// 各パーツのピボット（画像座標系: 付け根）
const PIVOTS = { earL: [600, 345], earR: [975, 340], tail: [735, 800] };

const png = readFileSync("samples/uchinoko_character/koneko_base.png");
const host = new RiveHost(PAGE_SCRIPT);
try {
  const sliced = await host.sliceImage(png, REGIONS);
  const part = Object.fromEntries(sliced.parts.map((p) => [p.name, p]));

  const rootW = { x: 300, y: 410 };
  const headGW = { x: 300, y: 270 }; // 首（headBone先端と一致させる）
  const groups = [
    { id: "root", x: rootW.x, y: rootW.y },
    { id: "headG", x: headGW.x - rootW.x, y: headGW.y - rootW.y, parent: "root" },
  ];
  const images = [
    { id: "base", bytes: new Uint8Array(Buffer.from(sliced.base, "base64")),
      x: C.x - rootW.x, y: C.y - rootW.y, scale: S, parent: "root",
      mesh: { columns: 8, rows: 8, bones: ["bodyBone", "headBone"] }, z: 1000 },
  ];
  const shapes = [];
  const partGroup = (name, parent, parentW) => {
    const pv = toWorld(...PIVOTS[name]);
    groups.push({ id: name + "G", x: pv.x - parentW.x, y: pv.y - parentW.y, parent });
    const p = part[name];
    const cW = toWorld(p.x + p.width / 2, p.y + p.height / 2);
    images.push({
      id: name, bytes: new Uint8Array(Buffer.from(p.png, "base64")),
      x: cW.x - pv.x, y: cW.y - pv.y, scale: S, parent: name + "G",
      z: name === "tail" ? 999 : 1001, // 尻尾は体の後ろ、耳は前
    });
    return pv;
  };
  partGroup("earL", "headG", headGW);
  partGroup("earR", "headG", headGW);
  partGroup("tail", "root", rootW);

  // 耳の穴埋めパッチ（base の上・耳の下 z=1000.5）
  for (const [name, dx] of [["earL", -50.4], ["earR", 62.1]]) {
    const pv = toWorld(...PIVOTS[name]);
    shapes.push({
      id: name + "Patch", type: "ellipse", parent: "headG",
      x: pv.x - headGW.x, y: pv.y - headGW.y - 6, width: 52, height: 30,
      fill: { color: "#f9efe3" }, z: 1000.5,
    });
  }
  // まぶた（目パチ用オーバーレイ、通常 opacity 0）
  const eyes = { L: toWorld(700, 435), R: toWorld(905, 430) };
  for (const k of ["L", "R"]) {
    shapes.push({
      id: "lid" + k, type: "ellipse", parent: "headG",
      x: eyes[k].x - headGW.x, y: eyes[k].y - headGW.y, width: 33, height: 40,
      opacity: 0, fill: { color: "#f8eee2" }, z: 1500,
    });
    shapes.push({
      id: "lash" + k, type: "rect", parent: "headG",
      x: eyes[k].x - headGW.x, y: eyes[k].y - headGW.y + 3, width: 28, height: 4.5, cornerRadius: 2,
      opacity: 0, fill: { color: "#6b4a3a" }, z: 1501,
    });
  }

  const blinkKeys = [
    { frame: 0, value: 0, easing: "hold" }, { frame: 96, value: 1, easing: "hold" },
    { frame: 104, value: 0, easing: "hold" }, { frame: 196, value: 1, easing: "hold" },
    { frame: 204, value: 0, easing: "hold" }, { frame: 240, value: 0 },
  ];
  const headTiltKeys = [
    { frame: 0, value: 0 }, { frame: 70, value: 3.2, easing: "ease-in-out" },
    { frame: 160, value: -2.6, easing: "ease-in-out" }, { frame: 240, value: 0, easing: "ease-in-out" },
  ];
  const spec = {
    artboard: { name: "KonekoParts", width: 600, height: 460 },
    backgroundColor: "#fdf6ec",
    groups,
    bones: [
      { id: "bodyBone", parent: "root", x: 0, y: -20, rotation: -90, length: 120 },
      { id: "headBone", parent: "bodyBone", length: 110 },
    ],
    shapes,
    images,
    animations: [
      { name: "idle", duration: 240, fps: 60, loop: "loop", tracks: [
        // 頭の傾き: スキンメッシュ(headBone)とパーツ(headG)を同角で同期
        { target: "headBone", property: "rotation", keyframes: headTiltKeys },
        { target: "headG", property: "rotation", keyframes: headTiltKeys },
        { target: "root", property: "scaleY", keyframes: [
          { frame: 0, value: 1 }, { frame: 120, value: 1.015, easing: "ease-in-out" }, { frame: 240, value: 1, easing: "ease-in-out" } ] },
        { target: "tailG", property: "rotation", keyframes: [
          { frame: 0, value: 0 }, { frame: 60, value: 9, easing: "ease-in-out" },
          { frame: 130, value: -4, easing: "ease-in-out" }, { frame: 200, value: 7, easing: "ease-in-out" },
          { frame: 240, value: 0, easing: "ease-in-out" } ] },
        ...["lidL", "lidR", "lashL", "lashR"].map((t) => ({ target: t, property: "opacity", keyframes: blinkKeys })),
      ] },
      { name: "happy", duration: 90, fps: 60, loop: "oneShot", tracks: [
        { target: "tailG", property: "rotation", keyframes: [
          { frame: 0, value: 0 }, { frame: 12, value: -24, easing: "ease-in-out" }, { frame: 28, value: 22, easing: "ease-in-out" },
          { frame: 44, value: -24, easing: "ease-in-out" }, { frame: 60, value: 22, easing: "ease-in-out" },
          { frame: 76, value: -12, easing: "ease-in-out" }, { frame: 90, value: 0, easing: "ease-in-out" } ] },
        { target: "earLG", property: "rotation", keyframes: [
          { frame: 0, value: 0 }, { frame: 8, value: -10, easing: "ease-out" }, { frame: 20, value: 0, easing: "ease-in-out" },
          { frame: 34, value: -6, easing: "ease-out" }, { frame: 46, value: 0, easing: "ease-in-out" } ] },
        { target: "earRG", property: "rotation", keyframes: [
          { frame: 6, value: 0 }, { frame: 14, value: 10, easing: "ease-out" }, { frame: 26, value: 0, easing: "ease-in-out" },
          { frame: 40, value: 6, easing: "ease-out" }, { frame: 52, value: 0, easing: "ease-in-out" } ] },
        { target: "headBone", property: "rotation", keyframes: [
          { frame: 0, value: 0 }, { frame: 25, value: 5, easing: "ease-in-out" }, { frame: 65, value: 5 }, { frame: 90, value: 0, easing: "ease-in-out" } ] },
        { target: "headG", property: "rotation", keyframes: [
          { frame: 0, value: 0 }, { frame: 25, value: 5, easing: "ease-in-out" }, { frame: 65, value: 5 }, { frame: 90, value: 0, easing: "ease-in-out" } ] },
        { target: "root", property: "y", keyframes: [
          { frame: 0, value: 410 }, { frame: 12, value: 392, easing: "ease-out" }, { frame: 24, value: 410, easing: "ease-in" },
          { frame: 34, value: 398, easing: "ease-out" }, { frame: 44, value: 410, easing: "ease-in" }, { frame: 90, value: 410 } ] },
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
  writeFileSync("samples/koneko-parts.riv", Buffer.from(bytes));
  console.log("koneko-parts.riv:", bytes.length, "bytes");

  const rest = await host.renderFrames(Buffer.from(bytes), { animation: "idle", startTime: 0, frameCount: 1, format: "png" });
  writeFileSync("samples/koneko-parts-rest.png", Buffer.from(rest.frames[0], "base64"));
  const blink = await host.renderFrames(Buffer.from(bytes), { animation: "idle", startTime: 100 / 60, frameCount: 1, format: "png" });
  writeFileSync("samples/koneko-parts-blink.png", Buffer.from(blink.frames[0], "base64"));
  const idle = await host.renderFrames(Buffer.from(bytes), {
    animation: "idle", frameCount: 60, fps: 15, width: 480, background: "#fdf6ec", format: "rgba" });
  writeFileSync("samples/koneko-parts-idle.gif",
    encodeGif(idle.frames.map((f) => Buffer.from(f, "base64")), idle.width, idle.height, 15));
  const happy = await host.renderFrames(Buffer.from(bytes), {
    animation: "happy", frameCount: 30, fps: 20, width: 480, background: "#fdf6ec", format: "rgba" });
  writeFileSync("samples/koneko-parts-happy.gif",
    encodeGif(happy.frames.map((f) => Buffer.from(f, "base64")), happy.width, happy.height, 20));
  console.log("done: rest/blink png + idle/happy gif");
} finally {
  await host.close();
}
