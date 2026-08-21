// Task 12: 実画像ベースライン用のスクリーンショット取得 + 正解アンカー抽出。
//
// 画像は .claude/ 配下（公開除外）にのみ置く。公開リポジトリへはアンカーJSONと
// 計測結果だけをコミットする（他人の画素を再配布しない）。
//
// **アンカーは目視で置かず DOM から取る。** 同じページ読み込みの中で実要素の
// bounding box・背景色・角丸・文字色を読めば、手で描いた矩形より正確で、
// 合成シーンの正解データ(synth.mjs)と同じフィールド構成になる。
// スクリーンショットとアンカーは**必ず同一の読み込みから**取ること
// （ニュース系サイトは再訪のたびに中身が変わるので、別々に撮ると対応が壊れる）。
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

// 出力先は既定で公開除外のディレクトリ。**スクリーンショットをこのリポジトリに入れない。**
// 他人の画面の画素を再配布しないため、画像と正解アンカーは非公開側に置き、
// 公開するのはこの取得スクリプトと数値(metrics)だけにする。
// RIVE_UI_FIXTURES で差し替えれば、自分の画面で同じ計測ができる。
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(process.env.RIVE_UI_FIXTURES || join(HERE, "..", "..", ".claude", "ui-fixtures"));
const OUT = join(FIXTURE_DIR, "images");
mkdirSync(OUT, { recursive: true });

// UI の種類が偏ると「合成生成器に最適化された検出器」を実画像でも見逃す。
// 計画の分類を1枚ずつ埋める。
//
// split: tuning は閾値決定に使ってよい。**holdout は Task 19 まで開けない**
// （見てしまうと holdout の意味が消える。metrics は記録するが、それを見て
//  閾値を動かしてはいけない）。
const TARGETS = [
  { id: "docs-light-dense", url: "https://developer.mozilla.org/en-US/docs/Web/CSS/display", w: 1440, h: 900, category: "light / dense text", split: "tuning" },
  // Stripe のトップは候補が7件しか取れず（transform を多用しており除外される）、
  // 肝心のグラデーション negative が0件になった。MDN の linear-gradient のページは
  // CSS グラデーションの実例が DOM 上の background-image として大量に並ぶ。
  // **グラデーションが縞に砕ける問題が本命**なので、ここに正解が無いと実画像で判定できない。
  { id: "gradient-boxes", url: "https://developer.mozilla.org/en-US/docs/Web/CSS/gradient/linear-gradient", w: 1440, h: 900, category: "gradient", split: "tuning" },
  { id: "card-heavy", url: "https://news.ycombinator.com/", w: 1440, h: 900, category: "dense list / flat", split: "tuning" },
  { id: "dense-table", url: "https://en.wikipedia.org/wiki/Comparison_of_web_browsers", w: 1440, h: 900, category: "dense table", split: "tuning" },
  { id: "mobile-narrow", url: "https://developer.mozilla.org/en-US/", w: 414, h: 896, category: "mobile-ish", split: "tuning" },
  // Unsplash はボット遮断。Commons の特選画像一覧は白地が 93.7% を占め写真が疎で
  // photo-rich の検体にならなかった（実測）。ニュースの一覧は写真カードが密に並ぶ。
  // 大きな写真1枚 + 小さな写真複数。photo negative を確実に確保するため。
  { id: "photo-hero", url: "https://en.wikipedia.org/wiki/Mount_Fuji", w: 1440, h: 900, category: "photo + article", split: "tuning", scrollY: 1600 },
  { id: "photo-rich", url: "https://www.bbc.com/news", w: 1440, h: 900, category: "photo-rich", split: "holdout" },
  // Vercel は 96% 白のページが撮れた（dark mode の検体にならない）。
  { id: "dark-mode", url: "https://github.com/", w: 1440, h: 900, category: "dark mode", split: "holdout", colorScheme: "dark" },
  { id: "dashboard-flat", url: "https://tailwindcss.com/", w: 1440, h: 900, category: "flat marketing / cards", split: "holdout" },
];

