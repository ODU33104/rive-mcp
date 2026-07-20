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
  check("tools/list has 27 tools", names.length === 27, names.join(","));

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
