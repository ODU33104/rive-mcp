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
          let sum = 0, n = 0;
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
        // 四隅から対角に走査し、成分に入るまでの距離 d を測る。
        // 半径 r の丸角では中心が (r, r) にあり、対角上の点 (t, t) が図形内に入るのは
        // 中心からの距離² = 2(t-r)² <= r² を解いて t >= r(1 - 1/√2) のとき。
        // つまり最初にヒットする d ≈ 0.2929r なので、r に戻す係数は 1/(1 - 1/√2) = 2+√2 ≈ 3.414
        // であって √2 ではない（誤って √2 に「簡略化」しないこと。過去に係数を取り違えて
        // 真の半径の 41% しか報告できていなかった実績あり）。
        // 整数格子の probe は d を切り上げて返すため、-0.5 の半格子補正を掛けてから係数を掛ける。
        const probe = (cx, cy, dx, dy) => {
          for (let d = 0; d < Math.min(w, h) / 2; d++) {
            const x = cx + dx * d, y = cy + dy * d;
            if (x < 0 || y < 0 || x >= W || y >= H) return 0;
            if (label[y * W + x] === c.id) return d;
          }
          return 0;
        };
        const ds = [
          probe(c.minX, c.minY, 1, 1),
          probe(c.maxX, c.minY, -1, 1),
          probe(c.minX, c.maxY, 1, -1),
          probe(c.maxX, c.maxY, -1, -1),
        ];
        // d=0（直角の角）は「半径0のサンプル」ではなく「丸くない角」の意味。
        // 上だけ丸い等の非対称な角Rでは直角側の0が中央値を押し下げるので、中央値の前に除外する
        const rounded = ds.filter((d) => d > 0).sort((a, b) => a - b);
        if (rounded.length > 0) {
          const mid = rounded.length >> 1;
          const median =
            rounded.length % 2 === 1 ? rounded[mid] : (rounded[mid - 1] + rounded[mid]) / 2;
          cornerRadius = Math.round(Math.min(24, Math.max(0, median - 0.5) * (2 + Math.SQRT2) * inv));
          if (cornerRadius < 2) cornerRadius = 0;
        }
      }

      regions.push({
        renderMode,
        semanticHint,
        rect: [Math.round(c.minX * inv), Math.round(c.minY * inv), rectW, rectH],
        cornerRadius,
        fill: color,
      });
    }

    // 文字は minArea 未満に量子化で散った成分の集まりになる。行として束ねて拾い直す
    const glyphs = [];
    for (const c of comps) {
      const w = c.maxX - c.minX + 1;
      const h = c.maxY - c.minY + 1;
      if (w * h * inv * inv >= minArea) continue;
      if (h < 4 || h > 40 * scale) continue;          // 行として無理のない高さだけ
      if (w > 60 * scale) continue;                    // 1文字にしては横長すぎる
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
      } else {
        lines.push({ minX: g.minX, minY: g.minY, maxX: g.maxX, maxY: g.maxY,
                     r: g.r, g: g.g, b: g.b, n: 1 });
      }
    }
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
      regions.push({
        renderMode: "raster",
        semanticHint: "text",
        rect: [Math.round(l.minX * inv), Math.round(l.minY * inv), rectW, rectH],
        fill: color,
        fontSizePx: Math.round(h * 1.3),  // 大文字高 ≒ フォントサイズの 0.7〜0.75
      });
    }

    return { width: W0, height: H0, regions, sampledColors };
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
