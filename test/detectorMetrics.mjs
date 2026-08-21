// UI検出器の計測ハーネス。このファイルは検出器の挙動を「変更」しない。
// 後続タスクが自分の変更の効果を数値で示すための土台。
//
// Task 11 改訂の理由（消さないこと）:
// Task 10 の指標一式には**2つの抜け道**が空いていた。どちらも「指標は全部改善するが
// 機能の価値は失われる」ため、指標を信じて最適化すると製品が壊れる。
//   抜け道1「全部 raster にする」 — 再構成誤差ほぼ0・縞スコア0・leak 0・要素数減。
//     ベクター編集性を完全に失うのに満点が出る → positivePanelInstanceRecall で塞ぐ。
//     **面積 recall ではなく instance recall**（小さいボタン10個を落として巨大な背景1個を
//     拾っても面積 recall は良く見える）。
//   抜け道2「巨大な raster 1枚にまとめる」 — leak なし・再構成ほぼ完璧・要素数はむしろ減る。
//     独立したアニメーションと操作を失う → rasterOverdrawRatio / rasterContainmentCount で塞ぐ。
//
// 閾値は名前付き定数にして根拠をここに書く（「妥当そうな値」ではなく実測/設計上の
// 理由がある値だけを使う）。
import { pathToFileURL } from "node:url";
import { RiveHost } from "../dist/riveHost.js";
import { PAGE_SCRIPT } from "../dist/pageScript.js";

// ---- 幾何ヘルパー -----------------------------------------------------------

const areaOf = (r) => Math.max(0, r[2]) * Math.max(0, r[3]);

export function intersectArea(a, b) {
  const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  return ix * iy;
}

function iou(a, b) {
  const inter = intersectArea(a, b);
  if (inter === 0) return 0;
  const union = areaOf(a) + areaOf(b) - inter;
  return union > 0 ? inter / union : 0;
}

/** 矩形群の和集合面積を座標圧縮で厳密に求める。重なりを二重計上しない。 */
function unionArea(rects) {
  const valid = rects.filter((r) => r[2] > 0 && r[3] > 0);
  if (!valid.length) return 0;
  const xs = [...new Set(valid.flatMap((r) => [r[0], r[0] + r[2]]))].sort((a, b) => a - b);
  const ys = [...new Set(valid.flatMap((r) => [r[1], r[1] + r[3]]))].sort((a, b) => a - b);
  let total = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const cw = xs[i + 1] - xs[i];
      const ch = ys[j + 1] - ys[j];
      // 最小セルなので「どれかに完全に含まれる」か「どれとも交わらない」かの二択。
      const cell = [xs[i], ys[j], cw, ch];
      if (valid.some((r) => intersectArea(r, cell) > 0)) total += cw * ch;
    }
  }
  return total;
}