// ページ内で実行する抽出器。**疎なアンカーで良い**（網羅は不要）。
// 誤ったアンカーを1件入れるほうが、アンカーが3件少ないより遥かに有害なので、
// 少しでも怪しい要素は落とす方向に倒す。
const EXTRACT = function () {
  const toHex = (rgb) => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(rgb);
    if (!m) return null;
    const a = m[4] === undefined ? 1 : parseFloat(m[4]);
    return { hex: "#" + [1, 2, 3].map((i) => (+m[i]).toString(16).padStart(2, "0")).join(""), alpha: a };
  };
  const VW = window.innerWidth, VH = window.innerHeight;
  const anchors = [];
  const seen = new Set();

  // 中心が自分（か子孫）で拾えないなら、その要素は何かに覆われている。
  // 中心1点だけだと、中身が詰まったカードで子要素に当たって落ちる／逆に
  // 一部だけ覆われた要素を見逃す。3点のうち1点でも自分か子孫なら「見えている」。
  const visibleAt = (el, r) => {
    const pts = [[0.5, 0.5], [0.2, 0.2], [0.8, 0.8]];
    for (const [fx, fy] of pts) {
      const cx = Math.round(r.x + r.width * fx), cy = Math.round(r.y + r.height * fy);
      if (cx < 1 || cy < 1 || cx > VW - 2 || cy > VH - 2) continue;
      const hit = document.elementFromPoint(cx, cy);
      if (hit && (hit === el || el.contains(hit))) return true;
    }
    return false;
  };
  // 完全に画面内である要求は厳しすぎた（ヒーロー画像や大きなパネルがほぼ全て落ちる）。
  // 9割が見えていれば採用し、矩形は画面へクリップする。
  const clip = (r) => {
    const x = Math.max(0, r.x), y = Math.max(0, r.y);
    const x2 = Math.min(VW, r.x + r.width), y2 = Math.min(VH, r.y + r.height);
    return { x, y, width: x2 - x, height: y2 - y };
  };
  const inView = (r) => {
    const c = clip(r);
    if (c.width <= 0 || c.height <= 0) return false;
    return (c.width * c.height) / (r.width * r.height) >= 0.9;
  };
  const key = (r) => [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(",");

  for (const el of document.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width < 28 || r.height < 20) continue;
    if (!inView(r)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== "visible" || cs.display === "none" || parseFloat(cs.opacity) < 0.99) continue;
    // transform が掛かっていると bounding box と実際の描画がずれることがある。触らない。
    if (cs.transform && cs.transform !== "none") continue;
    const k = key(r);
    if (seen.has(k)) continue;

    const cr = clip(r);
    const rect = [Math.round(cr.x), Math.round(cr.y), Math.round(cr.width), Math.round(cr.height)];
    const hasBgImage = cs.backgroundImage && cs.backgroundImage !== "none";

    // --- negative: canvas / svg / video。中身は任意の絵なのでベクター化してはいけない ---
    // Stripe のヒーローのグラデーションは canvas で描かれており、CSS の
    // background-image では拾えなかった（実測: gradient カテゴリの negative が0件になった）。
    if (["CANVAS", "SVG", "VIDEO"].includes(el.tagName.toUpperCase()) && r.width * r.height >= 4000) {
      if (!visibleAt(el, r)) continue;
      seen.add(k);
      anchors.push({ label: `${el.tagName.toLowerCase()}@${rect.join("_")}`, rect, expectVectorPanel: false, semanticHint: "image", leakGate: true, erodePx: 3 });
      continue;
    }

    // --- negative: 写真。ベクター化してはいけない ---
    if (el.tagName === "IMG" && el.naturalWidth > 0 && r.width * r.height >= 4000) {
      if (!visibleAt(el, r)) continue;
      seen.add(k);
      anchors.push({ label: `img@${rect.join("_")}`, rect, expectVectorPanel: false, semanticHint: "image", leakGate: true, erodePx: 3 });
      continue;
    }
    if (hasBgImage && /url\(/.test(cs.backgroundImage) && r.width * r.height >= 4000) {
      if (!visibleAt(el, r)) continue;
      seen.add(k);
      anchors.push({ label: `bgimg@${rect.join("_")}`, rect, expectVectorPanel: false, semanticHint: "image", leakGate: true, erodePx: 3 });
      continue;
    }
    // --- negative: グラデーション。縞に割ってはいけない ---
    // **この判定は「背景画像を持つ要素を飛ばす」より前に置くこと。**
    // 以前は blanket の `if (hasBgImage) continue;` が先にあり、グラデーションを
    // 持つ要素が分岐へ到達する前に全て捨てられていた（実測: グラデーションの
    // ページで画面内に 265x76 と 351x268 の2件があったのに抽出0件）。
    // グラデーションが縞に砕ける問題が本命なので、ここを落とすと実画像で判定できない。
    if (hasBgImage && /gradient/.test(cs.backgroundImage) && r.width * r.height >= 4000) {
      if (!visibleAt(el, r)) continue;
      seen.add(k);
      anchors.push({ label: `grad@${rect.join("_")}`, rect, expectVectorPanel: false, semanticHint: "image", leakGate: true, erodePx: 3 });
      continue;
    }
    if (hasBgImage) continue; // 上の分岐に当たらない背景画像は正解として扱わない

    // --- positive: 不透明な単色パネル ---
    const bg = toHex(cs.backgroundColor);
    if (bg && bg.alpha === 1) {
      // 親と同じ色なら「見えるパネル」ではない（境界が存在しないので検出器が見つけようがない）。
      const pcs = el.parentElement ? getComputedStyle(el.parentElement) : null;
      const pbg = pcs ? toHex(pcs.backgroundColor) : null;
      if (pbg && pbg.alpha === 1 && pbg.hex === bg.hex) continue;
      // 子が同じ矩形を別色で塗り潰しているなら、見えているのは子の色。
      let covered = false;
      for (const c of el.children) {
        const chr = c.getBoundingClientRect();
        const ccs = getComputedStyle(c);
        const cbg = toHex(ccs.backgroundColor);
        const overlap = Math.max(0, Math.min(chr.right, r.right) - Math.max(chr.left, r.left)) *
                        Math.max(0, Math.min(chr.bottom, r.bottom) - Math.max(chr.top, r.top));
        if (cbg && cbg.alpha === 1 && overlap / (r.width * r.height) > 0.9) { covered = true; break; }
      }
      if (covered) continue;
      if (!visibleAt(el, r)) continue;
      const radius = Math.round(parseFloat(cs.borderTopLeftRadius) || 0);
      seen.add(k);
      anchors.push({
        label: `panel@${rect.join("_")}`, rect, expectVectorPanel: true, semanticHint: "panel",
        fill: bg.hex, cornerRadius: radius,
      });
      continue;
    }

    // --- negative: テキスト行。インク色を持たせる（画素厳密な正解になる） ---
    // 直下に実テキストを持ち、子要素を持たない葉だけを取る（入れ子で二重に数えない）。
    if (el.children.length === 0) {
      const txt = (el.textContent || "").trim();
      if (txt.length >= 3 && r.height <= 80) {
        const fg = toHex(cs.color);
        const fs = parseFloat(cs.fontSize) || 0;
        if (fg && fg.alpha === 1 && fs >= 13 && visibleAt(el, r)) {
          seen.add(k);
          anchors.push({
            label: `text@${rect.join("_")}`, rect, expectVectorPanel: false, semanticHint: "text",
            // テキストの矩形は字間の背景を正当に含むので面積 leak を gate にしてはいけない
            // （合成シーンと同じ理由。synth.mjs の leakGate コメント参照）。
            leakGate: false, inkColor: fg.hex, fontSizePx: Math.round(fs),
          });
        }
      }
    }
  }
  return { width: VW, height: VH, anchors };
};

