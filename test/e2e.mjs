// stdio JSON-RPC で実サーバーを spawn し全ツールを実呼び出しする E2E テスト
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
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

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }
    }, 120_000);
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

async function callTool(name, args) {
  const res = await rpc("tools/call", { name, arguments: args });
  return res;
}

let failures = 0;
function check(label, cond, detail = "") {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${detail ? " — " + detail : ""}`);
}

function textOf(res) {
  return (res.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
}

try {
  // handshake
  const init = await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "e2e-test", version: "0.0.1" },
  });
  check("initialize", init.serverInfo?.name === "rive-mcp", init.serverInfo?.name);
  notify("notifications/initialized", {});

  const tools = await rpc("tools/list", {});
  const names = tools.tools.map((t) => t.name).sort();
  console.log("tools:", names.join(", "));
  check("tools/list has 14 tools", names.length === 14, names.join(","));

  // riv_list
  const list = await callTool("riv_list", { dir: join(root, "samples") });
  check("riv_list finds vehicles.riv", textOf(list).includes("vehicles.riv"), textOf(list).slice(0, 200));

  // riv_inspect
  const inspect = await callTool("riv_inspect", { path: RIV });
  const inspectText = textOf(inspect);
  console.log("--- inspect ---\n" + inspectText);
  check("riv_inspect not error", !inspect.isError);
  const meta = JSON.parse(inspectText);
  check("riv_inspect has artboards", meta.artboardCount >= 1);

  const ab = meta.artboards[0];
  const anim = ab.animations[0];
  const sm = ab.stateMachines[0];

  // riv_render_frame
  const frame = await callTool("riv_render_frame", {
    path: RIV,
    time: 0.5,
    outPath: join(root, "samples", "test-frame.png"),
  });
  check("riv_render_frame not error", !frame.isError, textOf(frame));
  const img = (frame.content || []).find((c) => c.type === "image");
  check("riv_render_frame returns image", !!img && img.data.length > 1000);
  check(
    "riv_render_frame writes png",
    existsSync(join(root, "samples", "test-frame.png")) &&
      statSync(join(root, "samples", "test-frame.png")).size > 1000
  );

  // riv_render_gif
  const gif = await callTool("riv_render_gif", {
    path: RIV,
    duration: 1.5,
    fps: 12,
    width: 320,
    outPath: join(root, "samples", "test-preview.gif"),
  });
  check("riv_render_gif not error", !gif.isError, textOf(gif));
  {
    const gifPath = join(root, "samples", "test-preview.gif");
    const bytes = existsSync(gifPath) ? await import("node:fs").then((m) => m.readFileSync(gifPath)) : null;
    // GIF内の Graphic Control Extension (21 F9 04) の個数 = フレーム数
    let frameCount = 0;
    if (bytes) {
      for (let i = 0; i < bytes.length - 2; i++) {
        if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) frameCount++;
      }
    }
    check(
      "riv_render_gif writes animated gif (18 frames)",
      !!bytes && bytes.subarray(0, 6).toString() === "GIF89a" && frameCount === 18,
      bytes ? `${bytes.length} bytes, ${frameCount} frames` : "missing"
    );
  }

  // riv_play_state_machine
  if (sm) {
    const steps = [];
    const boolInput = sm.inputs.find((i) => i.type === "boolean");
    const numInput = sm.inputs.find((i) => i.type === "number");
    const trigInput = sm.inputs.find((i) => i.type === "trigger");
    if (boolInput) steps.push({ input: boolInput.name, value: !boolInput.value, advance: 0.5, capture: true });
    if (numInput) steps.push({ input: numInput.name, value: 50, advance: 0.5 });
    if (trigInput) steps.push({ input: trigInput.name, advance: 0.5 });
    if (!steps.length) steps.push({ advance: 1.0, capture: true });
    const play = await callTool("riv_play_state_machine", { path: RIV, steps });
    const playText = textOf(play);
    console.log("--- play_state_machine ---\n" + playText.slice(0, 1500));
    check("riv_play_state_machine not error", !play.isError);
    check("riv_play_state_machine has report", playText.includes("report"));
  } else {
    console.log("(no state machine in sample — skipping play test)");
  }

  // riv_generate_code (react + flutter)
  for (const fw of ["react", "flutter"]) {
    const code = await callTool("riv_generate_code", { path: RIV, framework: fw });
    const codeText = textOf(code);
    check(
      `riv_generate_code ${fw} mentions real artboard '${ab.name}'`,
      !code.isError && codeText.includes(ab.name)
    );
    if (fw === "react") console.log("--- react code ---\n" + codeText);
  }

  // riv_dump
  const dump = await callTool("riv_dump", { path: RIV });
  const dumpText = textOf(dump);
  check(
    "riv_dump parses vehicles.riv fully",
    !dump.isError && dumpText.includes('"objectCount": 3939') && dumpText.includes('"parseError": null')
  );

  // riv_create: 生成 → 公式ランタイム検証 → SM実駆動
  const genPath = join(root, "samples", "e2e-generated.riv");
  const created = await callTool("riv_create", {
    outPath: genPath,
    scene: {
      artboard: { name: "Gen", width: 300, height: 200 },
      backgroundColor: "#222244",
      shapes: [
        { id: "sq", type: "rect", x: 80, y: 100, width: 60, height: 60, cornerRadius: 8, fill: { color: "#e94560" } },
        { id: "dot", type: "ellipse", x: 220, y: 100, width: 50, height: 50, fill: { gradient: { stops: [{ color: "#00d9ff" }, { color: "#0066ff" }] } } },
        { id: "tri", type: "polygon", x: 150, y: 60, points: [{ x: 0, y: -25 }, { x: 22, y: 13 }, { x: -22, y: 13 }], fill: { color: "#ffd700" } },
      ],
      animations: [
        {
          name: "wobble", duration: 60, loop: "loop",
          tracks: [
            { target: "sq", property: "rotation", keyframes: [{ frame: 0, value: 0 }, { frame: 60, value: 360 }] },
            { target: "dot", property: "scaleX", keyframes: [{ frame: 0, value: 1 }, { frame: 30, value: 1.5, easing: "ease-in-out" }, { frame: 60, value: 1 }] },
            { target: "sq", property: "fillColor", keyframes: [{ frame: 0, color: "#e94560" }, { frame: 60, color: "#45e960" }] },
          ],
        },
        { name: "still", duration: 10, loop: "oneShot", tracks: [] },
      ],
      stateMachine: {
        name: "Flow",
        inputs: [{ name: "active", type: "bool" }],
        states: [{ name: "idle", animation: "still" }, { name: "moving", animation: "wobble" }],
        transitions: [
          { from: "entry", to: "idle" },
          { from: "idle", to: "moving", condition: { input: "active" } },
        ],
      },
    },
  });
  const createdText = textOf(created);
  check("riv_create validated by official runtime", !created.isError && createdText.includes("validated"), createdText.slice(0, 300));
  check("riv_create returns preview image", (created.content || []).some((c) => c.type === "image"));
  check(
    "riv_create SM structure recognized",
    createdText.includes('"Flow"') && createdText.includes('"active"')
  );

  // riv_create: 画像埋め込み + グループ + メッシュ頂点アニメ
  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const pngPath = join(root, "samples", "e2e-tiny.png");
  await import("node:fs").then((m) => m.writeFileSync(pngPath, tinyPng));
  const imgCreated = await callTool("riv_create", {
    outPath: join(root, "samples", "e2e-image.riv"),
    scene: {
      artboard: { width: 100, height: 100 },
      groups: [{ id: "rig", x: 50, y: 50 }],
      images: [{ id: "img", pngPath, x: 0, y: 0, scale: 40, parent: "rig", mesh: { columns: 2, rows: 2 } }],
      animations: [
        {
          name: "wiggle", duration: 30, loop: "loop",
          tracks: [
            { target: "rig", property: "y", keyframes: [{ frame: 0, value: 50 }, { frame: 30, value: 40 }] },
            { target: "img#v0_1", property: "x", keyframes: [{ frame: 0, value: 0 }, { frame: 30, value: 10 }] },
          ],
        },
      ],
    },
  });
  check(
    "riv_create embeds image + mesh + group",
    !imgCreated.isError && textOf(imgCreated).includes("validated"),
    textOf(imgCreated).slice(0, 250)
  );

  // riv_create: ボーン+スキニング（バインド姿勢が壊れていないか = 公式ランタイムで受理+レンダリング）
  const boneCreated = await callTool("riv_create", {
    outPath: join(root, "samples", "e2e-bones.riv"),
    scene: {
      artboard: { width: 100, height: 100 },
      groups: [{ id: "base", x: 50, y: 90 }],
      bones: [
        { id: "b1", parent: "base", rotation: -90, length: 40 },
        { id: "b2", parent: "b1", length: 40 },
      ],
      images: [{ id: "img", pngPath, x: 0, y: -40, scale: 40, parent: "base", mesh: { columns: 2, rows: 6, bones: ["b1", "b2"] } }],
      animations: [
        { name: "bend", duration: 30, loop: "loop",
          tracks: [{ target: "b2", property: "rotation", keyframes: [{ frame: 0, value: 0 }, { frame: 30, value: 45 }] }] },
      ],
    },
  });
  check(
    "riv_create bones + skinning validated",
    !boneCreated.isError && textOf(boneCreated).includes("validated"),
    textOf(boneCreated).slice(0, 250)
  );

  // riv_slice_image
  const sliced = await callTool("riv_slice_image", {
    pngPath: join(root, "samples", "vehicles.riv").replace("vehicles.riv", "e2e-tiny.png"),
    outDir: join(root, "samples", "e2e-slices"),
    regions: [{ name: "whole", polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] }],
  });
  check(
    "riv_slice_image writes parts",
    !sliced.isError && textOf(sliced).includes("whole.png") && textOf(sliced).includes("base.png"),
    textOf(sliced).slice(0, 200)
  );

  // 生成ファイルのSMを実駆動: active=true で idle→moving に遷移するか
  const genPlay = await callTool("riv_play_state_machine", {
    path: genPath,
    stateMachine: "Flow",
    steps: [
      { advance: 0.1 },
      { input: "active", value: true, advance: 0.3, capture: true },
    ],
  });
  const genPlayText = textOf(genPlay);
  // 遷移先state(moving)の状態変化はアニメーション名("wobble")で報告される仕様
  check(
    "generated SM transitions on input",
    !genPlay.isError && genPlayText.includes("wobble"),
    genPlayText.slice(0, 400)
  );

  // riv_edit: プロパティ変更
  const edited = await callTool("riv_edit", {
    path: genPath,
    outPath: join(root, "samples", "e2e-edited.riv"),
    edits: [{ op: "set", name: "sq", type: "Shape", set: { x: 150 } }],
  });
  check("riv_edit sets property", !edited.isError && textOf(edited).includes("set #"), textOf(edited).slice(0, 200));

  // riv_diff
  const diff = await callTool("riv_diff", { pathA: genPath, pathB: join(root, "samples", "e2e-edited.riv") });
  check("riv_diff detects change", !diff.isError && textOf(diff).includes("x: 80 -> 150"), textOf(diff).slice(0, 300));

  // HLAPI: bake + particles
  const hlapi = await callTool("riv_create", {
    outPath: join(root, "samples", "e2e-hlapi.riv"),
    scene: {
      artboard: { width: 200, height: 200 },
      shapes: [{ id: "b", type: "ellipse", x: 100, y: 40, width: 30, height: 30, fill: { color: "#e94560" } }],
      particles: [{ prefab: "snow", count: 5, area: { x: 0, y: 0, width: 200, height: 200 }, animation: "fx" }],
      animations: [{ name: "fx", duration: 90, loop: "loop", tracks: [
        { target: "b", property: "y", bake: { type: "gravity", from: 40, to: 170 } } ] }],
    },
  });
  check("riv_create HLAPI bake+particles", !hlapi.isError && textOf(hlapi).includes("validated"), textOf(hlapi).slice(0, 200));

  // riv_rig_character（最小: パーツ無し・目のみ）
  const rig = await callTool("riv_rig_character", {
    pngPath: pngPath,
    outPath: join(root, "samples", "e2e-rig.riv"),
    eyes: [{ x: 0, y: 0, width: 1, height: 1 }],
  });
  check("riv_rig_character generates rig", !rig.isError && textOf(rig).includes("idle"), textOf(rig).slice(0, 250));

  // riv_studio: 起動→/state→停止
  const studio = await callTool("riv_studio", { path: genPath, port: 8797 });
  check("riv_studio starts", !studio.isError && textOf(studio).includes("http://localhost:8797/"));
  const stateRes = await fetch("http://localhost:8797/state").then((r2) => r2.json()).catch(() => null);
  check("riv_studio serves state", !!stateRes && typeof stateRes.objects === "number", JSON.stringify(stateRes)?.slice(0, 120));
  const treeRes = await fetch("http://localhost:8797/tree").then((r2) => r2.json()).catch(() => null);
  check("riv_studio serves tree", !!treeRes?.artboards?.length && treeRes.artboards[0].nodes.length > 0, JSON.stringify(treeRes)?.slice(0, 120));
  // AIへの指示: UI投稿 → riv_studio_notes で消費
  await fetch("http://localhost:8797/notes", { method: "POST", body: JSON.stringify({ text: "テスト指示: 大きくして" }) });
  const notesRes = await callTool("riv_studio_notes", { port: 8797 });
  check("riv_studio_notes fetches instructions", !notesRes.isError && textOf(notesRes).includes("テスト指示"), textOf(notesRes).slice(0, 150));
  const notesEmpty = await callTool("riv_studio_notes", { port: 8797 });
  check("riv_studio_notes consumes queue", !notesEmpty.isError && textOf(notesEmpty).includes("No pending"), textOf(notesEmpty).slice(0, 100));
  const stopped = await callTool("riv_studio", { path: genPath, stop: true });
  check("riv_studio stops", !stopped.isError && textOf(stopped).includes("stopped"));

  // エラー処理: 存在しないアニメ名 → 候補列挙
  const bad = await callTool("riv_render_frame", { path: RIV, animation: "__nope__" });
  check(
    "unknown animation returns candidates",
    bad.isError && textOf(bad).includes("Available:"),
    textOf(bad)
  );

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
} catch (e) {
  console.error("E2E fatal:", e);
  failures++;
} finally {
  child.kill();
  process.exit(failures === 0 ? 0 : 1);
}