function hexToRgb(hex) {
  if (typeof hex !== "string") return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** 2色のチャンネル最大絶対差(0〜255)。片方でも解釈できなければ Infinity(=不一致)。 */
function fillDelta(a, b) {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return Infinity;
  return Math.max(Math.abs(ra[0] - rb[0]), Math.abs(ra[1] - rb[1]), Math.abs(ra[2] - rb[2]));
}

// ---- z順とレイヤーラベル -----------------------------------------------------

/**
 * uiPrototype.ts buildPrototypeScene と同じ描画順（親なし要素を y,x 順に並べ、
 * 深さ優先 pre-order で z を振る）を複製する。src/ を変更せずに計測したいため
 * ここに複製がある。**両者は同時に見ること** — ずれると誤差と leak の意味が変わる。
 *
 * 本家と違うのは防御が2つ入っている点だけ:
 *   - 訪問済み集合を持つ（壊れた children で無限再帰しない）
 *   - 根から到達できない要素を末尾に足す（落とすと「描かれないので誤差に出ない」という
 *     嘘の good 判定になる）
 */
export function zOrder(elements) {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const roots = elements
    .filter((e) => e.parent === null)
    .sort((a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0]);
  const ordered = [];
  const seen = new Set();
  const visit = (e) => {
    if (seen.has(e.id)) return;
    seen.add(e.id);
    ordered.push(e);
    for (const cid of e.children || []) {
      const c = byId.get(cid);
      if (c) visit(c);
    }
  };
  roots.forEach(visit);
  for (const e of elements) {
    if (!seen.has(e.id)) {
      seen.add(e.id);
      ordered.push(e);
    }
  }
  return ordered;
}

export const LABEL_BASE = 0;
export const LABEL_VECTOR_FILL = 1;
export const LABEL_RASTER = 2;

/**
 * 画素ごとに「最前面のレイヤーは何か」を返す(width*height の Uint8Array)。
 *
 * **これが Task 11 Step 4 の中核。** 旧 truthAlignment は negative 矩形と vector-panel 矩形の
 * 交差面積を素朴に足していたため、「正当なパネル(header)の上に正しくテキストの raster が
 * 乗っている」だけで leak 率 1.000 が出ていた（ベースラインの title-text / number-text が
 * まさにこれで、集計値 0.70 の半分は**指標の作り物**だった）。
 * 最前面レイヤーで判定すれば、上に raster が乗っている画素は「元の画素が保たれている」ので
 * leak と数えられない。
 *
 * cornerRadius は無視して矩形として塗る。角で vector 被覆をわずかに過大評価するが、
 * negative leak の指標としては**過大評価が安全側**（見落としを作らない）なので許容する。
 */
export function topLayerLabels(elements, { width, height }) {
  const buf = new Uint8Array(width * height);
  for (const el of zOrder(elements)) {
    let label;
    if (el.renderMode === "vector-panel" && el.fill) label = LABEL_VECTOR_FILL;
    else if (el.renderMode === "raster") label = LABEL_RASTER;
    else continue; // fill の無い vector-panel は何も描かない → base がそのまま残る
    const [x, y, w, h] = el.rect;
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(width, Math.round(x + w));
    const y1 = Math.min(height, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) {
      const row = yy * width;
      buf.fill(label, row + x0, row + x1);
    }
  }
  return buf;
}

// ---- 再構成誤差 --------------------------------------------------------------

/**
 * 検出結果から「アニメーション最終状態」の静止画を合成し直し、元画像と画素比較する。
 *
 * 誤差の定義: 再合成画像と元画像のRGB各チャンネル絶対差の平均(0〜1に正規化=MAE/255)。
 * RMSE ではなく MAE を選んだ理由: 少数の激しく壊れた画素(単色矩形が写真を覆う)と
 * 多数の小さな画素誤差(アンチエイリアシング境界)を、人間の「見た目の破綻」の感覚に
 * 近い比率で足し合わせたいため。RMSEは外れ値を過大評価し、逆に「32本の縞で
 * グラデーションを近似した」ような広範囲の中程度の誤差を過小評価する。
 *
 * **平均だけでは足りない(Task 11 Step 7)。** 画面面積1%のボタンが完全に壊れても
 * global mean は巨大な背景に薄められて小さいままになる。そこで
 *   - p95 / p99: 画素誤差の分位。局所的な事故が平均に埋もれない
 *   - vectorAreaMae: **ベクター化した画素だけ**の平均。ラスタ部分は定義上ほぼ0なので、
 *     全体平均に混ぜるとベクター化の失敗が希釈される
 * を併せて返す。
 *
 * labels は Node 側で topLayerLabels() が作ったものを base64 で渡す。ページ側で
 * z順ロジックを二重実装しないための選択（実装が2箇所にあると必ずずれる）。
 *
 * host: RiveHost（既に起動済みの canvas-advanced ページを持つ）。canvas 実行にライブ
 * ページが要るため brief の型 reconstructionError(png, elements) に host を足してある。
 */
export async function reconstructionStats(host, sourcePng, elements) {
  const page = await host.getPage();
  const srcB64 = Buffer.isBuffer(sourcePng) ? sourcePng.toString("base64") : sourcePng;

  // 元画像の実寸はページ側でしか分からないので、先に問い合わせてから labels を作る。
  const size = await page.evaluate(async ({ srcB64 }) => {
    function b64ToBytes(b64) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }
    const bmp = await createImageBitmap(new Blob([b64ToBytes(srcB64)], { type: "image/png" }));
    return { width: bmp.width, height: bmp.height };
  }, { srcB64 });

  const labels = topLayerLabels(elements, size);
  const labelsB64 = Buffer.from(labels).toString("base64");

  return await page.evaluate(
    async ({ srcB64, elements, labelsB64 }) => {
      function b64ToBytes(b64) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
      }
      const bitmap = await createImageBitmap(new Blob([b64ToBytes(srcB64)], { type: "image/png" }));
      const W = bitmap.width, H = bitmap.height;
      const labels = b64ToBytes(labelsB64);

      // 比較対象は「同じ手順で一度canvasに描いてから読んだ元画像」。bitmapを直接
      // 比較すると toDataURL 往復による再エンコード誤差が非対称に効くのを避けるため。
      const srcCanvas = document.createElement("canvas");
      srcCanvas.width = W; srcCanvas.height = H;
      const sctx = srcCanvas.getContext("2d");
      sctx.drawImage(bitmap, 0, 0);
      const srcData = sctx.getImageData(0, 0, W, H).data;

      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d");
      // base: 元画像全面。uiPrototype.ts の sliceImage/attachRasterAssets は fill を持つ
      // vector-panel の元画素を base から消さない(不透明な塗りが常に上に乗るため)。
      // ここでも同じ前提で「base を切り欠かず、上に重ねるだけ」にする。
      ctx.drawImage(bitmap, 0, 0);

      // z順は Node 側 zOrder() と同じ規則。ここは描画だけを行い、順序の正本は
      // Node 側にある(labels も同じ順序で作られている)。
      const byId = new Map(elements.map((e) => [e.id, e]));
      const roots = elements
        .filter((e) => e.parent === null)
        .sort((a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0]);
      const ordered = [];
      const seen = new Set();
      const visit = (e) => {
        if (seen.has(e.id)) return;
        seen.add(e.id);
        ordered.push(e);
        for (const cid of e.children || []) {
          const c = byId.get(cid);
          if (c) visit(c);
        }
      };
      roots.forEach(visit);
      for (const e of elements) if (!seen.has(e.id)) { seen.add(e.id); ordered.push(e); }

      for (const el of ordered) {
        const [x, y, w, h] = el.rect;
        if (w <= 0 || h <= 0) continue;
        if (el.renderMode === "vector-panel" && el.fill) {
          ctx.fillStyle = el.fill;
          ctx.beginPath();
          const r = Math.max(0, Math.min(el.cornerRadius || 0, w / 2, h / 2));
          if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
          else ctx.rect(x, y, w, h);
          ctx.fill();
          if (el.stroke) {
            ctx.lineWidth = el.stroke.width;
            ctx.strokeStyle = el.stroke.color;
            ctx.stroke();
          }
        } else if (el.renderMode === "raster") {
          // ラスタ要素は元画像の同じ位置から切り出して同じ位置に描く(sliceImage相当)。
          const sx = Math.max(0, Math.min(W, x));
          const sy = Math.max(0, Math.min(H, y));
          const sw = Math.max(0, Math.min(W - sx, w));
          const sh = Math.max(0, Math.min(H - sy, h));
          if (sw > 0 && sh > 0) ctx.drawImage(bitmap, sx, sy, sw, sh, sx, sy, sw, sh);
        }
      }

      const reconData = ctx.getImageData(0, 0, W, H).data;
      const N = W * H;
      // 画素誤差 e = |dR|+|dG|+|dB| は 0..765 の整数。766バケットのヒストグラムで
      // 分位を厳密に出せる(サンプリングや近似が要らない)。
      const hist = new Int32Array(766);
      let sum = 0;
      let vecSum = 0;
      let vecCount = 0;
      for (let p = 0; p < N; p++) {
        const i = p * 4;
        const e =
          Math.abs(reconData[i] - srcData[i]) +
          Math.abs(reconData[i + 1] - srcData[i + 1]) +
          Math.abs(reconData[i + 2] - srcData[i + 2]);
        sum += e;
        hist[e]++;
        if (labels[p] === 1) { vecSum += e; vecCount++; }
      }
      const percentile = (q) => {
        const target = q * N;
        let acc = 0;
        for (let e = 0; e < hist.length; e++) {
          acc += hist[e];
          if (acc >= target) return e / 765;
        }
        return 1;
      };
      return {
        mae: sum / (N * 765),
        p95: percentile(0.95),
        p99: percentile(0.99),
        vectorAreaMae: vecCount ? vecSum / (vecCount * 765) : 0,
        vectorPixelRatio: vecCount / N,
        width: W,
        height: H,
      };
    },
    { srcB64, elements, labelsB64 }
  );
}

