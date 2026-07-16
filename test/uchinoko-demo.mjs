// UCHINOKO キャラクター自然モーションデモ
// 1枚絵PNG → メッシュ変形で呼吸・首かしげ、SM で興奮バウンスをトリガー
import { readFileSync, writeFileSync } from "node:fs";
import { createRiv } from "../dist/rivWriter.js";
import { RiveHost } from "../dist/riveHost.js";
import { PAGE_SCRIPT } from "../dist/pageScript.js";
import { encodeGif } from "../dist/gif.js";

const png = new Uint8Array(readFileSync("samples/uchinoko_character/koneko_base.png"));
const W = 1536; // natural
const COLS = 8, ROWS = 8;

// 首かしげ: 上の行ほど大きく横に振る（行別ウェイト）
const swayWeight = [1.0, 0.8, 0.55, 0.3, 0.12, 0, 0, 0, 0];
// 呼吸: 胸〜体の行がゆっくり上下
const breathWeight = [0.3, 0.5, 0.9, 1.0, 0.8, 0.4, 0.1, 0, 0];

const tracks = [];
for (let r = 0; r <= ROWS; r++) {
  for (let c = 0; c <= COLS; c++) {
    const x0 = (c / COLS - 0.5) * W;
    const y0 = (r / ROWS - 0.5) * 1024;
    if (swayWeight[r] > 0) {
      const amp = 38 * swayWeight[r];
      tracks.push({
        target: `koneko#v${r}_${c}`, property: "x",
        keyframes: [
          { frame: 0, value: x0 },
          { frame: 60, value: x0 + amp, easing: "ease-in-out" },
          { frame: 150, value: x0 - amp * 0.7, easing: "ease-in-out" },
          { frame: 240, value: x0, easing: "ease-in-out" },
        ],
      });
    }
    if (breathWeight[r] > 0) {
      const amp = 9 * breathWeight[r];
      tracks.push({
        target: `koneko#v${r}_${c}`, property: "y",
        keyframes: [
          { frame: 0, value: y0 },
          { frame: 120, value: y0 - amp, easing: "ease-in-out" },
          { frame: 240, value: y0, easing: "ease-in-out" },
        ],
      });
    }
  }
}

const spec = {
  artboard: { name: "Koneko", width: 600, height: 400 },
  backgroundColor: "#fdf6ec",
  groups: [{ id: "rig", x: 300, y: 210 }],
  images: [{ id: "koneko", pngPath: "x", bytes: png, x: 0, y: 0, scale: 0.28, parent: "rig", mesh: { columns: COLS, rows: ROWS } }],
  animations: [
    { name: "idle", duration: 240, fps: 60, loop: "loop", tracks },
    {
      name: "excited", duration: 60, fps: 60, loop: "oneShot",
      tracks: [
        { target: "rig", property: "y", keyframes: [
          { frame: 0, value: 210 }, { frame: 12, value: 165, easing: "ease-out" },
          { frame: 24, value: 210, easing: "ease-in" }, { frame: 36, value: 175, easing: "ease-out" },
          { frame: 48, value: 210, easing: "ease-in" }, { frame: 60, value: 210 } ] },
        { target: "rig", property: "scaleY", keyframes: [
          { frame: 0, value: 1 }, { frame: 10, value: 1.06, easing: "ease-out" },
          { frame: 24, value: 0.94, easing: "ease-in" }, { frame: 34, value: 1.05, easing: "ease-out" },
          { frame: 48, value: 0.96, easing: "ease-in" }, { frame: 60, value: 1 } ] },
        { target: "rig", property: "scaleX", keyframes: [
          { frame: 0, value: 1 }, { frame: 24, value: 1.04 },
          { frame: 48, value: 1.03 }, { frame: 60, value: 1 } ] },
      ],
    },
  ],
  stateMachine: {
    name: "Character",
    inputs: [{ name: "happy", type: "trigger" }],
    states: [
      { name: "idle", animation: "idle" },
      { name: "excitedState", animation: "excited" },
    ],
    transitions: [
      { from: "entry", to: "idle" },
      { from: "idle", to: "excitedState", condition: { input: "happy" } },
      { from: "excitedState", to: "idle", exitTimeMs: 1000 },
    ],
  },
};

const { bytes } = createRiv(spec);
writeFileSync("samples/koneko-live.riv", Buffer.from(bytes));
console.log("koneko-live.riv:", bytes.length, "bytes");

const host = new RiveHost(PAGE_SCRIPT);
try {
  // idle ループ GIF（4秒）
  const idle = await host.renderFrames(Buffer.from(bytes), {
    animation: "idle", frameCount: 60, fps: 15, width: 480, background: "#fdf6ec", format: "rgba",
  });
  writeFileSync("samples/koneko-idle.gif",
    encodeGif(idle.frames.map((f) => Buffer.from(f, "base64")), idle.width, idle.height, 15));

  // excited GIF（1秒）
  const ex = await host.renderFrames(Buffer.from(bytes), {
    animation: "excited", frameCount: 20, fps: 20, width: 480, background: "#fdf6ec", format: "rgba",
  });
  writeFileSync("samples/koneko-excited.gif",
    encodeGif(ex.frames.map((f) => Buffer.from(f, "base64")), ex.width, ex.height, 20));

  // SM 検証: happy トリガー → excited へ遷移 → exit time で idle に自動復帰
  const play = await host.playStateMachine(Buffer.from(bytes), {
    stateMachine: "Character",
    steps: [
      { advance: 0.2 },
      { input: "happy", advance: 0.3 },
      { advance: 1.2 },
    ],
  });
  console.log("SM report:", JSON.stringify(play.report.map((s) => ({ step: s.step, states: s.statesChanged }))));
} finally {
  await host.close();
}
console.log("done: koneko-idle.gif / koneko-excited.gif / koneko-live.riv");
