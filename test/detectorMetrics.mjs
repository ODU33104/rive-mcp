// Task 10 計測ハーネス: 再構成誤差・guardrail 指標・正解データとの突き合わせ。
// このファイルはUI検出器の挙動を「変更」しない。以降のタスク(11〜)が自分の変更の
// 効果を数値で示すために使う土台。閾値は名前付き定数にして根拠をここに書く
// （「妥当そうな値」ではなく実測/設計上の理由がある値だけを使う）。
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

// ---- Step 2: 再構成誤差 ------------------------------------------------------

/**
 * 検出結果から「アニメーション最終状態」の静止画を合成し直し、元画像と画素比較する。
 * 重ね順・vector-panel/raster の描き分けは uiPrototype.ts の buildPrototypeScene と
 * 同じ規則をここで複製している(src/ は変更しないため)。この複製を保守する場合は
 * 両者を同時に見ること — ロジックがずれると誤差の意味が変わる。
 *
 * 誤差の定義: 再合成画像と元画像のRGB各チャンネル絶対差の平均(0〜1に正規化=MAE/255)。
 * RMSE ではなく MAE を選んだ理由: 少数の激しく壊れた画素(例: 単色矩形が写真を覆う)と
 * 多数の小さな画素誤差(アンチエイリアシング境界など)を人間の「見た目の破綻」の感覚に
 * 近い比率で足し合わせたいため。RMSEは外れ値(＝派手な破綻)を過大評価し、
 * 逆に「32本の縞でグラデーションを近似した」ような広い範囲の中程度の誤差を過小評価する
 * (二乗により小さい誤差がさらに小さくなる)。MAEは両者をほぼ線形に扱うので、
 * 「グラデーションを縞で潰した」ケースでも guardrail 抜きである程度の兆候を残せる。
 *
 * ただしこれだけでは不十分（ブリーフの通り）。32本の平坦な縞は元のグラデーションと
 * 色味が近ければ MAE 上は小さく出る。過検出そのものを検出するのは guardrails/
 * truthAlignment の役目なので、この関数の結果を唯一の合否基準にしないこと。
 *
 * host: RiveHost（既に起動済みの canvas-advanced ページを持つ）。rasterize/detectUiRegions
 * と同じ Playwright page 上で合成・比較まで行うことで、PNGデコーダを別途Node側に
 * 持ち込まずに済む(brief の型は reconstructionError(png, elements) だが、canvas 実行には
 * ライブページが要るため host を第一引数に追加した)。
 */
export async function reconstructionError(host, sourcePng, elements) {
  const page = await host.getPage();
  const srcB64 = Buffer.isBuffer(sourcePng) ? sourcePng.toString("base64") : sourcePng;
  const result = await page.evaluate(
    async ({ srcB64, elements }) => {
      function b64ToBytes(b64) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
      }
      const bitmap = await createImageBitmap(new Blob([b64ToBytes(srcB64)], { type: "image/png" }));
      const W = bitmap.width, H = bitmap.height;

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
      // base: 元画像全面。uiPrototype.ts の sliceImage/attachRasterAssets は
      // fill を持つ vector-panel の元画素を base から消さない(不透明な塗りが常に
      // 上に乗るため)。ここでも同じ前提で「base を切り欠かず、上に重ねるだけ」にする。
      ctx.drawImage(bitmap, 0, 0);

      // z順: uiPrototype.ts buildPrototypeScene と同じ規則(親なし要素をy,x順に並べ、
      // 深さ優先(pre-order)でzを振る)を複製する。
      const byId = new Map(elements.map((e) => [e.id, e]));
      const roots = elements
        .filter((e) => e.parent === null)
        .sort((a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0]);
      const ordered = [];
      const visit = (e) => {
        ordered.push(e);
        for (const cid of e.children) {
          const c = byId.get(cid);
          if (c) visit(c);
        }
      };
      roots.forEach(visit);

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
          // クランプは念のため(画面外にはみ出た矩形を渡された場合の防御)。
          const sx = Math.max(0, Math.min(W, x));
          const sy = Math.max(0, Math.min(H, y));
          const sw = Math.max(0, Math.min(W - sx, w));
          const sh = Math.max(0, Math.min(H - sy, h));
          if (sw > 0 && sh > 0) ctx.drawImage(bitmap, sx, sy, sw, sh, sx, sy, sw, sh);
        }
        // fill の無い vector-panel(資格はあるが未確定)は何も描かない。base がそのまま残る。
      }

      const reconData = ctx.getImageData(0, 0, W, H).data;
      let sum = 0;
      for (let i = 0; i < srcData.length; i += 4) {
        sum +=
          Math.abs(reconData[i] - srcData[i]) +
          Math.abs(reconData[i + 1] - srcData[i + 1]) +
          Math.abs(reconData[i + 2] - srcData[i + 2]);
      }
      const mae = sum / (W * H * 3 * 255);
      return { mae, width: W, height: H };
    },
    { srcB64, elements }
  );
  return result.mae;
}

