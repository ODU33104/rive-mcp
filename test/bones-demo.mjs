// ボーン+スキニングの検証: 縦ストリップ画像を3ボーンチェーンで滑らかに曲げる
import { writeFileSync } from "node:fs";
import { createRiv } from "../dist/rivWriter.js";
import { RiveHost } from "../dist/riveHost.js";
import { PAGE_SCRIPT } from "../dist/pageScript.js";
import { encodeGif } from "../dist/gif.js";

const host = new RiveHost(PAGE_SCRIPT);
try {
  // 1. テスト用ストリップPNGを自前レンダラーで生成（幅120x高さ480のグラデ角丸棒）
  const stripSpec = {
    artboard: { width: 120, height: 480 },
    shapes: [{
      id: "bar", type: "rect", x: 60, y: 240, width: 100, height: 460, cornerRadius: 40,
      fill: { gradient: { type: "linear", stops: [{ color: "#ff8c42" }, { color: "#a23bcf" }],
        start: { x: 0, y: -230 }, end: { x: 0, y: 230 } } },
      stroke: { color: "#5a2a70", thickness: 6 },
    }],
  };
  const strip = createRiv(stripSpec).bytes;
  const stripPng = await host.renderFrames(Buffer.from(strip), { frameCount: 1, format: "png" });
  const pngBytes = new Uint8Array(Buffer.from(stripPng.frames[0], "base64"));
  console.log("strip png:", pngBytes.length, "bytes");

  // 2. 3ボーンチェーンにスキニング（根元は下、上に向かって b1→b2→b3）
  const spec = {
    artboard: { width: 500, height: 560 },
    backgroundColor: "#fdf6ec",
    groups: [{ id: "base", x: 250, y: 520 }],
    bones: [
      { id: "b1", parent: "base", x: 0, y: 0, rotation: -90, length: 160 },
      { id: "b2", parent: "b1", length: 160 },
      { id: "b3", parent: "b2", length: 160 },
    ],
    images: [{
      id: "strip", bytes: pngBytes, x: 0, y: -240, parent: "base",
      mesh: { columns: 2, rows: 12, bones: ["b1", "b2", "b3"] },
    }],
    animations: [{
      name: "sway", duration: 120, fps: 60, loop: "loop",
      tracks: [
        { target: "b2", property: "rotation", keyframes: [
          { frame: 0, value: 0 }, { frame: 30, value: 28, easing: "ease-in-out" },
          { frame: 90, value: -28, easing: "ease-in-out" }, { frame: 120, value: 0, easing: "ease-in-out" } ] },
        { target: "b3", property: "rotation", keyframes: [
          { frame: 0, value: 0 }, { frame: 40, value: 36, easing: "ease-in-out" },
          { frame: 100, value: -36, easing: "ease-in-out" }, { frame: 120, value: 0, easing: "ease-in-out" } ] },
      ],
    }],
  };
  const { bytes } = createRiv(spec);
  writeFileSync("samples/bones-test.riv", Buffer.from(bytes));
  console.log("bones-test.riv:", bytes.length, "bytes");

  // 3. 検証: 静止フレーム（バインド姿勢が崩れていないか）+ 曲げピーク + GIF
  const rest = await host.renderFrames(Buffer.from(bytes), { animation: "sway", startTime: 0, frameCount: 1, format: "png" });
  writeFileSync("samples/bones-rest.png", Buffer.from(rest.frames[0], "base64"));
  const peak = await host.renderFrames(Buffer.from(bytes), { animation: "sway", startTime: 0.55, frameCount: 1, format: "png" });
  writeFileSync("samples/bones-peak.png", Buffer.from(peak.frames[0], "base64"));
  const anim = await host.renderFrames(Buffer.from(bytes), {
    animation: "sway", frameCount: 30, fps: 15, width: 400, background: "#fdf6ec", format: "rgba" });
  writeFileSync("samples/bones-sway.gif",
    encodeGif(anim.frames.map((f) => Buffer.from(f, "base64")), anim.width, anim.height, 15));
  console.log("done: bones-rest.png / bones-peak.png / bones-sway.gif");
} finally {
  await host.close();
}