/** 後方互換の薄いラッパ(平均だけ欲しい呼び出し用)。 */
export async function reconstructionError(host, sourcePng, elements) {
  return (await reconstructionStats(host, sourcePng, elements)).mae;
}

// ---- 安価な guardrail 指標 ---------------------------------------------------

// 44px は Apple/Material のタップ領域下限。20x20=400px^2 はその半分以下で、意図的なUI
// 要素としてはまず小さすぎるサイズ。detectUiRegions の panel/image 経路は minArea
// (既定576px^2)未満を最初から捨てるので、これより小さい要素が残るのはテキスト行
// (最小 w>=8,h>=6)経由のみ — 将来のタスクでテクスチャ分割等がここに非テキストの
// 小片を送り込むかを見張るための閾値。
export const TINY_AREA_PX = 400;

// 0.9 = ほぼ同一矩形。uiDetect.mjs の回帰テスト(Bug1: 100x100を2pxオフセットした2枚)の
// 実測IoUが0.96前後だったため、正常な親子包含(子が親よりずっと小さい→IoUは低い)を
// 誤検出しない範囲で「同一検出の重複」を拾える値としてこれを採用した。
export const IOU_DUP_THRESHOLD = 0.9;

// raster の包含判定。buildTree の contains() と同じ 95%(1pxのはみ出しで切れない値)を使う。
export const RASTER_CONTAIN_RATIO = 0.95;
// 画面の 95% 以上を覆う raster は「背景レイヤー」として外側の集計から除外する。
// 背景は定義上ほかの全 raster を包含するので、これを数えると containment が
// **raster 件数にほぼ比例するだけの数**になり、本来見たい「中間層が周囲を飲み込んだ」
// 事故が薄まる。実測(2026-08-21, seed=1): 全43件のうち21件が背景由来で、
// 本命のシグナル（ノイズ領域が14件を包含）が埋もれていた。
export const RASTER_BACKGROUND_COVER_RATIO = 0.95;

// 縞スコア: 量子化された同色バケットの帯は、同じ行/列に沿ってほぼ隙間なく(2px以内)
// 連続する。3個以上の連続を「縞」とみなす。
export const STRIPE_ADJACENT_GAP_PX = 2;
// 同じ帯に属するかの y/x 一致許容量。cornerRadius probe 等、既存コードの半格子誤差
// 許容(±0.5px級)より緩めだが、bbox丸め誤差(Math.round)の蓄積を吸収する必要があるため4px。
export const STRIPE_MATCH_TOL_PX = 4;
export const STRIPE_MIN_RUN = 3;

function groupBy(items, keyFn) {
  const map = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  }
  return map;
}

// axis=0: 横方向(x昇順)に隣接するかを見る＝横長の帯を検出。axis=1: 縦方向。
function stripeRunLength(group, axis) {
  const sorted = [...group].sort((a, b) => a.rect[axis] - b.rect[axis]);
  let total = 0;
  let runLen = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].rect[axis] + sorted[i - 1].rect[axis + 2];
    const gap = sorted[i].rect[axis] - prevEnd;
    if (gap <= STRIPE_ADJACENT_GAP_PX) {
      runLen++;
    } else {
      if (runLen >= STRIPE_MIN_RUN) total += runLen;
      runLen = 1;
    }
  }
  if (runLen >= STRIPE_MIN_RUN) total += runLen;
  return total;
}

/**
 * 縞スコア = 「同じ行/列に沿って3個以上連続で隙間なく並ぶ vector-panel の総数」。
 * 横方向・縦方向を両方数える(縦グラデーションもあるため)。
 *
 * **旧名 gradientBandScore から改名した(Task 11 Step 6)。** この指標は正解データを
 * 見ておらず「グラデーションの場所」を知らない。名前が gradient を名乗っていると、
 * 「グラデーションを直した」の証拠として誤読される。グラデーション領域そのものの
 * 評価は truthAlignment 側の perNegative[].vectorPanelCount を見ること。
 */
export function stripeRunScore(regions) {
  const candidates = regions.filter((e) => e.renderMode === "vector-panel");
  let score = 0;
  const byRow = groupBy(candidates, (e) => {
    const yb = Math.round(e.rect[1] / STRIPE_MATCH_TOL_PX);
    const hb = Math.round(e.rect[3] / STRIPE_MATCH_TOL_PX);
    return `row:${yb}:${hb}`;
  });
  for (const group of byRow.values()) {
    if (group.length >= STRIPE_MIN_RUN) score += stripeRunLength(group, 0);
  }
  const byCol = groupBy(candidates, (e) => {
    const xb = Math.round(e.rect[0] / STRIPE_MATCH_TOL_PX);
    const wb = Math.round(e.rect[2] / STRIPE_MATCH_TOL_PX);
    return `col:${xb}:${wb}`;
  });
  for (const group of byCol.values()) {
    if (group.length >= STRIPE_MIN_RUN) score += stripeRunLength(group, 1);
  }
  return score;
}

/**
 * ツリー(parent/children)を根から辿り、循環と最大深さを調べる。buildTree は
 * id順の構造的な保証(親のidは常に子より小さい)で循環が起きない設計になっているが、
 * guardrail としては信頼せず実際に辿って確認する(仕様変更で保証が崩れた時に気付くため)。
 */