// ---- Step 3: 安価な guardrail 指標 -------------------------------------------

// 44px は Apple/Material のタップ領域下限(このリポジトリの design 系メモリでも同じ基準を
// 使っている)。20x20=400px^2 はその半分以下で、意図的なUI要素としてはまず小さすぎる
// サイズ。detectUiRegions の panel/image 経路は minArea(既定576px^2)未満を最初から
// 捨てるので、これより小さい要素が残るのはテキスト行(最小 w>=8,h>=6)経由のみ —
// 将来のタスクでテクスチャ分割等がここに非テキストの小片を送り込むかを見張るための閾値。
export const TINY_AREA_PX = 400;

// 0.9 = ほぼ同一矩形。uiDetect.mjs の回帰テスト(Bug1: 100x100を2pxオフセットした2枚)の
// 実測IoUが0.96前後だったため、正常な親子包含(子が親よりずっと小さい→IoUは低い)を
// 誤検出しない範囲で「同一検出の重複」を拾える値としてこれを採用した。
export const IOU_DUP_THRESHOLD = 0.9;

// グラデーション縞スコア: 量子化された同色バケットの帯は、同じ行/列に沿って
// ほぼ隙間なく(2px以内)連続する。3個以上の連続を「縞」とみなす(brief の定義通り)。
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
 * グラデーション縞スコア = 「同じ行/列に沿って3個以上連続で隙間なく並ぶ vector-panel の
 * 総数」。Task 11 のstripe統合が効けば、同じシーンでこの数値は激減するはず(1本の帯に
 * 統合されれば連続数は1に戻る)。横方向・縦方向を両方数える(縦グラデーションもあるため)。
 * 同じ要素が横グループにも縦グループにも稀に二重計上され得るが、guardrail としては
 * 「悪化/改善の方向」が分かれば十分なので許容する。
 */