// **DOM を信用せず、撮れた画素でアンカーを検証する。**
// DOM は「この要素はこの色の背景を持つ」と言うが、実際に見えているとは限らない
// （半透明の重ね・スクロールバー・遅延で入れ替わった中身・webfont のフォールバック）。
// 誤ったアンカーが1件混ざるほうがアンカーが3件少ないより有害なので、
// 宣言と画素が食い違うものはここで落とす。
const VERIFY = async function ({ b64, anchors, fillTol, inkTol }) {
  const bin = atob(b64);
  const by = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) by[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([by], { type: "image/png" }));
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext("2d");
  x.drawImage(bmp, 0, 0);
  const d = x.getImageData(0, 0, bmp.width, bmp.height).data;
  const at = (px, py) => { const i = (py * bmp.width + px) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const near = (a, b, tol) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;

  const kept = [];
  const rejected = [];
  for (const a of anchors) {
    const [rx, ry, rw, rh] = a.rect;
    if (rw < 8 || rh < 6) { rejected.push({ label: a.label, why: "too-small" }); continue; }

    if (a.expectVectorPanel) {
      // 内側2pxの周囲リングを標本にする。中身(文字・アイコン)を避けつつ、
      // 「そのパネルの色が実際に見えている」ことだけを確かめる。
      const want = hexRgb(a.fill);
      let hit = 0, n = 0;
      for (let t = 0; t < 10; t++) {
        const f = 0.05 + (t / 9) * 0.9;
        const pts = [
          [Math.round(rx + rw * f), ry + 2],
          [Math.round(rx + rw * f), ry + rh - 3],
          [rx + 2, Math.round(ry + rh * f)],
          [rx + rw - 3, Math.round(ry + rh * f)],
        ];
        for (const [px, py] of pts) {
          if (px < 0 || py < 0 || px >= bmp.width || py >= bmp.height) continue;
          n++; if (near(at(px, py), want, fillTol)) hit++;
        }
      }
      // 7割。角丸のコーナーと1px の枠線で必ず数点は外れるので 100% は要求できない。
      if (!(n >= 20 && hit / n >= 0.7)) { rejected.push({ label: a.label, why: `fill-not-visible ${hit}/${n}` }); continue; }

      // **境界コントラストが無いアンカーは正解にしてはいけない。**
      // 白い地に白いパネル、暗い地に暗いパネルは、DOM 上は別要素でも画像には
      // 境界が写っていない。どんなアルゴリズムでも見つけられないものを recall の
      // 分母に入れると、検出器の欠陥ではなく正解データの欠陥を測ることになる。
      // 実測(2026-08-21): この判定を入れる前、実画像の miss 17件すべてが
      // 「IoU 0.8 以上の候補が1つも無い」で、その大半が白地の白パネルだった。
      //
      // **しきい値は「検出器の量子化が2つの色を別物として扱える最小差」に留める。**
      // 5bit量子化のバケット幅は8なので 12 はそれをわずかに超えるだけ。
      // Task 13 が入れる境界コントラストの gate は必ずこれより強い値になる。
      // ここを強くすると gate に無条件の合格点を与えてしまうので、上げないこと。
      const OUT_OFF = 4;
      let sides = 0;
      const sideDiff = (pts) => {
        let d = 0, m = 0;
        for (const [px, py] of pts) {
          if (px < 0 || py < 0 || px >= bmp.width || py >= bmp.height) continue;
          const o = at(px, py);
          d += Math.max(Math.abs(o[0] - want[0]), Math.abs(o[1] - want[1]), Math.abs(o[2] - want[2]));
          m++;
        }
        return m ? d / m : null;
      };
      for (const pts of [
        Array.from({ length: 7 }, (_, i) => [Math.round(rx + rw * (0.15 + i * 0.12)), ry - OUT_OFF]),
        Array.from({ length: 7 }, (_, i) => [Math.round(rx + rw * (0.15 + i * 0.12)), ry + rh - 1 + OUT_OFF]),
        Array.from({ length: 7 }, (_, i) => [rx - OUT_OFF, Math.round(ry + rh * (0.15 + i * 0.12))]),
        Array.from({ length: 7 }, (_, i) => [rx + rw - 1 + OUT_OFF, Math.round(ry + rh * (0.15 + i * 0.12))]),
      ]) {
        const d = sideDiff(pts);
        if (d !== null && d >= 12) sides++;
      }
      // 画面端に接するパネルは測れる辺が減るので2辺で足りるとする。
      if (sides >= 2) kept.push({ ...a, contrastSides: sides });
      else rejected.push({ label: a.label, why: `no-boundary-contrast sides=${sides}` });
      continue;
    }

    if (a.semanticHint === "text") {
      // 宣言した文字色の画素が実際に十分あるか。webfont のフォールバックや
      // 遅延で中身が入れ替わったケースをここで落とす。
      const want = hexRgb(a.inkColor);
      let ink = 0;
      for (let py = ry; py < ry + rh; py++) {
        for (let px = rx; px < rx + rw; px++) {
          if (px < 0 || py < 0 || px >= bmp.width || py >= bmp.height) continue;
          if (near(at(px, py), want, inkTol)) ink++;
        }
      }
      // インクが面積の 1% 未満なら、その矩形に文字は写っていない。
      if (ink >= 30 && ink / (rw * rh) >= 0.01) kept.push({ ...a, inkPixels: ink });
      else rejected.push({ label: a.label, why: `no-ink ${ink}px` });
      continue;
    }

    // image/canvas/gradient negative: 平坦なら negative として無価値
    //（「ベクター化するな」と言う意味がない）。色数で判定する。
    const seen = new Set();
    for (let py = ry; py < ry + rh; py += 2) {
      for (let px = rx; px < rx + rw; px += 2) {
        if (px < 0 || py < 0 || px >= bmp.width || py >= bmp.height) continue;
        const [r0, g0, b0] = at(px, py);
        seen.add(((r0 >> 3) << 10) | ((g0 >> 3) << 5) | (b0 >> 3));
      }
    }
    if (seen.size >= 20) kept.push({ ...a, distinctColors: seen.size });
    else rejected.push({ label: a.label, why: `flat ${seen.size} colors` });
  }
  return { kept, rejected };
};

