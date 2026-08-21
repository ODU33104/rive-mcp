// 決定的な合成シーン生成器（Task 10 計測ハーネス）。
// 目的は「検出器が壊しやすい種類の入力」を正解つきで再現性ある形に固定すること。
// Math.random() は禁止（実行のたびに変わると baseline.json との比較が成立しない）。
// 代わりに Numerical Recipes 系の線形合同法(LCG)を使う: 32bit 乗算加算 → 状態を
// そのまま [0,1) に正規化するだけの最小構成で、暗号強度は不要（テストフィクスチャ用途）。
function makeRng(seed) {
  let state = seed >>> 0;
  return function rng() {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const pick = (rng, min, max) => min + rng() * (max - min);

// HSL -> #RRGGBB。合成シーンの色は「役割ごとに離れた色相帯」から選ぶことで、
// detectUiRegions の5bit量子化(パーチャンネル8バケット)が隣接要素を誤って同一色成分に
// 混ぜないようにする（色相帯を55°以上離しておけば量子化バケットは必ず割れる）。
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.min(100, Math.max(0, s)) / 100;
  l = Math.min(100, Math.max(0, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to255 = (v) => Math.round((v + m) * 255);
  const hex = (v) => v.toString(16).padStart(2, "0");
  return "#" + hex(to255(r)) + hex(to255(g)) + hex(to255(b));
}

// テキストの厳密なグリフ境界は環境依存(フォントメトリクス)なので測れない。
// sans-serif の平均字幅 0.58em ・ ascent 0.8em ・ descent 0.25em という粗い近似で
// bbox を出す。用途は「vector-panel が文字領域を侵食していないか」の緩い判定だけなので、
// 数px のズレは許容範囲(truthAlignment 側のしきい値で吸収する)。
function textBBox(x, yBaseline, text, fontSize) {
  const w = Math.max(8, Math.round(text.length * fontSize * 0.58));
  const ascent = fontSize * 0.8;
  const descent = fontSize * 0.25;
  return [Math.round(x), Math.round(yBaseline - ascent), w, Math.round(ascent + descent)];
}

const WORD_LIST = [
  "Revenue", "Signups", "Active", "Pending", "Overview",
  "Insights", "Summary", "Traffic", "Errors", "Latency",
];

const W = 760;
const H = 520;

/**
 * seed から決定的に1シーンを作る。同じ seed なら常に同じ svg/truth を返す。
 * シーンは検出器の6つの既知の破綻源すべてを1枚に混在させる:
 *   平らな矩形/角丸矩形・穴あきカード(positive) / グラデーション帯・写真調ノイズ(negative)
 *   / 文字断片列(negative=vector-panel化してはいけない) / 区切り線(positive)
 * negative を含めない正解データは過検出を検出できない(ブリーフの核心)ので、
 * このシーンは常に positive 6件・negative 4件を含む構成で固定している。
 */
export function generateScene(seed, opts = {}) {
  // pixelScale: SVG の viewBox は 760x520 のまま、出力ピクセル寸法だけを倍にする。
  // 目的は検出器の**縮小経路を踏ませること**。detectUiRegions は workingMax(既定1280)を
  // 超える画像を縮小して解析し、結果を inv 倍して元座標へ戻す。760x520 のシーンだけでは
  // scale が常に厳密に 1 になり、この座標変換が一度も実行されない。
  // このコードベースは既に座標系のバグを2件出しているので、未実行の経路を残さない。
  const pixelScale = opts.pixelScale ?? 1;
  const S = (v) => Math.round(v * pixelScale);
  const SR = (r) => [S(r[0]), S(r[1]), S(r[2]), S(r[3])];
  const rng = makeRng(seed);

  const bgColor = hslToHex(210 + pick(rng, -10, 10), 12 + pick(rng, 0, 6), 96);
  const headerColor = hslToHex(210 + pick(rng, -15, 15), 55 + pick(rng, 0, 15), 28 + pick(rng, 0, 8));
  const cardColor = hslToHex(255 + pick(rng, -15, 15), 35 + pick(rng, 0, 10), 30 + pick(rng, 0, 6));
  const buttonColor = hslToHex(28 + pick(rng, -10, 10), 75 + pick(rng, 0, 10), 55 + pick(rng, 0, 8));
  const tileAColor = hslToHex(150 + pick(rng, -10, 10), 45 + pick(rng, 0, 10), 60 + pick(rng, 0, 6));
  const tileBColor = hslToHex(330 + pick(rng, -10, 10), 55 + pick(rng, 0, 10), 62 + pick(rng, 0, 6));
  const dividerColor = "#C7CCD6"; // 区切り線は常に固定の中立グレー(意味的にニュートラルな要素なので揺らす理由がない)

  const header = { rect: [24, 24, 712, 64], cornerRadius: 10, fill: headerColor };
  const card = { rect: [24, 112, 320, 208], cornerRadius: 12, fill: cardColor };
  // card の中に別色の button を置く = 「子要素で穴を開けられたカード」。
  // CC ベースの検出器では card の連結成分は button の面積ぶん fillRatio が下がるが、
  // それでも vector-panel であるべき、というのがこの要素の正解データとしての価値。
  const cardButton = { rect: [48, 266, 120, 36], cornerRadius: 8, fill: buttonColor };
  const tileA = { rect: [368, 112, 150, 96], cornerRadius: 6, fill: tileAColor };
  const tileB = { rect: [534, 112, 200, 96], cornerRadius: 6, fill: tileBColor };
  const divider = { rect: [24, 472, 712, 2], fill: dividerColor };

  // グラデーション帯: 4 stop・色相をばらけさせて量子化器が確実に複数バケットへ割る
  // ようにする(negative: 縞に割れても vector-panel であってはならない)
  const gradStops = Array.from({ length: 4 }, (_, i) => ({
    offset: i / 3,
    color: hslToHex(pick(rng, 0, 360), 65, 55),
  }));
  const gradientRect = [24, 336, 712, 56];

  // 写真調ノイズ: feTurbulence(fractalNoise)。baseFrequency を低め(0.03〜0.08)に
  // 取ると、本物の写真にありがちな「局所的になめらかな塊」が生まれる。これは
  // 検出器の量子化+連結成分が最も誤ってpanel扱いしやすいケースを意図的に作っている
  // (バンドを細かくしすぎると逆にnegativeとして自明に安全になり測定の意味が薄れる)。
  const noiseSeed = Math.floor(pick(rng, 0, 900));
  const noiseFreq = (0.03 + pick(rng, 0, 0.05)).toFixed(3);
  // 高さ 100(y=232..332)。**グラデーション帯(y=336..392)と重ねてはいけない。**
  // 当初は 120(y=232..352)で 16px 重なっており、noise の leak 0.045〜0.116 は
  // すべて gradient 縞の食い込みで、noise 自身の過検出は 0 だった(2026-08-21 実測)。
  // negative 同士が重なると「どちらの失敗か」が数値から判定できなくなる。
  const noiseRect = [368, 232, 200, 100];

  const titleWord = WORD_LIST[Math.floor(pick(rng, 0, WORD_LIST.length))];
  const titleFontSize = Math.round(pick(rng, 16, 20));
  const titleX = 44;
  const titleBaseline = 24 + 64 / 2 + titleFontSize * 0.35;

  const numberWord = String(Math.floor(pick(rng, 100, 999)));
  const numberFontSize = Math.round(pick(rng, 24, 30));
  const numberX = 388;
  const numberBaseline = 160;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S(W)}" height="${S(H)}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="grad" x1="0" y1="0" x2="1" y2="0">
      ${gradStops.map((s) => `<stop offset="${s.offset}" stop-color="${s.color}"/>`).join("\n      ")}
    </linearGradient>
    <filter id="noise" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="${noiseFreq}" numOctaves="3" seed="${noiseSeed}" result="n"/>
      <feColorMatrix in="n" type="saturate" values="0.6"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="${bgColor}"/>
  <rect x="${header.rect[0]}" y="${header.rect[1]}" width="${header.rect[2]}" height="${header.rect[3]}" rx="${header.cornerRadius}" fill="${header.fill}"/>
  <text x="${titleX}" y="${titleBaseline}" font-family="Arial, sans-serif" font-size="${titleFontSize}" fill="#FFFFFF">${titleWord}</text>
  <rect x="${card.rect[0]}" y="${card.rect[1]}" width="${card.rect[2]}" height="${card.rect[3]}" rx="${card.cornerRadius}" fill="${card.fill}"/>
  <rect x="${cardButton.rect[0]}" y="${cardButton.rect[1]}" width="${cardButton.rect[2]}" height="${cardButton.rect[3]}" rx="${cardButton.cornerRadius}" fill="${cardButton.fill}"/>
  <rect x="${tileA.rect[0]}" y="${tileA.rect[1]}" width="${tileA.rect[2]}" height="${tileA.rect[3]}" rx="${tileA.cornerRadius}" fill="${tileA.fill}"/>
  <text x="${numberX}" y="${numberBaseline}" font-family="Arial, sans-serif" font-size="${numberFontSize}" fill="#12151C">${numberWord}</text>
  <rect x="${tileB.rect[0]}" y="${tileB.rect[1]}" width="${tileB.rect[2]}" height="${tileB.rect[3]}" rx="${tileB.cornerRadius}" fill="${tileB.fill}"/>
  <rect x="${noiseRect[0]}" y="${noiseRect[1]}" width="${noiseRect[2]}" height="${noiseRect[3]}" fill="#888888" filter="url(#noise)"/>
  <rect x="${gradientRect[0]}" y="${gradientRect[1]}" width="${gradientRect[2]}" height="${gradientRect[3]}" fill="url(#grad)"/>
  <rect x="${divider.rect[0]}" y="${divider.rect[1]}" width="${divider.rect[2]}" height="${divider.rect[3]}" fill="${divider.fill}"/>
</svg>`;

  // positive には fill と cornerRadius も持たせる(Task 11 Step 1)。
  // instance recall の hit 条件は IoU だけでは足りない —「位置は合っているが
  // 色も角丸も別物」を hit と数えてしまい、抜け道1 を塞げなくなる。
  const truth = {
    width: S(W),
    height: S(H),
    pixelScale,
    elements: [
      { label: "header", rect: SR(header.rect), expectVectorPanel: true, semanticHint: "panel", fill: header.fill, cornerRadius: S(header.cornerRadius) },
      { label: "card", rect: SR(card.rect), expectVectorPanel: true, semanticHint: "panel", fill: card.fill, cornerRadius: S(card.cornerRadius) },
      { label: "card-button", rect: SR(cardButton.rect), expectVectorPanel: true, semanticHint: "panel", fill: cardButton.fill, cornerRadius: S(cardButton.cornerRadius) },
      { label: "tileA", rect: SR(tileA.rect), expectVectorPanel: true, semanticHint: "panel", fill: tileA.fill, cornerRadius: S(tileA.cornerRadius) },
      { label: "tileB", rect: SR(tileB.rect), expectVectorPanel: true, semanticHint: "panel", fill: tileB.fill, cornerRadius: S(tileB.cornerRadius) },
      { label: "divider", rect: SR(divider.rect), expectVectorPanel: true, semanticHint: "line", fill: divider.fill, cornerRadius: 0 },
      // --- negative: vector-panel であってはならない ---
      // leakGate: 面積 leak を**合否判定(P0 gate)に使ってよいか**。
      // テキストの2件は false。textBBox() のフォントメトリクス近似は実測で過大評価だった
      // (2026-08-21: GT "Revenue"/17px が 69x18 に対し、実際のグリフ矩形は 61x12)。
      // 余った縁は正当な header パネルの塗りなので leak として数えられてしまい、
      // **指標の作り物**が gate に混ざる。矩形が画素厳密な noise/gradient だけを gate に使う。
      // テキストの過剰ベクター化は面積ではなく perNegative[].vectorPanelCount で見ること
      // (こちらは近似に影響されない)。
      { label: "title-text", rect: SR(textBBox(titleX, titleBaseline, titleWord, titleFontSize)), expectVectorPanel: false, semanticHint: "text", leakGate: false },
      { label: "number-text", rect: SR(textBBox(numberX, numberBaseline, numberWord, numberFontSize)), expectVectorPanel: false, semanticHint: "text", leakGate: false },
      { label: "noise-texture", rect: SR(noiseRect), expectVectorPanel: false, semanticHint: "image", leakGate: true },
      { label: "gradient-band", rect: SR(gradientRect), expectVectorPanel: false, semanticHint: "image", leakGate: true },
    ],
  };

  return { svg, truth };
}

// --- 以降のタスクのテストはこの行の上に追記する（process.exit より下は実行されない） ---
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let failed = 0;
  const check = (label, cond, detail = "") => {
    console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (!cond) failed++;
  };

  const a1 = generateScene(1);
  const a2 = generateScene(1);
  const b1 = generateScene(2);
  check("同じseedは同じsvgを返す(決定的)", a1.svg === a2.svg);
  check("同じseedは同じtruthを返す(決定的)", JSON.stringify(a1.truth) === JSON.stringify(a2.truth));
  check("異なるseedは異なるsvgを返す", a1.svg !== b1.svg);

  const positives = a1.truth.elements.filter((e) => e.expectVectorPanel);
  const negatives = a1.truth.elements.filter((e) => !e.expectVectorPanel);
  check("positive(vector-panel であるべき)を含む", positives.length > 0, String(positives.length));
  check("negative(vector-panel であってはならない)を含む", negatives.length > 0, String(negatives.length));
  check("negativeにグラデーション帯を含む", negatives.some((e) => e.label === "gradient-band"));
  check("negativeに写真調ノイズを含む", negatives.some((e) => e.label === "noise-texture"));

  // negative 同士が重なると leak の帰属が決まらない(回帰防止)
  for (let i = 0; i < negatives.length; i++) {
    for (let j = i + 1; j < negatives.length; j++) {
      const [ax, ay, aw, ah] = negatives[i].rect;
      const [bx, by, bw, bh] = negatives[j].rect;
      const ov = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx)) *
                 Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
      check(`negative ${negatives[i].label} と ${negatives[j].label} は重ならない`, ov === 0, String(ov));
    }
  }
  check("gate 対象の negative は画素厳密な2件", negatives.filter((e) => e.leakGate).length === 2);

  check("positive は fill を持つ", positives.every((e) => /^#[0-9A-Fa-f]{6}$/.test(e.fill)));
  check("positive は cornerRadius を持つ", positives.every((e) => Number.isFinite(e.cornerRadius)));

  for (const e of a1.truth.elements) {
    const [x, y, w, h] = e.rect;
    check(`${e.label}: rectが画面内`,
      x >= 0 && y >= 0 && x + w <= a1.truth.width && y + h <= a1.truth.height, e.rect.join(","));
  }

  // pixelScale: 縮小経路を踏ませるための倍寸シーン。viewBox は据え置きなので
  // 正解座標はちょうど2倍になる（検出器が inv を掛け忘れれば半分にずれて露見する）。
  const big = generateScene(1, { pixelScale: 2 });
  check("pixelScale=2 の出力寸法は倍", big.truth.width === W * 2 && big.truth.height === H * 2,
    `${big.truth.width}x${big.truth.height}`);
  check("pixelScale=2 の svg は viewBox を持つ", big.svg.includes(`viewBox="0 0 ${W} ${H}"`));
  check("pixelScale=2 の正解矩形は倍",
    big.truth.elements.every((e, i) => e.rect.every((v, k) => v === a1.truth.elements[i].rect[k] * 2)));
  check("pixelScale=2 は workingMax(1280) を超える", big.truth.width > 1280, String(big.truth.width));
  check("pixelScale は決定的",
    JSON.stringify(big.truth) === JSON.stringify(generateScene(1, { pixelScale: 2 }).truth));
  for (const e of big.truth.elements) {
    const [x, y, w, h] = e.rect;
    check(`big/${e.label}: rectが画面内`,
      x >= 0 && y >= 0 && x + w <= big.truth.width && y + h <= big.truth.height, e.rect.join(","));
  }

  process.exit(failed ? 1 : 0);
}
