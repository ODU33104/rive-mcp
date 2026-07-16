// ブラウザページ内で実行されるスクリプト。
// 公式 Rive ランタイム (canvas-advanced) を駆動し、window.riveApi を公開する。
// Node 側からは page.evaluate 経由で呼び出す。
export const PAGE_SCRIPT = String.raw`
import RiveFactory from "/canvas_advanced.mjs";

const rive = await RiveFactory({ locateFile: (f) => "/" + f });

const INPUT_TYPES = { 56: "number", 58: "trigger", 59: "boolean" };
const LOOP_NAMES = ["oneShot", "loop", "pingPong"];

function b64ToBytes(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function withFile(b64, fn) {
  const file = await rive.load(b64ToBytes(b64));
  if (!file) throw new Error("Failed to load .riv file (unsupported or corrupt format)");
  try {
    return await fn(file);
  } finally {
    if (file.delete) file.delete();
  }
}

function artboardNames(file) {
  const names = [];
  for (let i = 0; i < file.artboardCount(); i++) {
    const ab = file.artboardByIndex(i);
    names.push(ab.name);
    ab.delete();
  }
  return names;
}

function getArtboard(file, name) {
  if (!name) {
    if (file.artboardCount() === 0) throw new Error("File has no artboards");
    return file.artboardByIndex(0);
  }
  const ab = file.artboardByName(name);
  if (!ab) {
    throw new Error(
      "Artboard '" + name + "' not found. Available: " + artboardNames(file).join(", ")
    );
  }
  return ab;
}

function listNames(ab, kind) {
  const names = [];
  const count = kind === "animation" ? ab.animationCount() : ab.stateMachineCount();
  for (let i = 0; i < count; i++) {
    names.push(kind === "animation" ? ab.animationByIndex(i).name : ab.stateMachineByIndex(i).name);
  }
  return names;
}

function inputInfo(inp) {
  // 値は型付きアクセサ経由でないと取れない
  let value = null;
  if (inp.type === 59) value = inp.asBool().value;
  else if (inp.type === 56) value = inp.asNumber().value;
  if (value === undefined) value = null;
  return {
    name: inp.name,
    type: INPUT_TYPES[inp.type] || String(inp.type),
    value,
  };
}

function applyInput(sm, name, value) {
  for (let i = 0; i < sm.inputCount(); i++) {
    const inp = sm.input(i);
    if (inp.name !== name) continue;
    if (inp.type === 58) {
      inp.asTrigger().fire();
    } else if (inp.type === 59) {
      inp.asBool().value = !!value;
    } else {
      inp.asNumber().value = Number(value);
    }
    return inputInfo(inp);
  }
  const available = [];
  for (let i = 0; i < sm.inputCount(); i++) available.push(sm.input(i).name);
  throw new Error("Input '" + name + "' not found. Available: " + available.join(", "));
}

function collectStateChanges(sm) {
  const states = [];
  for (let i = 0; i < sm.stateChangedCount(); i++) states.push(sm.stateChangedNameByIndex(i));
  return states;
}

function makeScene(file, opts) {
  const ab = getArtboard(file, opts.artboard);
  const b = ab.bounds;
  const abW = b.maxX - b.minX;
  const abH = b.maxY - b.minY;
  const width = Math.round(opts.width || abW);
  const height = Math.round(opts.height || (width * abH) / abW);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  // captureStream()/MediaRecorder はcanvasがドキュメントに接続されていないと合成フレームを出さない
  canvas.style.position = "fixed";
  canvas.style.left = "-99999px";
  document.body.appendChild(canvas);
  const renderer = rive.makeRenderer(canvas);
  // ctx は遅延取得: canvas.getContext("2d") を呼ぶだけで captureStream(0)+requestFrame() の
  // フレーム捕捉が空になる環境がある(実測)。background合成/rgba capture を使わない経路(=動画録画)
  // では一切呼ばれないようにする。
  let _ctx = null;
  const getCtx = () => (_ctx || (_ctx = canvas.getContext("2d")));

  let anim = null;
  let sm = null;
  if (opts.stateMachine) {
    const def = ab.stateMachineByName(opts.stateMachine);
    if (!def) {
      throw new Error(
        "StateMachine '" + opts.stateMachine + "' not found. Available: " +
          listNames(ab, "stateMachine").join(", ")
      );
    }
    sm = new rive.StateMachineInstance(def, ab);
  } else if (opts.animation) {
    const def = ab.animationByName(opts.animation);
    if (!def) {
      throw new Error(
        "Animation '" + opts.animation + "' not found. Available: " +
          listNames(ab, "animation").join(", ")
      );
    }
    anim = new rive.LinearAnimationInstance(def, ab);
  } else if (ab.stateMachineCount() > 0) {
    sm = new rive.StateMachineInstance(ab.stateMachineByIndex(0), ab);
  } else if (ab.animationCount() > 0) {
    anim = new rive.LinearAnimationInstance(ab.animationByIndex(0), ab);
  }

  const step = (sec) => {
    if (sm) {
      sm.advanceAndApply(sec);
      return collectStateChanges(sm);
    }
    if (anim) {
      anim.advance(sec);
      anim.apply(1);
    }
    ab.advance(sec);
    return [];
  };

  const draw = () => {
    renderer.clear();
    renderer.save();
    renderer.align(
      rive.Fit.contain,
      rive.Alignment.center,
      { minX: 0, minY: 0, maxX: width, maxY: height },
      ab.bounds
    );
    ab.draw(renderer);
    renderer.restore();
    // rAF ループ外なのでバッチ済み描画コマンドを明示的にフラッシュする
    rive.resolveAnimationFrame();
    if (opts.background) {
      // 背景は描画結果の下に合成する
      const ctx = getCtx();
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "source-over";
    }
  };

  const capture = (format) => {
    if (format === "rgba") {
      const data = getCtx().getImageData(0, 0, width, height).data;
      let bin = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < data.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, data.subarray(i, i + CHUNK));
      }
      return btoa(bin);
    }
    return canvas.toDataURL("image/png").split(",")[1];
  };

  const cleanup = () => {
    if (sm) sm.delete();
    if (anim) anim.delete();
    ab.delete();
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  };

  return { ab, sm, anim, width, height, canvas, step, draw, capture, cleanup };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

window.riveApi = {
  // PNG をポリゴン領域で切り分ける。parts: 各領域の切り出しPNG + bbox、base: 領域を消去した残り
  async sliceImage(b64, opts) {
    const bytes = b64ToBytes(b64);
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const W = bitmap.width, H = bitmap.height;
    const parts = [];
    for (const region of opts.regions) {
      const xs = region.polygon.map((p) => p[0]);
      const ys = region.polygon.map((p) => p[1]);
      const x0 = Math.max(0, Math.floor(Math.min(...xs)));
      const y0 = Math.max(0, Math.floor(Math.min(...ys)));
      const x1 = Math.min(W, Math.ceil(Math.max(...xs)));
      const y1 = Math.min(H, Math.ceil(Math.max(...ys)));
      const canvas = document.createElement("canvas");
      canvas.width = x1 - x0;
      canvas.height = y1 - y0;
      const ctx = canvas.getContext("2d");
      ctx.beginPath();
      region.polygon.forEach(([px, py], i) =>
        i === 0 ? ctx.moveTo(px - x0, py - y0) : ctx.lineTo(px - x0, py - y0)
      );
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(bitmap, -x0, -y0);
      parts.push({
        name: region.name,
        x: x0, y: y0, width: x1 - x0, height: y1 - y0,
        png: canvas.toDataURL("image/png").split(",")[1],
      });
    }
    const baseCanvas = document.createElement("canvas");
    baseCanvas.width = W;
    baseCanvas.height = H;
    const bctx = baseCanvas.getContext("2d");
    bctx.drawImage(bitmap, 0, 0);
    bctx.globalCompositeOperation = "destination-out";
    for (const region of opts.regions) {
      if (region.keepInBase) continue;
      bctx.beginPath();
      region.polygon.forEach(([px, py], i) =>
        i === 0 ? bctx.moveTo(px, py) : bctx.lineTo(px, py)
      );
      bctx.closePath();
      bctx.fill();
    }
    return { width: W, height: H, parts, base: baseCanvas.toDataURL("image/png").split(",")[1] };
  },

  // .riv の全メタデータを抽出する
  async inspect(b64) {
    return withFile(b64, (file) => {
      const out = { artboardCount: file.artboardCount(), artboards: [] };
      for (let i = 0; i < file.artboardCount(); i++) {
        const ab = file.artboardByIndex(i);
        const b = ab.bounds;
        const info = {
          name: ab.name,
          width: b.maxX - b.minX,
          height: b.maxY - b.minY,
          animations: [],
          stateMachines: [],
        };
        for (let j = 0; j < ab.animationCount(); j++) {
          const def = ab.animationByIndex(j);
          info.animations.push({
            name: def.name,
            durationFrames: def.duration,
            durationSeconds: def.fps ? def.duration / def.fps : null,
            fps: def.fps,
            speed: def.speed,
            loop: LOOP_NAMES[def.loopValue] !== undefined ? LOOP_NAMES[def.loopValue] : def.loopValue,
          });
        }
        for (let k = 0; k < ab.stateMachineCount(); k++) {
          const def = ab.stateMachineByIndex(k);
          const sm = new rive.StateMachineInstance(def, ab);
          const inputs = [];
          for (let m = 0; m < sm.inputCount(); m++) inputs.push(inputInfo(sm.input(m)));
          info.stateMachines.push({ name: def.name, inputs });
          sm.delete();
        }
        out.artboards.push(info);
        ab.delete();
      }
      return out;
    });
  },

  // フレーム列をレンダリングする（PNG base64 or RGBA base64）
  async renderFrames(b64, opts) {
    return withFile(b64, (file) => {
      const scene = makeScene(file, opts);
      try {
        const frames = [];
        const states = [];
        const dt = 1 / (opts.fps || 60);
        const changed = scene.step(opts.startTime || 0);
        if (changed.length) states.push({ frame: 0, states: changed });
        const frameCount = Math.min(opts.frameCount || 1, 600);
        for (let i = 0; i < frameCount; i++) {
          if (i > 0) {
            const c = scene.step(dt);
            if (c.length) states.push({ frame: i, states: c });
          }
          scene.draw();
          frames.push(scene.capture(opts.format || "png"));
        }
        return { width: scene.width, height: scene.height, frames, states };
      } finally {
        scene.cleanup();
      }
    });
  },

  // アニメーション/SMをリアルタイムでWebM動画に録画する
  async renderVideo(b64, opts) {
    return withFile(b64, async (file) => {
      const scene = makeScene(file, opts);
      try {
        const fps = opts.fps || 30;
        const duration = Math.max(0.05, opts.duration || 2);
        const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : (MediaRecorder.isTypeSupported("video/webm;codecs=vp8") ? "video/webm;codecs=vp8" : "video/webm");

        const recordOnce = async () => {
          // captureStream(fps) の自動タイマーサンプリングは canvas-advanced の描画(dirty-rect検出を経ない
          // ブリット)を拾わないことがある。captureStream(0)=手動モード + track.requestFrame() で毎描画を
          // 確実にキャプチャする（実測: 自動=110B(空), 手動=数十KB/1s で検証済み）。
          const stream = scene.canvas.captureStream(0);
          const track = stream.getVideoTracks()[0];
          const chunks = [];
          const recorder = new MediaRecorder(stream, { mimeType });
          recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) chunks.push(e.data);
          };
          const stopped = new Promise((resolve, reject) => {
            recorder.onstop = resolve;
            recorder.onerror = (ev) => reject(ev.error || new Error("MediaRecorder error"));
          });
          scene.step(0);
          scene.draw();
          track.requestFrame();
          recorder.start();
          const start = performance.now();
          let steps = 0;
          const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
          while ((performance.now() - start) / 1000 < duration) {
            await nextFrame();
            scene.step(1 / 60);
            scene.draw();
            track.requestFrame();
            steps++;
          }
          recorder.stop();
          await stopped;
          const elapsedSeconds = (performance.now() - start) / 1000;
          const blob = new Blob(chunks, { type: mimeType });
          return { blob, elapsedSeconds, steps };
        };

        // 実測: フレッシュなページでの最初の captureStream(0)+MediaRecorder 呼び出しは、パイプラインの
        // ウォームアップが間に合わず空(~110B)のWebMを返すことがある(非決定的)。中身が明らかに空なら
        // 同じシーンで1回だけ録り直す。
        let result = await recordOnce();
        if (result.blob.size < 1000 && result.steps > 3) {
          result = await recordOnce();
        }
        const base64 = await blobToBase64(result.blob);
        return {
          base64,
          mimeType,
          width: scene.width,
          height: scene.height,
          durationSeconds: result.elapsedSeconds,
          steps: result.steps,
          estimatedFrames: result.steps + 1,
          byteLength: result.blob.size,
        };
      } finally {
        scene.cleanup();
      }
    });
  },

  // 等間隔Nフレームを1枚のスプライトシートPNGに合成する
  async renderSprites(b64, opts) {
    return withFile(b64, (file) => {
      const scene = makeScene(file, opts);
      try {
        const count = Math.max(1, Math.min(opts.count || 16, 256));
        const duration = opts.duration && opts.duration > 0 ? opts.duration : count / (opts.fps || 20);
        const fps = opts.fps || Math.round(count / duration) || 1;
        const cols = Math.ceil(Math.sqrt(count));
        const rows = Math.ceil(count / cols);
        const cellW = scene.width;
        const cellH = scene.height;
        const sheet = document.createElement("canvas");
        sheet.width = cellW * cols;
        sheet.height = cellH * rows;
        const sctx = sheet.getContext("2d");
        const dt = count > 1 ? duration / count : 0;
        scene.step(0);
        for (let i = 0; i < count; i++) {
          if (i > 0) scene.step(dt);
          scene.draw();
          const col = i % cols;
          const row = Math.floor(i / cols);
          sctx.drawImage(scene.canvas, col * cellW, row * cellH);
        }
        return {
          image: sheet.toDataURL("image/png").split(",")[1],
          width: sheet.width,
          height: sheet.height,
          cellW,
          cellH,
          cols,
          rows,
          count,
          fps,
        };
      } finally {
        scene.cleanup();
      }
    });
  },

  // 2つの.rivを同条件レンダリングしてピクセル差分を計算する
  async visualDiff(b64, opts) {
    return withFile(b64, (fileA) =>
      withFile(opts.b64B, (fileB) => {
        const sceneA = makeScene(fileA, opts);
        const forcedOpts = Object.assign({}, opts, { width: sceneA.width, height: sceneA.height });
        const sceneB = makeScene(fileB, forcedOpts);
        try {
          const t = opts.time || 0;
          sceneA.step(t);
          sceneA.draw();
          sceneB.step(t);
          sceneB.draw();
          const w = sceneA.width, h = sceneA.height;
          const dataA = sceneA.canvas.getContext("2d").getImageData(0, 0, w, h).data;
          const dataB = sceneB.canvas.getContext("2d").getImageData(0, 0, w, h).data;
          const threshold = opts.threshold === undefined ? 16 : opts.threshold;
          const diffCanvas = document.createElement("canvas");
          diffCanvas.width = w;
          diffCanvas.height = h;
          const dctx = diffCanvas.getContext("2d");
          const outImg = dctx.createImageData(w, h);
          const out = outImg.data;
          let diffPixels = 0;
          const total = w * h;
          for (let p = 0; p < total; p++) {
            const o = p * 4;
            const dr = Math.abs(dataA[o] - dataB[o]);
            const dg = Math.abs(dataA[o + 1] - dataB[o + 1]);
            const db = Math.abs(dataA[o + 2] - dataB[o + 2]);
            const da = Math.abs(dataA[o + 3] - dataB[o + 3]);
            const maxDiff = Math.max(dr, dg, db, da);
            if (maxDiff > threshold) {
              diffPixels++;
              out[o] = 255;
              out[o + 1] = 0;
              out[o + 2] = 0;
              out[o + 3] = 255;
            } else {
              const lum = (dataA[o] + dataA[o + 1] + dataA[o + 2]) / 3;
              out[o] = out[o + 1] = out[o + 2] = lum;
              out[o + 3] = dataA[o + 3] > 0 ? 60 : 0;
            }
          }
          dctx.putImageData(outImg, 0, 0);
          return {
            width: w,
            height: h,
            totalPixels: total,
            diffPixels,
            matchRate: total > 0 ? (1 - diffPixels / total) * 100 : 100,
            threshold,
            diffImage: diffCanvas.toDataURL("image/png").split(",")[1],
          };
        } finally {
          sceneA.cleanup();
          sceneB.cleanup();
        }
      })
    );
  },

  // State Machine を対話的に実行する。
  // steps: [{input?, value?, advance?, capture?}]
  async playStateMachine(b64, opts) {
    return withFile(b64, (file) => {
      const scene = makeScene(file, {
        artboard: opts.artboard,
        stateMachine: opts.stateMachine,
        width: opts.width,
        height: opts.height,
        background: opts.background,
      });
      if (!scene.sm) {
        scene.cleanup();
        throw new Error("No state machine available on this artboard");
      }
      try {
        const report = [];
        const frames = [];
        // 初期化: 0秒 advance で初期状態を確定
        const initial = scene.step(0);
        report.push({ step: "init", statesChanged: initial, inputs: currentInputs(scene.sm) });
        for (let i = 0; i < (opts.steps || []).length; i++) {
          const s = opts.steps[i];
          const entry = { step: i };
          if (s.input !== undefined && s.input !== null) {
            entry.applied = applyInput(scene.sm, s.input, s.value);
          }
          const changed = scene.step(s.advance || 0);
          entry.advancedSeconds = s.advance || 0;
          entry.statesChanged = changed;
          entry.inputs = currentInputs(scene.sm);
          if (s.capture) {
            scene.draw();
            entry.frameIndex = frames.length;
            frames.push(scene.capture("png"));
          }
          report.push(entry);
        }
        return { width: scene.width, height: scene.height, report, frames };
      } finally {
        scene.cleanup();
      }
    });
  },
};

function currentInputs(sm) {
  const out = [];
  for (let i = 0; i < sm.inputCount(); i++) out.push(inputInfo(sm.input(i)));
  return out;
}

window.__riveReady = true;
`;