async function launch() {
  const base = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "ms-playwright") : null;
  const attempts = [];
  if (process.env.RIVE_MCP_CHROME) attempts.push(() => chromium.launch({ headless: true, executablePath: process.env.RIVE_MCP_CHROME }));
  if (base) {
    try {
      const d = readdirSync(base).filter((x) => /^chromium-\d+$/.test(x)).sort().pop();
      if (d) attempts.push(() => chromium.launch({ headless: true, executablePath: join(base, d, "chrome-win", "chrome.exe") }));
    } catch {}
  }
  attempts.push(() => chromium.launch({ headless: true, channel: "chrome" }));
  attempts.push(() => chromium.launch({ headless: true, channel: "msedge" }));
  let last;
  for (const a of attempts) { try { return await a(); } catch (e) { last = e; } }
  throw last;
}

// 疎なアンカーで良い。多すぎると1件の誤りが混ざる確率が上がるだけなので、
// 種類ごとに面積上位を数件だけ残す。
// negative を厚めに取る。非対称損失（誤ってベクター化すると見た目が壊れる）を
// 測るのが主目的なので、negative が薄いと計測の意味が落ちる。
const PER_KIND = { panel: 4, image: 5, text: 4 };
function thin(anchors) {
  const kind = (a) => (a.expectVectorPanel ? "panel" : a.semanticHint === "text" ? "text" : "image");
  const out = [];
  for (const k of Object.keys(PER_KIND)) {
    const of = anchors.filter((a) => kind(a) === k).sort((x, y) => y.rect[2] * y.rect[3] - x.rect[2] * x.rect[3]);
    // 大きすぎるパネル（画面の8割超）は「背景そのもの」で検出の腕前を測れないので外す。
    const usable = k === "panel" ? of.filter((a) => a.rect[2] * a.rect[3] < 0.8 * 1440 * 900) : of;
    out.push(...usable.slice(0, PER_KIND[k]));
  }
  return out;
}

