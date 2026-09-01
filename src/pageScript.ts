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

  // 大きな時間ジャンプ用: SMは1回のadvanceで遷移評価が1回しか走らないため、
  // 1/60秒刻みで進めて exitTime 遷移やアニメ進行を正しく通過させる
  const seek = (sec) => {
    const all = [];
    const dt = 1 / 60;
    let remaining = sec;
    while (remaining > 1e-9) {
      const d = Math.min(dt, remaining);
      remaining -= d;
      const c = step(d);
      for (const s of c) if (!all.includes(s)) all.push(s);
    }
    if (sec <= 1e-9) {
      const c = step(0);
      for (const s of c) if (!all.includes(s)) all.push(s);
    }
    return all;
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

  return { ab, sm, anim, width, height, canvas, step, seek, draw, capture, cleanup };
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
      // cut: true は「base から消すだけ」の領域。画像アセットは作らない
      if (region.cut) continue;
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

      // holes: この切り抜きの内側で「別の要素として上に描かれ、かつ動きうる」領域。
      // 抜かないと、カードの切り抜きにボタンが焼き付いたまま残り、上のベクターが
      // 入場や press で動いた瞬間に下から同じ絵が現れて二重になる
      // （実測 2026-09-01: サインインカードの入場でボタンが 2 枚見えた）。
      for (const hole of region.holes ?? []) {
        ctx.globalCompositeOperation = "destination-out";
        ctx.beginPath();
        hole.forEach(([px, py], i) =>
          i === 0 ? ctx.moveTo(px - x0, py - y0) : ctx.lineTo(px - x0, py - y0)
        );
        ctx.closePath();
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
      }

      // matte が付いている領域は、切り出した矩形をそのまま貼るのではなく
      // 前景色 + alpha に置き換える。矩形のまま貼ると背景が焼き付き、
      // **静止時は完全に一致するのに動かした瞬間に露出する**。
      // 判定(matteEligible)は detectUiRegions が済ませてあり、ここでは適用するだけ。
      if (region.matte) {
        const toLin = region.matte.space === "linear";
        const LUT = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
          const c = i / 255;
          LUT[i] = toLin ? (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)) : c;
        }
        const px = (h) => [
          parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
        ];
        const F8 = px(region.matte.fg), B8 = px(region.matte.bg);
        const B = [LUT[B8[0]], LUT[B8[1]], LUT[B8[2]]];
        const D = [LUT[F8[0]] - B[0], LUT[F8[1]] - B[1], LUT[F8[2]] - B[2]];
        const len2 = D[0] * D[0] + D[1] * D[1] + D[2] * D[2];
        if (len2 > 1e-9) {
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const d = img.data;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] === 0) continue; // クリップ外はそのまま透明
            const c0 = LUT[d[i]] - B[0], c1 = LUT[d[i + 1]] - B[1], c2 = LUT[d[i + 2]] - B[2];
            let a = (c0 * D[0] + c1 * D[1] + c2 * D[2]) / len2;
            a = a < 0 ? 0 : a > 1 ? 1 : a;
            // 色は前景色で塗り替える。これが matting モデルそのもの:
            // 元の背景 B の上に置けば元通りに見え、別の背景の上でも破綻しない。
            d[i] = F8[0]; d[i + 1] = F8[1]; d[i + 2] = F8[2];
            d[i + 3] = Math.round(a * 255);
          }
          ctx.putImageData(img, 0, 0);
        }
      }

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

  // スクリーンショットから UI 要素の矩形を拾う。
  // UI は「平坦塗り + 軸に揃った矩形」が支配的なので、色量子化 + 連結成分で素直に取れる。
  async detectUiRegions(b64, opts) {
    const minArea = opts?.minArea ?? 576;
    const workingMax = opts?.workingMax ?? 1280;
    // 境界コントラスト gate のパラメータ。**MCP ツールの引数としては公開していない。**
    // 閾値を「妥当そうな値」で決めないために、計測ハーネス側から掃引できるようにしてある
    // (test/fixtures/gateSweep.mjs)。既定値の根拠はその掃引の実測。
    // 既定値の根拠（2026-08-21 の掃引実測。test/fixtures/gateSweep.mjs で再現できる）:
    //
    //   min sides |  合成: gradPanel  recall  leakMax |  実画像: recall  leakMax
    //     0   3   |       29.8   1.000   0.678       |    0.417   0.221   ← gate 無し
    //     8   3   |        0.7   1.000   0.018       |    0.417   0.006
    //    10   3   |        0.7   1.000   0.018       |    0.417   0.006
    //    14   3   |        0.7   1.000   0.018       |    0.417   0.006
    //    16   3   |        0.7   1.000   0.018       |    0.375   0.006   ← 実画像が落ち始める
    //     8   4   |        0.0   1.000   0.000       |    0.292   0.000   ← グラデーションは0だが代償が大きい
    //
    // 辺3本・閾値 8〜14 は品質指標が完全に平坦で、その範囲では**実画像の recall が
    // 1件も落ちない**。10 を採る理由: 8 は 5bit 量子化のバケット幅そのもので
    // アンチエイリアスの揺れに対する余裕が無く、12 は計測側の正解アンカーの
    // admissibility 閾値と一致するため gate に無条件の合格点を与えてしまう。
    //
    // 辺4本にすればグラデーションのベクターパネルは 0 になるが、実画像の recall が
    // 0.417 → 0.292 に落ちる。実画像では検出器が元々ベクターパネルをほとんど
    // 作れていない(記事1ページで候補3件)ので、この取引は割に合わない。
    const boundaryContrastMin = opts?.boundaryContrastMin ?? 10;
    const boundarySidesRequired = opts?.boundarySidesRequired ?? 3;
    const bitmap = await createImageBitmap(new Blob([b64ToBytes(b64)], { type: "image/png" }));
    const W0 = bitmap.width, H0 = bitmap.height;
    const scale = Math.min(1, workingMax / Math.max(W0, H0));
    const W = Math.max(1, Math.round(W0 * scale));
    const H = Math.max(1, Math.round(H0 * scale));

    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;

    // 境界の外側をどれだけ離れて測るか。1px の枠線と 1〜2px のアンチエイリアスを
    // 跨ぐ必要があり、かつ隣接要素を跨いでしまうほど離せない。
    const BOUNDARY_OFFSET_PX = 3;

    // 5bit 量子化。UI の平坦塗りは同じバケットに落ちる
    const q = new Int32Array(W * H);
    for (let i = 0, p = 0; i < q.length; i++, p += 4) {
      q[i] = ((data[p] >> 3) << 10) | ((data[p + 1] >> 3) << 5) | (data[p + 2] >> 3);
    }

    // 4近傍 BFS で連結成分。stack は明示的に持つ（再帰だと深さで死ぬ）
    const label = new Int32Array(W * H).fill(-1);
    const comps = [];
    const stack = new Int32Array(W * H);
    for (let start = 0; start < q.length; start++) {
      if (label[start] !== -1) continue;
      const id = comps.length;
      const color = q[start];
      let sp = 0, count = 0;
      let minX = W, minY = H, maxX = -1, maxY = -1;
      let sr = 0, sg = 0, sb = 0;
      stack[sp++] = start;
      label[start] = id;
      while (sp > 0) {
        const idx = stack[--sp];
        const x = idx % W, y = (idx / W) | 0;
        count++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        const p = idx * 4;
        sr += data[p]; sg += data[p + 1]; sb += data[p + 2];
        if (x > 0 && label[idx - 1] === -1 && q[idx - 1] === color) { label[idx - 1] = id; stack[sp++] = idx - 1; }
        if (x < W - 1 && label[idx + 1] === -1 && q[idx + 1] === color) { label[idx + 1] = id; stack[sp++] = idx + 1; }
        if (y > 0 && label[idx - W] === -1 && q[idx - W] === color) { label[idx - W] = id; stack[sp++] = idx - W; }
        if (y < H - 1 && label[idx + W] === -1 && q[idx + W] === color) { label[idx + W] = id; stack[sp++] = idx + W; }
      }
      comps.push({ id, count, minX, minY, maxX, maxY, r: sr / count, g: sg / count, b: sb / count });
    }

    const inv = scale === 0 ? 1 : 1 / scale;
    const parseHex = (h) => [
      parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
    ];
    const hex = (r, g, b) =>
      "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

    const regions = [];
    const sampledColors = [];
    for (const c of comps) {
      const w = c.maxX - c.minX + 1;
      const h = c.maxY - c.minY + 1;
      if (w * h * inv * inv < minArea) continue;
      const fillRatio = c.count / (w * h);
      const color = hex(c.r, c.g, c.b);
      // usage は出現回数ではなく面積(元解像度ピクセル数)で重み付けする(designTokens.ts
      // paletteFromColors 参照)。画面全体を覆う背景1件と小さいボタン20件を同じ「1票」で
      // 数えると、面積では劣勢のボタン色がbackground(最頻色)に選ばれてしまう。
      // ここでの面積は regions.rect と同じ丸め後・元解像度の値を使う(workingMax縮小時の
      // scale混入を避けるため。rect算出前のw*h*inv*invではなく、後で使うのと同じ値を使う)。
      const rectW = Math.round(w * inv);
      const rectH = Math.round(h * inv);
      sampledColors.push({ hex: color, weight: rectW * rectH });

      const cls = classifyComp(c, w, h, fillRatio);
      regions.push({
        renderMode: cls.renderMode,
        semanticHint: cls.semanticHint,
        rect: [Math.round(c.minX * inv), Math.round(c.minY * inv), rectW, rectH],
        cornerRadius: cls.cornerRadius,
        fill: color,
        // テキスト行が確定した後の再分類（下の「文字で覆われた穴」参照）で使う。出力前に消す
        _comp: c,
      });
    }

    // 充填率と境界から「面」か「非矩形の絵」かを決め、面なら角丸も測る。
    // 最初の分類とテキスト行確定後の再分類の両方から呼ぶので、判断はここ1か所に置く。
    function classifyComp(c, w, h, fillRatio) {
      // 充填率で「面」か「非矩形の絵」かを分ける
      let semanticHint = fillRatio >= 0.85 ? "panel" : "image";
      // 細長く薄いものは区切り線
      if (semanticHint === "panel" && (h <= 3 * scale || w <= 3 * scale)) semanticHint = "line";

      // --- 境界コントラスト gate ---
      // 充填率だけでは**グラデーションの縞を絶対に落とせない**。縞は内部が平坦で
      // 矩形度も高く直線性も角丸フィットも良い(合成シーンの実測: 1本の帯が
      // 平坦な vector-panel 32枚に砕ける)。落とせる可能性があるのは境界だけ。
      //
      // ただし「コントラストが低ければ落とす」という単純な閾値にすると、実画像の
      // 淡いパネル(例 #ECF4FE を白地に置いたもの = 差 19)も巻き添えで落ちる。
      // **辺の本数で見る。** グラデーションの縞は左右が隣の縞(差は量子化バケット幅
      // ≒8 程度)、上下が地(高コントラスト)なので **4辺中2辺しか contrast を持たない**。
      // 本物のパネルは4辺すべてで地から浮いている。
      //
      // 判定を通らなかったものは renderMode を raster に落とすだけで、
      // semanticHint は保つ(意味の推定と描き方の判断は別問題)。エラーにはしない。
      // 非対称損失: 誤ってラスタにしても見た目は保たれ編集性が落ちるだけだが、
      // 誤ってベクター化すると見た目そのものが壊れる。迷ったらラスタへ倒す。
      let renderMode = (semanticHint === "panel" || semanticHint === "line") ? "vector-panel" : "raster";
      if (renderMode === "vector-panel") {
        const inside = [c.r, c.g, c.b];
        // 外側 3px を7点サンプル。角丸のコーナーと1pxの枠線を避けるため辺の 15%〜85% を使う。
        const sideContrast = (pts) => {
          let sum = 0, n = 0, mid = 0;
          for (let i = 0; i < pts.length; i++) {
            const x = pts[i][0], y = pts[i][1];
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            const o = (y * W + x) * 4;
            sum += Math.max(
              Math.abs(data[o] - inside[0]),
              Math.abs(data[o + 1] - inside[1]),
              Math.abs(data[o + 2] - inside[2])
            );
            n++;
          }
          // 半分以上が画面外なら「測れない辺」として扱う(端に接するパネルを不利にしない)
          return n >= 4 ? sum / n : null;
        };
        const top = [], bottom = [], left = [], right = [];
        for (let t = 0; t < 7; t++) {
          const f = 0.15 + (t * 0.7) / 6;
          const fx = Math.round(c.minX + (c.maxX - c.minX) * f);
          const fy = Math.round(c.minY + (c.maxY - c.minY) * f);
          top.push([fx, c.minY - BOUNDARY_OFFSET_PX]);
          bottom.push([fx, c.maxY + BOUNDARY_OFFSET_PX]);
          left.push([c.minX - BOUNDARY_OFFSET_PX, fy]);
          right.push([c.maxX + BOUNDARY_OFFSET_PX, fy]);
        }
        let measurable = 0, contrasting = 0;
        for (const pts of [top, bottom, left, right]) {
          const d = sideContrast(pts);
          if (d === null) continue;
          measurable++;
          if (d >= boundaryContrastMin) contrasting++;
        }
        // 測れる辺が3未満なら、測れた辺すべてに contrast を要求する。
        // 4辺とも測れない(画面全体を覆う成分 = 背景)場合は素通しする。
        if (contrasting < Math.min(boundarySidesRequired, measurable)) renderMode = "raster";
      }

      let cornerRadius = 0;
      if (semanticHint === "panel") {
        // 四隅からそれぞれ 3 方向（角の行・角の列・対角）に走査し、成分に入るまでの距離から
        // 半径を出して、12 本の推定の中央値を採る。
        //
        // 中心 (r, r) の丸角では、角から j 離れた行で図形が始まる横位置 u が
        //   (r-u)² + (r-j)² = r²  →  **r = u + j + √(2uj)**
        // を満たす。角の行に沿う走査は j=0 なので **r = u**（円弧の始まりがそのまま半径）、
        // 対角は u=j なので r = (2+√2)u ≈ 3.414u になる。同じ式の両端。
        // 係数を √2 に「簡略化」しないこと（過去に取り違えて真の半径の 41% しか
        // 報告できていなかった実績あり）。
        //
        // **対角 1 本だけを見ていた頃の相対誤差は 10〜17%**（合成シーンの実測: 半径 6/8/10 が
        // すべて 1px 外れる）。原因は増幅で、整数格子の ±1px が半径では ±3.4px になる。
        // 行・列の走査は増幅が無いぶん精度が高い代わりに、**角の 1 行/1 列を量子化が別成分に
        // 落とすと j が 0 でなくなり、その 1 本だけ大きく外れる**。12 本の中央値を採るのは
        // その外れ値を捨てるため（1 本ずつの値を信じない）。
        const probeD = (cx, cy, dx, dy) => {
          const lim = Math.min(w, h) / 2;
          for (let d = 0; d < lim; d++) {
            const x = cx + dx * d, y = cy + dy * d;
            if (x < 0 || y < 0 || x >= W || y >= H) return -1;
            if (label[y * W + x] === c.id) return d;
          }
          return -1;
        };
        const rOf = (u, j) => u + j + Math.sqrt(2 * u * j);
        const ests = [];
        for (const corner of [
          [c.minX, c.minY, 1, 1],
          [c.maxX, c.minY, -1, 1],
          [c.minX, c.maxY, 1, -1],
          [c.maxX, c.maxY, -1, -1],
        ]) {
          const cx = corner[0], cy = corner[1], dx = corner[2], dy = corner[3];
          const row = probeD(cx, cy, dx, 0);
          const col = probeD(cx, cy, 0, dy);
          const diag = probeD(cx, cy, dx, dy);
          // d=0（角の画素が既に成分の中）は「半径0のサンプル」ではなく「丸くない角」の意味。
          // 上だけ丸い等の非対称な角Rでは直角側の0が中央値を押し下げるので、中央値の前に除外する
          //
          // 半格子補正が行/列と対角で違うのは、円弧の交わり方が違うから。
          // **角の行では円弧が辺に接している**ので、x = r の 1 つ手前の画素も面積の大半が
          // 図形側に入り、量子化バケットとしては「中」になる。実測（rx = 4/6/8/10/12/16/20 の
          // 矩形、2026-08-26）でも最初の画素は常に r-1 だった。だから +1 を戻す。
          // 対角は円弧を横切るので普通の半格子補正 -0.5 でよい（同じ実測で誤差 -1.2〜-0.05）。
          if (row > 0) ests.push(rOf(row + 1, 0));
          if (col > 0) ests.push(rOf(col + 1, 0));
          if (diag > 0) ests.push(rOf(diag - 0.5, diag - 0.5));
        }
        if (ests.length > 0) {
          ests.sort((a, b) => a - b);
          const mid = ests.length >> 1;
          const median = ests.length % 2 === 1 ? ests[mid] : (ests[mid - 1] + ests[mid]) / 2;
          cornerRadius = Math.round(Math.min(24, median * inv));
          if (cornerRadius < 2) cornerRadius = 0;
        }
      }

      return { semanticHint, renderMode, cornerRadius };
    }

    // --- 縞ファミリの統合 ---
    // 境界コントラスト gate はグラデーションを「ベクター化しない」ようにはしたが、
    // 帯が細かいラスタに砕けたままである点は直さない（実測: 1本の帯が 38.7 枚の
    // ラスタ領域として残り、重複描画は 0.137 → 0.208 に増えた）。
    // 39枚の画像アセットは独立した意味を持たず、動かす単位としても間違っている。
    //
    // **無制限の色マージは禁止。** single-linkage で色をつないでいくと、隣接する
    // カード群まで芋づるで飲み込む。実画像には隣り合う4枚のセル（隙間 0〜1px・同じ帯）
    // があり、それらは正当な個別パネルなので、統合してはならない。
    // 守っているのは色の刻み幅: グラデーションの隣接縞は実測で中央値 6・最大 16 なのに対し、
    // 上記のセルは隣接同士で 63〜97 離れている。
    // 隙間の許容。実測: グラデーション帯の隣接成分の隙間は 1〜13px（-4 の重なりも出る）。
    // これは minArea(既定576px²)未満で捨てられた細い縞の跡で、帯の高さが100pxなら
    // 幅 5.8px 未満の縞が消えるため必然的に空く。
    // **ただし隙間を広く許すだけでは、同色のカードが等間隔に3枚並んだ場合に
    // 丸ごと飲み込む**（計画が禁じている single-linkage chaining）。
    // そこで隙間の**実画素**を見る（下の gapContinuesRamp）。
    // 24。掃引では 24〜80 で結果が一切変わらなかった（＝拘束条件になっていない）。
    // 実際に連鎖を切っていたのは色差のほうだった。上限は暴走防止として残す。
    const STRIPE_GAP_MAX_PX = opts?.stripeGapMax ?? 24;
    const STRIPE_OVERLAP_MAX_PX = 8;      // 量子化の境目で成分同士がわずかに重なることがある
    const STRIPE_GAP_RAMP_TOL = 12;       // 隙間の色が両隣の色の「間」に収まっているかの許容
    const STRIPE_BAND_TOL_PX = 4;         // 同じ帯とみなす直交方向の位置/太さのズレ
    // 隣接する縞の色差の上限。**絶対値で固定するのは誤り**だった。
    // 隙間を挟んだ相手との色差は当然その分だけ大きくなる（実測: 隙間 15/16/24/27px の
    // ところで色差 17/18/24/24 となり、絶対上限 16 で連鎖が切れていた）。
    // グラデーションが持つのは単位距離あたりの変化率なので、隙間の幅に比例させる。
    // 隙間の実画素は gapContinuesRamp が別途1件ずつ検証しているので、ここを距離で
    // 緩めてもカードの余白を橋渡しすることにはならない。
    const STRIPE_COLOR_STEP_MAX = 16;
    // 0.4/px。掃引の実測: 0(絶対上限のみ) → 6.00 ／ 0.2 → 3.83 ／ 0.4 → 3.33 で頭打ち。
    // 実測の必要量: 隙間 27px で色差 24 を通す必要があり (24-16)/27 = 0.30。余裕を見て 0.4。
    const STRIPE_COLOR_RATE_PER_PX = opts?.stripeColorRate ?? 0.4;
    // 2枚では「並び」と言えない。テストから極端な値を渡して統合だけを切り、
    // 境界コントラスト gate 単体の挙動を検証できるようにしてある（MCP ツールの引数としては未公開）。
    const STRIPE_MIN_RUN = opts?.stripeMinRun ?? 3;
    // union のうち「実際には成分が無く、隙間の画素判定だけで橋渡しした」割合の上限。
    // 充填率で run 方向の隙間を測るのは誤り（隙間は gapContinuesRamp が1件ずつ
    // 検証済みで、そこを二重に罰すると統合が一切成立しなくなる。実測でそうなった）。
    // ここで見たいのは「推測で埋めた部分が多すぎないか」だけ。
    // 0.45。掃引の実測（6シーン平均のグラデーション残存ラスタ数）:
    //   0.25/0.30/0.35 → 4.67 ／ 0.45 → 3.33。0.45 を超えても変わらない。
    //   実画像の recall・leak・要素数はこの範囲で**一切動かない**。
    const STRIPE_BRIDGED_FRACTION_MAX = opts?.stripeBridgedMax ?? 0.45;
    // 帯の太さ方向の穴を防ぐ。全メンバーが union の太さをほぼ占めていること。
    const STRIPE_MEMBER_THICKNESS_MIN = 0.8;
    const STRIPE_MEMBER_MAX_SHARE = 0.5;  // 1枚が union の半分超なら「大きな面＋薄片」であって縞ではない

    const colorStep = (a, b) =>
      Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    const areaOfRect = (r) => Math.max(0, r[2]) * Math.max(0, r[3]);

    /**
     * 隙間の画素が「両隣の色の間」に収まっているか。
     *
     * グラデーションの隙間は捨てられた縞の跡なので、そこには両隣の中間色が写っている。
     * カードの余白には**地の色**が写っており、両隣の色の範囲から外れる。
     * これが「縞の連なり」と「等間隔に並んだカード」を分ける唯一の確かな信号。
     *
     * 例: #F4E3FF と #FFEEDD のカードが白の余白を挟む場合、G チャンネルは
     * 両隣が 227〜238 なのに隙間は 255 で範囲外 → 連鎖を切る。
     * グラデーションでは定義上どのチャンネルも両隣の間に入る。
     *
     * 座標は元解像度で来るので scale を掛けて作業解像度へ戻す。
     */
    const gapContinuesRamp = (axis, prevRect, curRect, prevColor, curColor) => {
      const lo0 = (prevRect[axis] + prevRect[axis + 2]) * scale;
      const hi0 = curRect[axis] * scale;
      const other = 1 - axis;
      const oMid = (Math.max(prevRect[other], curRect[other]) +
        Math.min(prevRect[other] + prevRect[other + 2], curRect[other] + curRect[other + 2])) / 2 * scale;
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let t = 0; t < 5; t++) {
        const f = 0.2 + t * 0.15;
        const a = Math.round(lo0 + (hi0 - lo0) * f);
        const b = Math.round(oMid + ((t - 2) * 3));
        const x = axis === 0 ? a : b;
        const y = axis === 0 ? b : a;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const o = (y * W + x) * 4;
        sr += data[o]; sg += data[o + 1]; sb += data[o + 2]; n++;
      }
      if (n === 0) return false;
      const mid = [sr / n, sg / n, sb / n];
      for (let ch = 0; ch < 3; ch++) {
        const lo = Math.min(prevColor[ch], curColor[ch]) - STRIPE_GAP_RAMP_TOL;
        const hi = Math.max(prevColor[ch], curColor[ch]) + STRIPE_GAP_RAMP_TOL;
        if (mid[ch] < lo || mid[ch] > hi) return false;
      }
      return true;
    };

    const removedIdx = new Set();
    const mergedRegions = [];

    const tryMergeRun = (run, axis) => {
      if (run.length < STRIPE_MIN_RUN) return;
      const size = axis + 2, otherSize = 3 - axis;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, sumArea = 0;
      let spanCovered = 0, wr = 0, wg = 0, wb = 0;
      for (const i of run) {
        const r = regions[i].rect;
        x0 = Math.min(x0, r[0]); y0 = Math.min(y0, r[1]);
        x1 = Math.max(x1, r[0] + r[2]); y1 = Math.max(y1, r[1] + r[3]);
        const a = areaOfRect(r);
        sumArea += a;
        spanCovered += r[size];
        const c = parseHex(regions[i].fill);
        wr += c[0] * a; wg += c[1] * a; wb += c[2] * a;
      }
      const union = [x0, y0, x1 - x0, y1 - y0];
      const ua = areaOfRect(union);
      if (ua <= 0 || sumArea <= 0) return;
      // 推測で埋めた割合（重なりがあると spanCovered > union になるので下限0で切る）
      const bridged = Math.max(0, (union[size] - spanCovered) / Math.max(1, union[size]));
      if (bridged > STRIPE_BRIDGED_FRACTION_MAX) return;
      let maxShare = 0;
      for (const i of run) {
        const r = regions[i].rect;
        maxShare = Math.max(maxShare, areaOfRect(r) / ua);
        // 太さ方向に痩せたメンバーが混じるなら、それは帯ではなく別物の集まり
        if (r[otherSize] < union[otherSize] * STRIPE_MEMBER_THICKNESS_MIN) return;
      }
      if (maxShare > STRIPE_MEMBER_MAX_SHARE) return;
      for (const i of run) removedIdx.add(i);
      mergedRegions.push({
        renderMode: "raster",
        semanticHint: "image",
        rect: union,
        cornerRadius: 0,
        fill: hex(wr / sumArea, wg / sumArea, wb / sumArea),
      });
    };

    // axis 0: 横に並ぶ縞（縦グラデーション帯は縦に並ぶので axis 1 で拾う）
    for (const axis of [0, 1]) {
      const pos = axis, size = axis + 2, other = 1 - axis, otherSize = 3 - axis;
      const groups = new Map();
      for (let i = 0; i < regions.length; i++) {
        if (removedIdx.has(i)) continue;
        const r = regions[i].rect;
        const k =
          Math.round(r[other] / STRIPE_BAND_TOL_PX) + ":" + Math.round(r[otherSize] / STRIPE_BAND_TOL_PX);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(i);
      }
      for (const idxs of groups.values()) {
        if (idxs.length < STRIPE_MIN_RUN) continue;
        idxs.sort((a, b) => regions[a].rect[pos] - regions[b].rect[pos]);
        let run = [idxs[0]];
        for (let i = 1; i < idxs.length; i++) {
          const prev = regions[run[run.length - 1]].rect;
          const cur = regions[idxs[i]].rect;
          const gap = cur[pos] - (prev[pos] + prev[size]);
          const pc = parseHex(regions[run[run.length - 1]].fill);
          const cc = parseHex(regions[idxs[i]].fill);
          const step = colorStep(pc, cc);
          const spanOk = gap >= -STRIPE_OVERLAP_MAX_PX && gap <= STRIPE_GAP_MAX_PX;
          // 2px を超える隙間は「捨てられた縞の跡」かもしれないし「カードの余白」かもしれない。
          // 実画素で判定する。2px 以下は丸め誤差の範囲なので調べない。
          const bridgeOk = gap <= 2 ? true : gapContinuesRamp(pos, prev, cur, pc, cc);
          const stepAllowed = STRIPE_COLOR_STEP_MAX + Math.max(0, gap) * STRIPE_COLOR_RATE_PER_PX;
          if (spanOk && step <= stepAllowed && bridgeOk) {
            run.push(idxs[i]);
          } else {
            tryMergeRun(run, pos);
            run = [idxs[i]];
          }
        }
        tryMergeRun(run, pos);
      }
    }

    if (removedIdx.size > 0) {
      const kept = regions.filter((_, i) => !removedIdx.has(i));
      regions.length = 0;
      for (const r of kept) regions.push(r);
      for (const r of mergedRegions) regions.push(r);
    }

    // 文字は minArea 未満に量子化で散った成分の集まりになる。行として束ねて拾い直す
    const glyphs = [];
    const strips = [];
    const GLYPH_MAX_H = 40 * scale;
    // 切り分け用（計測ハーネスからのみ。MCP ツールの引数としては未公開）
    const DEFER_STRIPS = opts?.deferStrips ?? true;
    const TEXT_COVERED_HOLES = opts?.textCoveredHoles ?? true;
    for (const c of comps) {
      const w = c.maxX - c.minX + 1;
      const h = c.maxY - c.minY + 1;
      if (w * h * inv * inv >= minArea) continue;
      if (h < 4 || h > GLYPH_MAX_H) continue;         // 行として無理のない高さだけ
      if (w > 60 * scale) continue;                    // 1文字にしては横長すぎる
      // 幅 1〜2px で背の高い断片は、行の先頭に入れない。パネルの縁のアンチエイリアスが
      // ちょうどこの形（実測 2026-08-26: dark-mode のボタン左右縁が 1x31 と 1x33）で、
      // x 昇順の処理ではボタン左縁が**行の最初の断片**になる。行高 31 から始まった行は
      // 縦の許容 18px・横の許容 62px でラベルも隣の要素も呑み込む。
      // 本物の文字の縦棒（"l" "i" の 1px 断片）もここに入るが、それらは行が確定した後に
      // 行の縦範囲に収まるものだけ後付けする（下の strips ループ）。
      // 16px: 1x 表示でストローク幅 1px の書体の cap-height は 14px 程度まで。それより高い
      // 1px 断片は太いストロークが量子化で 1px 列に割れたもので、後付けと ink 伸長で戻る。
      if (DEFER_STRIPS && w <= 2 && h >= 16) { strips.push({ ...c, w, h }); continue; }
      glyphs.push({ ...c, w, h });
    }
    // 読み順(x昇順)で束ねる。y優先でソートすると同じ単語内の断片が処理順で入れ違い、
    // 1回のみの前方マージでは正しい行に戻れず分裂したまま残る（実測: "Dashboard"がminY優先だと
    // 7断片→2行にしか収束しなかったが、x優先では1行に収束する）
    glyphs.sort((a, b) => a.minX - b.minX || a.minY - b.minY);
    const lines = [];
    for (const g of glyphs) {
      const line = lines.find((l) => {
        const lh = l.maxY - l.minY + 1;
        // 量子化された文字は丸い/曲線の文字(o,bなど)がまるごと背景の連結成分に呑まれて
        // 断片が1つも残らないことがある。断片自身のgより、既に確定した行の高さlhの方が
        // フォントの実際のcap-heightを表す。しきい値はどちらか大きい方を使う
        const H = Math.max(g.h, lh);
        return (
          // 束ねた結果が「1文字として許した最大の高さ」を超えるなら、それは別の行を
          // 巻き込んでいる。この上限が無いと行高が正帰還で膨らむ: 一度背の高い断片を
          // 取り込んだ行は H が大きくなり、縦の許容(H*0.6)と横の許容(H*2)が広がって
          // さらに遠くの断片を取り込む。実測(2026-08-26): dark-mode で 1222x393、
          // photo-rich で 1440x513 の「テキスト行」ができ、ボタンのラベルはその中に
          // 呑まれて独立要素として出てこなかった（取りこぼしパネル 13 件中 9 件が内包要素 0）。
          Math.max(l.maxY, g.maxY) - Math.min(l.minY, g.minY) + 1 <= GLYPH_MAX_H &&
          Math.abs((l.minY + l.maxY) / 2 - (g.minY + g.maxY) / 2) <= Math.max(4, H * 0.6) &&
          // 係数はブリーフの1.2ではなく2.0固定。理由は「もっと厳密な値が未検証」ではなく、
          // 意図してこの側に倒している: 量子化器は丸い/曲線の文字(o,bなど)を背景の連結成分に
          // 丸ごと呑み込むことがあり、単語の途中に地の色そのままの穴が開く（実測:
          // "Dashboard"でo,bが断片を1つも残さず、隣接断片間のgapが23px=cap-height13pxの1.77倍
          // まで開いた）。この「呑まれた文字の穴」と「本物の単語間スペース」はどちらも同じ
          // 背景色の隙間でしかなく、幾何情報だけでは区別できない。区別できない以上、単語が
          // 分裂する側と、隣接するラベル+値のような別々の語が1つのtext領域に融合する側の
          // どちらかでしか失敗できない。本検出結果は最終的にラスタ切り出しに使われ、画素は
          // どちらの側でも元画像から取るため見た目は同じで、違うのはアニメーションの分割
          // 粒度だけ。単語が真っ二つに割れて別々に動く方が「壊れて見える」ため、
          // 「隣接語を融合させる」側に倒すことを選んだ（実測の下限は1.75〜1.80、2.0はそこに
          // 余裕を足した値）。1.2に「直す」と実測フィクスチャの1語すら束ねられずFAILに戻る。
          g.minX - l.maxX <= Math.max(8, H * 2.0) &&
          // x昇順ソート下では、既存行のminXは処理済み(=より小さいminXの)断片の最小値でしかなく、
          // 新しく来る断片のminXが必ずそれ以上になるためこの条件は恒常的にtrue（無害な冗長条件）。
          // ソート順を変えるとここが再び効いてくる — 過去のminY優先ソートでは実際にこの条件が
          // 誤マージを防いでいた（詳しくは glyphs.sort 直前のコメント参照）
          g.minX >= l.minX - H
        );
      });
      if (line) {
        line.minX = Math.min(line.minX, g.minX);
        line.minY = Math.min(line.minY, g.minY);
        line.maxX = Math.max(line.maxX, g.maxX);
        line.maxY = Math.max(line.maxY, g.maxY);
        line.r += g.r; line.g += g.g; line.b += g.b; line.n++;
        line.ids.push(g.id);
      } else {
        lines.push({ minX: g.minX, minY: g.minY, maxX: g.maxX, maxY: g.maxY,
                     r: g.r, g: g.g, b: g.b, n: 1, ids: [g.id] });
      }
    }
    // 保留した縦長断片を、縦範囲が行に収まるものだけ後付けする。行の高さは変えない
    // （上下 25% は行の縦範囲の推定誤差ぶん）。収まらない断片はパネルの縁なので捨てる。
    for (const g of strips) {
      const line = lines.find((l) => {
        const lh = l.maxY - l.minY + 1, tol = lh * 0.25;
        return g.minY >= l.minY - tol && g.maxY <= l.maxY + tol &&
          g.minX <= l.maxX + Math.max(8, lh * 2.0) && g.maxX >= l.minX - Math.max(8, lh * 2.0);
      });
      if (!line) continue;
      line.minX = Math.min(line.minX, g.minX);
      line.maxX = Math.max(line.maxX, g.maxX);
      line.r += g.r; line.g += g.g; line.b += g.b; line.n++;
      line.ids.push(g.id);
    }
    // --- テキストの alpha matte（色直線への射影） ---
    //
    // 目的は「文字を背景から切り離して独立に動かせるようにする」こと。矩形で切り出すと
    // 背景が焼き付き、**静止していれば完全に一致するのに 10px 動かした瞬間に露出する**。
    // 静的な再構成誤差では原理的に検出できない失敗なので、信頼度で守るしかない。
    //
    // モデル: 前景色 F と背景色 B を結ぶ直線に画素 C を射影する。
    //   alpha = clamp( ((C-B)*(F-B)) / |F-B|^2 , 0, 1 )
    // **2値化しない。** アンチエイリアスの縁は中間の alpha として保つ。
    //
    // 信頼度は直交残差 e = |(C-B) - alpha(F-B)| から出す。文字が単色なら残差はほぼ0だが、
    // 写真や模様が「テキスト行」として誤検出された場合は残差が大きくなる。
    // **semanticHint を信用しない**のはこのため（手続き的ノイズが text に紛れ込む実例がある）。
    // 残差が大きければ matteEligible=false にして、普通の矩形ラスタのまま fade だけさせる。
    const MATTE_MIN_CONTRAST = 24;        // |F-B| がこれ未満だと射影が数値的に無意味
    // 適格性は fit と 2峰性の**両方**で判定する。単一の合成スコアにすると、
    // 片方が高いだけの領域が通ってしまう（実測で両方の分布を取って決めた）。
    //
    //   fitMin midMax | テキスト残存 | 写真の誤通過   （2026-08-21・合成6枚＋実画像6枚）
    //    0.70  0.45   |  95%         |  16%
    //    0.78  0.35   |  89%         |  10%   ← 採用
    //    0.82  0.35   |  73%         |  10%
    //    0.90  0.26   |  31%         |   7%
    //
    // **写真の誤通過を 0 にはできない。** 7% 前後で下げ止まり、そこから先はテキストを
    // 捨てるだけで写真は減らない。二色モデルでは原理的に分離できない領域が存在する
    // （彩度の低い2階調の写真は、色空間で本当に文字と同じ形をしている）。
    // 通り抜けた分は matteConfidence を通じて Task 18 の「動かし方の制限」で封じ込める。
    //
    // 誤りの代償は非対称: 写真を誤って matte にすると大量の画素が透明になり見た目が壊れるが、
    // テキストを matte にし損ねても矩形ラスタ + fade に落ちるだけで見た目は保たれる。
    const MATTE_FIT_MIN = opts?.matteFitMin ?? 0.78;
    const MATTE_CORE_TOP_FRACTION = 0.25; // F 推定に使う「B から最も遠い」画素の割合
    // alpha が 0.2〜0.8 に入る画素の割合。この値で 2峰性スコアが 0 になる。
    // 既定は下の掃引の実測から決める（暫定 0.35）。
    const MATTE_MID_ALPHA_MAX = opts?.matteMidAlphaMax ?? 0.35;
    // 2峰性スコアが 0 になる中間 alpha 割合。分布の実測は
    // テキスト中央 0.246 / p90 0.322、写真中央 0.319 / p75 0.447。
    const MATTE_BIMODAL_ZERO = 0.60;
    // --- インクの「太さ」で写真の平坦部を落とす ---
    // fit も中間 alpha の割合も **alpha のヒストグラムしか見ていない**。水面のような
    // 2階調で平坦な写真は、そのヒストグラムが文字とほとんど同じ形をしていて分離できない
    // （上の表の「写真の誤通過 10%」の下げ止まりがこれ）。違うのは**空間配置**のほう:
    // 文字は細いストロークの集まりで、写真の塊は太い。
    // alpha>0.5 のインクマスクを半径 r で erosion して残る割合 Q を測る。
    // r は行高から出す: 欧文の縦線幅は 0.06〜0.12em、行の箱はアセンダ+ディセンダで
    // 約 1.25em なので、ストロークは行高の 0.1 倍前後にしかならない。
    // r = 行高×0.25 の正方形（一辺 ≥ 行高×0.5）はどんなストロークにも入らないので、
    // 理想的な文字なら Q = 0 になる。
    const MATTE_ERODE_RATIO = 0.25;
    // 0.2 は「文字なら 0」という幾何の予測に対する余裕。実測（2026-08-26）:
    //   通常の文字 0.000 ／ 極太スラブの見出し "Rust"(37px) 0.264〜0.297 ／
    //   行と同じ形の平坦な2階調の塊 0.352〜0.400（幅 w・高さ h の塊は理論上 0.5(1-h/w) 前後）
    // **極太の見出しは巻き添えで落ちる**（実画像 16 枚で 853 行中 2 行）。それを救うには
    // 閾値を 0.3 まで上げることになり、塊の 0.35 との間隔がほぼ無くなる。
    // 誤りの代償は非対称 — matte を取り損ねた文字は矩形ラスタ + fade で見た目は保たれるが、
    // 写真を matte にすると大量の画素が透明になって見た目が壊れる。だから低い側に置く。
    const MATTE_INK_THICK_MAX = opts?.matteInkThickMax ?? 0.2;

    const SRGB_TO_LIN = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const c = i / 255;
      SRGB_TO_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    const medianOf = (arr) => {
      if (!arr.length) return 0;
      const a = Float64Array.from(arr).sort();
      const m = a.length >> 1;
      return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
    };

    /**
     * インクマスク(alpha>0.5)を一辺 2k+1 の正方形で erosion して残る割合。
     * 距離変換ではなく分離可能な min フィルタ（横→縦）で掛ける。同じ答えが O(n·k) で出る。
     * 箱の外は背景として扱う。外へ続く塊は縁で削られるが、内部が太ければ残る。
     */
    const thickFraction = (ink, bw, bh, k) => {
      let total = 0;
      for (let i = 0; i < ink.length; i++) total += ink[i];
      if (total === 0) return 0;
      if (k < 1) return 1;   // 1px 未満の erosion は「削っていない」= 判定に使えない
      const hmin = new Uint8Array(bw * bh);
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          let on = 1;
          for (let dx = -k; dx <= k; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= bw || !ink[y * bw + xx]) { on = 0; break; }
          }
          hmin[y * bw + x] = on;
        }
      }
      let kept = 0;
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          if (!hmin[y * bw + x]) continue;
          let on = 1;
          for (let dy = -k; dy <= k; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= bh || !hmin[yy * bw + x]) { on = 0; break; }
          }
          if (on) kept++;
        }
      }
      return kept / total;
    };

    const estimateMatte = (line) => {
      // コア画素: 行を構成したグリフ成分そのもの。既に持っている情報を捨てない。
      const idSet = new Set(line.ids);
      const core = [];
      for (let y = line.minY; y <= line.maxY; y++) {
        for (let x = line.minX; x <= line.maxX; x++) {
          const q = y * W + x;
          if (idSet.has(label[q])) core.push(q);
        }
      }
      if (core.length < 24) return null;

      // 背景 B。まず外接する vector-panel の塗り、無ければ bbox 外周リングの中央値。
      // 平均ではなく中央値なのは、リングに別の要素が掛かっても引きずられないため。
      let bg = null;
      {
        const ox = Math.round(line.minX * inv), oy = Math.round(line.minY * inv);
        const ow = Math.round((line.maxX - line.minX + 1) * inv);
        const oh = Math.round((line.maxY - line.minY + 1) * inv);
        let bestArea = Infinity;
        for (const r of regions) {
          if (r.renderMode !== "vector-panel" || !r.fill) continue;
          const rx = r.rect[0], ry = r.rect[1], rw = r.rect[2], rh = r.rect[3];
          if (rx <= ox && ry <= oy && rx + rw >= ox + ow && ry + rh >= oy + oh && rw * rh < bestArea) {
            bestArea = rw * rh;
            bg = parseHex(r.fill);
          }
        }
      }
      if (!bg) {
        const rr = [], rg = [], rb = [];
        for (let d = 1; d <= 3; d++) {
          for (let x = line.minX - d; x <= line.maxX + d; x++) {
            for (const y of [line.minY - d, line.maxY + d]) {
              if (x < 0 || y < 0 || x >= W || y >= H) continue;
              const o = (y * W + x) * 4; rr.push(data[o]); rg.push(data[o + 1]); rb.push(data[o + 2]);
            }
          }
          for (let y = line.minY - d; y <= line.maxY + d; y++) {
            for (const x of [line.minX - d, line.maxX + d]) {
              if (x < 0 || y < 0 || x >= W || y >= H) continue;
              const o = (y * W + x) * 4; rr.push(data[o]); rg.push(data[o + 1]); rb.push(data[o + 2]);
            }
          }
        }
        if (rr.length < 12) return null;
        bg = [medianOf(rr), medianOf(rg), medianOf(rb)];
      }

      // 前景 F。**成分の平均色ではない。** 平均は縁の中間色に引かれて B 寄りになる。
      // B から最も離れたコア画素の上位 25% の中央値を使う。
      const dist = core.map((q) => {
        const o = q * 4;
        const dr = data[o] - bg[0], dg = data[o + 1] - bg[1], db = data[o + 2] - bg[2];
        return dr * dr + dg * dg + db * db;
      });
      const order = core.map((_, i) => i).sort((a, b) => dist[b] - dist[a]);
      const take = Math.max(8, Math.floor(order.length * MATTE_CORE_TOP_FRACTION));
      const fr = [], fgv = [], fb = [];
      for (let i = 0; i < take; i++) {
        const o = core[order[i]] * 4;
        fr.push(data[o]); fgv.push(data[o + 1]); fb.push(data[o + 2]);
      }
      const fgc = [medianOf(fr), medianOf(fgv), medianOf(fb)];

      // sRGB と linear の両方を試し、残差の小さいほうを採る（どちらが正しいかは
      // 画像の生成経路に依存するので、決め打ちせず測って選ぶ）。
      const evalSpace = (toLin) => {
        const conv = (v) => (toLin ? SRGB_TO_LIN[v] : v / 255);
        const B = [conv(Math.round(bg[0])), conv(Math.round(bg[1])), conv(Math.round(bg[2]))];
        const F = [conv(Math.round(fgc[0])), conv(Math.round(fgc[1])), conv(Math.round(fgc[2]))];
        const d = [F[0] - B[0], F[1] - B[1], F[2] - B[2]];
        const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
        if (len2 < 1e-9) return null;
        // **残差はコア画素ではなく bbox 全体で測る。**
        // コアは定義上「同じ量子化バケットの連結成分」なので、写真だろうと一様に見える。
        // 実測(2026-08-21): コアだけで測るとノイズ領域の信頼度が最大 0.849 まで出て、
        // 本物のテキスト(0.999)と分離できなかった。
        // matte モデルが主張しているのは「切り出す矩形の**全画素**が F と B の混合である」
        // ことなので、その主張をそのまま bbox 上で検証する。文字なら地の画素は alpha=0 として
        // 直線に乗るが、写真は乗らない。
        const bw = line.maxX - line.minX + 1, bh = line.maxY - line.minY + 1;
        const ink = new Uint8Array(bw * bh);
        let sum = 0, n = 0, mid = 0;
        for (let y = line.minY; y <= line.maxY; y++) {
          for (let x = line.minX; x <= line.maxX; x++) {
            const o = (y * W + x) * 4;
            const c0 = conv(data[o]) - B[0], c1 = conv(data[o + 1]) - B[1], c2 = conv(data[o + 2]) - B[2];
            let a = (c0 * d[0] + c1 * d[1] + c2 * d[2]) / len2;
            a = a < 0 ? 0 : a > 1 ? 1 : a;
            const e0 = c0 - a * d[0], e1 = c1 - a * d[1], e2 = c2 - a * d[2];
            sum += Math.sqrt(e0 * e0 + e1 * e1 + e2 * e2);
            if (a > 0.2 && a < 0.8) mid++;
            if (a > 0.5) ink[(y - line.minY) * bw + (x - line.minX)] = 1;
            n++;
          }
        }
        if (n === 0) return null;
        return {
          residual: sum / n, len: Math.sqrt(len2), midFraction: mid / n,
          thick: thickFraction(ink, bw, bh, Math.round(bh * MATTE_ERODE_RATIO)),
        };
      };
      const srgb = evalSpace(false), lin = evalSpace(true);
      if (!srgb && !lin) return null;
      const useLin = !!lin && (!srgb || lin.residual / lin.len < srgb.residual / srgb.len);
      const chosen = useLin ? lin : srgb;

      const contrast = Math.max(
        Math.abs(fgc[0] - bg[0]), Math.abs(fgc[1] - bg[1]), Math.abs(fgc[2] - bg[2])
      );
      // 直交残差を色距離で正規化する。0.5 で割っているのは「残差が色距離の半分に達したら
      // 信頼度0」という意味（それだけ外れていれば直線モデルはもう成り立っていない）。
      const fit = Math.max(0, Math.min(1, 1 - chosen.residual / (chosen.len * 0.5)));
      // **残差だけでは原理的に分離できない。** 彩度を落としたノイズは色空間でほぼ1次元で、
      // 色直線モデルに実際によく当てはまる（実測: ノイズ領域で fit 0.844）。
      // 構造で分ける: テキストの alpha は2峰性（ほぼ0かほぼ1で、中間はアンチエイリアスの
      // 細い縁だけ）だが、写真の alpha は全域に散る。
      const bimodal = Math.max(0, Math.min(1, 1 - chosen.midFraction / MATTE_BIMODAL_ZERO));
      const confidence = fit * bimodal;
      return {
        fg: hex(fgc[0], fgc[1], fgc[2]),
        bg: hex(bg[0], bg[1], bg[2]),
        space: useLin ? "linear" : "srgb",
        confidence,
        fit,
        midFraction: chosen.midFraction,
        inkThick: chosen.thick,
        contrast,
        eligible: contrast >= MATTE_MIN_CONTRAST &&
          fit >= MATTE_FIT_MIN && chosen.midFraction <= MATTE_MID_ALPHA_MAX &&
          chosen.thick <= MATTE_INK_THICK_MAX,
      };
    };

    for (const l of lines) {
      const w = (l.maxX - l.minX + 1) * inv;
      const h = (l.maxY - l.minY + 1) * inv;
      if (w < 8 || h < 6) continue;   // ノイズ 1 粒を「文字」と言わない
      const color = hex(l.r / l.n, l.g / l.n, l.b / l.n);
      const rectW = Math.round(w);
      const rectH = Math.round(h);
      // panel/image と同じ理由(designTokens.ts paletteFromColors参照)で面積weightを渡す。
      // テキスト行は面積が小さいことが多いが、件数(=行の本数)ではなく面積で数えることで
      // 「小さい文字がたくさんある画面」でbackgroundを誤って乗っ取らないようにする。
      sampledColors.push({ hex: color, weight: rectW * rectH });
      const m = estimateMatte(l);

      // --- インクの実際の広がりまで矩形を伸ばす ---
      // 行の矩形は「生き残ったグリフ断片の和」でしかない。量子化が丸い文字(o,a,e)や
      // 先頭・末尾の1文字を背景の連結成分ごと飲み込むと、その文字は断片を1つも残さず
      // **矩形の外に出る**。実測(2026-08-21): "Analytics" が x=57 から検出され、
      // 実際の文字は x=44 から始まっていて、切り出すと "nalvtics" になった。
      //
      // 固定量のパディングでは足りない（1文字分は行高の 1.2 倍近くある）し、
      // 増やせば隣を巻き込む。前景色 F が分かっているので、**その色の画素が
      // 実際に在る所まで**伸ばす。無ければ止まる。
      let gx0 = l.minX, gy0 = l.minY, gx1 = l.maxX, gy1 = l.maxY;
      if (m) {
        const F = parseHex(m.fg), B = parseHex(m.bg);
        const D = [F[0] - B[0], F[1] - B[1], F[2] - B[2]];
        const len2 = D[0] * D[0] + D[1] * D[1] + D[2] * D[2];
        if (len2 > 1e-6) {
          // alpha > 0.5 ＝ 背景より前景に近い画素を「インク」とみなす。
          const isInk = (x, y) => {
            const o = (y * W + x) * 4;
            const c0 = data[o] - B[0], c1 = data[o + 1] - B[1], c2 = data[o + 2] - B[2];
            return (c0 * D[0] + c1 * D[1] + c2 * D[2]) / len2 > 0.5;
          };
          const lh0 = l.maxY - l.minY + 1;
          // **走査する帯は、その時点で確定している矩形を使う。**
          // 横方向を「伸ばす前の縦の範囲」で走査すると、生き残った断片がアセンダだけだった行で
          // x-height にしかない文字を見落とす。実測(2026-08-21): "Active" の末尾の e は
          // x=427..428 に alpha 1.0 のインクがあるのに、断片の縦範囲に入らず矩形の外に残り、
          // 切り出すと "Activ" になった（同じ6文字の "Errors" は 35px、"Active" は 32px）。
          // 縦は上下の伸びしろ（アセンダ/ディセンダ）だけなので控えめに。
          const maxGrowY = Math.max(2, Math.round(lh0 * 0.5));
          // **横方向の走査は「縦に伸びうる範囲」まで見る。ただし矩形は広げない。**
          // 断片の縦範囲だけで走査すると、生き残った断片がアセンダだけだった行で
          // x-height にしかない文字を見落とす。実測(2026-08-21): "Active" の末尾の e は
          // x=427..428 に alpha 1.0 のインクがあるのに断片の縦範囲に入らず、
          // 切り出すと "Activ" になった（同じ6文字の "Errors" は 35px、"Active" は 32px）。
          //
          // 逆に「縦を先に伸ばしてから横を走査する」と広げすぎる。実測: 重複描画が
          // 1.76 → 10.85 に爆発した（帯が広がった分だけ横が隣の語まで走り、
          // 同じ単語を覆う矩形が何枚も積み上がる）。**走査だけ広げ、確定は別に持つ。**
          const rowHasInk = (y) => {
            for (let x = gx0; x <= gx1; x++) if (y >= 0 && y < H && isInk(x, y)) return true;
            return false;
          };
          // **縦を先に確定する。** 横の上限は行高に比例させるが、その行高を
          // 「生き残った断片の縦幅」から採ると足りない。断片がアセンダだけの行では
          // 行高が半分ほどに見積もられ、上限がその 1.6 倍でも末尾の1文字に届かない。
          // 実測(2026-08-21): "Active" の末尾の e は x=427..428 に alpha 1.0 の
          // インクがあるのに上限の外に落ち、切り出すと "Activ" になった
          // （同じ6文字の "Errors" は 35px、"Active" は 32px）。
          // **インクの無い行に当たったら止める。** 範囲内の行を飛び飛びに拾うと、空白を
          // 跨いで隣の行のインクまで届く。実測(2026-08-26): gradient-boxes の
          // "linear-gradient()" 行が 16px 上の "light-dark()" 行まで伸び、
          // 行高 32 → 47 になってパネルの外へはみ出した。アセンダ/ディセンダは
          // 本体のインクと縦に連続しているので、連続走査で十分拾える。
          for (let d = 1; d <= maxGrowY && rowHasInk(l.minY - d); d++) gy0 = l.minY - d;
          for (let d = 1; d <= maxGrowY && rowHasInk(l.maxY + d); d++) gy1 = l.maxY + d;
          // 伸ばす上限は確定した行高の 1.6 倍。1文字ぶんを拾うには足りて、隣の語まで
          // 無条件に届くほどではない距離。
          // 上限は行高の 8 倍。以前は 1.6 倍だったが、それは「範囲内のインクを飛び飛びに
          // 拾う」走査で隣の語を巻き込まないための値。今は空白（行高×0.35）で止まるので
          // 上限は安全弁でしかなく、1.6 倍では先頭の複数文字が丸ごと呑まれた行に届かない
          // （実測 2026-08-26: "(discontinued)" が "continued" から検出され、"(dis" が
          // 平坦塗りに消えて反実仮想 risk 0.026）。
          const maxGrow = Math.max(4, Math.round((gy1 - gy0 + 1) * 8));
          // **始点は伸ばす前の端に固定する。** gx1 を足しながら進める書き方にすると
          // 1回の走査が上限を超えて伸び続け、隣の語まで飲み込む。実測: 重複描画が
          // 1.76 → 10.85 に爆発した（同じ単語を覆う矩形が何枚も積み上がる）。
          const colHasInk = (x) => {
            for (let y = gy0; y <= gy1; y++) if (x >= 0 && x < W && isInk(x, y)) return true;
            return false;
          };
          // 横も連続走査。ただし文字間の隙間（数px）は跨ぐ必要があるので、インクの無い列が
          // 続いた長さで止める。許容は行高の 0.35（文字間は cap-height の 1/4 前後、
          // 単語間は 1/2 以上なので、その間）。上限 maxGrow まで飛び飛びに拾う書き方だと
          // 単語間の空白を越えて隣の語を巻き込む。
          const maxGapX = Math.max(2, Math.round((gy1 - gy0 + 1) * 0.35));
          for (let d = 1, gap = 0; d <= maxGrow && gap <= maxGapX; d++) {
            if (colHasInk(l.minX - d)) { gx0 = l.minX - d; gap = 0; } else gap++;
          }
          for (let d = 1, gap = 0; d <= maxGrow && gap <= maxGapX; d++) {
            if (colHasInk(l.maxX + d)) { gx1 = l.maxX + d; gap = 0; } else gap++;
          }
          // アンチエイリアスの縁 1px。isInk は alpha>0.5 なので縁の薄い画素は「インク無し」
          // と判定され、箱がその 1 行/1 列手前で止まる。切り出しは元画素なので広げても害は無く、
          // 狭いと平坦塗りの上に縁が露出する（実測 2026-08-26: 行の下端 1 行が risk に数えられた）。
          gx0 -= 1; gy0 -= 1; gx1 += 1; gy1 += 1;
          gx0 = Math.max(0, gx0); gy0 = Math.max(0, gy0);
          gx1 = Math.min(W - 1, gx1); gy1 = Math.min(H - 1, gy1);
        }
      }
      const gRect = [
        Math.round(gx0 * inv), Math.round(gy0 * inv),
        Math.round((gx1 - gx0 + 1) * inv), Math.round((gy1 - gy0 + 1) * inv),
      ];

      regions.push({
        renderMode: "raster",
        semanticHint: "text",
        rect: gRect,
        fill: color,
        // フォントサイズの推定は**伸ばす前の**高さから出す。伸ばした矩形には
        // アセンダ/ディセンダが入るので、そのまま使うと大きく見積もる。
        fontSizePx: Math.round(h * 1.3),  // 大文字高 ≒ フォントサイズの 0.7〜0.75
        // **matteEligible は semanticHint とは独立。** 手続き的ノイズが「テキスト行」として
        // 誤検出されても、射影残差が大きければここが false になり、matte の対象から外れる。
        matteEligible: !!(m && m.eligible),
        matteConfidence: m ? Math.round(m.confidence * 1000) / 1000 : 0,
        matteFit: m ? Math.round(m.fit * 1000) / 1000 : 0,
        matteMidAlpha: m ? Math.round(m.midFraction * 1000) / 1000 : 1,
        matteInkThick: m ? Math.round(m.inkThick * 1000) / 1000 : 1,
        matte: m && m.eligible ? { fg: m.fg, bg: m.bg, space: m.space } : undefined,
        _wr: [gx0, gy0, gx1, gy1],
      });
    }

    // --- ほぼ同じ場所を指すテキスト行の統合 ---
    //
    // 量子化の断片から行を 2 通りに束ねてしまい、ink 伸長後にほぼ同じ矩形へ収束することがある
    // （実測 2026-09-01: "Password" が 73,229,63x12 と 74,229,62x12 の 2 要素になった。
    //  静止画では完全に重なって見えないが、入場アニメで 2 枚が別々にフェードして二重に見える）。
    // 交差面積が小さい方の 85% 以上なら同じ行とみなし、矩形を union して 1 枚に。
    // matte は面積の大きい方のものを残す（両者はほぼ同じ画素を指しているので差は縁だけ）。
    {
      const texts = regions.filter((r) => r.semanticHint === "text");
      const drop = new Set();
      for (let i = 0; i < texts.length; i++) {
        if (drop.has(texts[i])) continue;
        for (let j = i + 1; j < texts.length; j++) {
          if (drop.has(texts[j])) continue;
          const a = texts[i].rect, b = texts[j].rect;
          const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
          const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
          const inter = ix * iy;
          // IoU で「ほぼ同一」だけを統合する。片側包含（大きな行の中の短い語）まで統合すると、
          // 別の行を呑んで文字カバレッジが落ちる（実測 2026-09-01: holdout の
          // textInkRasterCover 0.9996 → 0.958）。同一矩形の二重検出だけを消す
          const uni = a[2] * a[3] + b[2] * b[3] - inter;
          if (uni <= 0 || inter / uni < 0.8) continue;
          const keep = a[2] * a[3] >= b[2] * b[3] ? texts[i] : texts[j];
          const gone = keep === texts[i] ? texts[j] : texts[i];
          const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]);
          keep.rect = [x0, y0, Math.max(a[0] + a[2], b[0] + b[2]) - x0, Math.max(a[1] + a[3], b[1] + b[3]) - y0];
          if (keep._wr && gone._wr) {
            keep._wr = [Math.min(keep._wr[0], gone._wr[0]), Math.min(keep._wr[1], gone._wr[1]),
              Math.max(keep._wr[2], gone._wr[2]), Math.max(keep._wr[3], gone._wr[3])];
          }
          drop.add(gone);
          if (keep === texts[j]) break;
        }
      }
      if (drop.size) {
        const kept = regions.filter((r) => !drop.has(r));
        regions.length = 0;
        for (const r of kept) regions.push(r);
      }
    }

    // --- 文字で覆われた穴を充填率に算入して再分類 ---
    //
    // ラベル入りのボタンは、文字のぶんだけ充填率が 0.85 を割って "image" に落ちる
    // （実測 2026-08-26: 取りこぼした正解パネル 13 件の充填率は 0.63〜0.84）。
    // ただし穴を無条件に許すと写真の穴も通る（§5-3 で取り下げた案）。
    // ここで許すのは**このパネルの内側に収まるテキスト行が覆う穴だけ**。
    // 覆う要素が上に乗るなら、パネルを平坦に塗ってもその画素は最終合成に露出しない。
    // 閾値は最初の分類と同じ 0.85 を使い、新しい閾値は足さない。
    // 内側に収まる行に限るのは z-order のため: bbox に含まれない行は buildTree で
    // 子にならず、面積次第ではパネルの下に描かれてラベルが消える。
    const textWr = regions.filter((r) => r._wr).map((r) => r._wr);
    for (const reg of regions) {
      const c = reg._comp;
      if (!TEXT_COVERED_HOLES || !c || reg.semanticHint !== "image") continue;
      const w = c.maxX - c.minX + 1, h = c.maxY - c.minY + 1;
      const inside = textWr.filter((t) =>
        t[0] >= c.minX && t[1] >= c.minY && t[2] <= c.maxX && t[3] <= c.maxY);
      if (inside.length === 0) continue;
      let covered = 0;
      for (const t of inside) {
        for (let y = t[1]; y <= t[3]; y++) {
          for (let x = t[0]; x <= t[2]; x++) if (label[y * W + x] !== c.id) covered++;
        }
      }
      // 行同士が重なると二重に数えるので、穴の総数で頭打ちにする
      covered = Math.min(covered, w * h - c.count);
      const fillRatio = (c.count + covered) / (w * h);
      if (fillRatio < 0.85) continue;
      const cls = classifyComp(c, w, h, fillRatio);
      reg.semanticHint = cls.semanticHint;
      reg.renderMode = cls.renderMode;
      reg.cornerRadius = cls.cornerRadius;
      // このパネルが平坦塗りで成立するのは、内側のテキスト行が上に乗る前提。
      // buildTree はこの印を見て、要素数上限で行を落とすときも行をパネルと一緒に残す
      // （行だけ落ちると、ラベルが消えたボタンが出来上がる。実測: dark-mode の
      // ボタン内ラベルが上限 120 で落ち、インク被覆 1.00 → 0.75）。
      if (cls.renderMode === "vector-panel") reg.coveredByText = true;
    }
    for (const r of regions) { delete r._comp; delete r._wr; }

    return { width: W0, height: H0, regions, sampledColors };
  },

  // 反実仮想判定: 要素を実際に z 順で合成し、ベクター塗りの各要素について
  // 「最終合成で自分が最前面に露出している画素」だけの誤差を測る。
  // ボタンのラベルは上のテキスト要素が覆うので誤差に寄与せず、写真やイラストの
  // 上に置かれた平坦塗りは覆われないぶんだけ外れる。穴の意味を推測する必要が無い。
  //
  // 検出器の中では正しく測れない（z 順・要素数上限・角丸・matte が確定していない。
  // 2026-08-22 に検出器側で試して recall 7→4 に落ちた）。ここは buildTree の後、
  // つまり最終的な要素とその順序が決まった後に呼ぶ。合成の規則は test/detectorMetrics.mjs の
  // reconstructionStats と同じ（base 全面 → 塗り矩形は roundRect、ラスタは同位置に切り出し）。
  //
  // opts.ordered: z 順（背面→前面）に並んだ要素。opts.delta: 「外れた」とみなす
  // チャンネル最大差の下限（8 = 5bit 量子化のバケット幅。それ未満は量子化の揺れ）。
  async assessVectorFills(b64, opts) {
    const bitmap = await createImageBitmap(new Blob([b64ToBytes(b64)], { type: "image/png" }));
    const W = bitmap.width, H = bitmap.height;
    const delta = opts?.delta ?? 8;
    const src = document.createElement("canvas");
    src.width = W; src.height = H;
    const sctx = src.getContext("2d", { willReadFrequently: true });
    sctx.drawImage(bitmap, 0, 0);
    const srcData = sctx.getImageData(0, 0, W, H).data;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const owner = new Int32Array(W * H).fill(-1);
    const ordered = opts.ordered;
    for (let k = 0; k < ordered.length; k++) {
      const el = ordered[k];
      const [x, y, w, h] = el.rect;
      if (w <= 0 || h <= 0) continue;
      if (el.renderMode === "vector-panel" && el.fill) {
        ctx.fillStyle = el.fill;
        ctx.beginPath();
        const r = Math.max(0, Math.min(el.cornerRadius || 0, w / 2, h / 2));
        ctx.roundRect(x, y, w, h, r);
        ctx.fill();
      } else if (el.renderMode === "raster") {
        const sx = Math.max(0, Math.min(W, x)), sy = Math.max(0, Math.min(H, y));
        const sw = Math.max(0, Math.min(W - sx, w)), sh = Math.max(0, Math.min(H - sy, h));
        if (sw > 0 && sh > 0) ctx.drawImage(bitmap, sx, sy, sw, sh, sx, sy, sw, sh);
      } else continue;
      const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
      const x1 = Math.min(W, Math.round(x + w)), y1 = Math.min(H, Math.round(y + h));
      for (let yy = y0; yy < y1; yy++) owner.fill(k, yy * W + x0, yy * W + x1);
    }
    const rec = ctx.getImageData(0, 0, W, H).data;
    const exposed = new Int32Array(ordered.length);
    const off = new Int32Array(ordered.length);
    const sum = new Float64Array(ordered.length);
    // 要素の矩形の縁 edge px は数えない。縁は角丸の推定誤差(±1px 程度)と 1px の枠線・
    // アンチエイリアスで必ず外れ、小さな要素ほどその割合が支配的になる（実測 2026-08-26:
    // 39x22 のボタンで縁込み risk 0.07、内側だけなら後述）。ここで測りたいのは
    // 「塗りつぶすと消える中身」であって縁の精度ではない。
    const edge = opts?.edge ?? 2;
    const bounds = ordered.map((el) => {
      const [x, y, w, h] = el.rect;
      return [Math.round(x) + edge, Math.round(y) + edge, Math.round(x + w) - edge, Math.round(y + h) - edge];
    });
    for (let p = 0, i = 0; p < W * H; p++, i += 4) {
      const k = owner[p];
      if (k < 0) continue;
      const px = p % W, py = (p / W) | 0, b = bounds[k];
      if (px < b[0] || py < b[1] || px >= b[2] || py >= b[3]) continue;
      const d = Math.max(
        Math.abs(rec[i] - srcData[i]), Math.abs(rec[i + 1] - srcData[i + 1]), Math.abs(rec[i + 2] - srcData[i + 2]));
      exposed[k]++;
      sum[k] += d;
      if (d > delta) off[k]++;
    }
    // --- 外れた画素の塊（patch 候補） ---
    // 外れた画素を要素ごとに 8 近傍で塊にまとめ、塊ごとに「パネルの塗り B を背景とした
    // alpha matte」を推定する。塗りは既知なので B の推定が要らず、行の matte より条件が良い。
    // モデルと閾値は detectUiRegions の estimateMatte と同じ（fit ≥ 0.78・中間 alpha ≤ 0.35・
    // コントラスト ≥ 24）。数が多すぎる要素（写真）は塊を数えず null を返し、呼び出し側が
    // 要素ごとラスタに落とす。
    // 塊の数の上限は写真の足切り（写真は数百になる）。破線や点線は 1 本で十数個の塊になるので
    // 少なすぎると本物の線を写真扱いしてしまう（実測 2026-08-26: 8/6 の破線 + 角丸の 4 隅で 17）。
    const PATCH_MAX_CLUSTERS = opts?.patchMaxClusters ?? 64;
    const PATCH_DILATE = 1;
    // 近い塊は 1 つの patch にまとめる（破線 → 1 本、文字の点 → 1 文字）。切り抜きは
    // 元画素なので、間の塗り部分を含んでも見た目は変わらない。8px: 破線の隙間(6)より広く、
    // 別のアイコン同士が並ぶ間隔(通常 12px 以上)より狭い。
    // **統合するのは同じ行か同じ列に並ぶ塊だけ**（bbox が縦または横に重なっているもの）。
    // 距離だけで見ると、斜めに 8px 離れただけのアイコンが連鎖して 1 塊になり、
    // ツールバーが丸ごと 1 枚の切り抜きになる（動かす単位として間違っている）。
    // 破線は同じ行に並ぶので縦に重なり、統合される。
    const PATCH_MERGE_GAP = opts?.patchMergeGap ?? 8;
    const PATCH_MIN_PIXELS = 4;
    const mergeClusters = (cs) => {
      let merged = true;
      while (merged) {
        merged = false;
        for (let i = 0; i < cs.length && !merged; i++) {
          for (let j = i + 1; j < cs.length; j++) {
            const a = cs[i].rect, b = cs[j].rect;
            const gx = Math.max(a[0], b[0]) - Math.min(a[0] + a[2], b[0] + b[2]);
            const gy = Math.max(a[1], b[1]) - Math.min(a[1] + a[3], b[1] + b[3]);
            // gx/gy が負 = その軸で重なっている。「横に重なって縦が近い」か
            // 「縦に重なって横が近い」だけを統合し、斜めの隣接は統合しない
            const sameColumn = gx <= 0 && gy <= PATCH_MERGE_GAP;
            const sameRow = gy <= 0 && gx <= PATCH_MERGE_GAP;
            if (!sameColumn && !sameRow) continue;
            const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]);
            const x1 = Math.max(a[0] + a[2], b[0] + b[2]), y1 = Math.max(a[1] + a[3], b[1] + b[3]);
            cs[i] = { rect: [x0, y0, x1 - x0, y1 - y0], pixels: cs[i].pixels + cs[j].pixels };
            cs.splice(j, 1);
            merged = true;
            break;
          }
        }
      }
      return cs;
    };
    const clustersOf = (k, el) => {
      const [ex, ey, ew, eh] = el.rect;
      const bx0 = Math.max(0, Math.round(ex)), by0 = Math.max(0, Math.round(ey));
      const bx1 = Math.min(W, Math.round(ex + ew)), by1 = Math.min(H, Math.round(ey + eh));
      const bw = bx1 - bx0, bh = by1 - by0;
      if (bw <= 0 || bh <= 0) return [];
      const mask = new Uint8Array(bw * bh);
      const b = bounds[k];
      for (let py = by0; py < by1; py++) {
        for (let px = bx0; px < bx1; px++) {
          const p = py * W + px;
          if (owner[p] !== k) continue;
          if (px < b[0] || py < b[1] || px >= b[2] || py >= b[3]) continue;
          const i = p * 4;
          const d = Math.max(
            Math.abs(rec[i] - srcData[i]), Math.abs(rec[i + 1] - srcData[i + 1]), Math.abs(rec[i + 2] - srcData[i + 2]));
          if (d > delta) mask[(py - by0) * bw + (px - bx0)] = 1;
        }
      }
      // 1px 膨張: アンチエイリアスで途切れた線を 1 つの塊にする
      const dil = new Uint8Array(bw * bh);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        if (!mask[y * bw + x]) continue;
        for (let dy = -PATCH_DILATE; dy <= PATCH_DILATE; dy++) for (let dx = -PATCH_DILATE; dx <= PATCH_DILATE; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy >= 0 && yy < bh && xx >= 0 && xx < bw) dil[yy * bw + xx] = 1;
        }
      }
      const seen = new Uint8Array(bw * bh);
      const stack = new Int32Array(bw * bh);
      const clusters = [];
      for (let s0 = 0; s0 < bw * bh; s0++) {
        if (!dil[s0] || seen[s0]) continue;
        let sp = 0, n = 0, x0 = bw, y0 = bh, x1 = -1, y1 = -1;
        stack[sp++] = s0; seen[s0] = 1;
        while (sp > 0) {
          const q = stack[--sp];
          const qx = q % bw, qy = (q / bw) | 0;
          if (mask[q]) n++;
          if (qx < x0) x0 = qx; if (qy < y0) y0 = qy; if (qx > x1) x1 = qx; if (qy > y1) y1 = qy;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const yy = qy + dy, xx = qx + dx;
            if (yy < 0 || yy >= bh || xx < 0 || xx >= bw) continue;
            const r = yy * bw + xx;
            if (dil[r] && !seen[r]) { seen[r] = 1; stack[sp++] = r; }
          }
        }
        clusters.push({ rect: [bx0 + x0, by0 + y0, x1 - x0 + 1, y1 - y0 + 1], pixels: n });
        if (clusters.length > PATCH_MAX_CLUSTERS) return null;
      }
      return clusters;
    };
    const parseHexLocal = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const hexLocal = (r, g, b) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
    const medianLocal = (arr) => { const a = [...arr].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
    const matteAgainstFill = (rect, fillHex) => {
      const bg = parseHexLocal(fillHex);
      const [rx, ry, rw, rh] = rect;
      const dist = [], px = [];
      for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) {
        const o = (y * W + x) * 4;
        const dr = srcData[o] - bg[0], dg = srcData[o + 1] - bg[1], db = srcData[o + 2] - bg[2];
        dist.push(dr * dr + dg * dg + db * db); px.push(o);
      }
      if (px.length < 8) return null;
      const order = px.map((_, i) => i).sort((a, b) => dist[b] - dist[a]);
      const take = Math.max(4, Math.floor(order.length * 0.25));
      const fr = [], fg = [], fb = [];
      for (let i = 0; i < take; i++) { const o = px[order[i]]; fr.push(srcData[o]); fg.push(srcData[o + 1]); fb.push(srcData[o + 2]); }
      const F = [medianLocal(fr), medianLocal(fg), medianLocal(fb)];
      const d = [F[0] - bg[0], F[1] - bg[1], F[2] - bg[2]];
      const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      const contrast = Math.max(Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2]));
      if (len2 < 1e-9 || contrast < 24) return { eligible: false, fit: 0, mid: 1, fg: hexLocal(F[0], F[1], F[2]), bg: fillHex };
      let sum = 0, mid = 0;
      for (const o of px) {
        const c0 = srcData[o] - bg[0], c1 = srcData[o + 1] - bg[1], c2 = srcData[o + 2] - bg[2];
        let a = (c0 * d[0] + c1 * d[1] + c2 * d[2]) / len2;
        a = a < 0 ? 0 : a > 1 ? 1 : a;
        const e0 = c0 - a * d[0], e1 = c1 - a * d[1], e2 = c2 - a * d[2];
        sum += Math.sqrt(e0 * e0 + e1 * e1 + e2 * e2);
        if (a > 0.2 && a < 0.8) mid++;
      }
      const len = Math.sqrt(len2);
      const fit = Math.max(0, Math.min(1, 1 - (sum / px.length) / (len * 0.5)));
      const midFraction = mid / px.length;
      return { eligible: fit >= 0.78 && midFraction <= 0.35, fit, mid: midFraction, fg: hexLocal(F[0], F[1], F[2]), bg: fillHex };
    };

    const out = [];
    for (let k = 0; k < ordered.length; k++) {
      const el = ordered[k];
      if (!(el.renderMode === "vector-panel" && el.fill)) continue;
      const risk = exposed[k] ? off[k] / exposed[k] : 0;
      let patches = null;
      if (off[k] > 0) {
        const clusters = clustersOf(k, el);
        if (clusters) {
          // 数画素の塊は角丸の推定誤差の残り（実測: 角ごとに 1px）。切り抜きにしても
          // 見えないし、要素が 4 つ増えるだけ
          patches = mergeClusters(clusters.filter((c) => c.pixels >= PATCH_MIN_PIXELS)).map((c) => {
            // 塊の bbox を 1px 広げて AA の縁を含める（要素の矩形内に収める）
            const [ex, ey, ew, eh] = el.rect;
            const x0 = Math.max(Math.round(ex), c.rect[0] - 1), y0 = Math.max(Math.round(ey), c.rect[1] - 1);
            const x1 = Math.min(Math.round(ex + ew), c.rect[0] + c.rect[2] + 1), y1 = Math.min(Math.round(ey + eh), c.rect[1] + c.rect[3] + 1);
            const rect = [x0, y0, x1 - x0, y1 - y0];
            const m = matteAgainstFill(rect, el.fill);
            return {
              rect, pixels: c.pixels,
              matteEligible: !!(m && m.eligible),
              matteConfidence: m ? Math.round(m.fit * (1 - Math.min(1, m.mid / 0.35)) * 1000) / 1000 : 0,
              matteFit: m ? Math.round(m.fit * 1000) / 1000 : 0,
              matteMidAlpha: m ? Math.round(m.mid * 1000) / 1000 : 1,
              matte: m && m.eligible ? { fg: m.fg, bg: m.bg, space: "srgb" } : undefined,
            };
          });
        }
      }
      out.push({
        id: el.id,
        exposed: exposed[k],
        // 露出画素のうち delta を超えて外れた割合。露出が無い(完全に覆われた)要素は 0
        risk,
        meanDiff: exposed[k] ? sum[k] / exposed[k] / 255 : 0,
        // 外れた画素の塊。null は「塊が多すぎて数えなかった」(写真)
        patches,
      });
    }
    return out;
  },

  // 検出結果に通し番号を焼き込む。ラベル位置は uiOverlay.ts（Node側の純関数）が決める
  async drawOverlay(b64, opts) {
    const bitmap = await createImageBitmap(new Blob([b64ToBytes(b64)], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    ctx.lineWidth = 2;
    ctx.font = "bold 13px sans-serif";
    ctx.textBaseline = "bottom";
    for (const l of opts.labels) {
      ctx.strokeStyle = l.color;
      ctx.strokeRect(l.box[0] + 1, l.box[1] + 1, l.box[2] - 2, l.box[3] - 2);
      const text = String(l.id);
      const w = ctx.measureText(text).width + 6;
      ctx.fillStyle = l.color;
      ctx.fillRect(l.labelX, l.labelY - 14, w, 15);
      ctx.fillStyle = "#000000";
      ctx.fillText(text, l.labelX + 3, l.labelY);
    }
    return canvas.toDataURL("image/png").split(",")[1];
  },

  // 画像の実寸だけを知りたいとき（検出を走らせずに済ませる）
  async imageSize(b64) {
    const bitmap = await createImageBitmap(new Blob([b64ToBytes(b64)], { type: "image/png" }));
    return { width: bitmap.width, height: bitmap.height };
  },

  // テスト用: SVG 文字列を PNG にする
  async rasterize(b64) {
    const svg = new TextDecoder().decode(b64ToBytes(b64));
    const url = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width = img.width; canvas.height = img.height;
    canvas.getContext("2d").drawImage(img, 0, 0);
    return canvas.toDataURL("image/png").split(",")[1];
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
        const changed = scene.seek(opts.startTime || 0);
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
        for (let retry = 0; retry < 2 && result.blob.size < 1000 && result.steps > 3; retry++) {
          result = await recordOnce();
        }
        if (result.blob.size < 1000 && result.steps > 3) {
          // 実測: 高CPU負荷下(並列レンダリング等)ではリトライしても全フレーム落ちすることがある。
          // 110B程度のヘッダのみのWebMを黙って返すより、明示エラーで呼び出し側に再試行を促す。
          throw new Error(
            "Video capture produced an empty WebM (" + result.blob.size + " bytes after " + result.steps +
              " frames, 3 attempts). This usually means the machine was under heavy CPU load during the realtime recording. Retry when the system is idle."
          );
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
          const changed = scene.seek(s.advance || 0);
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