function walkTree(elements) {
  const byId = new Map(elements.map((e) => [e.id, e]));
  let cycleCount = 0;
  let maxDepth = 0;
  for (const el of elements) {
    let cur = el;
    let steps = 0;
    const cap = elements.length + 1;
    while (cur && cur.parent !== null) {
      steps++;
      if (steps > cap) { cycleCount++; break; }
      cur = byId.get(cur.parent);
    }
    if (steps <= cap) maxDepth = Math.max(maxDepth, steps);
  }
  return { cycleCount, maxDepth };
}

/**
 * 安価な guardrail 指標一式（正解データ不要）。
 *
 * opts.rawRegions は **maxElements の cap を適用する前**の検出結果。
 * cap 後だけを測っていると、別のノイズが増えて縞が top-N から押し出されただけで
 * スコアが下がり、アルゴリズムが何も改善していないのに成功に見える(Task 11 Step 5)。
 *
 * 「全要素面積の合計 ÷ 画面面積」は入れ子(親子が同じ領域を二重に占める)と重なりで
 * 意味が安定しないため、意図的に primary 指標から外している。
 */
export function guardrails(elements, sourceSize, opts = {}) {
  const { dropped = 0, rawRegions = null } = opts;
  const { width, height } = sourceSize;
  const n = elements.length;
  const screen = Math.max(1, width * height);
  const megapixels = Math.max(1e-9, (width * height) / 1_000_000);

  const tinyCount = elements.filter((e) => areaOf(e.rect) < TINY_AREA_PX).length;

  // --- 抜け道2「巨大な raster 1枚にまとめる」を塞ぐ ---
  // 同一画素が複数の raster レイヤーに入る overdraw が duplication の強いシグナル。
  // 旧 rasterOverlapAreaRatio は「全ペアの交差面積の和 ÷ 画面面積」で、3枚が重なると
  // 同じ画素を3回数え、値が1を超え得る意味の壊れた指標だった。和集合で正規化する。
  const rasterRects = elements.filter((e) => e.renderMode === "raster").map((e) => e.rect);
  const rasterSum = rasterRects.reduce((a, r) => a + areaOf(r), 0);
  const rasterUnion = unionArea(rasterRects);
  let rasterContainmentCount = 0;
  let rasterBackgroundCount = 0;
  for (let i = 0; i < rasterRects.length; i++) {
    if (areaOf(rasterRects[i]) / screen >= RASTER_BACKGROUND_COVER_RATIO) {
      rasterBackgroundCount++;
      continue;
    }
    for (let j = 0; j < rasterRects.length; j++) {
      if (i === j) continue;
      const inner = areaOf(rasterRects[j]);
      if (inner <= 0 || inner >= areaOf(rasterRects[i])) continue;
      if (intersectArea(rasterRects[i], rasterRects[j]) / inner >= RASTER_CONTAIN_RATIO) {
        rasterContainmentCount++;
      }
    }
  }

  let highIouDuplicateCount = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (iou(elements[i].rect, elements[j].rect) >= IOU_DUP_THRESHOLD) highIouDuplicateCount++;
    }
  }

  const { cycleCount, maxDepth } = walkTree(elements);

  return {
    keptElementsPerMegapixel: n / megapixels,
    rawElementsPerMegapixel: rawRegions ? rawRegions.length / megapixels : n / megapixels,
    dropped,
    tinyFraction: n ? tinyCount / n : 0,
    rasterUnionAreaRatio: rasterUnion / screen,
    rasterOverdrawRatio: rasterUnion > 0 ? (rasterSum - rasterUnion) / rasterUnion : 0,
    rasterContainmentCount,
    rasterBackgroundCount,
    highIouDuplicateCount,
    stripeRunScore: stripeRunScore(elements),
    stripeRunScoreRaw: rawRegions ? stripeRunScore(rawRegions) : stripeRunScore(elements),
    rootCount: elements.filter((e) => e.parent === null).length,
    cycleCount,
    maxDepth,
  };
}

// ---- 正解データとの突き合わせ ------------------------------------------------

// negative 領域の 0.1% でも最前面が不透明な vector-panel なら「侵食あり」と数える
// (RegionsWithAnyLeak 用の厳しい診断値)。合否判定はこれではなく
// Overall <= 0.005 / MaxPerRegion <= 0.02 の lexicographic gate で行う。
export const NEGATIVE_LEAK_ANY_EPS = 0.001;
// 0.1 = negative領域の10%以上が覆われたら「はっきり壊れている」件数として数える。
// 0%(1pxでも違反)にしないのは bbox境界の丸め誤差(±1〜2px)を違反件数に混ぜないため。
export const NEGATIVE_LEAK_THRESHOLD = 0.1;

// IoU 0.8 = 検出benchmarkの標準的な「厳しめの一致」。0.5 では「2枚のカードを1枚に
// 融合した」失敗が hit として通ってしまう(融合矩形は各カードと IoU 0.5 前後になる)ため、
// 抜け道を塞ぐ目的には 0.8 が要る。
// **細い要素では IoU は過酷**: 4px の区切り線が 2px として検出されると IoU 0.5 で miss に
// なる(実測: pixelScale=2 の divider がこれ)。集計値だけでなく perPositive[] を見ること。
export const POSITIVE_IOU_HIT = 0.8;

// 塗りの許容差 = 8。5bit量子化のバケット幅(256/32 = 8)。平坦でない領域の代表色推定は
// 原理的にこの幅ぶん動き得るので、それ未満を「別の色」と呼ぶ根拠がない。
// 合成シーンでの実測は**全42件で差 0**(2026-08-21)。この 8 は実画像用の余裕であって
// 現状を通すための緩和ではない。
export const POSITIVE_FILL_TOL = 8;
// 角丸の許容差 = max(3px, GT の 25%)。検出器の角丸推定は相対誤差を持つ
// (実測 2026-08-21: GT 6→1, 8→1, 10→1, 12→0/2, 16→2, 20→2, 24→2 ＝ 最大約17%)。
// 絶対値だけの許容にすると高解像度で必ず落ちるため相対項が要る。
export const POSITIVE_RADIUS_TOL_PX = 3;
export const POSITIVE_RADIUS_TOL_RATIO = 0.25;