const only = process.argv.slice(2);
const browser = await launch();
const fixtures = [];
try {
  for (const t of TARGETS) {
    if (only.length && !only.includes(t.id)) continue;
    const ctx = await browser.newContext({
      viewport: { width: t.w, height: t.h },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      colorScheme: t.colorScheme ?? "light",
    });
    const page = await ctx.newPage();
    try {
      try {
        await page.goto(t.url, { waitUntil: "load", timeout: 30000 });
      } catch {
        await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      }
      await page.waitForTimeout(1800);
      if (t.scrollY) {
        // 記事ページは本文の途中に写真が集まる。先頭だけを見ていると
        // negative が1件しか取れない（実測: Mount Fuji で raw 35 中 image 1件）。
        await page.evaluate((y) => window.scrollTo(0, y), t.scrollY);
        await page.waitForTimeout(1200); // 遅延読み込み画像の到着待ち
      }
      // **順序が重要**: 先にスクリーンショット、直後に抽出。間にスクロールや
      // 遅延読み込みが走ると画像とアンカーが食い違う。
      const buf = await page.screenshot({ type: "png" });

      // トップフレームだけでは足りない。MDN の実例（グラデーションの見本）は
      // iframe の中にあり、`document.querySelectorAll` では一切見えなかった
      // （実測: グラデーションのページから negative が0件）。
      // 各フレームで抽出し、親フレーム上のオフセットを足して座標系を揃える。
      const ex = await page.evaluate(EXTRACT);
      for (const fr of page.frames()) {
        if (fr === page.mainFrame()) continue;
        try {
          const fe = await fr.frameElement();
          const box = await fe.boundingBox();
          if (!box || box.width < 40 || box.height < 40) continue;
          const sub = await fr.evaluate(EXTRACT);
          for (const a of sub.anchors) {
            a.rect = [Math.round(a.rect[0] + box.x), Math.round(a.rect[1] + box.y), a.rect[2], a.rect[3]];
            a.label = `f:${a.label}`;
            // フレームの外へはみ出す分は親の画素には写っていない
            if (a.rect[0] < 0 || a.rect[1] < 0 ||
                a.rect[0] + a.rect[2] > t.w || a.rect[1] + a.rect[3] > t.h) continue;
            ex.anchors.push(a);
          }
        } catch { /* 別オリジンのフレームは読めない。飛ばす */ }
      }
      writeFileSync(join(OUT, `${t.id}.png`), buf);
      // 間引く**前**に検証する（検証で落ちた分を面積順の下位が埋められるように）
      const v = await page.evaluate(VERIFY, {
        b64: buf.toString("base64"), anchors: ex.anchors,
        // 12: パネル境界の1px枠線と subpixel AA を吸収する幅。
        // 32: インクのコア画素だけを拾う幅（detectorMetrics の INK_MATCH_TOL と同値）。
        fillTol: 12, inkTol: 32,
      });
      const anchors = thin(v.kept);
      fixtures.push({
        id: t.id, url: t.url, category: t.category, split: t.split,
        width: ex.width, height: ex.height, image: `images/${t.id}.png`,
        anchorsRaw: ex.anchors.length, anchorsVerified: v.kept.length,
        rejectedSample: v.rejected.slice(0, 8), anchors,
      });
      const n = (k) => anchors.filter((a) => (k === "panel" ? a.expectVectorPanel : !a.expectVectorPanel && a.semanticHint === k)).length;
      console.log(`ok   ${t.id.padEnd(20)} ${t.w}x${t.h}  panel=${n("panel")} image=${n("image")} text=${n("text")}  (raw ${ex.anchors.length} → 検証通過 ${v.kept.length} → 採用 ${anchors.length})`);
    } catch (e) {
      console.log(`FAIL ${t.id.padEnd(20)} ${e.message.split("\n")[0]}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

if (!only.length) {
  writeFileSync(join(FIXTURE_DIR, "fixtures.json"), JSON.stringify({ capturedAt: new Date().toISOString(), fixtures }, null, 2) + "\n");
  console.log(`\n${fixtures.length}/${TARGETS.length} captured`);
}
