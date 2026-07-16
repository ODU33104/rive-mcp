// 実利用デモ: MCP プロトコル経由で Jeep の weather ステートマシンを駆動する
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const RIV = join(root, "samples", "vehicles.riv");

const child = spawn(process.execPath, [join(root, "dist", "index.js")], {
  stdio: ["pipe", "pipe", "inherit"],
});

let buffer = "";
const pending = new Map();
let nextId = 1;
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  }
});
const rpc = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => pending.has(id) && (pending.delete(id), reject(new Error("timeout"))), 120_000);
  });

await rpc("initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "demo", version: "0.0.1" },
});
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

// 雨を降らせて 1 秒後をキャプチャ → 晴れに戻して 1 秒後をキャプチャ
const play = await rpc("tools/call", {
  name: "riv_play_state_machine",
  arguments: {
    path: RIV,
    artboard: "Jeep",
    stateMachine: "weather",
    width: 600,
    background: "#e8f4fd",
    steps: [
      { input: "Raining", value: true, advance: 1.2, capture: true },
      { input: "Raining", value: false, advance: 1.2, capture: true },
    ],
  },
});
console.log(play.content.filter((c) => c.type === "text").map((c) => c.text).join("\n"));
const images = play.content.filter((c) => c.type === "image");
images.forEach((img, i) => {
  const p = join(root, "samples", `demo-weather-${i === 0 ? "rainy" : "sunny"}.png`);
  writeFileSync(p, Buffer.from(img.data, "base64"));
  console.log("saved:", p);
});

// Jeep の雨シーンを GIF に
const gif = await rpc("tools/call", {
  name: "riv_render_gif",
  arguments: {
    path: RIV,
    artboard: "Jeep",
    animation: "rainy",
    duration: 2,
    fps: 15,
    width: 400,
    outPath: join(root, "samples", "demo-jeep-rainy.gif"),
  },
});
console.log(gif.content.filter((c) => c.type === "text").map((c) => c.text).join("\n"));

child.kill();
process.exit(0);
