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
  const renderer = rive.makeRenderer(canvas);
  const ctx = canvas.getContext("2d");

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
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "source-over";
    }
  };

  const capture = (format) => {
    if (format === "rgba") {
      const data = ctx.getImageData(0, 0, width, height).data;
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
  };

  return { ab, sm, anim, width, height, step, draw, capture, cleanup };
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
