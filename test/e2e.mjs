// stdio JSON-RPC で実サーバーを spawn し全ツールを実呼び出しする E2E テスト
import { spawn } from "node:child_process";
import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { connect as netConnect } from "node:net";
import { request as httpRequest } from "node:http";
import { networkInterfaces } from "node:os";
import { inflateSync } from "node:zlib";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const RIV = join(root, "samples", "vehicles.riv");

function listSampleEntries(dir) {
  const entries = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    entries.push(path);
    if (item.isDirectory()) entries.push(...listSampleEntries(path));
  }
  return entries;
}
const originalSampleEntries = new Set(listSampleEntries(join(root, "samples")));

// ---- 共有(読み取り専用)テスト用の小道具 ----
function firstLanIp() {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254.")) return a.address;
    }
  }
  return null;
}
function tcpOpen(host, port) {
  return new Promise((res) => {
    const s = netConnect({ host, port, timeout: 1500 });
    s.once("connect", () => { s.destroy(); res(true); });
    s.once("timeout", () => { s.destroy(); res(false); });
    s.once("error", () => res(false));
  });
}
// fetch は .. を正規化し Host も固定できないので、生のパス/ヘッダーを送れる http.request を使う
function rawRequest({ host, port, path, method = "GET", headers = {} }) {
  return new Promise((res, rej) => {
    const req = httpRequest({ host, port, path, method, headers }, (r) => {
      const chunks = [];
      r.on("data", (c) => chunks.push(c));
      r.on("end", () => res({ status: r.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", rej);
    req.end();
  });
}

function fsMod2Sig(path) {
  return readFileSync(path).subarray(0, 4).toString("hex");
}

// Canvas2D PNG (8bit RGBA) を展開し、描画後の Flex 子の実位置をピクセルで確認する。
function pngPixelReader(path) {
  const png = readFileSync(path);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (png[24] !== 8 || png[25] !== 6) throw new Error("Expected 8-bit RGBA PNG");
  const idat = [];
  for (let pos = 8; pos + 12 <= png.length;) {
    const length = png.readUInt32BE(pos);
    const type = png.toString("ascii", pos + 4, pos + 8);
    if (type === "IDAT") idat.push(png.subarray(pos + 8, pos + 8 + length));
    pos += 12 + length;
    if (type === "IEND") break;
  }
  const data = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rows = [];
  let prev = Buffer.alloc(stride);
  let at = 0;
  for (let y = 0; y < height; y++) {
    const filter = data[at++];
    const row = Buffer.from(data.subarray(at, at + stride));
    at += stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? row[i - 4] : 0;
      const up = prev[i];
      const upLeft = i >= 4 ? prev[i - 4] : 0;
      const p = left + up - upLeft;
      const paeth = Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - upLeft) ? left
        : Math.abs(p - up) <= Math.abs(p - upLeft) ? up : upLeft;
      const predictor = [0, left, up, Math.floor((left + up) / 2), paeth][filter];
      if (predictor === undefined) throw new Error(`Unsupported PNG filter ${filter}`);
      row[i] = (row[i] + predictor) & 255;
    }
    rows.push(row);
    prev = row;
  }
  return (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) throw new Error("Pixel outside PNG");
    return [...rows[y].subarray(x * 4, x * 4 + 4)];
  };
}

// FIGMA_TOKEN は**必ず外して**起動する。開発機に鍵が置いてあるかどうかで e2e の
// 結果が変わってはいけないし、テストが本物の Figma を叩いてしまうのも避ける
const childEnv = { ...process.env };
delete childEnv.FIGMA_TOKEN;
const child = spawn(process.execPath, [join(root, "dist", "index.js")], {
  stdio: ["pipe", "pipe", "inherit"],
  env: childEnv,
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

// 編集用 Studio は認証必須: riv_studio の出力にある入口 URL (#token) を控え、以降の fetch に Bearer を付ける
const studioTokens = new Map();
function noteStudio(res) {
  const m = /http:\/\/127\.0\.0\.1:(\d+)\/#([a-f0-9]{64})/.exec(JSON.stringify(res));
  if (m) studioTokens.set(m[1], m[2]);
  return res;
}
function sFetch(url, opts = {}) {
  const t = studioTokens.get(new URL(url).port);
  return fetch(url, { ...opts, headers: { ...(opts.headers ?? {}), ...(t ? { Authorization: "Bearer " + t } : {}) } });
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
  const pkgVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  check("serverInfo.version matches package.json", init.serverInfo?.version === pkgVersion, `${init.serverInfo?.version} vs ${pkgVersion}`);
  notify("notifications/initialized", {});

  const tools = await rpc("tools/list", {});
  const names = tools.tools.map((t) => t.name).sort();
  console.log("tools:", names.join(", "));
  check("tools/list has 35 tools", names.length === 35, names.join(","));

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
  check("riv_inspect omits dataBinding for a file with no ViewModel", meta.dataBinding === undefined);

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

  // riv_render_apng (transparent=true 既定)
  const apng = await callTool("riv_render_apng", {
    path: RIV,
    duration: 1,
    fps: 10,
    width: 240,
    out: join(root, "samples", "test-anim.apng"),
  });
  check("riv_render_apng not error", !apng.isError, textOf(apng));
  {
    const apngPath = join(root, "samples", "test-anim.apng");
    const bytes = existsSync(apngPath) ? await import("node:fs").then((m) => m.readFileSync(apngPath)) : null;
    const sigOk = !!bytes && bytes[0] === 0x89 && bytes.subarray(1, 4).toString() === "PNG";
    // チャンク走査: acTL の有無 / fcTL・fdAT 数 / IHDR colorType
    let hasActl = false, actlFrames = 0, fctlCount = 0, fdatCount = 0, colorType = -1;
    if (sigOk) {
      let pos = 8;
      while (pos + 8 <= bytes.length) {
        const len = bytes.readUInt32BE(pos);
        const type = bytes.subarray(pos + 4, pos + 8).toString();
        if (type === "IHDR") colorType = bytes[pos + 8 + 9];
        if (type === "acTL") { hasActl = true; actlFrames = bytes.readUInt32BE(pos + 8); }
        if (type === "fcTL") fctlCount++;
        if (type === "fdAT") fdatCount++;
        pos += 8 + len + 4;
        if (type === "IEND") break;
      }
    }
    check(
      "riv_render_apng writes APNG (PNG sig + acTL, 10 frames)",
      sigOk && hasActl && actlFrames === 10 && fctlCount === 10 && fdatCount >= 9,
      bytes ? `${bytes.length} bytes, acTL=${hasActl}(${actlFrames}), fcTL=${fctlCount}, fdAT=${fdatCount}` : "missing"
    );
    // transparent=true: canvas由来PNGは colorType 6 (truecolor + alpha)
    check("riv_render_apng transparent output has alpha (IHDR colorType 6)", colorType === 6, `colorType=${colorType}`);
  }

  // riv_render_video
  const video = await callTool("riv_render_video", {
    path: RIV,
    duration: 1,
    fps: 15,
    width: 240,
    out: join(root, "samples", "test-video.webm"),
  });
  check("riv_render_video not error", !video.isError, textOf(video));
  {
    const videoPath = join(root, "samples", "test-video.webm");
    const bytes = existsSync(videoPath) ? await import("node:fs").then((m) => m.readFileSync(videoPath)) : null;
    // WebM/Matroska EBML magic: 1A 45 DF A3
    check(
      "riv_render_video writes a webm file",
      !!bytes && bytes.length > 500 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3,
      bytes ? `${bytes.length} bytes` : "missing"
    );
  }

  // riv_render_sprites
  const sprites = await callTool("riv_render_sprites", {
    path: RIV,
    count: 9,
    duration: 1,
    width: 100,
    out: join(root, "samples", "test-sprites.png"),
  });
  const spritesText = textOf(sprites);
  check("riv_render_sprites not error", !sprites.isError, spritesText);
  check("riv_render_sprites returns image", (sprites.content || []).some((c) => c.type === "image"));
  {
    const pngPath = join(root, "samples", "test-sprites.png");
    const jsonPath = join(root, "samples", "test-sprites.json");
    const fs = await import("node:fs");
    const pngOk = existsSync(pngPath) && fs.statSync(pngPath).size > 1000;
    let metaOk = false;
    if (existsSync(jsonPath)) {
      const meta = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      metaOk = meta.count === 9 && meta.cols === 3 && meta.rows === 3 && meta.cellW > 0 && meta.cellH > 0;
    }
    check("riv_render_sprites writes PNG + metadata JSON (3x3 grid)", pngOk && metaOk, `png=${pngOk} meta=${metaOk}`);
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

  // Layout はオプトイン: 省略/空配列のバイト列は完全一致する。
  const { createRiv } = await import(pathToFileURL(join(root, "dist", "rivWriter.js")).href);
  const legacySpec = {
    artboard: { name: "Legacy", width: 120, height: 100 },
    shapes: [{ id: "rect", type: "rect", x: 30, y: 30, width: 20, height: 20, fill: { color: "#ff0000" } }],
  };
  check("layout absent / [] are byte-identical",
    Buffer.from(createRiv(legacySpec).bytes).equals(Buffer.from(createRiv({ ...legacySpec, layouts: [] }).bytes)));

  const flexScene = (direction) => ({
    artboard: { name: "Flex", width: 120, height: 100 },
    layouts: [
      { id: "root", width: 120, height: 100, direction, gap: 10 },
      { id: "red", parent: "root", width: 20, height: 20, fillColor: "#ff0000" },
      { id: "green", parent: "root", width: 20, height: 20, fillColor: "#00ff00" },
      { id: "blue", parent: "root", width: 20, height: 20, fillColor: "#0000ff" },
    ],
  });
  for (const direction of ["row", "column"]) {
    const outPath = join(root, "test", "tmp", `flex-${direction}.riv`);
    const pngPath = join(root, "test", "tmp", `flex-${direction}.png`);
    mkdirSync(dirname(outPath), { recursive: true });
    const made = await callTool("riv_create", { outPath, scene: flexScene(direction) });
    check(`riv_create ${direction} layout accepted`, !made.isError && textOf(made).includes("validated"), textOf(made).slice(0, 200));
    if (made.isError) continue;
    const dump = await callTool("riv_dump", { path: outPath, full: true });
    const parsed = JSON.parse(textOf(dump));
    const nodes = parsed.objects.filter((o) => o.typeName === "LayoutComponent");
    const styles = parsed.objects.filter((o) => o.typeName === "LayoutComponentStyle");
    const board = parsed.objects.find((o) => o.typeName === "Artboard");
    const byName = Object.fromEntries(nodes.map((o) => [o.properties.name, o]));
    const local = (o) => o.index - board.index;
    check(`riv_dump ${direction} layout object types`,
      !dump.isError && parsed.parseError === null && nodes.length === 4 && styles.length === 5 &&
      parsed.typeCounts.Fill === 3 && parsed.typeCounts.SolidColor === 3);
    check(`riv_dump ${direction} parentId/styleId references`,
      !!board && !!byName.root && board.properties.styleId === local(styles.find((s) => s.properties.parentId === 0)) &&
      ["red", "green", "blue"].every((name) => byName[name]?.properties.parentId === local(byName.root)) &&
      nodes.every((n) => styles.some((s) => s.properties.parentId === local(n) && n.properties.styleId === local(s))));
    const frame = await callTool("riv_render_frame", { path: outPath, outPath: pngPath, width: 120, height: 100 });
    check(`riv_render_frame ${direction} layout`, !frame.isError);
    if (frame.isError) continue;
    const pixel = pngPixelReader(pngPath);
    const coords = direction === "row" ? [[10, 10], [40, 10], [70, 10]] : [[10, 10], [10, 40], [10, 70]];
    const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]];
    check(`Flex ${direction} children at computed positions with 10px gap`,
      coords.every(([x, y], i) => JSON.stringify(pixel(x, y)) === JSON.stringify(colors[i])),
      coords.map(([x, y]) => pixel(x, y).join(",")).join(" / "));
  }

  // Additional Flex cases use the official runtime and read the rendered pixels.
  {
    const t3Canvas = { width: 160, height: 80 };
    const t3Colors = {
      red: [255, 0, 0, 255],
      green: [0, 255, 0, 255],
      blue: [0, 0, 255, 255],
      gray: [128, 128, 128, 255],
    };
    const t3Box = (pixel, color) => {
      let left = t3Canvas.width, top = t3Canvas.height, right = -1, bottom = -1;
      const expected = t3Colors[color];
      for (let y = 0; y < t3Canvas.height; y++) {
        for (let x = 0; x < t3Canvas.width; x++) {
          const rgba = pixel(x, y);
          if (rgba.every((channel, i) => channel === expected[i])) {
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
          }
        }
      }
      return right < 0 ? null : [left, top, right - left + 1, bottom - top + 1];
    };
    const t3Near = (actual, expected, tolerance = 1) =>
      !!actual && expected.every((n, i) => Math.abs(actual[i] - n) <= tolerance);
    const t3Create = async (tag, layouts) => {
      const outPath = join(root, "test", "tmp", "flex-t3-" + tag + ".riv");
      const pngPath = join(root, "test", "tmp", "flex-t3-" + tag + ".png");
      const created = await callTool("riv_create", {
        outPath, scene: { artboard: { name: "T3", ...t3Canvas }, layouts },
      });
      check("T3 " + tag + ": official runtime accepts file",
        !created.isError && textOf(created).includes("validated"), textOf(created).slice(0, 200));
      if (created.isError) return null;
      const inspected = await callTool("riv_inspect", { path: outPath });
      check("T3 " + tag + ": runtime inspect loads artboard",
        !inspected.isError && JSON.parse(textOf(inspected)).artboardCount === 1);
      const lint = await callTool("riv_lint", { path: outPath });
      const counts = !lint.isError ? JSON.parse(textOf(lint)) : null;
      check("T3 " + tag + ": no lint errors or warnings",
        counts?.errorCount === 0 && counts?.warningCount === 0, textOf(lint).slice(0, 200));
      const frame = await callTool("riv_render_frame", {
        path: outPath, outPath: pngPath, ...t3Canvas,
      });
      check("T3 " + tag + ": runtime renders pixels", !frame.isError, textOf(frame).slice(0, 200));
      if (frame.isError) return null;
      const pixel = pngPixelReader(pngPath);
      return { outPath, box: (color) => t3Box(pixel, color) };
    };
    const t3Child = (id, color, extra = {}) =>
      ({ id, width: 20, height: 20, fillColor: "#" + color, parent: "root", ...extra });
    const fixed = await t3Create("fixed", [
      { id: "root", width: 160, height: 80, direction: "row", gap: 10 },
      t3Child("red", "ff0000"), t3Child("green", "00ff00"), t3Child("blue", "0000ff"),
    ]);
    if (fixed) {
      check("T3 fixed row: three child top-left coordinates from pixels",
        t3Near(fixed.box("red"), [0, 0, 20, 20], 0) &&
        t3Near(fixed.box("green"), [30, 0, 20, 20], 0) &&
        t3Near(fixed.box("blue"), [60, 0, 20, 20], 0),
        JSON.stringify(["red", "green", "blue"].map((c) => fixed.box(c))));
    }

    const t3SpacingScene = (padding, gap, margin) => [
      { id: "root", width: 160, height: 80, direction: "row", padding, gap },
      t3Child("red", "ff0000", margin === undefined ? {} : { margin }),
      t3Child("green", "00ff00"),
    ];
    const baseline = await t3Create("spacing-base", t3SpacingScene(10, 5));
    const padded = await t3Create("spacing-padding", t3SpacingScene(14, 5));
    const gapped = await t3Create("spacing-gap", t3SpacingScene(10, { horizontal: 12, vertical: 0 }));
    const margined = await t3Create("spacing-margin", t3SpacingScene(10, 5, { left: 6, top: 3 }));
    if (baseline && padded && gapped && margined) {
      const bR = baseline.box("red"), bG = baseline.box("green");
      const pR = padded.box("red"), pG = padded.box("green");
      const gR = gapped.box("red"), gG = gapped.box("green");
      const mR = margined.box("red"), mG = margined.box("green");
      check("T3 padding: both children shift four pixels",
        !!bR && !!bG && !!pR && !!pG &&
        pR[0] - bR[0] === 4 && pG[0] - bG[0] === 4 &&
        pR[1] - bR[1] === 4 && pG[1] - bG[1] === 4);
      check("T3 gap: second child shifts seven pixels",
        !!bR && !!bG && !!gR && !!gG &&
        gR[0] === bR[0] && gG[0] - bG[0] === 7);
      check("T3 margin: first child and following sibling move by six pixels",
        !!bR && !!bG && !!mR && !!mG &&
        mR[0] - bR[0] === 6 && mG[0] - bG[0] === 6 &&
        mR[1] - bR[1] === 3);
    }

    const percent = await t3Create("percent", [
      { id: "root", width: 160, height: 80, direction: "row" },
      t3Child("red", "ff0000", { width: 50, widthMode: "percent" }),
    ]);
    if (percent) {
      check("T3 percent: child width is half parent within one pixel",
        t3Near(percent.box("red"), [0, 0, 80, 20]));
      const dump = JSON.parse(textOf(await callTool("riv_dump", { path: percent.outPath, full: true })));
      check("T3 percent: registered width unit and scale type serialized",
        dump.objects.some((o) => o.typeName === "LayoutComponentStyle" &&
          o.properties.widthUnitsValue === 2 && o.properties.layoutWidthScaleType === 0));
    }
    const filled = await t3Create("fill", [
      { id: "root", width: 160, height: 80, direction: "row" },
      t3Child("blue", "0000ff", { width: 40 }),
      t3Child("red", "ff0000", { widthMode: "fill", width: 0, widthWeight: 1 }),
      t3Child("green", "00ff00", { widthMode: "fill", width: 0, widthWeight: 2 }),
    ]);
    if (filled) {
      const blue = filled.box("blue"), red = filled.box("red"), green = filled.box("green");
      check("T3 fill: remaining width divides in 1-to-2 ratio",
        t3Near(blue, [0, 0, 40, 20]) &&
        t3Near(red, [40, 0, 40, 20]) &&
        t3Near(green, [80, 0, 80, 20]), JSON.stringify({ blue, red, green }));
      const dump = JSON.parse(textOf(await callTool("riv_dump", { path: filled.outPath, full: true })));
      check("T3 fill: fractionalWidth weight and fill mode serialized",
        dump.objects.some((o) => o.typeName === "LayoutComponent" &&
          o.properties.name === "green" && o.properties.fractionalWidth === 2) &&
        dump.objects.filter((o) => o.typeName === "LayoutComponentStyle" &&
          o.properties.layoutWidthScaleType === 1).length === 2);
    }
    const hugged = await t3Create("hug", [
      { id: "root", widthMode: "auto", height: 40, direction: "row", gap: 10,
        padding: 5, fillColor: "#808080" },
      t3Child("red", "ff0000", { width: 30 }),
      t3Child("green", "00ff00", { width: 20 }),
    ]);
    if (hugged) {
      check("T3 auto hug: parent width equals child content plus gap and padding",
        t3Near(hugged.box("gray"), [0, 0, 70, 40]) &&
        t3Near(hugged.box("red"), [5, 5, 30, 20]) &&
        t3Near(hugged.box("green"), [45, 5, 20, 20]));
    }

    const justifyPositions = {
      start: [0, 20], center: [60, 80], end: [120, 140], "space-between": [0, 140],
    };
    for (const [justifyContent, xPositions] of Object.entries(justifyPositions)) {
      const frame = await t3Create("justify-" + justifyContent, [
        { id: "root", width: 160, height: 80, direction: "row", justifyContent },
        t3Child("red", "ff0000"), t3Child("green", "00ff00"),
      ]);
      if (frame) {
        check("T3 justify " + justifyContent + ": measured main-axis positions",
          t3Near(frame.box("red"), [xPositions[0], 0, 20, 20]) &&
          t3Near(frame.box("green"), [xPositions[1], 0, 20, 20]));
      }
    }
    for (const [alignItems, y] of Object.entries({ start: 0, center: 30, end: 60 })) {
      const frame = await t3Create("align-" + alignItems, [
        { id: "root", width: 160, height: 80, direction: "row", alignItems },
        t3Child("red", "ff0000"),
      ]);
      if (frame) {
        check("T3 align " + alignItems + ": measured cross-axis position",
          t3Near(frame.box("red"), [0, y, 20, 20]));
      }
    }

    const nested = await t3Create("nested", [
      { id: "root", width: 160, height: 80, direction: "row", gap: 10 },
      { id: "inner", parent: "root", width: 50, height: 60, direction: "column", gap: 5 },
      { id: "red", parent: "inner", width: 20, height: 15, fillColor: "#ff0000" },
      { id: "green", parent: "inner", width: 20, height: 15, fillColor: "#00ff00" },
      t3Child("blue", "0000ff"),
    ]);
    if (nested) {
      check("T3 nested layouts: inner column and outer row positions",
        t3Near(nested.box("red"), [0, 0, 20, 15]) &&
        t3Near(nested.box("green"), [0, 20, 20, 15]) &&
        t3Near(nested.box("blue"), [60, 0, 20, 20]));
    }
    const v08Scene = flexScene("row");
    const v08Bytes = Buffer.from(createRiv(v08Scene).bytes);
    const explicitFixed = Buffer.from(createRiv({
      ...v08Scene,
      layouts: v08Scene.layouts.map((item) => ({ ...item, widthMode: "fixed", heightMode: "fixed" })),
    }).bytes);
    check("T3 legacy fixed layout: explicit default modes are byte-identical",
      v08Bytes.equals(explicitFixed));
  }
  // riv_preflight: detect binary object families and check the bundled official runtime.
  const preflightVehiclesCall = await callTool("riv_preflight", { path: RIV });
  const preflightVehicles = preflightVehiclesCall.isError ? null : JSON.parse(textOf(preflightVehiclesCall));
  check("riv_preflight vehicles detects state machines",
    !!preflightVehicles && preflightVehicles.features.some((entry) => entry.feature === "State Machine" && entry.count > 0),
    textOf(preflightVehiclesCall).slice(0, 240));
  check("riv_preflight vehicles loads in the official WASM runtime",
    preflightVehicles?.runtimeCheck.officialWasm === "loaded" &&
    preflightVehicles?.file.bytes === statSync(RIV).size);
  check("riv_preflight defaults to all target runtimes",
    preflightVehicles?.targets.length === 6 && preflightVehicles?.targets.every(
      (entry) => ["ok", "warn", "unsupported", "unknown"].includes(entry.verdict)
    ));

  const preflightShapePath = join(root, "test", "tmp", "preflight-shapes.riv");
  mkdirSync(dirname(preflightShapePath), { recursive: true });
  const preflightShapeCreated = await callTool("riv_create", {
    outPath: preflightShapePath,
    scene: {
      artboard: { name: "PreflightShape", width: 80, height: 80 },
      shapes: [{ id: "square", type: "rect", x: 40, y: 40,
        width: 30, height: 30, fill: { color: "#ff2200" } }],
    },
  });
  check("riv_preflight shape fixture validated by official runtime",
    !preflightShapeCreated.isError && textOf(preflightShapeCreated).includes("validated"),
    textOf(preflightShapeCreated).slice(0, 220));
  const preflightShapeCall = await callTool("riv_preflight", { path: preflightShapePath });
  const preflightShape = preflightShapeCall.isError ? null : JSON.parse(textOf(preflightShapeCall));
  check("riv_preflight simple shape has few features and no unsupported targets",
    !!preflightShape && preflightShape.features.length <= 4 &&
    preflightShape.targets.length === 6 &&
    preflightShape.targets.every((entry) => ["ok", "unknown"].includes(entry.verdict)) &&
    preflightShape.runtimeCheck.officialWasm === "loaded",
    textOf(preflightShapeCall).slice(0, 320));

  const preflightBindingPath = join(root, "test", "tmp", "preflight-binding.riv");
  const preflightBindingCreated = await callTool("riv_create", {
    outPath: preflightBindingPath,
    scene: {
      artboard: { name: "PreflightBinding", width: 100, height: 100 },
      viewModels: [{ name: "PreflightModel", properties: [{ name: "value", type: "number" }] }],
      viewModelInstances: [{ name: "PreflightInstance", viewModel: "PreflightModel", values: { value: 8 } }],
      viewModel: "PreflightModel",
      viewModelInstance: "PreflightInstance",
      shapes: [{ id: "disk", type: "ellipse", x: 50, y: 50, width: 30, height: 30,
        fill: { color: "#0066ff" } }],
    },
  });
  check("riv_preflight binding fixture validated by official runtime",
    !preflightBindingCreated.isError && textOf(preflightBindingCreated).includes("validated"),
    textOf(preflightBindingCreated).slice(0, 220));
  const preflightBindingCall = await callTool("riv_preflight", { path: preflightBindingPath });
  const preflightBinding = preflightBindingCall.isError ? null : JSON.parse(textOf(preflightBindingCall));
  check("riv_preflight detects ViewModel and Data Binding typeKeys",
    !!preflightBinding && preflightBinding.features.some((entry) =>
      entry.feature === "Data Binding" && entry.count > 0) &&
    preflightBinding.runtimeCheck.officialWasm === "loaded",
    textOf(preflightBindingCall).slice(0, 300));

  const preflightLayoutCall = await callTool("riv_preflight", {
    path: join(root, "test", "tmp", "flex-row.riv"),
  });
  const preflightLayout = preflightLayoutCall.isError ? null : JSON.parse(textOf(preflightLayoutCall));
  check("riv_preflight detects Layout typeKeys from riv_create",
    !!preflightLayout && preflightLayout.features.some((entry) =>
      entry.feature === "Layout" && entry.count >= 4) &&
    preflightLayout.runtimeCheck.officialWasm === "loaded",
    textOf(preflightLayoutCall).slice(0, 300));

  const preflightBrokenPath = join(root, "test", "tmp", "preflight-truncated.riv");
  writeFileSync(preflightBrokenPath, Buffer.from([0x52, 0x49, 0x56, 0x45, 7, 0, 0]));
  const preflightBrokenCall = await callTool("riv_preflight", { path: preflightBrokenPath });
  let preflightBrokenJson = null;
  try { preflightBrokenJson = JSON.parse(textOf(preflightBrokenCall)); } catch {}
  check("riv_preflight truncated file returns JSON error without crashing",
    !!preflightBrokenCall.isError && typeof preflightBrokenJson?.error === "string");

  const preflightLimitedCall = await callTool("riv_preflight", {
    path: preflightShapePath, targets: ["ios", "web", "ios"],
  });
  const preflightLimited = preflightLimitedCall.isError ? null : JSON.parse(textOf(preflightLimitedCall));
  check("riv_preflight selected targets are filtered and deduplicated",
    JSON.stringify(preflightLimited?.targets.map((entry) => entry.target)) === JSON.stringify(["ios", "web"]));
  const preflightInvalidCall = await callTool("riv_preflight", {
    path: preflightShapePath, targets: ["unrecognized-runtime"],
  });
  let preflightInvalidJson = null;
  try { preflightInvalidJson = JSON.parse(textOf(preflightInvalidCall)); } catch {}
  check("riv_preflight unknown target returns a JSON error",
    !!preflightInvalidCall.isError && preflightInvalidJson?.error.includes("Unknown target"));

  const preflightStrictCall = await callTool("riv_preflight", {
    path: preflightShapePath, targets: ["ios"], strict: true,
  });
  const preflightStrict = preflightStrictCall.isError ? null : JSON.parse(textOf(preflightStrictCall));
  check("riv_preflight strict counts unknown support as a warning",
    preflightShape?.targets.find((entry) => entry.target === "ios")?.verdict === "unknown" &&
    preflightStrict?.targets[0]?.verdict === "warn" && preflightStrict?.summary.warn === 1);
  const { PREFLIGHT_MATRIX: preflightMatrixRows } =
    await import(pathToFileURL(join(root, "dist", "preflightMatrix.js")).href);
  check("riv_preflight every compatibility matrix entry has evidence",
    preflightMatrixRows.length > 0 && preflightMatrixRows.every((entry) =>
      typeof entry.source === "string" && entry.source.startsWith("https://") &&
      typeof entry.feature === "string" && typeof entry.target === "string"));

  // Runtime version comparisons use the existing Data Binding fixture.
  {
    const { compareRuntimeVersion: preflightVersionCompare } =
      await import(pathToFileURL(join(root, "dist", "rivPreflight.js")).href);
    check("riv_preflight accepts numeric versions at or above the minimum",
      preflightVersionCompare("2.26.6", "2.26.6+") === "ok" &&
      preflightVersionCompare("2.26.7", "2.26.6+") === "ok" &&
      preflightVersionCompare("10.0.4", "10.0.4") === "ok" &&
      preflightVersionCompare("2.26.6.0", "2.26.6+") === "ok");
    check("riv_preflight compares numeric segments without lexical ordering",
      preflightVersionCompare("2.9.0", "2.26.6+") === "unsupported" &&
      preflightVersionCompare("10.0.0", "9.99.99+") === "ok");
    check("riv_preflight leaves equal prerelease numeric versions unverified",
      preflightVersionCompare("0.14.0", "0.14.0-dev.1") === "unknown" &&
      preflightVersionCompare("0.3.3", "0.3.3-canary.72+") === "unknown" &&
      preflightVersionCompare("0.14.1", "0.14.0-dev.1") === "ok" &&
      preflightVersionCompare("0.13.9", "0.14.0-dev.1") === "unsupported");

    const preflightVersionHighCall = await callTool("riv_preflight", {
      path: preflightBindingPath, targets: ["web"], versions: { web: "99.0.0" },
    });
    const preflightVersionHigh = preflightVersionHighCall.isError ? null : JSON.parse(textOf(preflightVersionHighCall));
    check("riv_preflight sufficient web version clears the Data Binding issue",
      !preflightVersionHighCall.isError &&
      preflightVersionHigh?.targets[0]?.version === "99.0.0" &&
      !preflightVersionHigh?.targets[0]?.issues.some((issue) => issue.feature === "Data Binding") &&
      preflightVersionHigh?.features.some((entry) => entry.feature === "Data Binding"),
      textOf(preflightVersionHighCall).slice(0, 350));
    check("riv_preflight unknown matrix entries stay unknown with a version",
      preflightVersionHigh?.targets[0]?.verdict === "unknown" &&
      preflightVersionHigh.targets[0].issues.some((issue) =>
        issue.feature === "Core vector graphics" && issue.source === "unverified"));

    const preflightVersionLowCall = await callTool("riv_preflight", {
      path: preflightBindingPath, targets: ["web"], versions: { web: "2.0.0" },
    });
    const preflightVersionLow = preflightVersionLowCall.isError ? null : JSON.parse(textOf(preflightVersionLowCall));
    check("riv_preflight older web runtime is unsupported with compared minimum",
      !preflightVersionLowCall.isError &&
      preflightVersionLow?.targets[0]?.verdict === "unsupported" &&
      preflightVersionLow.targets[0].issues.some((issue) =>
        issue.feature === "Data Binding" &&
        issue.reason.includes("2.0.0") && issue.reason.includes("2.26.6+")),
      textOf(preflightVersionLowCall).slice(0, 350));

    check("riv_preflight unspecified target retains unknown minimum evidence",
      preflightBinding?.targets.find((entry) => entry.target === "web")?.version === null &&
      preflightBinding?.targets.find((entry) => entry.target === "web")?.verdict === "unknown" &&
      preflightBinding.targets.find((entry) => entry.target === "web").issues.some((issue) =>
        issue.feature === "Data Binding" && issue.reason.includes("2.26.6+")));

    const preflightVersionPrereleaseCall = await callTool("riv_preflight", {
      path: preflightBindingPath, targets: ["flutter"], versions: { flutter: "0.14.0" },
    });
    const preflightVersionPrerelease = preflightVersionPrereleaseCall.isError ? null :
      JSON.parse(textOf(preflightVersionPrereleaseCall));
    check("riv_preflight matching prerelease numeric version stays unknown",
      !preflightVersionPrereleaseCall.isError &&
      preflightVersionPrerelease?.targets[0]?.verdict === "unknown" &&
      preflightVersionPrerelease.targets[0].issues.some((issue) =>
        issue.feature === "Data Binding" && issue.reason.includes("prerelease ordering not verified")),
      textOf(preflightVersionPrereleaseCall).slice(0, 350));

    for (const invalidRuntimeVersion of ["2.x", "2.20.0-beta", ""]) {
      const preflightVersionInvalidCall = await callTool("riv_preflight", {
        path: preflightBindingPath, targets: ["web"], versions: { web: invalidRuntimeVersion },
      });
      let preflightVersionInvalidJson = null;
      try { preflightVersionInvalidJson = JSON.parse(textOf(preflightVersionInvalidCall)); } catch {}
      check(`riv_preflight rejects invalid version ${JSON.stringify(invalidRuntimeVersion)} as JSON`,
        !!preflightVersionInvalidCall.isError &&
        typeof preflightVersionInvalidJson?.error === "string" &&
        preflightVersionInvalidJson.error.includes("Invalid version"),
        textOf(preflightVersionInvalidCall).slice(0, 250));
    }
    const preflightVersionUnknownTargetCall = await callTool("riv_preflight", {
      path: preflightShapePath, targets: ["web"], versions: { "unrecognized-runtime": "2.0.0" },
    });
    let preflightVersionUnknownTargetJson = null;
    try { preflightVersionUnknownTargetJson = JSON.parse(textOf(preflightVersionUnknownTargetCall)); } catch {}
    check("riv_preflight unknown version target returns JSON error",
      !!preflightVersionUnknownTargetCall.isError &&
      preflightVersionUnknownTargetJson?.error.includes("Unknown target"));

    const preflightVersionOutsideCall = await callTool("riv_preflight", {
      path: preflightShapePath, targets: ["web"], versions: { ios: "6.0.0" },
    });
    let preflightVersionOutsideJson = null;
    try { preflightVersionOutsideJson = JSON.parse(textOf(preflightVersionOutsideCall)); } catch {}
    check("riv_preflight version outside selected targets returns JSON error",
      !!preflightVersionOutsideCall.isError &&
      preflightVersionOutsideJson?.error.includes("not selected"));
  }

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

  const preflightMeshCall = await callTool("riv_preflight", {
    path: join(root, "samples", "e2e-image.riv"),
  });
  const preflightMesh = preflightMeshCall.isError ? null : JSON.parse(textOf(preflightMeshCall));
  check("riv_preflight reports unknown for mesh without compatibility evidence",
    !preflightMeshCall.isError &&
    preflightMesh?.features.some((entry) => entry.feature === "Mesh Deformation" && entry.count > 0) &&
    !preflightMatrixRows.some((entry) => entry.feature === "Mesh Deformation") &&
    preflightMesh.runtimeCheck.officialWasm === "loaded" &&
    preflightMesh.targets.length === 6 &&
    preflightMesh.targets.every((entry) =>
      entry.verdict === "unknown" &&
      entry.issues.some((issue) => issue.feature === "Mesh Deformation" && issue.source === "unverified")),
    textOf(preflightMeshCall).slice(0, 320));

  // 回帰: Mesh.triangleIndexBytes は varuint 列（uint16 固定長だと 128 頂点以上で崩れる）。14x14 = 225 頂点で index>=128 を含める
  {
    const cols = 14, rows = 14;
    const outPath = join(root, "samples", "e2e-mesh-varuint.riv");
    const meshCreated = await callTool("riv_create", {
      outPath,
      scene: {
        artboard: { width: 100, height: 100 },
        images: [{ id: "img", pngPath, x: 50, y: 50, scale: 40, mesh: { columns: cols, rows } }],
      },
    });
    const expected = [];
    const pushVar = (v) => { do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; expected.push(b); } while (v); };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const tl = r * (cols + 1) + c, tr = tl + 1, bl = tl + cols + 1, br = bl + 1;
      for (const t of [tl, bl, tr, tr, bl, br]) pushVar(t);
    }
    const fileBytes = await import("node:fs").then((m) => m.readFileSync(outPath));
    check(
      "riv_create writes Mesh.triangleIndexBytes as varuint (225 vertices)",
      !meshCreated.isError && fileBytes.includes(Buffer.from(expected)),
      textOf(meshCreated).slice(0, 250)
    );
  }

  // riv_extract_assets: e2e-image.riv には埋め込みPNG("img")が1つあるはず
  const extracted = await callTool("riv_extract_assets", {
    path: join(root, "samples", "e2e-image.riv"),
    outDir: join(root, "samples", "e2e-assets"),
  });
  const extractedText = textOf(extracted);
  check("riv_extract_assets not error", !extracted.isError, extractedText);
  check(
    "riv_extract_assets extracts the embedded PNG",
    extractedText.includes('"type": "ImageAsset"') && extractedText.includes(".png"),
    extractedText.slice(0, 300)
  );
  {
    const list = JSON.parse(extractedText || "[]");
    const first = Array.isArray(list) ? list[0] : null;
    const fileOk = first && existsSync(first.path) && (await import("node:fs")).statSync(first.path).size > 0;
    check("riv_extract_assets writes a non-empty PNG file", !!fileOk, JSON.stringify(first));
  }

  // riv_create: 音声対応（AudioAsset埋め込み + AudioEvent、アニメーションフレーム発火 + SM state進入発火）
  // samples/e2e-assets/ は .gitignore 対象（生成物置き場）なので、tinyPng と同様に音源はここで都度合成する
  // （固定ファイルをリポジトリに置くとフレッシュcloneでファイル欠落してテストが落ちる）
  const audioPath = join(root, "samples", "e2e-assets", "beep.wav");
  {
    const sampleRate = 8000;
    const numSamples = Math.floor(sampleRate * 0.3); // 440Hz sine, 0.3s, mono, 16bit PCM
    const dataSize = numSamples * 2;
    const wav = Buffer.alloc(44 + dataSize);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(36 + dataSize, 4);
    wav.write("WAVE", 8);
    wav.write("fmt ", 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); // PCM
    wav.writeUInt16LE(1, 22); // mono
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * 2, 28); // byteRate
    wav.writeUInt16LE(2, 32); // blockAlign
    wav.writeUInt16LE(16, 34); // bitsPerSample
    wav.write("data", 36);
    wav.writeUInt32LE(dataSize, 40);
    for (let i = 0; i < numSamples; i++) {
      const v = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.3 * 32767;
      wav.writeInt16LE(Math.round(v), 44 + i * 2);
    }
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(root, "samples", "e2e-assets"), { recursive: true });
    writeFileSync(audioPath, wav);
  }
  const audioOutPath = join(root, "samples", "e2e-audio.riv");
  const audioCreated = await callTool("riv_create", {
    outPath: audioOutPath,
    scene: {
      artboard: { name: "AudioDemo", width: 300, height: 200 },
      backgroundColor: "#1a1a2e",
      shapes: [{ id: "box", type: "rect", x: 150, y: 100, width: 60, height: 60, fill: { color: "#e94560" } }],
      audio: [{ id: "beep", path: audioPath }],
      events: [
        { id: "beepOnFrame", type: "audio", audio: "beep" },
        { id: "beepOnEnter", type: "audio", audio: "beep" },
      ],
      animations: [
        {
          name: "spin", fps: 60, duration: 60, loop: "loop",
          tracks: [{ target: "box", property: "rotation", keyframes: [{ frame: 0, value: 0 }, { frame: 60, value: 360, easing: "linear" }] }],
          // 指定フレームでのイベント発火（AudioEvent の再生タイミング）
          events: [{ event: "beepOnFrame", frame: 0 }, { event: "beepOnFrame", frame: 30 }],
        },
      ],
      stateMachine: {
        name: "SM",
        states: [{ name: "spinning", animation: "spin", fireEvent: "beepOnEnter" }],
        transitions: [{ from: "entry", to: "spinning" }],
      },
    },
  });
  const audioCreatedText = textOf(audioCreated);
  check(
    "riv_create embeds audio and validates with official runtime",
    !audioCreated.isError && audioCreatedText.includes("validated"),
    audioCreatedText.slice(0, 300)
  );

  const audioDump = await callTool("riv_dump", { path: audioOutPath, full: true });
  const audioDumpText = textOf(audioDump);
  check(
    "riv_dump shows AudioAsset + FileAssetContents embedded",
    audioDumpText.includes('"AudioAsset": 1') && audioDumpText.includes('"FileAssetContents"'),
    audioDumpText.slice(0, 200)
  );
  check(
    "riv_dump shows both AudioEvent instances",
    audioDumpText.includes('"AudioEvent": 2'),
    audioDumpText.slice(0, 200)
  );
  check(
    "riv_dump shows KeyFrameCallback keyframes for the animation-frame trigger",
    audioDumpText.includes('"KeyFrameCallback": 2'),
    audioDumpText.slice(0, 200)
  );
  check(
    "riv_dump shows StateMachineFireEvent for the SM state-enter trigger",
    audioDumpText.includes('"StateMachineFireEvent": 1'),
    audioDumpText.slice(0, 200)
  );

  // riv_extract_assets: e2e-audio.riv には埋め込みWAV("beep")が1つあるはず
  const audioExtracted = await callTool("riv_extract_assets", {
    path: audioOutPath,
    outDir: join(root, "samples", "e2e-assets"),
  });
  const audioExtractedText = textOf(audioExtracted);
  check(
    "riv_extract_assets recognizes the embedded AudioAsset",
    !audioExtracted.isError && audioExtractedText.includes('"type": "AudioAsset"'),
    audioExtractedText.slice(0, 300)
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

  // Studio のボーンオーバーレイのフレーム追従: ランタイムが評価したボーンのワールド変換を
  // 途中フレームで読むと、初期姿勢（t=0）とは違う値になる（UIを通さず RiveHost.boneWorldAt で検証）
  if (!boneCreated.isError) {
    const { RiveHost } = await import(pathToFileURL(join(root, "dist", "riveHost.js")).href);
    const { PAGE_SCRIPT } = await import(pathToFileURL(join(root, "dist", "pageScript.js")).href);
    const h = new RiveHost(PAGE_SCRIPT);
    try {
      const boneBytes = readFileSync(join(root, "samples", "e2e-bones.riv"));
      // bend: b2.rotation 0 -> 45deg を 30 フレーム(fps60 で 0.5s)
      const samples = await h.boneWorldAt(boneBytes, { animation: "bend", times: [0, 0.25, 0.49], bones: ["b1", "b2"] });
      const [s0, sMid, sEnd] = samples;
      const deg = (rad) => (rad * 180) / Math.PI;
      check("boneWorldAt: t=0 の b2 は初期姿勢（rotation 0）",
        Math.abs(deg(s0.bones.b2.rotation)) < 0.5, JSON.stringify(s0.bones.b2));
      check("boneWorldAt: 途中フレームの b2 は初期姿勢と異なる回転（0<rot<45deg）",
        deg(sMid.bones.b2.rotation) > 5 && deg(sMid.bones.b2.rotation) < 40, JSON.stringify(sMid.bones.b2));
      check("boneWorldAt: 途中フレームの b2 のワールド行列が初期姿勢と異なる",
        Math.abs(sMid.bones.b2.xx - s0.bones.b2.xx) > 0.05 && Math.abs(sMid.bones.b2.yx - s0.bones.b2.yx) > 0.05,
        `${JSON.stringify(s0.bones.b2)} vs ${JSON.stringify(sMid.bones.b2)}`);
      // loop なので t=0.5(=30f) は先頭に戻る。終端の一つ手前(29f付近)で 45deg 近くまで進んでいること
      check("boneWorldAt: 終端直前の b2 は 45deg 付近",
        Math.abs(deg(sEnd.bones.b2.rotation) - 44) < 2, JSON.stringify(sEnd.bones.b2));
      check("boneWorldAt: アニメの無い b1（根元）は全フレームで不動",
        Math.abs(sMid.bones.b1.tx - s0.bones.b1.tx) < 1e-3 && Math.abs(sMid.bones.b1.ty - s0.bones.b1.ty) < 1e-3 &&
        Math.abs(sMid.bones.b1.xx - s0.bones.b1.xx) < 1e-4);
    } finally { await h.close(); }
  }
  // riv_create: text on path（TextModifierGroup > TextModifierRange + TextFollowPathModifier）。
  // 公式ランタイムでロードでき、followPath 有りは無しと描画が変わる（= パスに沿って曲がる）ことを確認
  mkdirSync(join(root, "local"), { recursive: true });
  const topScene = (withPath) => ({
    artboard: { width: 400, height: 300 },
    backgroundColor: "#ffffff",
    fonts: [{ id: "f" }],
    shapes: [{ id: "curve", type: "polygon", x: 0, y: 0, closed: false,
      points: [{ x: 40, y: 200 }, { x: 200, y: 60, cubic: { rotation: 0, distance: 60 } }, { x: 360, y: 200 }],
      stroke: { color: "#cccccc", thickness: 2 } }],
    texts: [{ id: "t", x: 0, y: 0, runs: [{ text: "Hello text on path", fontSize: 28, color: "#d00000" }],
      ...(withPath ? { followPath: { path: "curve" } } : {}) }],
  });
  const topOn = await callTool("riv_create", { outPath: join(root, "local", "e2e-textpath.riv"), scene: topScene(true) });
  const topOff = await callTool("riv_create", { outPath: join(root, "local", "e2e-textpath-off.riv"), scene: topScene(false) });
  const topImg = (r) => (r.content || []).find((c) => c.type === "image")?.data;
  check(
    "riv_create text on path validated + renders differently from plain text",
    !topOn.isError && textOf(topOn).includes("validated") && topImg(topOn) && topImg(topOff) && topImg(topOn) !== topImg(topOff),
    textOf(topOn).slice(0, 250)
  );
  const topDump = await callTool("riv_dump", { path: join(root, "local", "e2e-textpath.riv") });
  check(
    "riv_dump shows TextFollowPathModifier inside a TextModifierGroup",
    !topDump.isError && textOf(topDump).includes("TextFollowPathModifier") && textOf(topDump).includes("TextModifierGroup"),
    textOf(topDump).slice(0, 200)
  );
  const topBad = await callTool("riv_create", {
    outPath: join(root, "local", "e2e-textpath-bad.riv"),
    scene: { ...topScene(true), texts: [{ id: "t", x: 0, y: 0, runs: [{ text: "x" }], followPath: { path: "nope" } }] },
  });
  check("riv_create text on path rejects unknown path shape", !!topBad.isError && textOf(topBad).includes("nope"), textOf(topBad).slice(0, 200));

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

  // riv_lint: 正常なファイルでは error/warning の誤検知が無いこと(モーション品質のinfo提案は許容)
  const lintClean = await callTool("riv_lint", { path: genPath });
  const lintCleanText = textOf(lintClean);
  const lintCleanParsed = JSON.parse(lintCleanText);
  check(
    "riv_lint reports no errors/warnings on a well-formed file",
    !lintClean.isError && lintCleanParsed.errorCount === 0 && lintCleanParsed.warningCount === 0,
    lintCleanText.slice(0, 300)
  );

  // riv_lint: 壊れたファイルで既知の問題を検出できること
  const lintBrokenPath = join(root, "samples", "e2e-lint-broken.riv");
  await callTool("riv_create", {
    outPath: lintBrokenPath,
    scene: {
      artboard: { width: 100, height: 100 },
      shapes: [{ id: "sq", type: "rect", x: 50, y: 50, width: 20, height: 20, fill: { color: "#e94560" } }],
      animations: [{ name: "still", duration: 10, loop: "oneShot", tracks: [] }],
      stateMachine: {
        name: "Broken",
        inputs: [{ name: "unused", type: "bool" }],
        states: [{ name: "idle", animation: "still" }, { name: "orphan", animation: "still" }],
        transitions: [
          { from: "entry", to: "idle" },
          { from: "idle", to: "idle" },
        ],
      },
    },
  });
  const lintBroken = await callTool("riv_lint", { path: lintBrokenPath });
  const lintBrokenText = textOf(lintBroken);
  const lintBrokenFindings = JSON.parse(lintBrokenText).findings;
  check(
    "riv_lint detects unreachable state",
    lintBrokenFindings.some((f) => f.rule === "unreachable-state" && f.message.includes("state#4")),
    lintBrokenText
  );
  check(
    "riv_lint detects unconditional self-transition",
    lintBrokenFindings.some((f) => f.rule === "infinite-loop-risk"),
    lintBrokenText
  );
  check(
    "riv_lint detects unused state-machine input",
    lintBrokenFindings.some((f) => f.rule === "unused-input" && f.message.includes("unused")),
    lintBrokenText
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

  // riv_edit: setKeyframes (mode=replace, 新規トラック作成)
  const kfPath1 = join(root, "samples", "e2e-keyframes.riv");
  const kfAdded = await callTool("riv_edit", {
    path: genPath,
    outPath: kfPath1,
    edits: [
      {
        op: "setKeyframes", name: "dot", type: "Shape", animation: "wobble", property: "y", mode: "replace",
        keyframes: [
          { frame: 0, value: 100 },
          { frame: 30, value: 20, easing: "ease-out" },
          { frame: 60, value: 100, easing: "ease-in" },
        ],
      },
    ],
  });
  check(
    "riv_edit setKeyframes creates a new track",
    !kfAdded.isError && textOf(kfAdded).includes("setKeyframes replace") && textOf(kfAdded).includes("new track"),
    textOf(kfAdded).slice(0, 300)
  );
  // official runtime がロード可能 + 追加したトラックが実際に動きに反映されているか(t=0とt=0.5でピクセルが変わる)
  const kfFrame0 = await callTool("riv_render_frame", { path: kfPath1, animation: "wobble", time: 0 });
  const kfFrame1 = await callTool("riv_render_frame", { path: kfPath1, animation: "wobble", time: 0.5 });
  const kfImg0 = (kfFrame0.content || []).find((c) => c.type === "image")?.data;
  const kfImg1 = (kfFrame1.content || []).find((c) => c.type === "image")?.data;
  check(
    "riv_edit setKeyframes: official runtime renders the new track and motion changes the frame",
    !kfFrame0.isError && !kfFrame1.isError && !!kfImg0 && !!kfImg1 && kfImg0 !== kfImg1,
    `frame0 err=${kfFrame0.isError} frame1 err=${kfFrame1.isError}`
  );

  // riv_edit: setKeyframes (mode=add, 既存トラックに1フレーム追加)
  const kfPath2 = join(root, "samples", "e2e-keyframes-add.riv");
  const kfAddMode = await callTool("riv_edit", {
    path: kfPath1,
    outPath: kfPath2,
    edits: [
      { op: "setKeyframes", name: "sq", type: "Shape", animation: "wobble", property: "rotation", mode: "add", keyframes: [{ frame: 45, value: 180 }] },
    ],
  });
  check(
    "riv_edit setKeyframes mode=add appends to an existing track",
    !kfAddMode.isError && textOf(kfAddMode).includes("setKeyframes add"),
    textOf(kfAddMode).slice(0, 300)
  );

  // riv_edit: setKeyframes (mode=remove, 追加したフレームを削除)
  const kfPath3 = join(root, "samples", "e2e-keyframes-remove.riv");
  const kfRemoveMode = await callTool("riv_edit", {
    path: kfPath2,
    outPath: kfPath3,
    edits: [
      { op: "setKeyframes", name: "sq", type: "Shape", animation: "wobble", property: "rotation", mode: "remove", keyframes: [{ frame: 45 }] },
    ],
  });
  check(
    "riv_edit setKeyframes mode=remove removes a keyframe (official runtime still loads it)",
    !kfRemoveMode.isError && textOf(kfRemoveMode).includes("setKeyframes remove"),
    textOf(kfRemoveMode).slice(0, 300)
  );

  // riv_optimize: vehicles.riv (実ファイル) を最適化 -> 同等以下のサイズ・パース可能・新規lint問題なし
  const vehiclesBeforeSize = statSync(RIV).size;
  const vehiclesLintBefore = await callTool("riv_lint", { path: RIV });
  const vehiclesLintBeforeParsed = JSON.parse(textOf(vehiclesLintBefore));

  const vehiclesOptOut = join(root, "samples", "e2e-optimize-vehicles.riv");
  const vehiclesOpt = await callTool("riv_optimize", { path: RIV, outPath: vehiclesOptOut });
  check("riv_optimize succeeds on vehicles.riv", !vehiclesOpt.isError, textOf(vehiclesOpt).slice(0, 300));
  check(
    "riv_optimize output is not larger than the source",
    existsSync(vehiclesOptOut) && statSync(vehiclesOptOut).size <= vehiclesBeforeSize,
    `before=${vehiclesBeforeSize} after=${existsSync(vehiclesOptOut) ? statSync(vehiclesOptOut).size : "missing"}`
  );

  const vehiclesDumpAfter = await callTool("riv_dump", { path: vehiclesOptOut });
  const vehiclesDumpAfterParsed = JSON.parse(textOf(vehiclesDumpAfter));
  check(
    "riv_optimize output on vehicles.riv still parses cleanly with the official reader",
    !vehiclesDumpAfter.isError && vehiclesDumpAfterParsed.parseError === null,
    JSON.stringify(vehiclesDumpAfterParsed.parseError)
  );

  const vehiclesLintAfter = await callTool("riv_lint", { path: vehiclesOptOut });
  const vehiclesLintAfterParsed = JSON.parse(textOf(vehiclesLintAfter));
  check(
    "riv_optimize introduces no new errors/warnings on vehicles.riv",
    !vehiclesLintAfter.isError &&
      vehiclesLintAfterParsed.errorCount === vehiclesLintBeforeParsed.errorCount &&
      vehiclesLintAfterParsed.warningCount === vehiclesLintBeforeParsed.warningCount,
    `before err=${vehiclesLintBeforeParsed.errorCount}/warn=${vehiclesLintBeforeParsed.warningCount} ` +
      `after err=${vehiclesLintAfterParsed.errorCount}/warn=${vehiclesLintAfterParsed.warningCount}`
  );

  // riv_optimize: rivWriter.createRiv を直接importして生成した「冗長キーフレーム入り」ファイルの間引き検証
  // (Windows の ESM import は file:// 絶対パス必須 -> pathToFileURL 経由。CLAUDE.md 落とし穴7 参照)
  const redundantKeyframes = [];
  for (let f = 0; f <= 100; f += 5) redundantKeyframes.push({ frame: f, value: f * 2 }); // 完全な直線 y=2x -> 中間点は全て冗長
  const redundantScene = createRiv({
    artboard: { name: "OptTest", width: 200, height: 200 },
    shapes: [{ id: "box", type: "rect", x: 50, y: 50, width: 20, height: 20, fill: { color: "#e94560" } }],
    animations: [
      { name: "move", duration: 100, loop: "loop", tracks: [{ target: "box", property: "x", keyframes: redundantKeyframes }] },
    ],
  });
  const redundantPath = join(root, "samples", "e2e-optimize-redundant.riv");
  const fsMod = await import("node:fs");
  fsMod.writeFileSync(redundantPath, redundantScene.bytes);
  const redundantBeforeSize = statSync(redundantPath).size;

  // dryRun: 計画のみ返し、ファイルは書き換えない
  const optDry = await callTool("riv_optimize", { path: redundantPath, dryRun: true });
  const optDryParsed = JSON.parse(textOf(optDry));
  check(
    "riv_optimize dryRun reports a thinning plan for the redundant track",
    !optDry.isError && optDryParsed.dryRun === true && optDryParsed.thinned.length >= 1 && optDryParsed.after.keyframeCount < optDryParsed.before.keyframeCount,
    textOf(optDry).slice(0, 400)
  );
  check(
    "riv_optimize dryRun does not modify the source file",
    statSync(redundantPath).size === redundantBeforeSize,
    `before=${redundantBeforeSize} after=${statSync(redundantPath).size}`
  );

  // 実行: 21キーフレームの完全な直線 -> 始点・終点のみ(2キーフレーム)に間引かれるはず
  const redundantOptOut = join(root, "samples", "e2e-optimize-redundant-out.riv");
  const optRun = await callTool("riv_optimize", { path: redundantPath, outPath: redundantOptOut });
  check("riv_optimize thins the redundant track", !optRun.isError && textOf(optRun).includes("Optimized ->"), textOf(optRun).slice(0, 300));

  const redundantDumpAfter = await callTool("riv_dump", { path: redundantOptOut, full: true });
  const redundantDumpAfterParsed = JSON.parse(textOf(redundantDumpAfter));
  const kfAfterCount = (redundantDumpAfterParsed.objects || []).filter((o) => o.typeName === "KeyFrameDouble").length;
  check(
    "riv_optimize collapses the fully-linear track to its 2 endpoints",
    !redundantDumpAfter.isError && redundantDumpAfterParsed.parseError === null && kfAfterCount === 2,
    `kfAfterCount=${kfAfterCount}`
  );

  const redundantLintAfter = await callTool("riv_lint", { path: redundantOptOut });
  check(
    "riv_optimize output for the redundant-keyframe file has no lint errors",
    !redundantLintAfter.isError && JSON.parse(textOf(redundantLintAfter)).errorCount === 0,
    textOf(redundantLintAfter).slice(0, 300)
  );

  // riv_visual_diff: 同一ファイル同士 -> 一致率100% / 編集後ファイルとの比較 -> 100%未満
  const diffSame = await callTool("riv_visual_diff", {
    pathA: genPath, pathB: genPath, out: join(root, "samples", "e2e-diff-same.png"),
  });
  const diffSameText = textOf(diffSame);
  check("riv_visual_diff same file matches 100%", !diffSame.isError && diffSameText.includes("100.00%"), diffSameText.slice(0, 200));

  const diffChanged = await callTool("riv_visual_diff", {
    pathA: genPath, pathB: join(root, "samples", "e2e-edited.riv"), out: join(root, "samples", "e2e-diff-changed.png"),
  });
  const diffChangedText = textOf(diffChanged);
  const matchPct = parseFloat((diffChangedText.match(/Match rate: ([\d.]+)%/) || [])[1] ?? "100");
  check(
    "riv_visual_diff detects the edit (<100% match)",
    !diffChanged.isError && matchPct < 100,
    diffChangedText.slice(0, 200)
  );
  check("riv_visual_diff returns a diff image", (diffChanged.content || []).some((c) => c.type === "image"));

  // riv_batch_render: rivPath job + glob job (multiple matches) + intentionally-missing job (must not abort the batch)
  const batchOutDir = join(root, "samples", "e2e-batch-out");
  const batchGlobPattern = join(root, "samples", "e2e-optimize-*.riv").replace(/\\/g, "/"); // matches 3 existing files
  const batchRender = await callTool("riv_batch_render", {
    defaults: { outDir: batchOutDir, width: 120 },
    jobs: [
      { rivPath: RIV, format: "png", time: 0.2 },
      { rivPath: genPath, format: "gif", duration: 0.4, fps: 8 },
      { glob: batchGlobPattern, format: "sprites", count: 4, duration: 0.5 },
      { rivPath: join(root, "samples", "__does_not_exist__.riv"), format: "png" },
    ],
  });
  const batchText = textOf(batchRender);
  check("riv_batch_render not error", !batchRender.isError, batchText.slice(0, 300));
  let batchReport = null;
  try {
    batchReport = JSON.parse(batchText.slice(batchText.indexOf("[")));
  } catch {}
  check(
    "riv_batch_render: 5 successes (1 rivPath png + 1 rivPath gif + 3 glob matches) and 1 failure (missing file)",
    Array.isArray(batchReport) && batchReport.filter((r) => r.success).length === 5 && batchReport.filter((r) => !r.success).length === 1,
    batchText.slice(0, 800)
  );
  check(
    "riv_batch_render: failed job reports an error without aborting the rest",
    Array.isArray(batchReport) && batchReport.some((r) => !r.success && r.error && r.error.includes("File not found")),
    JSON.stringify(batchReport?.filter((r) => !r.success))
  );
  {
    const pngJobOut = batchReport?.find((r) => r.success && r.format === "png" && r.rivPath === RIV)?.outPath;
    const gifJobOut = batchReport?.find((r) => r.success && r.format === "gif")?.outPath;
    const spriteOuts = batchReport?.filter((r) => r.success && r.format === "sprites").map((r) => r.outPath) ?? [];
    check(
      "riv_batch_render writes the png job output",
      !!pngJobOut && existsSync(pngJobOut) && statSync(pngJobOut).size > 500,
      pngJobOut
    );
    check(
      "riv_batch_render writes the gif job output",
      !!gifJobOut && existsSync(gifJobOut) && statSync(gifJobOut).size > 500,
      gifJobOut
    );
    check(
      "riv_batch_render glob expands to 3 separate sprite-sheet outputs",
      spriteOuts.length === 3 && spriteOuts.every((p) => existsSync(p)),
      JSON.stringify(spriteOuts)
    );
  }

  // riv_ab_compare: two different real files (vehicles vs. cute_cat), explicit duration -> deterministic frame count
  const abOut = join(root, "samples", "test-ab-compare.gif");
  const abCompare = await callTool("riv_ab_compare", {
    pathA: RIV,
    pathB: join(root, "samples", "cute_cat.riv"),
    width: 160,
    duration: 0.5,
    fps: 8,
    out: abOut,
  });
  const abText = textOf(abCompare);
  check("riv_ab_compare not error", !abCompare.isError, abText.slice(0, 300));
  check("riv_ab_compare returns a preview image", (abCompare.content || []).some((c) => c.type === "image"));
  {
    const bytes = existsSync(abOut) ? (await import("node:fs")).readFileSync(abOut) : null;
    let frameCount = 0;
    if (bytes) {
      for (let i = 0; i < bytes.length - 2; i++) {
        if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) frameCount++;
      }
    }
    check(
      "riv_ab_compare writes an animated gif with fps*duration frames (4)",
      !!bytes && bytes.subarray(0, 6).toString() === "GIF89a" && frameCount === 4,
      bytes ? `${bytes.length} bytes, ${frameCount} frames` : "missing"
    );
  }

  // riv_ab_compare: vertical layout + apng, default out path naming (alongside pathA, mentions both basenames)
  const abVertical = await callTool("riv_ab_compare", {
    pathA: RIV,
    pathB: join(root, "samples", "cute_cat.riv"),
    width: 120,
    duration: 0.3,
    fps: 6,
    layout: "vertical",
    format: "apng",
  });
  const abVerticalText = textOf(abVertical);
  check(
    "riv_ab_compare vertical/apng not error and defaults the output path alongside pathA",
    !abVertical.isError && abVerticalText.includes("vehicles") && abVerticalText.includes("cute_cat") && abVerticalText.includes("vertical, apng"),
    abVerticalText.slice(0, 300)
  );
  {
    const defaultOutMatch = abVerticalText.match(/-> (.+\.ab\.apng)/);
    const defaultOut = defaultOutMatch?.[1];
    const sig = defaultOut && existsSync(defaultOut) ? fsMod2Sig(defaultOut) : null;
    check(
      "riv_ab_compare vertical/apng writes a valid APNG file (PNG signature)",
      !!defaultOut && existsSync(defaultOut) && sig === "89504e47",
      `${defaultOut} sig=${sig}`
    );
  }

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

  // カーブエディタ (rivEdit.setKeyframeCurve): 直接importして無損失編集の核ロジックを検証
  // (Windows の ESM import は file:// 絶対パス必須 -> pathToFileURL 経由。CLAUDE.md 落とし穴7 参照)
  const { setKeyframeCurve } = await import(pathToFileURL(join(root, "dist", "rivEdit.js")).href);
  const { readRiv: readRivDirect } = await import(pathToFileURL(join(root, "dist", "rivBinary.js")).href);
  // a/x と b/x の両方に同名イージング(ease-in-out)を使わせ、rivWriterに同一interpolatorを共有させる
  const curveScene = createRiv({
    artboard: { name: "CurveTest", width: 200, height: 200 },
    shapes: [
      { id: "a", type: "rect", x: 50, y: 50, width: 20, height: 20, fill: { color: "#e94560" } },
      { id: "b", type: "rect", x: 100, y: 50, width: 20, height: 20, fill: { color: "#45e960" } },
    ],
    animations: [
      {
        name: "anim", duration: 10, loop: "loop",
        tracks: [
          { target: "a", property: "x", keyframes: [{ frame: 0, value: 0 }, { frame: 10, value: 100, easing: "ease-in-out" }] },
          { target: "b", property: "x", keyframes: [{ frame: 0, value: 0 }, { frame: 10, value: 50, easing: "ease-in-out" }] },
        ],
      },
    ],
  });
  // 挿入(クローン)が起きるとオブジェクトの.indexは総入れ替わりになるため、以降は常に
  // 「frame===undefinedのKeyFrameDouble」を出現順(=a, b)で引き直す。stale indexを使い回さない。
  const findShiftedKfs = (dump) => dump.objects.filter((o) => o.typeName === "KeyFrameDouble" && o.properties.frame === undefined);
  const interpOf = (dump, kfObj) => dump.objects[dump.objects.findIndex((o) => o.typeName === "Artboard") + kfObj.properties.interpolatorId];

  const dumpBefore = readRivDirect(curveScene.bytes);
  const kfObjsBefore = findShiftedKfs(dumpBefore);
  check("curve test fixture has 2 shifted keyframes sharing one interpolator", kfObjsBefore.length === 2);
  check(
    "fixture: both tracks reference the same interpolator (dedup by rivWriter)",
    kfObjsBefore[0].properties.interpolatorId === kfObjsBefore[1].properties.interpolatorId,
    `${kfObjsBefore[0].properties.interpolatorId} vs ${kfObjsBefore[1].properties.interpolatorId}`
  );

  const afterCubicEdit = setKeyframeCurve(curveScene.bytes, { keyframeIndex: kfObjsBefore[0].index, type: "cubic", cubic: [0.1, 0.2, 0.3, 0.4] });
  const dumpAfterCubic = readRivDirect(afterCubicEdit.bytes);
  const [aObjAfter, bObjAfter] = findShiftedKfs(dumpAfterCubic);
  const aInterpAfter = interpOf(dumpAfterCubic, aObjAfter);
  const bInterpAfter = interpOf(dumpAfterCubic, bObjAfter);
  check(
    "setKeyframeCurve(cubic) clones the interpolator instead of mutating a shared one",
    aObjAfter.properties.interpolatorId !== bObjAfter.properties.interpolatorId,
    `a->${aObjAfter.properties.interpolatorId} b->${bObjAfter.properties.interpolatorId}`
  );
  check(
    "setKeyframeCurve(cubic) writes the new control points on the cloned interpolator",
    Math.abs(aInterpAfter.properties.x1 - 0.1) < 1e-4 && Math.abs(aInterpAfter.properties.y2 - 0.4) < 1e-4,
    JSON.stringify(aInterpAfter.properties)
  );
  check(
    "the other track's shared interpolator is untouched (no cross-segment corruption)",
    Math.abs(bInterpAfter.properties.x1 - 0.42) < 1e-4 && Math.abs(bInterpAfter.properties.y2 - 1) < 1e-4,
    JSON.stringify(bInterpAfter.properties)
  );

  // 同じ(今は排他的な)interpolatorへの2回目以降の編集はin-placeで再利用される（クローンが増殖しない）
  const afterSecondCubicEdit = setKeyframeCurve(afterCubicEdit.bytes, { keyframeIndex: aObjAfter.index, type: "cubic", cubic: [0.5, 0.6, 0.7, 0.8] });
  const dumpAfterSecond = readRivDirect(afterSecondCubicEdit.bytes);
  const [aObjSecond] = findShiftedKfs(dumpAfterSecond);
  check(
    "a subsequent cubic edit on an already-exclusive interpolator reuses it in place (no growth)",
    dumpAfterSecond.objects.filter((o) => o.typeName === "CubicEaseInterpolator").length ===
      dumpAfterCubic.objects.filter((o) => o.typeName === "CubicEaseInterpolator").length,
    `${dumpAfterSecond.objects.filter((o) => o.typeName === "CubicEaseInterpolator").length} vs ${dumpAfterCubic.objects.filter((o) => o.typeName === "CubicEaseInterpolator").length}`
  );
  const aInterpSecond = interpOf(dumpAfterSecond, aObjSecond);
  check(
    "the reused interpolator's control points reflect the second edit",
    Math.abs(aInterpSecond.properties.x1 - 0.5) < 1e-4,
    JSON.stringify(aInterpSecond.properties)
  );

  const afterLinearEdit = setKeyframeCurve(afterSecondCubicEdit.bytes, { keyframeIndex: aObjSecond.index, type: "linear" });
  const dumpAfterLinear = readRivDirect(afterLinearEdit.bytes);
  const [aObjLinear] = findShiftedKfs(dumpAfterLinear);
  check("setKeyframeCurve(linear) sets interpolationType=1", aObjLinear.properties.interpolationType === 1);

  const afterHoldEdit = setKeyframeCurve(afterLinearEdit.bytes, { keyframeIndex: aObjLinear.index, type: "hold" });
  const dumpAfterHold = readRivDirect(afterHoldEdit.bytes);
  const [aObjHold] = findShiftedKfs(dumpAfterHold);
  check("setKeyframeCurve(hold) sets interpolationType=0", aObjHold.properties.interpolationType === 0);

  // riv_studio: 起動→/state→停止
  const studio = noteStudio(await callTool("riv_studio", { path: genPath, port: 8797 }));
  check("riv_studio starts", !studio.isError && textOf(studio).includes("http://127.0.0.1:8797/"));
  const stateRes = await sFetch("http://127.0.0.1:8797/state").then((r2) => r2.json()).catch(() => null);
  check("riv_studio serves state", !!stateRes && typeof stateRes.objects === "number", JSON.stringify(stateRes)?.slice(0, 120));
  const treeRes = await sFetch("http://127.0.0.1:8797/tree").then((r2) => r2.json()).catch(() => null);
  check("riv_studio serves tree", !!treeRes?.artboards?.length && treeRes.artboards[0].nodes.length > 0, JSON.stringify(treeRes)?.slice(0, 120));
  // AIへの指示: UI投稿 → riv_studio_notes で消費
  await sFetch("http://127.0.0.1:8797/notes", { method: "POST", body: JSON.stringify({ text: "テスト指示: 大きくして" }) });
  const notesRes = await callTool("riv_studio_notes", { port: 8797 });
  check("riv_studio_notes fetches instructions", !notesRes.isError && textOf(notesRes).includes("テスト指示"), textOf(notesRes).slice(0, 150));
  const notesEmpty = await callTool("riv_studio_notes", { port: 8797 });
  check("riv_studio_notes consumes queue", !notesEmpty.isError && textOf(notesEmpty).includes("No pending"), textOf(notesEmpty).slice(0, 100));

  // /anim + /curve: カーブエディタのHTTP面（genPathの"wobble"アニメには dot/scaleX に
  // 実際の ease-in-out CubicEaseInterpolator が入っている = riv_create 時にシフト書き込み済み）
  const genBytesBefore = fsMod.readFileSync(genPath);
  const animRes = await sFetch("http://127.0.0.1:8797/anim?artboard=Gen&animation=wobble").then((r2) => r2.json()).catch(() => null);
  check("/anim serves tracks for the riv-only timeline", !!animRes?.tracks?.length, JSON.stringify(animRes)?.slice(0, 150));
  const scaleTrack = animRes?.tracks?.find((tr) => tr.propertyName === "scaleX");
  check("/anim resolves target name and property name", scaleTrack?.targetName === "dot", JSON.stringify(scaleTrack)?.slice(0, 200));
  const kfSegFrame0 = scaleTrack?.keyframes?.find((k) => k.frame === 0);
  const kfFrame30 = scaleTrack?.keyframes?.find((k) => k.frame === 30);
  check("/anim: first keyframe has no incoming segment (editTargetIndex=null)", kfSegFrame0 && kfSegFrame0.editTargetIndex === null);
  check(
    "/anim: segment arriving at frame30 resolves the existing ease-in-out cubic interpolator",
    kfFrame30?.segment?.interpolator?.kind === "cubic" &&
      Math.abs(kfFrame30.segment.interpolator.x1 - 0.42) < 1e-3 &&
      Math.abs(kfFrame30.segment.interpolator.y2 - 1) < 1e-3,
    JSON.stringify(kfFrame30)
  );
  check("/anim: editTargetIndex for frame30's segment is a real object index (the shifted keyframe)", typeof kfFrame30?.editTargetIndex === "number");

  const curveRes = await sFetch("http://127.0.0.1:8797/curve", {
    method: "POST",
    body: JSON.stringify({ keyframeIndex: kfFrame30.editTargetIndex, type: "cubic", cubic: [0.1, 0.1, 0.9, 0.9] }),
  }).then((r2) => r2.json());
  check("/curve applies a cubic edit", curveRes.ok === true, JSON.stringify(curveRes));

  const animAfter = await sFetch("http://127.0.0.1:8797/anim?artboard=Gen&animation=wobble").then((r2) => r2.json());
  const scaleTrackAfter = animAfter.tracks.find((tr) => tr.propertyName === "scaleX");
  const kfFrame30After = scaleTrackAfter.keyframes.find((k) => k.frame === 30);
  const kfFrame60After = scaleTrackAfter.keyframes.find((k) => k.frame === 60);
  check(
    "/curve edit is reflected by /anim (control points updated)",
    Math.abs(kfFrame30After.segment.interpolator.x1 - 0.1) < 1e-3 && Math.abs(kfFrame30After.segment.interpolator.y2 - 0.9) < 1e-3,
    JSON.stringify(kfFrame30After)
  );
  check(
    "the adjacent segment (frame30->60) is untouched by the frame0->30 edit",
    kfFrame60After.segment.interpolationType === 1,
    JSON.stringify(kfFrame60After)
  );
  const rotationTrackAfter = animAfter.tracks.find((tr) => tr.propertyName === "rotation");
  check("an unrelated track (sq/rotation) is unaffected by the curve edit", !!rotationTrackAfter, JSON.stringify(rotationTrackAfter)?.slice(0, 150));

  // /curve: hold/linear への切替
  const curveHoldRes = await sFetch("http://127.0.0.1:8797/curve", {
    method: "POST",
    body: JSON.stringify({ keyframeIndex: kfFrame30.editTargetIndex, type: "hold" }),
  }).then((r2) => r2.json());
  check("/curve applies a hold edit", curveHoldRes.ok === true, JSON.stringify(curveHoldRes));
  const animAfterHold = await sFetch("http://127.0.0.1:8797/anim?artboard=Gen&animation=wobble").then((r2) => r2.json());
  const kfFrame30Hold = animAfterHold.tracks.find((tr) => tr.propertyName === "scaleX").keyframes.find((k) => k.frame === 30);
  check("/anim reflects the hold interpolationType", kfFrame30Hold.segment.interpolationType === 0, JSON.stringify(kfFrame30Hold));

  // /riv-restore: Undo相当（rivのみモードのUndo/Redoが依拠するエンドポイント）でファイルを丸ごと差し戻す
  const restoreRes = await sFetch("http://127.0.0.1:8797/riv-restore", {
    method: "POST",
    body: JSON.stringify({ bytesBase64: genBytesBefore.toString("base64") }),
  }).then((r2) => r2.json());
  check("/riv-restore accepts a snapshot", restoreRes.ok === true, JSON.stringify(restoreRes));
  const animAfterRestore = await sFetch("http://127.0.0.1:8797/anim?artboard=Gen&animation=wobble").then((r2) => r2.json());
  const kfFrame30Restored = animAfterRestore.tracks.find((tr) => tr.propertyName === "scaleX").keyframes.find((k) => k.frame === 30);
  check(
    "/riv-restore reverts the file to the pre-edit snapshot",
    Math.abs(kfFrame30Restored.segment.interpolator.x1 - 0.42) < 1e-3 && Math.abs(kfFrame30Restored.segment.interpolator.y2 - 1) < 1e-3,
    JSON.stringify(kfFrame30Restored)
  );

  // /sm: SMグラフビュー用のノードグラフJSON（genPathの"Flow": entry->idle, idle->moving(active条件)）
  const smRes = await sFetch("http://127.0.0.1:8797/sm").then((r2) => r2.json()).catch(() => null);
  const genAb = smRes?.artboards?.find((a) => a.name === "Gen");
  const flowSm = genAb?.stateMachines?.find((s) => s.name === "Flow");
  check("/sm finds the artboard and state machine", !!flowSm, JSON.stringify(smRes)?.slice(0, 200));
  check(
    "/sm reports the declared input",
    flowSm?.inputs?.length === 1 && flowSm.inputs[0].name === "active" && flowSm.inputs[0].type === "bool",
    JSON.stringify(flowSm?.inputs)
  );
  const flowLayer = flowSm?.layers?.[0];
  check("/sm defaults the layer name to 'Layer 1'", flowLayer?.name === "Layer 1", JSON.stringify(flowLayer?.name));
  const idleState = flowLayer?.states?.find((s) => s.name === "still");
  const movingState = flowLayer?.states?.find((s) => s.name === "wobble");
  check(
    "/sm resolves AnimationState node names to their animation name (idle->still, moving->wobble)",
    idleState?.kind === "AnimationState" && movingState?.kind === "AnimationState",
    JSON.stringify(flowLayer?.states)
  );
  check("/sm: reachable states are not flagged unreachable", idleState?.unreachable !== true && movingState?.unreachable !== true);
  const entryToIdle = flowLayer?.transitions?.find((t) => t.source === 0 && t.target === idleState?.id);
  const idleToMoving = flowLayer?.transitions?.find((t) => t.source === idleState?.id && t.target === movingState?.id);
  check("/sm: entry->idle transition has no conditions", !!entryToIdle && entryToIdle.conditions.length === 0, JSON.stringify(entryToIdle));
  check(
    "/sm: idle->moving transition carries the bool condition on 'active' with op '=='",
    idleToMoving?.conditions?.[0]?.inputName === "active" && idleToMoving.conditions[0].opLabel === "==",
    JSON.stringify(idleToMoving)
  );
  check("/sm: no false-positive selfLoopRisk on a well-formed SM", !flowSm.layers.some((l) => l.transitions.some((t) => t.selfLoopRisk)));

  // /sm: 到達不能state・条件なし自己遷移のハイライト用フラグ(rivLintの findings と同じファイルで再検証)
  const brokenStudio = noteStudio(await callTool("riv_studio", { path: lintBrokenPath, port: 8798 }));
  check("riv_studio (broken SM fixture) starts", !brokenStudio.isError);
  const smBrokenRes = await sFetch("http://localhost:8798/sm").then((r2) => r2.json()).catch(() => null);
  const brokenSm = smBrokenRes?.artboards?.[0]?.stateMachines?.find((s) => s.name === "Broken");
  const brokenLayer = brokenSm?.layers?.[0];
  check(
    "/sm flags the unreachable 'orphan' state (matches riv_lint's state#4 finding)",
    brokenLayer?.states?.some((s) => s.name === "still" && s.unreachable === true && s.id === 4),
    JSON.stringify(brokenLayer?.states)
  );
  check(
    "/sm flags the unconditional self-transition (matches riv_lint's infinite-loop-risk finding)",
    brokenLayer?.transitions?.some((t) => t.source === t.target && t.selfLoopRisk === true),
    JSON.stringify(brokenLayer?.transitions)
  );
  const brokenStopped = await callTool("riv_studio", { path: lintBrokenPath, stop: true });
  check("riv_studio (broken SM fixture) stops", !brokenStopped.isError && textOf(brokenStopped).includes("stopped"));

  // 共有なし(既定)では 127.0.0.1 以外で待ち受けない。LAN の IP 宛ての接続は拒否されるはず
  // （直前のテストで別の studio を起動して止めたので、既定の起動をここで改めて行う）
  const lanIp = firstLanIp();
  const defStudio = noteStudio(await callTool("riv_studio", { path: genPath, port: 8797 }));
  check("riv_studio default restart", !defStudio.isError && !textOf(defStudio).includes("Read-only share"), textOf(defStudio).slice(0, 120));
  if (lanIp) {
    check("riv_studio default: 127.0.0.1 accepts", await tcpOpen("127.0.0.1", 8797));
    check(`riv_studio default: LAN address ${lanIp} refuses (not listening beyond loopback)`, !(await tcpOpen(lanIp, 8797)));
    check(`riv_studio default: no share port (${lanIp}:8798) is open`, !(await tcpOpen(lanIp, 8798)));
  } else {
    console.log("  (skip) no LAN IPv4 address on this machine; default-binding check needs one");
  }
  // 編集用サーバーは Host が loopback 以外のリクエストを拒否（DNS リバインディング対策）
  const evilHost = await rawRequest({ host: "127.0.0.1", port: 8797, path: "/state", headers: { Host: "evil.example" } });
  check("edit server rejects a non-loopback Host header", evilHost.status === 403, String(evilHost.status));

  const stopped = await callTool("riv_studio", { path: genPath, stop: true });
  check("riv_studio stops", !stopped.isError && textOf(stopped).includes("stopped"));

  // --- riv_studio share: 読み取り専用のLAN共有 ---
  if (lanIp) {
    const shared = noteStudio(await callTool("riv_studio", { path: genPath, port: 8841, share: true, sharePort: 8842 }));
    const shareText = textOf(shared);
    const m = /Read-only share URL \(LAN\): (http:\/\/(\d+\.\d+\.\d+\.\d+):(\d+)\/s\/([A-Za-z0-9_-]+)\/)/.exec(shareText);
    check("riv_studio share:true returns a LAN read-only URL with a token", !shared.isError && !!m, shareText.slice(0, 300));
    if (m) {
      const [, shareUrl, shHost, shPortStr, token] = m;
      const shPort = Number(shPortStr);
      const origin = `http://${shHost}:${shPort}`;
      check("share token has >= 16 bytes of entropy (>= 22 base64url chars)", token.length >= 22, String(token.length));
      check("share URL host is a LAN address (not loopback)", !shHost.startsWith("127."), shHost);
      const rivBefore = readFileSync(genPath);

      // (a) トークン付きで読み取り専用ページと .riv が取れる
      const page = await fetch(shareUrl);
      const html = await page.text();
      const setCookie = page.headers.get("set-cookie") ?? "";
      check("share (a): token URL serves the read-only page", page.status === 200 && html.includes("window.__RO__") && html.includes('class="ro"'), String(page.status));
      check("share (a): page sets an HttpOnly SameSite=Strict cookie", /HttpOnly/i.test(setCookie) && /SameSite=Strict/i.test(setCookie), setCookie);
      const cookie = setCookie.split(";")[0];
      const rivViaPath = await fetch(`${origin}/s/${token}/file.riv`);
      const rivBytes = Buffer.from(await rivViaPath.arrayBuffer());
      check("share (a): .riv is served via the token path", rivViaPath.status === 200 && rivBytes.subarray(0, 4).toString() === "RIVE", String(rivViaPath.status));
      const rivViaCookie = await fetch(`${origin}/file.riv`, { headers: { Cookie: cookie } });
      check("share (a): .riv is served via the cookie", rivViaCookie.status === 200, String(rivViaCookie.status));
      const stateRo = await (await fetch(`${origin}/state`, { headers: { Cookie: cookie } })).text();
      check("share (a): /state does not leak local paths or scene", !stateRo.includes("rivPath") && !stateRo.includes(genPath) && !stateRo.includes("scenePath"), stateRo.slice(0, 160));
      for (const p of ["/tree", "/sm", "/bones", "/anim?artboard=Gen&animation=wobble"]) {
        const r2 = await fetch(`${origin}${p}`, { headers: { Cookie: cookie } });
        check(`share (a): GET ${p.split("?")[0]} works read-only`, r2.status === 200, String(r2.status));
      }
      const sse = await fetch(`${origin}/events`, { headers: { Cookie: cookie } });
      check("share (a): SSE stream opens", sse.status === 200 && (sse.headers.get("content-type") ?? "").includes("text/event-stream"));
      await sse.body?.cancel();

      // (b) トークン無し / 違うトークンは 403
      const noTok = [`${origin}/`, `${origin}/file.riv`, `${origin}/state`, `${origin}/events`, `${origin}/s/${token.slice(0, -1)}/`, `${origin}/s/${"A".repeat(token.length)}/file.riv`];
      let allDenied = true; const detail = [];
      for (const u of noTok) { const r2 = await fetch(u); if (r2.status !== 403) allDenied = false; detail.push(r2.status); }
      check("share (b): no/wrong token -> 403 everywhere", allDenied, detail.join(","));
      const badCookie = await fetch(`${origin}/file.riv`, { headers: { Cookie: cookie.replace(/=.*/, "=wrong") } });
      check("share (b): wrong cookie -> 403", badCookie.status === 403, String(badCookie.status));
      const noTokWrite = await fetch(`${origin}/edit`, { method: "POST", body: "[]" });
      check("share (b): unauthenticated write -> 403", noTokWrite.status === 403);

      // (c) 読み取り専用トークンで書き込み系・管理系の API が拒否される
      const writes = [
        ["POST", "/edit", "[]"], ["POST", "/rebuild", "{}"], ["POST", "/notes", JSON.stringify({ text: "x" })],
        ["POST", "/chat", JSON.stringify({ text: "x" })], ["POST", "/curve", "{}"], ["POST", "/riv-restore", JSON.stringify({ bytesBase64: "AAAA" })],
        ["POST", "/api/snapshots", "{}"], ["POST", "/api/snapshots/restore", "{}"], ["POST", "/api/snapshots/delete", "{}"],
        ["POST", "/api/replace-asset", "{}"], ["POST", "/export/gif", "{}"], ["POST", "/export/apng", "{}"],
        ["PUT", "/file.riv", "x"], ["DELETE", "/file.riv", undefined], ["POST", "/file.riv", "x"], ["POST", "/", "x"],
        ["GET", "/chat"], ["GET", "/notes?consume=1"], ["GET", "/notes"], ["GET", "/api/assets"], ["GET", "/api/snapshots"], ["GET", "/nope"],
      ];
      const bad = [];
      for (const [method, p, body] of writes) {
        for (const auth of [`${origin}/s/${token}${p}`, null]) {
          const r2 = await fetch(auth ?? `${origin}${p}`, { method, body, headers: auth ? {} : { Cookie: cookie } });
          if (r2.status !== 403) bad.push(`${method} ${p} -> ${r2.status}`);
        }
      }
      check("share (c): every write/admin/unknown route is 403 (token path and cookie)", bad.length === 0, bad.join("; "));
      const head = await rawRequest({ host: shHost, port: shPort, path: `/s/${token}/file.riv`, method: "HEAD" });
      check("share (c): HEAD is refused", head.status === 403, String(head.status));
      // パストラバーサル: 生のパスをそのまま送る（fetch は .. を正規化してしまうため http.request を使う）
      const trav = [`/s/${token}/../package.json`, `/s/${token}/..%2f..%2fpackage.json`, `/s/${token}/%2e%2e/%2e%2e/package.json`, `/s/${token}//etc/passwd`, `/s/${token}/file.riv/../../package.json`, `/..%5c..%5cpackage.json`];
      const travBad = [];
      for (const p of trav) {
        const r2 = await rawRequest({ host: shHost, port: shPort, path: p, headers: { Cookie: cookie } });
        if (r2.status === 200 || /rive-mcp-server|root:/.test(r2.body)) travBad.push(`${p} -> ${r2.status}`);
      }
      check("share (c): path traversal never reads other files", travBad.length === 0, travBad.join("; "));
      check("share (c): .riv on disk is unchanged after all rejected writes", readFileSync(genPath).equals(rivBefore));

      // (d) 共有あり: 編集用ポートは LAN から届かない。共有ポートは LAN の指定アドレスだけで待ち受け
      check("share (d): edit port is not reachable via the LAN address", !(await tcpOpen(shHost, 8841)));
      check("share (d): edit port is reachable on 127.0.0.1", await tcpOpen("127.0.0.1", 8841));
      check("share (d): share port is reachable via the LAN address", await tcpOpen(shHost, shPort));
      check("share (d): share port is not listening on loopback", !(await tcpOpen("127.0.0.1", shPort)));
      // 編集用は 127.0.0.1 から従来どおり書ける（Host=localhost）
      const editOk = await sFetch("http://127.0.0.1:8841/notes", { method: "POST", body: JSON.stringify({ text: "from loopback" }) });
      check("share: edit server still accepts writes from 127.0.0.1", editOk.status === 200, String(editOk.status));
      // 編集側の未取得の指示数は共有側に出さない
      check("share: viewer /state has no pendingNotes", !stateRo.includes("pendingNotes"));
    }
    const sharedStop = await callTool("riv_studio", { path: genPath, stop: true });
    check("riv_studio (share) stops", !sharedStop.isError && textOf(sharedStop).includes("stopped"));
    check("share port is closed after stop (token revoked)", !(await tcpOpen(lanIp, 8842)));
  } else {
    console.log("  (skip) share checks need a LAN IPv4 address");
  }

  // --- riv_ui_detect → riv_ui_prototype（画像1枚から動くプロトタイプ） ---
  // 検出は riv_ui_prototype 側でも走るので、**同じ引数でなければ id がずれる**。
  // その前提が本当に成り立っているかをここで確かめる（ずれると全要素が
  // 汎用パネル扱いになり、静かに退屈な .riv ができる）。
  {
    const shotPath = join(root, "test", "tmp", "ui-shot.png");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420">
      <rect width="640" height="420" fill="#F3F5F6"/>
      <rect x="24" y="24" width="592" height="56" rx="10" fill="#194878"/>
      <rect x="24" y="104" width="280" height="180" rx="12" fill="#3E3179"/>
      <rect x="48" y="230" width="120" height="36" rx="8" fill="#EB6F38"/>
      <rect x="330" y="104" width="150" height="96" rx="6" fill="#78D3A3"/>
      <rect x="496" y="104" width="120" height="96" rx="6" fill="#E275B5"/>
    </svg>`;
    // スクリーンショットは自前で用意する（SVG→PNG のツールは公開していない）。
    // サーバー本体とは別に headless を1つ起こすが、テスト内だけの話。
    mkdirSync(dirname(shotPath), { recursive: true });
    {
      const { RiveHost } = await import(pathToFileURL(join(root, "dist", "riveHost.js")).href);
      const { PAGE_SCRIPT } = await import(pathToFileURL(join(root, "dist", "pageScript.js")).href);
      const h = new RiveHost(PAGE_SCRIPT);
      try { writeFileSync(shotPath, await h.rasterize(svg)); } finally { await h.close(); }
    }
    {
      const det = await callTool("riv_ui_detect", { imagePath: shotPath });
      check("riv_ui_detect が要素を返す", !det.isError, textOf(det).slice(0, 120));
      const parsed = JSON.parse(textOf(det));
      check("要素が5件以上ある", parsed.elements.length >= 5, String(parsed.elements.length));

      const roles = parsed.elements.map((e, i) => ({
        id: e.id,
        role: i === 0 ? "background" : e.semanticHint === "text" ? "text" : "card",
      }));
      const outRiv = join(root, "test", "tmp", "ui-prototype.riv");
      const proto = await callTool("riv_ui_prototype", { imagePath: shotPath, outPath: outRiv, roles });
      check("riv_ui_prototype が .riv を書く", !proto.isError, textOf(proto).slice(0, 200));
      const pr = JSON.parse(textOf(proto));
      check("id が突き合っている（未知idの警告が出ない）",
        !pr.warnings.some((w) => w.includes("not in the detected element list")),
        JSON.stringify(pr.warnings));
      check("要素数が riv_ui_detect と一致", pr.elements === parsed.elements.length,
        `${pr.elements} vs ${parsed.elements.length}`);
      // 反実仮想判定の結果は両ツールで同じでなければならない（検出をもう一度走らせているので、
      // ずれたら「同じ引数なら同じ結果」という前提が壊れている）。
      check("demoted / patched が両ツールで一致",
        pr.demoted === parsed.demoted && pr.patched === parsed.patched,
        `detect ${parsed.demoted}/${parsed.patched} vs prototype ${pr.demoted}/${pr.patched}`);
      // 使う側が見るのは warnings。件数があるのに黙っていないか、無いのに言っていないかを両方見る
      const warnsAbout = (s) => pr.warnings.some((w) => w.includes(s));
      check("demoted / patched は warnings にも出る",
        (pr.demoted > 0) === warnsAbout("turned into crops") &&
        (pr.patched > 0) === warnsAbout("cut-out"),
        `demoted=${pr.demoted} patched=${pr.patched} warnings=${JSON.stringify(pr.warnings)}`);
      check("出力が RIVE で始まる", fsMod2Sig(outRiv) === "52495645", fsMod2Sig(outRiv));
      check("アニメーションが1つ以上ある", pr.animations.length >= 1, JSON.stringify(pr.animations));

      // 実際に再生できるか。ファイルが書けても読めなければ意味がない。
      const frame = await callTool("riv_render_frame", { path: outRiv, outPath: join(root, "test", "tmp", "ui-prototype.png") });
      check("生成した .riv を描画できる", !frame.isError, textOf(frame).slice(0, 160));
    }

    // --- 同じ2ツールのベクター入力（svgPath）。推定が無いので id は完全に決定的で、
    // 生成物には元画像が1枚も入らない
    {
      const { DASHBOARD_SVG } = await import(pathToFileURL(join(root, "test", "fixtures", "vectorSvg.mjs")).href);
      const svgFile = join(root, "test", "tmp", "ui-vector.svg");
      writeFileSync(svgFile, DASHBOARD_SVG);
      const det = await callTool("riv_ui_detect", { svgPath: svgFile });
      check("riv_ui_detect が SVG を読む", !det.isError, textOf(det).slice(0, 160));
      const parsed = JSON.parse(textOf(det));
      check("SVG の寸法をそのまま返す",
        parsed.source.width === 640 && parsed.source.height === 420 && parsed.source.kind === "svg",
        JSON.stringify(parsed.source));
      check("非矩形は vector-shape で返る",
        parsed.elements.some((e) => e.renderMode === "vector-shape"),
        parsed.elements.map((e) => e.renderMode).join(","));
      check("頂点座標そのものは返さない（要約だけ）",
        parsed.elements.every((e) => e.shapes === undefined) &&
        parsed.elements.some((e) => typeof e.vertices === "number"));
      check("レイヤー名がロールのヒントになる",
        parsed.elements.some((e) => e.roleHint === "button"),
        parsed.elements.map((e) => e.roleHint).join(","));
      const again = JSON.parse(textOf(await callTool("riv_ui_detect", { svgPath: svgFile })));
      check("同じ SVG からは同じ id が出る",
        JSON.stringify(again.elements) === JSON.stringify(parsed.elements));

      const outRiv = join(root, "test", "tmp", "ui-vector.riv");
      const proto = await callTool("riv_ui_prototype", {
        svgPath: svgFile, outPath: outRiv,
        roles: parsed.elements.map((e) => ({ id: e.id, role: e.roleHint ?? "panel" })),
      });
      check("riv_ui_prototype が SVG から .riv を書く", !proto.isError, textOf(proto).slice(0, 200));
      const pr = JSON.parse(textOf(proto));
      check("id が突き合っている（未知idの警告が出ない）",
        !pr.warnings.some((w) => w.includes("not in the element list")), JSON.stringify(pr.warnings));
      check("要素数が riv_ui_detect と一致", pr.elements === parsed.elements.length,
        `${pr.elements} vs ${parsed.elements.length}`);
      // ベクター経路の要点: 元画像を1枚も埋め込まない
      check("ラスタアセットが0件", pr.rasterAssets === 0, String(pr.rasterAssets));
      check("編集可能比率を返す", typeof pr.editable === "string" && pr.editable === parsed.editable,
        `${pr.editable} vs ${parsed.editable}`);
      check("出力が RIVE で始まる", fsMod2Sig(outRiv) === "52495645", fsMod2Sig(outRiv));
      const vframe = await callTool("riv_render_frame", { path: outRiv, outPath: join(root, "test", "tmp", "ui-vector.png") });
      check("SVG から作った .riv を描画できる", !vframe.isError, textOf(vframe).slice(0, 160));
      const both = await callTool("riv_ui_detect", { svgPath: svgFile, imagePath: shotPath });
      check("imagePath と svgPath の同時指定は断る",
        both.isError && textOf(both).includes("not several"), textOf(both).slice(0, 120));

      // Figma REST は既定オフ。**このテストはトークンを持たないので何も取りに行かない**
      // （実トークンでの疎通は未検証。ここで見るのは「鍵が無ければ動かない」ことだけ）
      {
        const noToken = await callTool("riv_ui_detect", {
          figmaUrl: "https://www.figma.com/design/KEY0/Name?node-id=1-2",
        });
        check("FIGMA_TOKEN が無ければ figmaUrl は断られる",
          noToken.isError && textOf(noToken).includes("FIGMA_TOKEN"), textOf(noToken).slice(0, 140));
        check("断り文はローカル経路を案内する",
          textOf(noToken).includes("svgPath"), textOf(noToken).slice(0, 200));
      }

      // --- <text> と <image>。フォントに無い文字は豆腐にせず絵にする（必ず警告つき） ---
      {
        const { TEXT_CARD_SVG, CJK_SVG } = await import(
          pathToFileURL(join(root, "test", "fixtures", "vectorSvg.mjs")).href);
        const textSvg = join(root, "test", "tmp", "ui-text.svg");
        writeFileSync(textSvg, TEXT_CARD_SVG);
        const td = JSON.parse(textOf(await callTool("riv_ui_detect", { svgPath: textSvg })));
        check("<text> は編集可能な vector-text になる",
          td.text.total === 5 && td.text.asText === 5 &&
            td.elements.filter((e) => e.renderMode === "vector-text").length === 5,
          JSON.stringify(td.text));
        check("巨大なバイト列は返さない（長さだけ）",
          td.elements.every((e) => e.imageBytes === undefined || typeof e.imageBytes === "number"));

        const textRiv = join(root, "test", "tmp", "ui-text.riv");
        const tp = JSON.parse(textOf(await callTool("riv_ui_prototype", {
          svgPath: textSvg, outPath: textRiv,
          roles: td.elements.map((e) => ({ id: e.id, role: e.roleHint ?? "panel" })),
        })));
        check("テキスト入り SVG から .riv が書ける", !!tp.outPath && tp.bytes > 0, JSON.stringify(tp.bytes));
        check("埋め込み <image> だけが画像アセットになる", tp.rasterAssets === 1, String(tp.rasterAssets));
        const tinfo = JSON.parse(textOf(await callTool("riv_inspect", { path: textRiv })));
        check("生成した .riv を公式ランタイムが読める",
          tinfo.artboards?.[0]?.width === 360, JSON.stringify(tinfo.artboards?.[0]?.width));

        const cjkSvg = join(root, "test", "tmp", "ui-cjk.svg");
        writeFileSync(cjkSvg, CJK_SVG);
        const cd = JSON.parse(textOf(await callTool("riv_ui_detect", { svgPath: cjkSvg })));
        check("同梱フォントに無い文字の行はラスタへ降格する",
          cd.text.rasterized === 1 && cd.text.asText === 1, JSON.stringify(cd.text));
        check("降格は黙ってやらない（警告に文字が出る）",
          cd.warnings.some((w) => w.includes("no glyph for")), JSON.stringify(cd.warnings));
        const cjkRiv = join(root, "test", "tmp", "ui-cjk.riv");
        const cp = JSON.parse(textOf(await callTool("riv_ui_prototype", {
          svgPath: cjkSvg, outPath: cjkRiv,
          roles: cd.elements.map((e) => ({ id: e.id, role: e.roleHint ?? "panel" })),
        })));
        check("降格した行は切り抜き 1 枚として .riv に入る", cp.rasterAssets === 1, String(cp.rasterAssets));
        const cframe = await callTool("riv_render_frame", {
          path: cjkRiv, outPath: join(root, "test", "tmp", "ui-cjk.png"), time: 2,
        });
        check("降格した行を含む .riv を描画できる", !cframe.isError, textOf(cframe).slice(0, 160));
      }
    }
  }


  // riv_repair: safe structural edits, visual equality, and idempotence.
  {
    const { readRiv, writeRawRiv, loadDefs } = await import("../dist/rivBinary.js");
    const defs = loadDefs();
    if (!defs) throw new Error("Rive definitions missing");
    const fixtureDir = join(root, "local");
    mkdirSync(fixtureDir, { recursive: true });
    const sourcePath = join(fixtureDir, "e2e-repair-source.riv");
    const outputPath = join(fixtureDir, "e2e-repair-output.riv");
    const previewPath = join(fixtureDir, "e2e-repair-preview.riv");
    const secondPath = join(fixtureDir, "e2e-repair-second.riv");
    const vehiclesPath = join(fixtureDir, "e2e-repair-vehicles.riv");
    const hugePath = join(fixtureDir, "e2e-repair-large.riv");
    const createResult = await callTool("riv_create", {
      outPath: sourcePath,
      scene: {
        artboard: { width: 120, height: 120 },
        shapes: [{ id: "dot", type: "rect", x: 24, y: 35, width: 20, height: 20, fill: { color: "#e94560" } }],
        animations: [{
          name: "Move", duration: 60, loop: "oneShot",
          tracks: [{
            target: "dot", property: "x",
            keyframes: [
              { frame: 0, value: 15 },
              { frame: 20, value: 40, easing: "ease-in" },
              { frame: 40, value: 65, easing: "ease-out" },
              { frame: 60, value: 25 },
            ],
          }],
        }],
        stateMachine: {
          name: "Switch",
          inputs: [{ name: "internalFlag", type: "bool" }],
          states: [{ name: "still", animation: "Move" }],
          transitions: [{ from: "entry", to: "still" }],
        },
      },
    });
    check("riv_repair source creation", !createResult.isError, textOf(createResult).slice(0, 250));
    const dump = readRiv(readFileSync(sourcePath));
    const keyframes = dump.objects.filter((o) => o.typeName === "KeyFrameDouble");
    const input = dump.objects.find((o) => o.typeName === "StateMachineBool");
    if (keyframes.length !== 4 || !input) throw new Error("Repair source structure differs from expectations");
    const typeKey = defs.types.InterpolatingKeyFrame.properties.interpolationType.key;
    const idKey = defs.types.InterpolatingKeyFrame.properties.interpolatorId.key;
    const publicKey = defs.types.StateMachineInput.properties.public.key;
    const firstId = keyframes[0].raw.find((p) => p.key === idKey)?.value;
    if (typeof firstId !== "number") throw new Error("Cubic easing reference missing");
    input.raw.push({ key: publicKey, fieldType: 0, value: 0 });
    // A linear segment may carry an unused invalid easing reference.
    keyframes[1].raw = keyframes[1].raw.filter((p) => p.key !== idKey);
    const secondKind = keyframes[1].raw.find((p) => p.key === typeKey);
    if (!secondKind) throw new Error("Second interpolation missing");
    secondKind.value = 1;
    keyframes[2].raw.push({ key: idKey, fieldType: 0, value: 999999 });
    const finalKind = keyframes[3].raw.find((p) => p.key === typeKey);
    if (!finalKind) throw new Error("Final interpolation missing");
    finalKind.value = 2;
    keyframes[3].raw.push({ key: idKey, fieldType: 0, value: firstId });
    writeFileSync(sourcePath, writeRawRiv(dump));

    const lintBefore = await callTool("riv_lint", { path: sourcePath });
    const baselineFindings = JSON.parse(textOf(lintBefore)).findings;
    check("riv_repair fixture contains safe findings",
      !lintBefore.isError &&
      baselineFindings.some((f) => f.rule === "broken-reference") &&
      baselineFindings.some((f) => f.rule === "dead-easing") &&
      baselineFindings.some((f) => f.rule === "unused-input"),
      JSON.stringify(baselineFindings).slice(0, 500));

    rmSync(previewPath, { force: true });
    const preview = await callTool("riv_repair", { path: sourcePath, out: previewPath, dryRun: true });
    const previewReport = preview.isError ? null : JSON.parse(textOf(preview));
    check("riv_repair dryRun never writes", !preview.isError && !existsSync(previewPath) &&
      previewReport?.applied.length >= 1 && previewReport?.skipped.some(
        (entry) => entry.rule === "broken-reference" && entry.reason.includes("removal changes rendered output")
      ), textOf(preview).slice(0, 500));

    const repaired = await callTool("riv_repair", { path: sourcePath, out: outputPath });
    const report = repaired.isError ? null : JSON.parse(textOf(repaired));
    check("riv_repair applies the private unused input fix",
      !repaired.isError &&
      report?.applied.some((entry) => entry.fix === "unused-input" && entry.count === 1 && !!entry.detail),
      textOf(repaired).slice(0, 900));
    check("riv_repair preserves referenced final easing",
      !repaired.isError &&
      !report?.applied.some((entry) => entry.fix === "dead-easing") &&
      report?.skipped.some((entry) => entry.rule === "dead-easing" &&
        entry.reason.includes("final keyframe easing is not applied; not rewritten")),
      textOf(repaired).slice(0, 900));
    const finalKeys = readRiv(readFileSync(outputPath)).objects.filter((o) => o.typeName === "KeyFrameDouble");
    check("riv_repair leaves final interpolation properties unchanged",
      finalKeys.length === keyframes.length &&
      finalKeys[finalKeys.length - 1].raw.find((p) => p.key === typeKey)?.value === 2 &&
      finalKeys[finalKeys.length - 1].raw.find((p) => p.key === idKey)?.value === firstId);
    check("riv_repair skips reference removal that changes pixels",
      !repaired.isError && !report?.applied.some((entry) => entry.fix === "broken-reference") &&
      report?.skipped.some((entry) =>
        entry.rule === "broken-reference" && entry.reason.includes("removal changes rendered output")),
      textOf(repaired).slice(0, 700));
    check("riv_repair returns the specified report shape",
      !repaired.isError &&
      typeof report?.before.lintCount === "number" &&
      typeof report?.before.byRule["broken-reference"] === "number" &&
      typeof report?.after.lintCount === "number" &&
      typeof report?.after.byRule === "object" &&
      report?.bytes.before === readFileSync(sourcePath).length &&
      report?.bytes.after === readFileSync(outputPath).length,
      textOf(repaired).slice(0, 900));
    check("riv_repair frame comparison is identical",
      !repaired.isError && report?.visual.identical === true &&
      report?.visual.frames > 0 && report?.visual.maxDiffPixels === 0,
      JSON.stringify(report?.visual));
    const afterLint = await callTool("riv_lint", { path: outputPath });
    const afterCount = JSON.parse(textOf(afterLint)).findings.length;
    check("riv_repair decreases lint findings", !afterLint.isError &&
      afterCount < baselineFindings.length && report?.after.lintCount === afterCount,
      `${baselineFindings.length} -> ${afterCount}`);
    const inspected = await callTool("riv_inspect", { path: outputPath });
    check("riv_repair result loads in the official runtime",
      !inspected.isError && JSON.parse(textOf(inspected)).artboardCount === 1,
      textOf(inspected).slice(0, 250));
    for (const time of [0, 0.5]) {
      const first = await callTool("riv_render_frame", { path: sourcePath, animation: "Move", time });
      const next = await callTool("riv_render_frame", { path: outputPath, animation: "Move", time });
      const firstPng = (first.content || []).find((c) => c.type === "image")?.data;
      const nextPng = (next.content || []).find((c) => c.type === "image")?.data;
      check("riv_repair rendered pixels match at " + time,
        !first.isError && !next.isError && !!firstPng && firstPng === nextPng,
        `time=${time} errors=${first.isError}/${next.isError}`);
    }

    const secondRun = await callTool("riv_repair", { path: outputPath, out: secondPath });
    check("riv_repair is idempotent",
      !secondRun.isError && JSON.parse(textOf(secondRun)).applied.length === 0 &&
      readFileSync(secondPath).equals(readFileSync(outputPath)),
      textOf(secondRun).slice(0, 350));

    const hugeDump = readRiv(readFileSync(outputPath));
    hugeDump.objects.push({
      typeKey: defs.types.FileAssetContents.typeKey,
      raw: [{ key: defs.types.FileAssetContents.properties.bytes.key, fieldType: 1, value: new Uint8Array(510000) }],
    });
    writeFileSync(hugePath, writeRawRiv(hugeDump));
    const hugeResult = await callTool("riv_repair", { path: hugePath, dryRun: true, fixes: [] });
    check("riv_repair reports huge assets as skipped with a reason",
      !hugeResult.isError && JSON.parse(textOf(hugeResult)).skipped.some(
        (entry) => entry.rule === "huge-asset" && !!entry.reason
      ), textOf(hugeResult).slice(0, 400));

    const originalVehicles = readFileSync(RIV);
    const { repairRiv } = await import("../dist/rivRepair.js");
    const plannedVehicles = repairRiv(originalVehicles);
    check("riv_repair plans no edits for healthy vehicles",
      plannedVehicles.report.applied.length === 0 &&
      plannedVehicles.candidates.length === 0 &&
      Buffer.from(plannedVehicles.bytes).equals(originalVehicles),
      JSON.stringify(plannedVehicles.report.applied).slice(0, 400));
    const vehiclesResult = await callTool("riv_repair", { path: RIV, out: vehiclesPath });
    const vehiclesReport = vehiclesResult.isError ? null : JSON.parse(textOf(vehiclesResult));
    check("riv_repair preserves healthy vehicles byte for byte",
      !vehiclesResult.isError && vehiclesReport?.applied.length === 0 &&
      vehiclesReport?.visual.frames === 0 &&
      existsSync(vehiclesPath) && readFileSync(vehiclesPath).equals(originalVehicles),
      textOf(vehiclesResult).slice(0, 400));
  }

  // riv_export_lottie: basic shape animation, timing, losses, and import round-trip
  const lottieExpPath = join(root, "samples", "e2e-lottie-export.riv");
  const lottieExpOut = join(root, "samples", "e2e-lottie-export.lottie.json");
  const lottieExpScene = {
    artboard: { name: "LottieExport", width: 160, height: 120 },
    shapes: [
      { id: "box", type: "rect", x: 40, y: 60, width: 24, height: 30, fill: { color: "#ff3300" } },
      { id: "disk", type: "ellipse", x: 110, y: 60, width: 24, height: 24, fill: { color: "#0066ff" } },
    ],
    animations: [{
      name: "shift", fps: 24, duration: 48, loop: "oneShot",
      tracks: [
        { target: "box", property: "x", keyframes: [
          { frame: 0, value: 40 },
          { frame: 24, value: 80, easing: "ease-in-out" },
          { frame: 48, value: 100, easing: "hold" },
        ] },
        { target: "disk", property: "opacity", keyframes: [
          { frame: 0, value: 1 }, { frame: 24, value: 0.5 }, { frame: 48, value: 1 },
        ] },
      ],
    }],
  };
  const lottieExpCreated = await callTool("riv_create", {
    outPath: lottieExpPath, scene: lottieExpScene,
  });
  check("lottie export fixture validated by official runtime",
    !lottieExpCreated.isError && textOf(lottieExpCreated).includes("validated"),
    textOf(lottieExpCreated).slice(0, 180));
  const lottieExpCall = await callTool("riv_export_lottie", {
    path: lottieExpPath, out: lottieExpOut,
  });
  check("riv_export_lottie returns a JSON report", !lottieExpCall.isError,
    textOf(lottieExpCall).slice(0, 180));
  const lottieExpReport = !lottieExpCall.isError
    ? JSON.parse(textOf(lottieExpCall)) : null;
  const lottieExpDocument = existsSync(lottieExpOut)
    ? JSON.parse(readFileSync(lottieExpOut, "utf8")) : null;
  check("riv_export_lottie writes a nonempty JSON file",
    !!lottieExpReport && lottieExpReport.out === lottieExpOut &&
    lottieExpReport.bytes === statSync(lottieExpOut).size &&
    lottieExpReport.bytes > 0);
  check("riv_export_lottie preserves required Lottie document fields",
    !!lottieExpDocument && typeof lottieExpDocument.v === "string" &&
    ["fr", "ip", "op", "w", "h"].every((key) =>
      Number.isFinite(lottieExpDocument[key])) &&
    Array.isArray(lottieExpDocument.layers) && lottieExpDocument.layers.length === 2);
  check("riv_export_lottie preserves source frame rate and duration",
    !!lottieExpDocument && lottieExpDocument.fr === 24 &&
    lottieExpDocument.ip === 0 && lottieExpDocument.op === 48);
  const lottieExpBox = lottieExpDocument?.layers?.find((layer) => layer.nm === "box");
  const lottieExpKeys = lottieExpBox?.ks?.p?.x?.k ?? [];
  check("riv_export_lottie preserves keyframe count and times",
    lottieExpKeys.length === 3 &&
    JSON.stringify(lottieExpKeys.map((key) => key.t)) === JSON.stringify([0, 24, 48]));
  check("riv_export_lottie writes easing on the correct interval",
    lottieExpKeys[0]?.o?.x === 0.42 && lottieExpKeys[1]?.i?.x === 0.58 &&
    lottieExpKeys[1]?.h === 1);
  check("riv_export_lottie reports no loss for simple shapes",
    !!lottieExpReport && Array.isArray(lottieExpReport.lost) &&
    lottieExpReport.lost.length === 0,
    JSON.stringify(lottieExpReport?.lost?.slice(0, 4)));
  const lottieExpVehicle = await callTool("riv_export_lottie", {
    path: RIV, out: join(root, "samples", "e2e-vehicles.lottie.json"),
  });
  const lottieExpVehicleReport = !lottieExpVehicle.isError
    ? JSON.parse(textOf(lottieExpVehicle)) : null;
  check("riv_export_lottie reports state machines in lost",
    !!lottieExpVehicleReport && lottieExpVehicleReport.lost.some(
      (entry) => entry.feature === "state machine"),
    textOf(lottieExpVehicle).slice(0, 160));
  const lottieExpImportPath = join(root, "samples", "e2e-lottie-roundtrip.scene.json");
  const lottieExpImported = await callTool("riv_lottie_import", {
    path: lottieExpOut, outSpec: lottieExpImportPath,
  });
  const lottieExpFragment = existsSync(lottieExpImportPath)
    ? JSON.parse(readFileSync(lottieExpImportPath, "utf8")) : null;
  check("riv_lottie_import accepts the exported Lottie and restores timing",
    !lottieExpImported.isError && !!lottieExpFragment &&
    lottieExpFragment.animations?.[0]?.tracks?.some((track) =>
      track.property === "x" && track.keyframes.length === 3 &&
      track.keyframes[1].frame === 24),
    textOf(lottieExpImported).slice(0, 180));
  const lottieExpAll = await callTool("riv_export_lottie", {
    path: lottieExpPath, animation: "all",
  });
  check("riv_export_lottie rejects animation=all", !!lottieExpAll.isError);
  if (lottieExpReport?.verify?.frames > 0) {
    check("riv_export_lottie pixel difference stays within 2 percent",
      typeof lottieExpReport.verify.maxDiffPercent === "number" &&
      lottieExpReport.verify.maxDiffPercent <= 2,
      JSON.stringify(lottieExpReport.verify));
  } else {
    check("riv_export_lottie explicitly marks pixel comparison unverified",
      lottieExpReport?.verify?.frames === 0 &&
      lottieExpReport?.verify?.maxDiffPercent === "unverified");
  }

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
  for (const path of listSampleEntries(join(root, "samples"))
    .filter((entry) => !originalSampleEntries.has(entry))
    .sort((a, b) => b.length - a.length)) {
    rmSync(path, { recursive: true, force: true });
  }
  check("samples contains no new test outputs",
    listSampleEntries(join(root, "samples")).every((entry) => originalSampleEntries.has(entry)));
  process.exit(failures === 0 ? 0 : 1);
}