function computeStripeScore(elements) {
  const candidates = elements.filter((e) => e.renderMode === "vector-panel");
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
 * id降順の構造的な保証(親のidは常に子より小さい)で循環が起きない設計になっているが、
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
 * 安価な guardrail 指標一式。「全要素面積の合計 ÷ 画面面積」は入れ子(親子が同じ領域を
 * 二重に占める)と重なりで意味が安定しないため、意図的に primary 指標から外している
 * (brief の指示通り)。
 */
export function guardrails(elements, sourceSize, dropped = 0) {
  const { width, height } = sourceSize;
  const n = elements.length;
  const megapixels = Math.max(1e-9, (width * height) / 1_000_000);

  const tinyCount = elements.filter((e) => areaOf(e.rect) < TINY_AREA_PX).length;

  const rasterEls = elements.filter((e) => e.renderMode === "raster");
  let rasterOverlapArea = 0;
  for (let i = 0; i < rasterEls.length; i++) {
    for (let j = i + 1; j < rasterEls.length; j++) {
      rasterOverlapArea += intersectArea(rasterEls[i].rect, rasterEls[j].rect);
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
    elementsPerMegapixel: n / megapixels,
    dropped,
    tinyFraction: n ? tinyCount / n : 0,
    rasterOverlapAreaRatio: width * height > 0 ? rasterOverlapArea / (width * height) : 0,
    highIouDuplicateCount,
    gradientBandScore: computeStripeScore(elements),
    rootCount: elements.filter((e) => e.parent === null).length,
    cycleCount,
    maxDepth,
  };
}

// ---- 正解データとの突き合わせ(baseline生成でのみ使う。guardrailsとは別枠) --------------

// 0.1 = negative領域の10%でも不透明な vector-panel の塗りに覆われれば、非対称損失
// (見た目が壊れる側)の観点では「侵食された」とみなすべき、という保守的な値。
// 0%(=1px でも重なれば違反)にしなかったのは、bbox境界の丸め誤差(±1〜2px)による
// ノイズをそのまま違反件数に混ぜないため。
export const NEGATIVE_LEAK_THRESHOLD = 0.1;
// 0.5 = positive領域の半分以上が vector-panel として捕捉されていれば「概ね拾えている」
// とみなす。カードは子要素(穴)を持つため100%一致は最初から期待できない。
export const POSITIVE_COVER_THRESHOLD = 0.5;

/**
 * 合成シーンの正解(truth)と検出結果(elements)を突き合わせ、
 * 「negativeをどれだけ誤ってvector-panel化したか」「positiveをどれだけ拾えたか」を返す。
 * guardrails() とは独立: guardrails は正解データ無しでも計算できる安価な指標、
 * こちらは synth.mjs の正解データがある場合だけ計算できる直接的な精度指標。
 */
export function truthAlignment(elements, truth) {
  const vectorEls = elements.filter((e) => e.renderMode === "vector-panel");
  const negatives = truth.elements.filter((e) => !e.expectVectorPanel);
  const positives = truth.elements.filter((e) => e.expectVectorPanel);

  let leakRatioSum = 0;
  let negativeLeakCount = 0;
  const perNegative = [];
  for (const neg of negatives) {
    let leaked = 0;
    for (const e of vectorEls) leaked += intersectArea(e.rect, neg.rect);
    const ratio = areaOf(neg.rect) > 0 ? Math.min(1, leaked / areaOf(neg.rect)) : 0;
    leakRatioSum += ratio;
    if (ratio > NEGATIVE_LEAK_THRESHOLD) negativeLeakCount++;
    perNegative.push({ label: neg.label, leakRatio: ratio });
  }

  let positiveCoverCount = 0;
  const perPositive = [];
  for (const pos of positives) {
    let best = 0;
    for (const e of vectorEls) {
      const ratio = areaOf(pos.rect) > 0 ? intersectArea(e.rect, pos.rect) / areaOf(pos.rect) : 0;
      if (ratio > best) best = ratio;
    }
    const covered = best >= POSITIVE_COVER_THRESHOLD;
    if (covered) positiveCoverCount++;
    perPositive.push({ label: pos.label, bestCoverRatio: Math.min(1, best) });
  }

  return {
    negativeLeakAreaRatioMean: negatives.length ? leakRatioSum / negatives.length : 0,
    negativeLeakCount,
    negativeTotal: negatives.length,
    positiveCoverCount,
    positiveTotal: positives.length,
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

  // --- guardrails: 純粋関数の単体テスト ---
  {
    const els = [
      { id: 1, parent: null, children: [2], renderMode: "vector-panel", semanticHint: "panel", rect: [0, 0, 400, 300] },
      { id: 2, parent: 1, children: [], renderMode: "raster", semanticHint: "image", rect: [10, 10, 100, 80] },
    ];
    const g = guardrails(els, { width: 400, height: 300 }, 0);
    check("elementsPerMegapixel を計算", Math.abs(g.elementsPerMegapixel - 2 / 0.12) < 1e-6, String(g.elementsPerMegapixel));
    check("dropped をそのまま通す", g.dropped === 0);
    check("rootCount", g.rootCount === 1, String(g.rootCount));
    check("cycleCount は0(正常木)", g.cycleCount === 0);
    check("maxDepth は1(親→子1段)", g.maxDepth === 1, String(g.maxDepth));
  }

  {
    // 高IoU重複: ほぼ同一矩形2枚
    const dup = [
      { id: 1, parent: null, children: [], renderMode: "vector-panel", semanticHint: "panel", rect: [0, 0, 100, 100] },
      { id: 2, parent: null, children: [], renderMode: "vector-panel", semanticHint: "panel", rect: [2, 0, 100, 100] },
    ];
    const g = guardrails(dup, { width: 200, height: 200 }, 0);
    check("高IoU重複を1件検出", g.highIouDuplicateCount === 1, String(g.highIouDuplicateCount));
  }

  {
    // 微小要素の比率
    const tiny = [
      { id: 1, parent: null, children: [], renderMode: "vector-panel", semanticHint: "panel", rect: [0, 0, 600, 600] },
      { id: 2, parent: null, children: [], renderMode: "raster", semanticHint: "image", rect: [0, 0, 10, 10] },
    ];
    const g = guardrails(tiny, { width: 600, height: 600 }, 0);
    check("微小要素比率 0.5", g.tinyFraction === 0.5, String(g.tinyFraction));
  }

  {
    // 循環を検出(構造的にありえないはずだが、防御ロジックとして手動でparentを壊す)
    const broken = [
      { id: 1, parent: 2, children: [], renderMode: "vector-panel", semanticHint: "panel", rect: [0, 0, 10, 10] },
      { id: 2, parent: 1, children: [], renderMode: "vector-panel", semanticHint: "panel", rect: [0, 0, 10, 10] },
    ];
    const g = guardrails(broken, { width: 100, height: 100 }, 0);
    check("壊れたparentの循環を検出", g.cycleCount > 0, String(g.cycleCount));
  }

  {
    // グラデーション縞スコア: 横一列に隙間なく並ぶ vector-panel 5枚
    const stripes = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1, parent: null, children: [],
      renderMode: "vector-panel", semanticHint: "panel", rect: [i * 20, 0, 20, 50],
    }));
    const g = guardrails(stripes, { width: 200, height: 50 }, 0);
    check("縞5枚が縞スコアに反映される", g.gradientBandScore === 5, String(g.gradientBandScore));

    // 統合後(1枚のラスタ)は縞スコアが0に戻る
    const merged = [{ id: 1, parent: null, children: [], renderMode: "raster", semanticHint: "image", rect: [0, 0, 100, 50] }];
    const g2 = guardrails(merged, { width: 200, height: 50 }, 0);
    check("統合後は縞スコアが0", g2.gradientBandScore === 0, String(g2.gradientBandScore));
  }

  // --- truthAlignment: 正解との突き合わせ ---
  {
    const truth = {
      width: 200, height: 200,
      elements: [
        { label: "panel-positive", rect: [0, 0, 100, 100], expectVectorPanel: true, semanticHint: "panel" },
        { label: "gradient-negative", rect: [100, 0, 100, 100], expectVectorPanel: false, semanticHint: "image" },
      ],
    };
    const goodEls = [
      { id: 1, parent: null, children: [], renderMode: "vector-panel", semanticHint: "panel", rect: [0, 0, 100, 100] },
      { id: 2, parent: null, children: [], renderMode: "raster", semanticHint: "image", rect: [100, 0, 100, 100] },
    ];
    const t = truthAlignment(goodEls, truth);
    check("正しい検出: positiveを1件捕捉", t.positiveCoverCount === 1, String(t.positiveCoverCount));
    check("正しい検出: negativeへの侵食0件", t.negativeLeakCount === 0, String(t.negativeLeakCount));

    const badEls = [
      { id: 1, parent: null, children: [], renderMode: "vector-panel", semanticHint: "panel", rect: [0, 0, 200, 100] }, // negativeまで飲み込む
    ];
    const t2 = truthAlignment(badEls, truth);
    check("過検出: negativeへの侵食を1件検出", t2.negativeLeakCount === 1, String(t2.negativeLeakCount));
    check("過検出: 侵食率がほぼ1.0", t2.perNegative[0].leakRatio > 0.9, String(t2.perNegative[0].leakRatio));
  }

  // --- reconstructionError: 実ブラウザ上で往復させる ---
  const host = new RiveHost(PAGE_SCRIPT);
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150">
      <rect width="200" height="150" fill="#1E1E2E"/>
      <rect x="20" y="20" width="80" height="40" fill="#6C7BFF"/>
    </svg>`;
    const png = await host.rasterize(svg);

    // 完全に正しい再構成(元と同じ矩形・同じ色) → 誤差はほぼ0
    // children を正しく張らないとDFS(pre-order)がid2を辿らず描かれない(z順複製ロジックの
    // 前提)ので、buildTree が実際に返す形と同じく parent/children を両方向とも埋めること。
    const perfectEls = [
      { id: 1, parent: null, children: [2], renderMode: "vector-panel", semanticHint: "panel", rect: [0, 0, 200, 150], fill: "#1E1E2E" },
      { id: 2, parent: 1, children: [], renderMode: "vector-panel", semanticHint: "panel", rect: [20, 20, 80, 40], fill: "#6C7BFF" },
    ];
    const maeGood = await reconstructionError(host, png, perfectEls);
    check("完全な再構成はMAEがほぼ0", maeGood < 0.01, String(maeGood));

    // 誤った色で塗った再構成 → 誤差が明確に増える
    const wrongColorEls = [
      { id: 1, parent: null, children: [2], renderMode: "vector-panel", semanticHint: "panel", rect: [0, 0, 200, 150], fill: "#1E1E2E" },
      { id: 2, parent: 1, children: [], renderMode: "vector-panel", semanticHint: "panel", rect: [20, 20, 80, 40], fill: "#FF0000" },
    ];
    const maeWrong = await reconstructionError(host, png, wrongColorEls);
    check("誤った色の再構成はMAEが増える", maeWrong > maeGood, `good=${maeGood} wrong=${maeWrong}`);

    // 要素0件(何も描かない=baseそのまま) → 誤差は0(baseを消していないため)
    const maeEmpty = await reconstructionError(host, png, []);
    check("要素0件でもbaseは残るのでMAEはほぼ0", maeEmpty < 0.01, String(maeEmpty));
  } finally {
    await host.close();
  }

  process.exit(failed ? 1 : 0);
}
