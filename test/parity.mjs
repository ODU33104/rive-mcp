// 高度機能の全部入り検証シーン
// text / nested / events / listeners / IK / blend1d / multi-layer / multi-artboard
import { readFileSync, writeFileSync } from "node:fs";
import { createRiv } from "../dist/rivWriter.js";
import { readRiv } from "../dist/rivBinary.js";
import { RiveHost } from "../dist/riveHost.js";
import { PAGE_SCRIPT } from "../dist/pageScript.js";

const font = new Uint8Array(readFileSync("assets/inter.ttf"));

const spec = {
  fonts: [{ id: "inter", bytes: font }],
  artboards: [
    {
      name: "Main", width: 500, height: 400, backgroundColor: "#1a1a2e",
      groups: [
        { id: "ikBase", x: 90, y: 360 },
        { id: "ikTarget", x: 200, y: 200 },
      ],
      bones: [
        { id: "b1", parent: "ikBase", rotation: -90, length: 100 },
        { id: "b2", parent: "b1", length: 100 },
      ],
      constraints: [
        { type: "ik", bone: "b2", target: "ikTarget", parentBoneCount: 1 },
      ],
      shapes: [
        { id: "button", type: "rect", x: 400, y: 340, width: 120, height: 50, cornerRadius: 10,
          fill: { color: "#e94560" } },
        { id: "armSeg", type: "rect", parent: "b1", x: 50, y: 0, width: 100, height: 14, cornerRadius: 7,
          fill: { color: "#00d9ff" } },
        { id: "armSeg2", type: "rect", parent: "b2", x: 50, y: 0, width: 100, height: 14, cornerRadius: 7,
          fill: { color: "#0f80ff" } },
        { id: "pulse", type: "ellipse", x: 250, y: 120, width: 50, height: 50,
          fill: { color: "#ffd700" } },
      ],
      texts: [
        { id: "title", x: 20, y: 20, width: 460, align: "center",
          runs: [
            { text: "Hello, ", fontSize: 36, color: "#ffffff" },
            { text: "Rive", name: "nameRun", fontSize: 36, color: "#e94560" },
            { text: "!", fontSize: 36, color: "#ffffff" },
          ] },
      ],
      nested: [
        { id: "widget", artboard: "Widget", x: 30, y: 80 },
      ],
      events: [
        { id: "pressed", type: "custom" },
        { id: "openSite", type: "openUrl", url: "https://example.com" },
      ],
      animations: [
        { name: "idlePulse", duration: 60, loop: "loop", tracks: [
          { target: "pulse", property: "scaleX", keyframes: [
            { frame: 0, value: 1 }, { frame: 30, value: 1.3, easing: "ease-in-out" }, { frame: 60, value: 1 } ] } ] },
        { name: "fastPulse", duration: 60, loop: "loop", tracks: [
          { target: "pulse", property: "scaleX", keyframes: [
            { frame: 0, value: 1 }, { frame: 15, value: 1.8, easing: "ease-out-back" }, { frame: 30, value: 1 },
            { frame: 45, value: 1.8 }, { frame: 60, value: 1 } ] } ] },
        { name: "moveTarget", duration: 120, loop: "pingPong", tracks: [
          { target: "ikTarget", property: "x", keyframes: [
            { frame: 0, value: 120 }, { frame: 120, value: 280, easing: "ease-in-out" } ] },
          { target: "ikTarget", property: "y", keyframes: [
            { frame: 0, value: 240 }, { frame: 120, value: 160, easing: "ease-in-out" } ] } ] },
        { name: "buttonFlash", duration: 30, loop: "oneShot", tracks: [
          { target: "button", property: "fillColor", keyframes: [
            { frame: 0, color: "#e94560" }, { frame: 10, color: "#ffffff" }, { frame: 30, color: "#e94560" } ] } ] },
      ],
      stateMachine: {
        name: "Main",
        inputs: [
          { name: "clicked", type: "trigger" },
          { name: "mix", type: "number", initial: 0 },
        ],
        layers: [
          { name: "blendLayer", states: [
              { name: "pulseBlend", blend1d: { input: "mix", animations: [
                { animation: "idlePulse", value: 0 }, { animation: "fastPulse", value: 100 } ] } } ],
            transitions: [{ from: "entry", to: "pulseBlend" }] },
          { name: "armLayer", states: [{ name: "moving", animation: "moveTarget" }],
            transitions: [{ from: "entry", to: "moving" }] },
          { name: "buttonLayer", states: [
              { name: "idleB", animation: "idlePulse" },
              { name: "flash", animation: "buttonFlash", fireEvent: "pressed" } ],
            transitions: [
              { from: "entry", to: "idleB" },
              { from: "idleB", to: "flash", condition: { input: "clicked" } },
              { from: "flash", to: "idleB", exitTimeMs: 500 } ] },
        ],
        listeners: [
          { target: "button", type: "click", actions: [{ input: "clicked" }] },
        ],
      },
    },
    {
      name: "Widget", width: 100, height: 100, backgroundColor: "#16213e",
      shapes: [
        { id: "dot", type: "ellipse", x: 50, y: 50, width: 60, height: 60, fill: { color: "#45e960" } },
      ],
      animations: [
        { name: "spinW", duration: 60, loop: "loop", tracks: [
          { target: "dot", property: "scaleY", keyframes: [
            { frame: 0, value: 1 }, { frame: 30, value: 0.5, easing: "ease-in-out" }, { frame: 60, value: 1 } ] } ] },
      ],
      stateMachine: {
        name: "WidgetSM",
        inputs: [{ name: "active", type: "bool", initial: true }],
        states: [{ name: "s", animation: "spinW" }],
        transitions: [{ from: "entry", to: "s" }],
      },
    },
  ],
};

const { bytes } = createRiv(spec);
writeFileSync("samples/parity.riv", Buffer.from(bytes));
console.log("parity.riv:", bytes.length, "bytes");

// 自己リード
const dump = readRiv(bytes, { tolerant: true });
console.log("self-read:", dump.objects.length, "objects, error:", dump.error ?? "none");
const counts = {};
dump.objects.forEach((o) => (counts[o.typeName] = (counts[o.typeName] || 0) + 1));
console.log(JSON.stringify(counts));

// 公式ランタイム検証
const host = new RiveHost(PAGE_SCRIPT);
try {
  const info = await host.inspect(Buffer.from(bytes));
  console.log("inspect:", JSON.stringify(info));
  const r = await host.renderFrames(Buffer.from(bytes), {
    artboard: "Main", stateMachine: "Main", startTime: 0.5, frameCount: 1, format: "png" });
  writeFileSync("samples/parity.png", Buffer.from(r.frames[0], "base64"));
  console.log("rendered -> samples/parity.png");
  // trigger発火でbuttonLayerが遷移するか
  const play = await host.playStateMachine(Buffer.from(bytes), {
    artboard: "Main", stateMachine: "Main",
    steps: [{ advance: 0.2 }, { input: "clicked", advance: 0.2 }, { advance: 0.6 }],
  });
  console.log("SM:", JSON.stringify(play.report.map((s) => ({ step: s.step, states: s.statesChanged }))));
} finally {
  await host.close();
}