// 要素が negative/positive 領域に「属する」とみなす面積比。半分以上その中にあれば
// その領域の要素とみなす。
export const REGION_MEMBERSHIP_RATIO = 0.5;

/**
 * candidate(vector-panel) と GT positive を1対1で対応付ける。
 * IoU 降順の貪欲法。要素数が高々数十なのでHungarianは不要で、
 * 同点時の順序を pi/ci で固定してあるため結果は決定的。
 */
function matchPositives(candidates, positives) {
  const pairs = [];
  for (let pi = 0; pi < positives.length; pi++) {
    for (let ci = 0; ci < candidates.length; ci++) {
      const v = iou(candidates[ci].rect, positives[pi].rect);
      if (v > 0) pairs.push({ pi, ci, iou: v });
    }
  }
  pairs.sort((a, b) => b.iou - a.iou || a.pi - b.pi || a.ci - b.ci);
  const usedP = new Set();
  const usedC = new Set();
  const matched = new Map(); // pi -> {candidate, iou}
  for (const p of pairs) {
    if (usedP.has(p.pi) || usedC.has(p.ci)) continue;
    usedP.add(p.pi);
    usedC.add(p.ci);
    matched.set(p.pi, { candidate: candidates[p.ci], iou: p.iou });
  }
  return matched;
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * 合成シーンの正解(truth)と検出結果(elements)を突き合わせる。
 * guardrails() とは独立: guardrails は正解データ無しでも計算できる安価な指標、
 * こちらは正解データがある場合だけ計算できる直接的な精度指標。
 *
 * **leak は最前面レイヤーで判定する。** 矩形交差の素朴な足し算ではない(topLayerLabels 参照)。
 */
export function truthAlignment(elements, truth) {
  const size = { width: truth.width, height: truth.height };
  const labels = topLayerLabels(elements, size);
  const negatives = truth.elements.filter((e) => !e.expectVectorPanel);
  const positives = truth.elements.filter((e) => e.expectVectorPanel);

  // --- negative: どれだけ誤ってベクター化したか ---
  const memberOf = (rect) => (el) => {
    const a = areaOf(el.rect);
    return a > 0 && intersectArea(el.rect, rect) / a >= REGION_MEMBERSHIP_RATIO;
  };
  let leakedTotal = 0;
  let negAreaTotal = 0;
  const perNegative = [];
  for (const neg of negatives) {
    const [x, y, w, h] = neg.rect;
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(size.width, Math.round(x + w));
    const y1 = Math.min(size.height, Math.round(y + h));
    let leaked = 0;
    let total = 0;
    for (let yy = y0; yy < y1; yy++) {
      const row = yy * size.width;
      for (let xx = x0; xx < x1; xx++) {
        total++;
        if (labels[row + xx] === LABEL_VECTOR_FILL) leaked++;
      }
    }
    const ratio = total > 0 ? leaked / total : 0;
    if (neg.leakGate !== false) {
      leakedTotal += leaked;
      negAreaTotal += total;
    }
    perNegative.push({
      label: neg.label,
      leakGate: neg.leakGate !== false,
      leakRatio: ratio,
      // 「1枚の誤 panel」か「20枚に砕けた」かを区別する。理想は vectorPanelCount 0 / rasterCount 1。
      vectorPanelCount: elements.filter((e) => e.renderMode === "vector-panel" && e.fill).filter(memberOf(neg.rect)).length,
      rasterCount: elements.filter((e) => e.renderMode === "raster").filter(memberOf(neg.rect)).length,
    });
  }
  // gate 対象は矩形が画素厳密な negative だけ。近似 GT(テキスト)を混ぜると
  // 「指標の作り物」が合否判定に入り込む(fixture 側 leakGate のコメント参照)。
  const leakRatios = perNegative.filter((p) => p.leakGate).map((p) => p.leakRatio);
  const leakRatiosAll = perNegative.map((p) => p.leakRatio);

  // --- positive: どれだけ拾えたか（抜け道1「全部raster」を塞ぐ主指標） ---
  const candidates = elements.filter((e) => e.renderMode === "vector-panel");
  const matched = matchPositives(candidates, positives);
  const perPositive = [];
  const hitIous = [];
  const radiusErrors = [];
  let hitCount = 0;
  for (let pi = 0; pi < positives.length; pi++) {
    const pos = positives[pi];
    const m = matched.get(pi);
    const gotIou = m ? m.iou : 0;
    const dFill = m && pos.fill !== undefined ? fillDelta(m.candidate.fill, pos.fill) : m ? 0 : Infinity;
    const dRadius =
      m && pos.cornerRadius !== undefined
        ? Math.abs((m.candidate.cornerRadius || 0) - pos.cornerRadius)
        : m
          ? 0
          : Infinity;
    const radiusTol = Math.max(POSITIVE_RADIUS_TOL_PX, (pos.cornerRadius || 0) * POSITIVE_RADIUS_TOL_RATIO);
    const hit = !!m && gotIou >= POSITIVE_IOU_HIT && dFill <= POSITIVE_FILL_TOL && dRadius <= radiusTol;
    if (hit) {
      hitCount++;
      hitIous.push(gotIou);
    }
    if (m && Number.isFinite(dRadius)) radiusErrors.push(dRadius);
    perPositive.push({
      label: pos.label,
      hit,
      iou: gotIou,
      fillDelta: Number.isFinite(dFill) ? dFill : null,
      radiusDelta: Number.isFinite(dRadius) ? dRadius : null,
    });
  }

  return {
    negativeLeakOverall: negAreaTotal > 0 ? leakedTotal / negAreaTotal : 0,
    negativeLeakMeanPerRegion: leakRatios.length ? leakRatios.reduce((a, b) => a + b, 0) / leakRatios.length : 0,
    negativeLeakMaxPerRegion: leakRatios.length ? Math.max(...leakRatios) : 0,
    negativeRegionsWithAnyLeak: leakRatios.filter((r) => r > NEGATIVE_LEAK_ANY_EPS).length,
    negativeLeakCount: leakRatios.filter((r) => r > NEGATIVE_LEAK_THRESHOLD).length,
    negativeLeakMaxPerRegionAll: leakRatiosAll.length ? Math.max(...leakRatiosAll) : 0,
    negativeGatedTotal: leakRatios.length,
    negativeTotal: negatives.length,
    positivePanelInstanceRecall: positives.length ? hitCount / positives.length : 0,
    positivePanelMedianIoU: median(hitIous),
    positiveHitCount: hitCount,
    positiveTotal: positives.length,
    cornerRadiusMAE: radiusErrors.length ? radiusErrors.reduce((a, b) => a + b, 0) / radiusErrors.length : 0,
    perNegative,
    perPositive,
  };
}

// --- 以降のタスクのテストはこの行の上に追記する（process.exit より下は実行されない） ---
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let failed = 0;
  const check = (label, cond, detail = "") => {
    console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (!cond) failed++;
  };
  const el = (o) => ({ parent: null, children: [], semanticHint: "panel", ...o });

  // --- guardrails: 純粋関数の単体テスト ---
  {
    const els = [
      el({ id: 1, children: [2], renderMode: "vector-panel", rect: [0, 0, 400, 300] }),
      el({ id: 2, parent: 1, renderMode: "raster", semanticHint: "image", rect: [10, 10, 100, 80] }),
    ];
    const g = guardrails(els, { width: 400, height: 300 });
    check("keptElementsPerMegapixel を計算", Math.abs(g.keptElementsPerMegapixel - 2 / 0.12) < 1e-6, String(g.keptElementsPerMegapixel));
    check("rootCount", g.rootCount === 1, String(g.rootCount));
    check("cycleCount は0(正常木)", g.cycleCount === 0);
    check("maxDepth は1(親→子1段)", g.maxDepth === 1, String(g.maxDepth));
  }

  {
    // Step 5: cap 前後を分ける。cap後だけ見ていると「押し出されただけ」を改善と誤読する。
    const kept = [el({ id: 1, renderMode: "vector-panel", rect: [0, 0, 100, 100] })];
    const raw = [
      ...kept,
      ...Array.from({ length: 5 }, (_, i) => ({ renderMode: "vector-panel", rect: [i * 20, 200, 20, 50] })),
    ];
    const g = guardrails(kept, { width: 1000, height: 1000 }, { dropped: 5, rawRegions: raw });
    check("dropped をそのまま通す", g.dropped === 5, String(g.dropped));
    check("cap後の縞スコアは0", g.stripeRunScore === 0, String(g.stripeRunScore));
    check("cap前の縞スコアは押し出された5枚を見る", g.stripeRunScoreRaw === 5, String(g.stripeRunScoreRaw));
    check("rawElementsPerMegapixel は cap 前の件数", Math.abs(g.rawElementsPerMegapixel - 6) < 1e-9, String(g.rawElementsPerMegapixel));
  }

  {
    // 高IoU重複: ほぼ同一矩形2枚
    const dup = [
      el({ id: 1, renderMode: "vector-panel", rect: [0, 0, 100, 100] }),
      el({ id: 2, renderMode: "vector-panel", rect: [2, 0, 100, 100] }),
    ];
    const g = guardrails(dup, { width: 200, height: 200 });
    check("高IoU重複を1件検出", g.highIouDuplicateCount === 1, String(g.highIouDuplicateCount));
  }

  {
    // 微小要素の比率
    const tiny = [
      el({ id: 1, renderMode: "vector-panel", rect: [0, 0, 600, 600] }),
      el({ id: 2, renderMode: "raster", semanticHint: "image", rect: [0, 0, 10, 10] }),
    ];
    const g = guardrails(tiny, { width: 600, height: 600 });
    check("微小要素比率 0.5", g.tinyFraction === 0.5, String(g.tinyFraction));
  }

  {
    // Step 2: 抜け道2。重ならない2枚は overdraw 0、包含は containment で拾う。
    const disjoint = [
      el({ id: 1, renderMode: "raster", semanticHint: "image", rect: [0, 0, 100, 100] }),
      el({ id: 2, renderMode: "raster", semanticHint: "image", rect: [100, 0, 100, 100] }),
    ];
    const g1 = guardrails(disjoint, { width: 200, height: 100 });
    check("重ならない raster は overdraw 0", g1.rasterOverdrawRatio === 0, String(g1.rasterOverdrawRatio));
    check("重ならない raster の union は画面全体", Math.abs(g1.rasterUnionAreaRatio - 1) < 1e-9, String(g1.rasterUnionAreaRatio));
    check("包含なしなら containment 0", g1.rasterContainmentCount === 0);

    // 巨大な1枚が小さい2枚を飲み込んだ形。sum=40000+2*2500=45000, union=40000
    // → overdraw = 5000/40000 = 0.125、containment は2件。
    const swallow = [
      el({ id: 1, renderMode: "raster", semanticHint: "image", rect: [0, 0, 200, 200] }),
      el({ id: 2, renderMode: "raster", semanticHint: "image", rect: [10, 10, 50, 50] }),
      el({ id: 3, renderMode: "raster", semanticHint: "image", rect: [100, 100, 50, 50] }),
    ];
    const g2 = guardrails(swallow, { width: 200, height: 200 });
    check("重なる raster の overdraw を検出", Math.abs(g2.rasterOverdrawRatio - 0.125) < 1e-9, String(g2.rasterOverdrawRatio));
    check("union は二重計上しない", Math.abs(g2.rasterUnionAreaRatio - 1) < 1e-9, String(g2.rasterUnionAreaRatio));
    // swallow[0] は画面全体(200x200)なので背景として外側から除外される → 0件
    check("全画面 raster は背景として除外", g2.rasterContainmentCount === 0, String(g2.rasterContainmentCount));
    check("背景 raster を1件と数える", g2.rasterBackgroundCount === 1, String(g2.rasterBackgroundCount));

    // 中間層が飲み込んだケースは残す（本命のシグナル）: 背景 + その上の中サイズ1枚 + 中の2枚
    const midSwallow = [
      el({ id: 1, renderMode: "raster", semanticHint: "image", rect: [0, 0, 400, 400] }),
      el({ id: 2, renderMode: "raster", semanticHint: "text", rect: [50, 50, 200, 200] }),
      el({ id: 3, renderMode: "raster", semanticHint: "text", rect: [60, 60, 40, 40] }),
      el({ id: 4, renderMode: "raster", semanticHint: "text", rect: [120, 120, 40, 40] }),
    ];
    const g3 = guardrails(midSwallow, { width: 400, height: 400 });
    check("中間層の飲み込みは残す", g3.rasterContainmentCount === 2, String(g3.rasterContainmentCount));
  }

  {
    // 循環を検出(構造的にありえないはずだが、防御ロジックとして手動でparentを壊す)
    const broken = [
      el({ id: 1, parent: 2, renderMode: "vector-panel", rect: [0, 0, 10, 10] }),
      el({ id: 2, parent: 1, renderMode: "vector-panel", rect: [0, 0, 10, 10] }),
    ];
    const g = guardrails(broken, { width: 100, height: 100 });
    check("壊れたparentの循環を検出", g.cycleCount > 0, String(g.cycleCount));
  }

  {
    // 縞スコア: 横一列に隙間なく並ぶ vector-panel 5枚
    const stripes = Array.from({ length: 5 }, (_, i) =>
      el({ id: i + 1, renderMode: "vector-panel", rect: [i * 20, 0, 20, 50] })
    );
    const g = guardrails(stripes, { width: 200, height: 50 });
    check("縞5枚が縞スコアに反映される", g.stripeRunScore === 5, String(g.stripeRunScore));

    const merged = [el({ id: 1, renderMode: "raster", semanticHint: "image", rect: [0, 0, 100, 50] })];
    const g2 = guardrails(merged, { width: 200, height: 50 });
    check("統合後は縞スコアが0", g2.stripeRunScore === 0, String(g2.stripeRunScore));
  }

  // --- zOrder / topLayerLabels ---
  {
    const els = [
      el({ id: 1, children: [2], renderMode: "vector-panel", rect: [0, 0, 100, 100], fill: "#FF0000" }),
      el({ id: 2, parent: 1, renderMode: "raster", semanticHint: "text", rect: [10, 10, 20, 20] }),
    ];
    const labels = topLayerLabels(els, { width: 100, height: 100 });
    check("パネルの画素は vector fill", labels[50 * 100 + 50] === LABEL_VECTOR_FILL);
    check("上に乗ったテキストの画素は raster", labels[15 * 100 + 15] === LABEL_RASTER);

    // 根から到達できない要素を落とさない(落とすと「描かれないので誤差ゼロ」の嘘が出る)
    const orphan = [el({ id: 1, parent: 99, renderMode: "vector-panel", rect: [0, 0, 10, 10], fill: "#00FF00" })];
    const ol = topLayerLabels(orphan, { width: 10, height: 10 });
    check("孤児要素も描画対象に含む", ol[0] === LABEL_VECTOR_FILL);

    // fill の無い vector-panel は何も描かない
    const nofill = [el({ id: 1, renderMode: "vector-panel", rect: [0, 0, 10, 10] })];
    check("fillの無いvector-panelは塗らない", topLayerLabels(nofill, { width: 10, height: 10 })[0] === LABEL_BASE);
  }

  // --- truthAlignment ---
  {
    const truth = {
      width: 200, height: 200,
      elements: [
        { label: "panel-positive", rect: [0, 0, 100, 100], expectVectorPanel: true, semanticHint: "panel", fill: "#123456", cornerRadius: 8 },
        { label: "gradient-negative", rect: [100, 0, 100, 100], expectVectorPanel: false, semanticHint: "image" },
      ],
    };
    const goodEls = [
      el({ id: 1, renderMode: "vector-panel", rect: [0, 0, 100, 100], fill: "#123456", cornerRadius: 8 }),
      el({ id: 2, renderMode: "raster", semanticHint: "image", rect: [100, 0, 100, 100] }),
    ];
    const t = truthAlignment(goodEls, truth);
    check("正しい検出: recall 1.0", t.positivePanelInstanceRecall === 1, String(t.positivePanelInstanceRecall));
    check("正しい検出: negativeへの侵食0件", t.negativeLeakCount === 0, String(t.negativeLeakCount));
    check("正しい検出: negative の vectorPanelCount は0", t.perNegative[0].vectorPanelCount === 0);
    check("正しい検出: negative の rasterCount は1", t.perNegative[0].rasterCount === 1, String(t.perNegative[0].rasterCount));
    check("cornerRadiusMAE 0", t.cornerRadiusMAE === 0, String(t.cornerRadiusMAE));

    // 抜け道1「全部 raster」— 見た目は完璧だが recall が 0 になる
    const allRaster = [
      el({ id: 1, renderMode: "raster", semanticHint: "image", rect: [0, 0, 100, 100] }),
      el({ id: 2, renderMode: "raster", semanticHint: "image", rect: [100, 0, 100, 100] }),
    ];
    const tAll = truthAlignment(allRaster, truth);
    check("抜け道1: 全部rasterはleak 0", tAll.negativeLeakOverall === 0, String(tAll.negativeLeakOverall));
    check("抜け道1: 全部rasterはrecall 0", tAll.positivePanelInstanceRecall === 0, String(tAll.positivePanelInstanceRecall));

    // 2枚を1枚に融合した失敗 — 面積被覆では見えないが instance recall なら落ちる
    const twoCards = {
      width: 200, height: 100,
      elements: [
        { label: "a", rect: [0, 0, 100, 100], expectVectorPanel: true, semanticHint: "panel", fill: "#111111", cornerRadius: 0 },
        { label: "b", rect: [100, 0, 100, 100], expectVectorPanel: true, semanticHint: "panel", fill: "#111111", cornerRadius: 0 },
      ],
    };
    const fused = [el({ id: 1, renderMode: "vector-panel", rect: [0, 0, 200, 100], fill: "#111111", cornerRadius: 0 })];
    const tF = truthAlignment(fused, twoCards);
    check("融合失敗: recall が 0 に落ちる", tF.positivePanelInstanceRecall === 0, String(tF.positivePanelInstanceRecall));

    // 塗りが別物なら hit にしない
    const wrongFill = [el({ id: 1, renderMode: "vector-panel", rect: [0, 0, 100, 100], fill: "#FF0000", cornerRadius: 8 })];
    check("塗りが違えば hit にしない", truthAlignment(wrongFill, truth).positivePanelInstanceRecall === 0);

    // 過検出: negative を飲み込む vector-panel
    const badEls = [el({ id: 1, renderMode: "vector-panel", rect: [0, 0, 200, 100], fill: "#123456" })];
    const t2 = truthAlignment(badEls, truth);
    check("過検出: 侵食を1件検出", t2.negativeLeakCount === 1, String(t2.negativeLeakCount));
    check("過検出: MaxPerRegion がほぼ1.0", t2.negativeLeakMaxPerRegion > 0.9, String(t2.negativeLeakMaxPerRegion));
    check("過検出: RegionsWithAnyLeak 1", t2.negativeRegionsWithAnyLeak === 1, String(t2.negativeRegionsWithAnyLeak));

    // Step 4 の核心: 正当なパネルの上に raster が正しく乗っているケースを leak にしない
    const nested = {
      width: 200, height: 100,
      elements: [
        { label: "header", rect: [0, 0, 200, 100], expectVectorPanel: true, semanticHint: "panel", fill: "#222222", cornerRadius: 0 },
        { label: "title-text", rect: [10, 10, 60, 20], expectVectorPanel: false, semanticHint: "text" },
      ],
    };
    const nestedEls = [
      el({ id: 1, children: [2], renderMode: "vector-panel", rect: [0, 0, 200, 100], fill: "#222222", cornerRadius: 0 }),
      el({ id: 2, parent: 1, renderMode: "raster", semanticHint: "text", rect: [10, 10, 60, 20] }),
    ];
    const tN = truthAlignment(nestedEls, nested);
    check("入れ子のテキストは leak にしない(最前面判定)", tN.negativeLeakMaxPerRegion === 0, String(tN.negativeLeakMaxPerRegion));
    check("入れ子でも positive recall は保つ", tN.positivePanelInstanceRecall === 1, String(tN.positivePanelInstanceRecall));

    // 逆に、テキストの上まで panel が覆いかぶさっていれば leak として出ること
    const buriedEls = [
      el({ id: 1, renderMode: "vector-panel", rect: [0, 0, 200, 100], fill: "#222222", cornerRadius: 0 }),
    ];
    check("テキストが panel に埋もれれば leak 1.0",
      truthAlignment(buriedEls, nested).negativeLeakMaxPerRegion === 1,
      String(truthAlignment(buriedEls, nested).negativeLeakMaxPerRegion));
  }

  // --- reconstructionStats: 実ブラウザ上で往復させる ---
  const host = new RiveHost(PAGE_SCRIPT);
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150">
      <rect width="200" height="150" fill="#1E1E2E"/>
      <rect x="20" y="20" width="80" height="40" fill="#6C7BFF"/>
    </svg>`;
    const png = await host.rasterize(svg);

    // 完全に正しい再構成(元と同じ矩形・同じ色) → 誤差はほぼ0
    // children を正しく張らないとDFS(pre-order)がid2を辿らず描かれないので、
    // buildTree が実際に返す形と同じく parent/children を両方向とも埋めること。
    const perfectEls = [
      el({ id: 1, children: [2], renderMode: "vector-panel", rect: [0, 0, 200, 150], fill: "#1E1E2E" }),
      el({ id: 2, parent: 1, renderMode: "vector-panel", rect: [20, 20, 80, 40], fill: "#6C7BFF" }),
    ];
    const good = await reconstructionStats(host, png, perfectEls);
    check("完全な再構成はMAEがほぼ0", good.mae < 0.01, String(good.mae));
    check("完全な再構成は p99 もほぼ0", good.p99 < 0.02, String(good.p99));
    check("ベクター被覆率を返す", good.vectorPixelRatio === 1, String(good.vectorPixelRatio));

    // 誤った色で塗った再構成 → 誤差が明確に増える
    const wrongColorEls = [
      el({ id: 1, children: [2], renderMode: "vector-panel", rect: [0, 0, 200, 150], fill: "#1E1E2E" }),
      el({ id: 2, parent: 1, renderMode: "vector-panel", rect: [20, 20, 80, 40], fill: "#FF0000" }),
    ];
    const wrong = await reconstructionStats(host, png, wrongColorEls);
    check("誤った色の再構成はMAEが増える", wrong.mae > good.mae, `good=${good.mae} wrong=${wrong.mae}`);
    // 80x40=3200px / 30000px = 10.7% が壊れている → p95 は明確に大きい。
    // これが「global mean だけでは局所事故が見えない」を塞ぐ根拠。
    check("局所的な破壊は p95 に出る", wrong.p95 > 0.1, `p95=${wrong.p95} mae=${wrong.mae}`);

    // 要素0件(何も描かない=baseそのまま) → 誤差は0(baseを消していないため)
    const empty = await reconstructionStats(host, png, []);
    check("要素0件でもbaseは残るのでMAEはほぼ0", empty.mae < 0.01, String(empty.mae));
    check("要素0件ならベクター被覆は0", empty.vectorPixelRatio === 0, String(empty.vectorPixelRatio));
  } finally {
    await host.close();
  }

  process.exit(failed ? 1 : 0);
}
