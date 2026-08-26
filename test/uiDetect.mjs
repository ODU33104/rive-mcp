import { buildTree } from "../dist/uiDetect.js";
import { paletteFromColors } from "../dist/designTokens.js";

let failed = 0;
function check(label, cond, detail = "") {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed++;
}

// 外側カード(0,0,200,200) の中にボタン(20,20,60,30) がある
const regions = [
  { renderMode: "vector-panel", semanticHint: "panel", rect: [0, 0, 200, 200], fill: "#1E1E2E" },
  { renderMode: "vector-panel", semanticHint: "panel", rect: [20, 20, 60, 30], fill: "#6C7BFF" },
];
const { elements, dropped } = buildTree(regions, 120);

check("2要素", elements.length === 2, String(elements.length));
check("id は 1 始まり", elements[0].id === 1 && elements[1].id === 2);
check("外側は親なし", elements[0].parent === null);
check("内側の親は外側", elements[1].parent === 1, String(elements[1].parent));
check("外側の children に内側", elements[0].children.join() === "2");
check("dropped は 0", dropped === 0);

// 面積の大きい順に maxElements で切る。落とした数を必ず返す
const many = Array.from({ length: 5 }, (_, i) => ({
  renderMode: "vector-panel", semanticHint: "panel", rect: [0, 0, 10 * (i + 1), 10], fill: "#000000",
}));
const cut = buildTree(many, 3);
check("maxElements で 3 件に絞る", cut.elements.length === 3, String(cut.elements.length));
check("落とした数を返す", cut.dropped === 2, String(cut.dropped));
check("残るのは面積上位", cut.elements.every((e) => e.rect[2] >= 30));

// 親候補が複数あるときは「95%以上含む最小の矩形」を選ぶ
const nested = [
  { renderMode: "vector-panel", semanticHint: "panel", rect: [0, 0, 300, 300], fill: "#111111" },
  { renderMode: "vector-panel", semanticHint: "panel", rect: [0, 0, 200, 200], fill: "#222222" },
  { renderMode: "vector-panel", semanticHint: "panel", rect: [10, 10, 50, 50], fill: "#333333" },
];
const n = buildTree(nested, 120);
check("最小の親を選ぶ", n.elements[2].parent === 2, String(n.elements[2].parent));

// スクリーンショットからサンプリングした色列を役割付きパレットに畳む
const p = paletteFromColors(
  ["#1E1E2E", "#1E1E2E", "#1E1E2E", "#1E1E2E", "#6C7BFF", "#E6E6E6", "#E6E6E6"],
  8
);
check("最頻色が background", p.background === "#1E1E2E", p.background);
check("背景と最もコントラストが高い色が foreground", p.foreground === "#E6E6E6", p.foreground);
check("彩度が最も高い色が accent", p.accent === "#6C7BFF", p.accent);
check("swatches は出現回数の降順", p.swatches[0].usage >= p.swatches[1].usage);
check("max を超えない", paletteFromColors(["#111111", "#222222", "#333333"], 2).swatches.length === 2);

// 回帰: 色味付きの黒に近い画素(圧縮ノイズ等)がHSL彩度では1.0になり、
// 本物のaccentより優先されてしまわないこと(OKLCHのchromaで選ぶ)
const near = paletteFromColors(
  ["#1E1E2E", "#1E1E2E", "#1E1E2E", "#020100", "#6C7BFF"],
  8
);
check("色味付きの黒より本物のaccentが勝つ", near.accent === "#6C7BFF", near.accent);

// 回帰(Bug 2・Important): usage は「出現回数」ではなく「面積」で重み付けする。
// 画面全体を覆う白い1領域 vs 20個の小さい青いボタンでは、面積では白が圧倒的優位でも
// 出現回数では青が20対1で勝ってしまい、background(最頻色)が青になる誤りが実際に起きていた。
const weighted = paletteFromColors(
  [
    { hex: "#FFFFFF", weight: 200000 }, // 画面全体を覆う白背景1領域
    ...Array.from({ length: 20 }, () => ({ hex: "#3D8BFD", weight: 400 })), // 小さい青ボタン20個
  ],
  8
);
check("面積の大きい白がbackground(件数では青が20対1で勝つが面積では白が勝つ)",
  weighted.background === "#FFFFFF", weighted.background);
check("面積の小さい青がaccent", weighted.accent === "#3D8BFD", weighted.accent);

// bare string も従来通り weight=1 として扱えること(既存呼び出し元との後方互換)
const bareString = paletteFromColors(["#1E1E2E", "#1E1E2E", "#6C7BFF"], 8);
check("bare stringはweight=1として集計される(後方互換)",
  bareString.swatches.find((s) => s.hex === "#1E1E2E").usage === 2);

// ブラウザ内ピクセル検出: 合成SVGを既知の矩形として描き、検出結果が元解像度で戻ることを確認
import { RiveHost } from "../dist/riveHost.js";
import { PAGE_SCRIPT } from "../dist/pageScript.js";

const host = new RiveHost(PAGE_SCRIPT);
try {
  const png = await host.rasterize(`
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">
      <rect width="320" height="240" fill="#1E1E2E"/>
      <rect x="40" y="60" width="120" height="48" fill="#6C7BFF"/>
    </svg>`);
  const det = await host.detectUiRegions(png, { minArea: 576, workingMax: 1280 });
  check("元解像度を返す", det.width === 320 && det.height === 240, `${det.width}x${det.height}`);
  const btn = det.regions.find((r) => r.fill === "#6C7BFF");
  check("明るい矩形を検出", !!btn);
  check("矩形の位置が合う", btn && Math.abs(btn.rect[0] - 40) <= 2 && Math.abs(btn.rect[1] - 60) <= 2,
    btn && btn.rect.join(","));
  check("矩形の寸法が合う", btn && Math.abs(btn.rect[2] - 120) <= 2 && Math.abs(btn.rect[3] - 48) <= 2,
    btn && btn.rect.join(","));
  check("renderMode は vector-panel", btn && btn.renderMode === "vector-panel", btn && btn.renderMode);
  check("semanticHint は panel", btn && btn.semanticHint === "panel", btn && btn.semanticHint);
  check("角Rなしは 0", btn && btn.cornerRadius === 0, btn && String(btn.cornerRadius));
  check("色を収集している", det.sampledColors.length > 0);
} finally {
  await host.close();
}

// 縮小パス(workingMax超過時)の座標復元を検証。同じ固定具を workingMax=160 で強制的に
// scale=0.5 にかけ、inv(=1/scale)を掛け忘れる/二重に掛けるとここで壊れることを確認する
const hostDown = new RiveHost(PAGE_SCRIPT);
try {
  const pngDown = await hostDown.rasterize(`
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">
      <rect width="320" height="240" fill="#1E1E2E"/>
      <rect x="40" y="60" width="120" height="48" fill="#6C7BFF"/>
    </svg>`);
  const detDown = await hostDown.detectUiRegions(pngDown, { minArea: 576, workingMax: 160 });
  check("縮小時も元解像度を返す", detDown.width === 320 && detDown.height === 240,
    `${detDown.width}x${detDown.height}`);
  const btnDown = detDown.regions.find((r) => r.fill === "#6C7BFF");
  check("縮小時も矩形を検出", !!btnDown);
  check("縮小時の位置が元解像度に復元される", btnDown && Math.abs(btnDown.rect[0] - 40) <= 4 && Math.abs(btnDown.rect[1] - 60) <= 4,
    btnDown && btnDown.rect.join(","));
  check("縮小時の寸法が元解像度に復元される", btnDown && Math.abs(btnDown.rect[2] - 120) <= 4 && Math.abs(btnDown.rect[3] - 48) <= 4,
    btnDown && btnDown.rect.join(","));
  check("縮小時も角Rなしは 0", btnDown && btnDown.cornerRadius === 0, btnDown && String(btnDown.cornerRadius));
} finally {
  await hostDown.close();
}

// 角Rの逆算係数を検証。真の半径12pxの丸角矩形で cornerRadius が概ね一致することを確認する。
// 直角矩形の "=== 0" だけだと係数を何倍にしても通ってしまう（d=0 は係数に関係なく0のため）ので、
// 実際に丸い矩形を検出させないと係数の誤りを検出できない
const hostRounded = new RiveHost(PAGE_SCRIPT);
try {
  const pngRounded = await hostRounded.rasterize(`
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">
      <rect width="320" height="240" fill="#1E1E2E"/>
      <rect x="40" y="60" width="120" height="48" rx="12" fill="#6C7BFF"/>
    </svg>`);
  const detRounded = await hostRounded.detectUiRegions(pngRounded, { minArea: 576, workingMax: 1280 });
  const btnRounded = detRounded.regions.find((r) => r.fill === "#6C7BFF");
  check("丸角矩形を検出", !!btnRounded);
  check("角Rが真の半径(12px)の近傍", btnRounded && Math.abs(btnRounded.cornerRadius - 12) <= 3,
    btnRounded && String(btnRounded.cornerRadius));
} finally {
  await hostRounded.close();
}

// 非対称な角R(上だけ丸い)を検証。d=0(直角)を中央値の前に除外していないと、
// 4値の中央値に直角側の0が混ざって真の半径の半分程度に潰れる(Finding 2 の回帰テスト)
const hostTopRounded = new RiveHost(PAGE_SCRIPT);
try {
  const pngTopRounded = await hostTopRounded.rasterize(`
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">
      <rect width="320" height="240" fill="#1E1E2E"/>
      <path d="M 52 60 H 148 A 12 12 0 0 1 160 72 V 108 H 40 V 72 A 12 12 0 0 1 52 60 Z" fill="#6C7BFF"/>
    </svg>`);
  const detTopRounded = await hostTopRounded.detectUiRegions(pngTopRounded, { minArea: 576, workingMax: 1280 });
  const btnTopRounded = detTopRounded.regions.find((r) => r.fill === "#6C7BFF");
  check("上だけ丸い矩形を検出", !!btnTopRounded);
  check("角Rが直角側に引きずられず真の半径(12px)の近傍", btnTopRounded && Math.abs(btnTopRounded.cornerRadius - 12) <= 3,
    btnTopRounded && String(btnTopRounded.cornerRadius));
} finally {
  await hostTopRounded.close();
}

// テキストは量子化で細かい成分に散り minArea 未満で捨てられる。水平に束ねて1行のtext regionにする
const hostText = new RiveHost(PAGE_SCRIPT);
try {
  const textPng = await hostText.rasterize(`
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="120">
      <rect width="320" height="120" fill="#1E1E2E"/>
      <text x="20" y="40" font-family="sans-serif" font-size="16" fill="#E6E6E6">Dashboard</text>
    </svg>`);
  const td = await hostText.detectUiRegions(textPng, { minArea: 16, workingMax: 1280 });
  const textRegion = td.regions.find((r) => r.semanticHint === "text");
  check("テキストを検出", !!textRegion, td.regions.map((r) => r.semanticHint).join(","));
  check("1行にまとまる", td.regions.filter((r) => r.semanticHint === "text").length === 1);
  check("テキストの renderMode は raster", textRegion && textRegion.renderMode === "raster",
    textRegion && textRegion.renderMode);
  check("fontSize を概算", textRegion && textRegion.fontSizePx >= 10 && textRegion.fontSizePx <= 24,
    textRegion && String(textRegion.fontSizePx));
} finally {
  await hostText.close();
}

// 回帰(Bug 1・Critical): ほぼ同一・大きく重なる2枚のpanelは互いを95%以上「含む」ため、
// 大きさで区別しないと双方が相手を親に選び parent 循環(1↔2)ができる。
// buildPrototypeScene は parent===null の要素から木を辿るため、循環があるとルートが
// 0件になり出力が空になる(またはロジックによっては無限に辿り続ける)。
function walkParentChain(elements, startId, maxSteps) {
  const byId = new Map(elements.map((e) => [e.id, e]));
  let cur = byId.get(startId);
  let steps = 0;
  while (cur && cur.parent !== null) {
    steps++;
    if (steps > maxSteps) return { terminated: false, steps };
    cur = byId.get(cur.parent);
  }
  return { terminated: true, steps };
}

{
  const dup = buildTree(
    [
      { renderMode: "vector-panel", semanticHint: "panel", rect: [0, 0, 100, 100], fill: "#111111" },
      { renderMode: "vector-panel", semanticHint: "panel", rect: [2, 0, 100, 100], fill: "#222222" },
    ],
    120
  );
  check("ほぼ同一矩形2枚: 循環なし(1が2の親かつ2が1の親、は起きない)",
    !(dup.elements[0].parent === dup.elements[1].id && dup.elements[1].parent === dup.elements[0].id));
  check("ほぼ同一矩形2枚: ルート(parent===null)が1件以上ある",
    dup.elements.some((e) => e.parent === null),
    dup.elements.map((e) => `${e.id}:${e.parent}`).join(","));
}

{
  const eq = buildTree(
    [
      { renderMode: "vector-panel", semanticHint: "panel", rect: [0, 0, 100, 100], fill: "#111111" },
      { renderMode: "vector-panel", semanticHint: "panel", rect: [0, 0, 100, 100], fill: "#222222" },
    ],
    120
  );
  check("完全に同一の矩形2枚: 循環なし",
    !(eq.elements[0].parent === eq.elements[1].id && eq.elements[1].parent === eq.elements[0].id));
  check("完全に同一の矩形2枚: ルートが1件以上ある",
    eq.elements.some((e) => e.parent === null),
    eq.elements.map((e) => `${e.id}:${e.parent}`).join(","));
}

{
  // 大きい背景・ほぼ同一の重複パネル2枚・その中の小さいボタンが混在する具体例で、
  // 全要素について parent チェーンが有限ステップで null に到達することを確認する
  // (形だけのチェックではなく、実際にリンクを辿るトラバーサル)
  const mixed = buildTree(
    [
      { renderMode: "vector-panel", semanticHint: "panel", rect: [0, 0, 500, 500], fill: "#0A0A0A" },
      { renderMode: "vector-panel", semanticHint: "panel", rect: [10, 10, 200, 200], fill: "#111111" },
      { renderMode: "vector-panel", semanticHint: "panel", rect: [12, 10, 200, 200], fill: "#131313" }, // 重複検出
      { renderMode: "vector-panel", semanticHint: "panel", rect: [20, 20, 40, 20], fill: "#6C7BFF" },
    ],
    120
  );
  for (const e of mixed.elements) {
    const { terminated, steps } = walkParentChain(mixed.elements, e.id, mixed.elements.length + 1);
    check(`要素${e.id}のparentチェーンがN歩以内でnullに到達`, terminated, `steps=${steps}`);
  }
  check("混在フィクスチャ: ルートが1件以上ある", mixed.elements.some((e) => e.parent === null));
}

{
  // 既存の「本物の入れ子」は引き続き機能すること(小さい矩形がはるかに大きい矩形の中にある)
  const nest2 = buildTree(
    [
      { renderMode: "vector-panel", semanticHint: "panel", rect: [0, 0, 400, 400], fill: "#000000" },
      { renderMode: "vector-panel", semanticHint: "panel", rect: [50, 50, 20, 20], fill: "#FFFFFF" },
    ],
    120
  );
  check("本物の入れ子は引き続き親子になる", nest2.elements[1].parent === nest2.elements[0].id,
    String(nest2.elements[1].parent));
}

// --- 境界コントラスト gate（Task 13） ---
// gate を外すと必ず落ちるテストにしてある（gate 無しの実測: グラデーション帯1本が
// 平坦な vector-panel 約30枚に砕ける）。
const hostGate = new RiveHost(PAGE_SCRIPT);
try {
  // 1) グラデーション帯は縞に割ってもベクターパネルにしない。
  //    縞は内部が平坦で矩形度も高いので、充填率の判定だけでは絶対に落ちない。
  const gradPng = await hostGate.rasterize(`
    <svg xmlns="http://www.w3.org/2000/svg" width="600" height="300">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#FF3366"/><stop offset="0.5" stop-color="#33CCFF"/>
        <stop offset="1" stop-color="#33FF66"/>
      </linearGradient></defs>
      <rect width="600" height="300" fill="#F4F5F7"/>
      <rect x="40" y="100" width="520" height="100" fill="url(#g)"/>
    </svg>`);
  // 同じ画像を gate 無し(min=0)と既定で比べる。効果を「約30枚」のような
  // 覚え書きの数字ではなく、その場の実測差として固定する。
  // gate 単体の効果を見るため統合は切る（statuMinRun を極端に大きく）
  const NO_MERGE = { minArea: 576, workingMax: 1280, stripeMinRun: 99999 };
  const gdOff = await hostGate.detectUiRegions(gradPng, { ...NO_MERGE, boundaryContrastMin: 0 });
  const gd = await hostGate.detectUiRegions(gradPng, NO_MERGE);
  const band = [40, 100, 520, 100];
  const inBand = (r) => r.rect[0] >= band[0] - 4 && r.rect[1] >= band[1] - 4 &&
    r.rect[0] + r.rect[2] <= band[0] + band[2] + 4 && r.rect[1] + r.rect[3] <= band[1] + band[3] + 4;
  const vOff = gdOff.regions.filter((r) => inBand(r) && r.renderMode === "vector-panel").length;
  const vOn = gd.regions.filter((r) => inBand(r) && r.renderMode === "vector-panel").length;
  check("gate 無しではグラデーションが多数のベクターパネルに砕ける", vOff >= 10, String(vOff));
  check("gate はそれを桁で減らす", vOn * 10 <= vOff, `${vOff} → ${vOn}`);
  // 帯の端に接する縞だけは3辺(外側+上下)で地から浮くので残り得る。
  // 実測(2026-08-21): 右端の 544,100,14,100 が1枚残る。これは帯の縁の細い一片で、
  // leak 面積としては 0.018 に留まる（合成ベースラインの実測値）。0 にするには
  // 4辺すべてを要求することになるが、それは実画像の recall を 0.417→0.292 に落とす。
  check("残るのは帯の端に接するものだけ（2枚以内）", vOn <= 2, String(vOn));
  check("帯の成分自体は検出されている(消してはいない)", gd.regions.filter(inBand).length > 0,
    String(gd.regions.filter(inBand).length));

  // 2) コントラストが弱くても4辺すべてで地から浮いているパネルは残す。
  //    「薄い色を一律に落とす」gate になっていないことの確認。
  //    #ECF4FE を白地に置くと最大チャンネル差は 19（実画像の実測値と同程度）。
  const faintPng = await hostGate.rasterize(`
    <svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
      <rect width="400" height="300" fill="#FFFFFF"/>
      <rect x="60" y="80" width="240" height="90" fill="#ECF4FE"/>
    </svg>`);
  const fd = await hostGate.detectUiRegions(faintPng, { minArea: 576, workingMax: 1280 });
  const faint = fd.regions.find((r) => Math.abs(r.rect[2] - 240) <= 3 && Math.abs(r.rect[3] - 90) <= 3);
  check("淡いが4辺で浮いているパネルは残る", faint && faint.renderMode === "vector-panel",
    faint ? `${faint.fill} ${faint.renderMode}` : "見つからない");

  // 3) 左右が同系色に挟まれたもの（＝縞と同じ状況）は落とす。上下は地に接するので
  //    2辺しか contrast を持たない。色は 5bit 量子化のバケット境界をまたぐように選ぶ
  //    (R = 63/64/72 → バケット 7/8/9)。同じバケットに入れると連結成分が融合して
  //    そもそも3枚に分かれない（最初にこれで失敗した）。隣接差は 1 と 8 で、
  //    実測したグラデーションの隣接差(中央値 6・範囲 3〜16)と同じ水準。
  const stripePng = await hostGate.rasterize(`
    <svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
      <rect width="400" height="300" fill="#FFFFFF"/>
      <rect x="100" y="90" width="60" height="110" fill="#3F50C8"/>
      <rect x="160" y="90" width="60" height="110" fill="#4050C8"/>
      <rect x="220" y="90" width="60" height="110" fill="#4850C8"/>
    </svg>`);
  const sd = await hostGate.detectUiRegions(stripePng, NO_MERGE);
  const middle = sd.regions.find((r) => Math.abs(r.rect[0] - 160) <= 3 && Math.abs(r.rect[2] - 60) <= 3);
  check("両隣が同系色の中央の帯は raster へ落とす",
    middle && middle.renderMode === "raster", middle ? `${middle.fill} ${middle.renderMode}` : "見つからない");
  const edge = sd.regions.find((r) => Math.abs(r.rect[0] - 100) <= 3 && Math.abs(r.rect[2] - 60) <= 3);
  check("端の帯は3辺で浮くので残る（gate が一律に落としていない）",
    edge && edge.renderMode === "vector-panel", edge ? `${edge.fill} ${edge.renderMode}` : "見つからない");

  // 4) gate は semanticHint を書き換えない（意味の推定と描き方の判断は別問題）
  check("落としても semanticHint は panel のまま",
    middle && middle.semanticHint === "panel", middle && middle.semanticHint);

  // --- 縞ファミリの統合（Task 15） ---
  // gate は「ベクター化しない」ようにするだけで、帯が細かいラスタに砕けたままである点は
  // 直さない。統合が無いと 1本の帯が数十枚の画像アセットとして出力される。
  const MERGE = { minArea: 576, workingMax: 1280 };

  // 5) グラデーション帯は少数のラスタにまとまる
  const gm = await hostGate.detectUiRegions(gradPng, MERGE);
  const bandCount = (regions) => regions.filter(inBand).length;
  check("統合前の帯は多数の領域に砕けている", bandCount(gd.regions) >= 20, String(bandCount(gd.regions)));
  check("統合で帯の領域数が桁で減る", bandCount(gm.regions) * 10 <= bandCount(gd.regions),
    `${bandCount(gd.regions)} → ${bandCount(gm.regions)}`);
  check("統合しても帯は消えない", bandCount(gm.regions) >= 1, String(bandCount(gm.regions)));

  // 6) 3枚の縞は1枚に統合される（union がちょうど矩形で埋まる）
  const sm = await hostGate.detectUiRegions(stripePng, MERGE);
  const merged = sm.regions.filter((r) => r.rect[1] >= 86 && r.rect[1] + r.rect[3] <= 204 &&
    r.rect[0] >= 96 && r.rect[0] + r.rect[2] <= 284);
  check("3枚の縞が1枚に統合される", merged.length === 1, `${merged.length}枚 ${merged.map((r) => r.rect.join(",")).join(" / ")}`);
  check("統合結果は union の矩形になる",
    merged.length === 1 && Math.abs(merged[0].rect[0] - 100) <= 3 && Math.abs(merged[0].rect[2] - 180) <= 4,
    merged.length === 1 ? merged[0].rect.join(",") : "-");
  check("統合結果は raster", merged.length === 1 && merged[0].renderMode === "raster",
    merged.length === 1 ? merged[0].renderMode : "-");

  // 7) **隣接していても色が離れていれば統合しない。**
  //    実画像(Wikipedia の比較表)にある隣り合う4枚のセルがこの形。隙間 0〜1px・同じ帯だが
  //    隣接する色差は 63〜97 あり、これらは正当な個別パネル（実画像 positive の hit 4件）。
  //    single-linkage で色をつないでいく実装にすると、ここでカード群を丸ごと飲み込む。
  const cellsPng = await hostGate.rasterize(`
    <svg xmlns="http://www.w3.org/2000/svg" width="600" height="300">
      <rect width="600" height="300" fill="#FFFFFF"/>
      <rect x="60"  y="100" width="120" height="90" fill="#F4E3FF"/>
      <rect x="180" y="100" width="120" height="90" fill="#FFEEDD"/>
      <rect x="300" y="100" width="120" height="90" fill="#9EFF9E"/>
      <rect x="420" y="100" width="120" height="90" fill="#DDFFFF"/>
    </svg>`);
  const cm = await hostGate.detectUiRegions(cellsPng, MERGE);
  const cells = cm.regions.filter((r) => r.rect[1] >= 96 && r.rect[1] + r.rect[3] <= 194 && r.rect[2] <= 130);
  check("色が離れた隣接セルは統合しない", cells.length === 4, `${cells.length}枚`);
  // 8) **最も重要な安全側のテスト。** 同じ色のカードが余白を挟んで3枚並ぶ形。
  //    色差は 0 なので色の条件は素通りし、隙間も許容内。ここで統合してしまうと
  //    「等間隔に並んだカード群を1枚の画像に潰す」という最悪の壊れ方をする。
  //    防いでいるのは隙間の**実画素**の判定だけ: 余白には地の色が写っており、
  //    両隣のカードの色の範囲から外れる。
  const spacedPng = await hostGate.rasterize(`
    <svg xmlns="http://www.w3.org/2000/svg" width="600" height="300">
      <rect width="600" height="300" fill="#FFFFFF"/>
      <rect x="60"  y="100" width="140" height="90" fill="#4050C8"/>
      <rect x="216" y="100" width="140" height="90" fill="#4050C8"/>
      <rect x="372" y="100" width="140" height="90" fill="#4050C8"/>
    </svg>`);
  const spm = await hostGate.detectUiRegions(spacedPng, MERGE);
  const spaced = spm.regions.filter((r) => r.rect[1] >= 96 && r.rect[1] + r.rect[3] <= 194 && r.rect[2] <= 150);
  check("余白を挟んだ同色カードは統合しない", spaced.length === 3,
    `${spaced.length}枚 ${spm.regions.filter((r) => r.rect[1] >= 96 && r.rect[1] + r.rect[3] <= 194).map((r) => r.rect.join(",")).join(" / ")}`);
  check("余白を挟んだカードはベクターパネルのまま",
    spaced.length === 3 && spaced.every((r) => r.renderMode === "vector-panel"),
    spaced.map((r) => r.renderMode).join(","));

  check("隣接セルはベクターパネルのまま",
    cells.length === 4 && cells.every((r) => r.renderMode === "vector-panel"),
    cells.map((r) => r.renderMode).join(","));
} finally {
  await hostGate.close();
}

// --- テキストの alpha matte と信頼度フォールバック（Task 17） ---
// matte を fallback 設計なしで単独投入しない、というのがこの機能の完了条件。
// 「成功→独立に動かす / 失敗→矩形ラスタのまま fade」までを一体で確かめる。
const hostMatte = new RiveHost(PAGE_SCRIPT);
try {
  // 1) 単色の文字が単色の地に乗っている ＝ 色直線モデルがそのまま成り立つ
  const textPng = await hostMatte.rasterize(`
    <svg xmlns="http://www.w3.org/2000/svg" width="420" height="200">
      <rect width="420" height="200" fill="#F3F5F6"/>
      <rect x="20" y="40" width="380" height="90" rx="10" fill="#194878"/>
      <text x="44" y="98" font-family="Arial, sans-serif" font-size="30" fill="#FFFFFF">Revenue</text>
    </svg>`);
  const td = await hostMatte.detectUiRegions(textPng, { minArea: 576, workingMax: 1280 });
  const textRegions = td.regions.filter((r) => r.semanticHint === "text");
  check("テキスト行を検出している", textRegions.length >= 1, String(textRegions.length));
  const line = textRegions.sort((a, b) => b.rect[2] * b.rect[3] - a.rect[2] * a.rect[3])[0];
  check("単色文字は matteEligible", line && line.matteEligible === true,
    line ? `eligible=${line.matteEligible} conf=${line.matteConfidence}` : "-");
  // matteConfidence = 当てはまり(fit) × 2峰性。1 にはならない — アンチエイリアスの縁は
  // 必ず中間 alpha になるため。実測の分布はテキスト中央 0.246 / 写真中央 0.319（mid）で、
  // このフィクスチャ(30px の白文字)は 0.75 前後。ノイズ側は 0.012〜0.235 に収まる。
  check("信頼度がノイズ側の上限(0.235)を明確に上回る",
    line && line.matteConfidence >= 0.6, line && String(line.matteConfidence));
  check("前景色として白に近い色を推定する",
    line && line.matte && parseInt(line.matte.fg.slice(1, 3), 16) >= 200,
    line && line.matte && line.matte.fg);
  check("背景色として囲んでいるパネルの色を採る",
    line && line.matte && line.matte.bg.toUpperCase() === "#194878",
    line && line.matte && line.matte.bg);

  // 2) 切り出した結果が本当に alpha を持つか。**ここまで確かめないと「矩形のまま」と
  //    区別がつかない。** 文字の内側は不透明、地だった画素は透明になっているはず。
  const sliced = await hostMatte.sliceImage(textPng, [{
    name: "line", polygon: [
      [line.rect[0], line.rect[1]],
      [line.rect[0] + line.rect[2], line.rect[1]],
      [line.rect[0] + line.rect[2], line.rect[1] + line.rect[3]],
      [line.rect[0], line.rect[1] + line.rect[3]],
    ], matte: line.matte,
  }]);
  const st = await (async () => {
    const page = await hostMatte.getPage();
    return page.evaluate(async (b64) => {
      const bin = atob(b64); const by = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) by[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([by], { type: "image/png" }));
      const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
      const x = c.getContext("2d"); x.drawImage(bmp, 0, 0);
      const d = x.getImageData(0, 0, bmp.width, bmp.height).data;
      let opaque = 0, clear = 0, mid = 0, n = 0;
      for (let i = 3; i < d.length; i += 4) {
        n++;
        if (d[i] >= 250) opaque++; else if (d[i] <= 5) clear++; else mid++;
      }
      return { opaque, clear, mid, n };
    }, sliced.parts[0].png);
  })();
  check("切り出しに不透明な画素がある（文字の中身）", st.opaque > 0, JSON.stringify(st));
  check("切り出しに透明な画素がある（地だったところ）", st.clear > st.n * 0.3, JSON.stringify(st));
  check("中間の alpha がある（2値化していない）", st.mid > 0, JSON.stringify(st));

  // 3) **完了条件の本体。** 手続き的ノイズが「テキスト行」として誤検出されても
  //    matte の対象にしてはいけない。semanticHint を信用すると、写真領域の大量の
  //    画素を透明化する事故になる。守っているのは射影残差だけ。
  const noisePng = await hostMatte.rasterize(`
    <svg xmlns="http://www.w3.org/2000/svg" width="420" height="260">
      <defs><filter id="n" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3" seed="7" result="t"/>
        <feColorMatrix in="t" type="saturate" values="0.6"/>
      </filter></defs>
      <rect width="420" height="260" fill="#F3F5F6"/>
      <rect x="40" y="40" width="340" height="180" fill="#888888" filter="url(#n)"/>
    </svg>`);
  const nd = await hostMatte.detectUiRegions(noisePng, { minArea: 576, workingMax: 1280 });
  const noiseText = nd.regions.filter((r) => r.semanticHint === "text");
  check("ノイズ領域がテキストと誤検出され得ることを確認", noiseText.length >= 1,
    `text扱い ${noiseText.length}件 / 全${nd.regions.length}件`);
  check("誤検出されても matteEligible は false",
    noiseText.every((r) => r.matteEligible !== true),
    noiseText.map((r) => `${r.rect.join(",")} conf=${r.matteConfidence}`).join(" | "));
  check("matte 自体が付いていない", noiseText.every((r) => !r.matte));
} finally {
  await hostMatte.close();
}

// --- ラベル入りボタン: 文字で覆われた穴を充填率に算入してベクター化する（2026-08-26） ---
//
// 文字のぶんだけ充填率が 0.85 を割る（実画像で 0.63〜0.84）。穴を無条件に許すと写真も
// 通るので、許すのは「内側に収まるテキスト行が覆う穴」だけ。
const hostLabel = new RiveHost(PAGE_SCRIPT);
try {
  const labelPng = await hostLabel.rasterize(`
    <svg xmlns="http://www.w3.org/2000/svg" width="360" height="200">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1B1F3A"/><stop offset="1" stop-color="#2E2A5C"/></linearGradient></defs>
      <rect width="360" height="200" fill="url(#g)"/>
      <rect x="60" y="70" width="180" height="48" rx="8" fill="#0E8A3C"/>
      <text x="150" y="104" font-family="Arial, sans-serif" font-size="28" font-weight="bold"
            fill="#FFFFFF" text-anchor="middle">SIGN IN</text>
    </svg>`);
  const ld = await hostLabel.detectUiRegions(labelPng, { minArea: 576, workingMax: 1280 });
  const btn = ld.regions.find((r) => r.semanticHint !== "text" && r.rect[2] > 150 && r.rect[2] < 200 && r.rect[3] > 36 && r.rect[3] < 60);
  check("ラベル入りボタンを検出", !!btn, ld.regions.map((r) => `${r.semanticHint}/${r.renderMode}@${r.rect.join(",")}`).join(" "));
  check("ラベル入りでも vector-panel", btn && btn.renderMode === "vector-panel", btn && `${btn.semanticHint}/${btn.renderMode}`);
  check("角丸を測っている", btn && btn.cornerRadius >= 5 && btn.cornerRadius <= 11, btn && String(btn.cornerRadius));
  check("文字で覆われた穴を根拠にしている印", btn && btn.coveredByText === true);
  const inside = (t) => btn && t.rect[0] >= btn.rect[0] && t.rect[1] >= btn.rect[1] &&
    t.rect[0] + t.rect[2] <= btn.rect[0] + btn.rect[2] && t.rect[1] + t.rect[3] <= btn.rect[1] + btn.rect[3];
  const labels = ld.regions.filter((r) => r.semanticHint === "text" && inside(r));
  check("ラベルがボタン内側のテキスト行として独立している", labels.length >= 1,
    ld.regions.filter((r) => r.semanticHint === "text").map((r) => r.rect.join(",")).join(" | "));
  check("ラベル行は1行の高さ（縁のストリップを巻き込んで膨らんでいない）",
    labels.every((r) => r.rect[3] <= 34), labels.map((r) => r.rect.join(",")).join(" | "));

  // 要素数上限で行が落ちるとラベルの消えたボタンになる。行はパネルの直前に並ぶ
  // 編集できるもの（vector-panel と本物のテキスト行）を先に残すので、上限 2 では
  // ボタンとラベルが残り、背景のラスタが落ちる
  const two = buildTree(ld.regions, 2);
  check("上限2: ボタンとラベル行が残る（背景ラスタより優先）",
    two.elements.some((e) => e.coveredByText) && two.elements.some((e) => e.semanticHint === "text"),
    two.elements.map((e) => `${e.semanticHint}/${e.renderMode}@${e.rect.join(",")}`).join(" "));
  const one = buildTree(ld.regions, 1);
  const oneBtn = one.elements.find((e) => e.rect[2] === btn.rect[2] && e.rect[3] === btn.rect[3]);
  check("上限1: ラベル行の席が無いパネルはラスタに落ちる（ラベルの消えたボタンを作らない）",
    oneBtn && oneBtn.renderMode === "raster" && !oneBtn.coveredByText && !one.elements.some((e) => e.semanticHint === "text"),
    one.elements.map((e) => `${e.semanticHint}/${e.renderMode}@${e.rect.join(",")}`).join(" "));
  const full = buildTree(ld.regions, 120);
  const btnEl = full.elements.find((e) => e.coveredByText);
  check("上限なし: ラベル行はパネルの子", btnEl && btnEl.children.length >= 1, btnEl && String(btnEl.children));

  // 縦長 1px のストリップ（パネルの縁のアンチエイリアス）が行の先頭になると行高が膨らむ。
  // 文字の左に 1x60 の縦線を置き、行がそれを取り込まないことを確認する
  const stripPng = await hostLabel.rasterize(`
    <svg xmlns="http://www.w3.org/2000/svg" width="360" height="200">
      <rect width="360" height="200" fill="#FFFFFF"/>
      <rect x="40" y="60" width="1" height="80" fill="#9AA0A6"/>
      <text x="52" y="106" font-family="Arial, sans-serif" font-size="18" fill="#202124">Settings</text>
    </svg>`);
  const sd = await hostLabel.detectUiRegions(stripPng, { minArea: 576, workingMax: 1280 });
  const stripTexts = sd.regions.filter((r) => r.semanticHint === "text");
  check("縦線の隣の1語が1行のまま（高さが文字の高さに収まる）",
    stripTexts.length >= 1 && stripTexts.every((r) => r.rect[3] <= 30),
    stripTexts.map((r) => r.rect.join(",")).join(" | "));
} finally {
  await hostLabel.close();
}

// --- 反実仮想判定（2026-08-26）: 要素を実際に合成し、塗りが露出する画素の誤差で決める ---
//
// 形から「写真かパネルか」を当てるのをやめ、平坦に塗った結果が元と合うかを測る。
// ラベルは上のテキスト行が覆うので誤差に寄与しない。覆われない中身（アイコン・線）は
// 露出して外れ、risk が閾値を超えたらラスタに落ちる。
import { detectUiElements, applyRenderCheck, zOrder, RENDER_RISK_TAU } from "../dist/uiDetect.js";
const hostCf = new RiveHost(PAGE_SCRIPT);
try {
  const cfPng = await hostCf.rasterize(`
    <svg xmlns="http://www.w3.org/2000/svg" width="480" height="240">
      <rect width="480" height="240" fill="#F4F5F7"/>
      <!-- 左: ラベル入りボタン。文字は行として上に乗るので平坦塗りで成立する -->
      <rect x="30" y="80" width="180" height="56" rx="8" fill="#1E6FD9"/>
      <text x="120" y="118" font-family="Arial, sans-serif" font-size="26" font-weight="bold"
            fill="#FFFFFF" text-anchor="middle">SIGN IN</text>
      <!-- 右: 平坦な矩形の上を破線が横切る。破線は要素にならないので塗ると消える -->
      <rect x="270" y="80" width="180" height="56" rx="8" fill="#CBE1FF"/>
      <line x1="250" y1="108" x2="470" y2="108" stroke="#7A7A7A" stroke-width="3" stroke-dasharray="8 6"/>
    </svg>`);
  const cf = await detectUiElements(hostCf, cfPng, { minArea: 576, workingMax: 1280, maxElements: 120 });
  const left = cf.elements.find((e) => e.rect[0] >= 25 && e.rect[0] <= 35 && e.rect[2] > 150 && e.rect[2] < 200);
  const right = cf.elements.find((e) => e.rect[0] >= 265 && e.rect[0] <= 275 && e.rect[2] > 150 && e.rect[2] < 200);
  check("ラベル入りボタンは vector-panel のまま（risk が閾値未満）",
    left && left.renderMode === "vector-panel" && left.renderRisk <= RENDER_RISK_TAU,
    left && `${left.renderMode} risk=${left.renderRisk}`);
  check("破線が横切る矩形は risk が閾値超", right && right.renderRisk > RENDER_RISK_TAU, right && `risk=${right.renderRisk}`);
  // 外れた塊が少なく小さければ、パネルは vector のまま残し、塊だけを切り抜きの子として乗せる
  check("破線の矩形は vector-panel のまま（破線は patch として上に乗る）",
    right && right.renderMode === "vector-panel", right && right.renderMode);
  const patchesR = cf.elements.filter((e) => e.renderPatch && e.parent === (right && right.id));
  check("破線が 1 つの patch にまとまる（塊の統合）", patchesR.length === 1, patchesR.map((p) => p.rect.join(",")).join(" | "));
  check("patch はパネルの塗りを背景にした matte を持つ（独立して動かせる）",
    patchesR.every((p) => p.matteEligible && p.matte && p.matte.bg === right.fill),
    patchesR.map((p) => `${p.matteEligible} fit=${p.matteFit} bg=${p.matte && p.matte.bg}`).join(" | "));
  check("patched を数える", cf.patched >= 1, String(cf.patched));
  // 塊が多すぎる（写真）ならパネルごとラスタへ
  const photoPng = await hostCf.rasterize(`
    <svg xmlns="http://www.w3.org/2000/svg" width="480" height="240">
      <defs><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="2" seed="3"/>
        <feColorMatrix type="saturate" values="0.3"/></filter></defs>
      <rect width="480" height="240" fill="#F4F5F7"/>
      <rect x="60" y="40" width="360" height="160" fill="#8899AA"/>
      <rect x="80" y="60" width="320" height="120" filter="url(#n)"/>
    </svg>`);
  const ph = await detectUiElements(hostCf, photoPng, { minArea: 576, workingMax: 1280, maxElements: 120 });
  check("写真を含む矩形は patch にせずラスタへ落とす",
    ph.elements.filter((e) => e.renderPatch).length === 0 && !ph.elements.some((e) => e.renderMode === "vector-panel" && e.rect[2] > 300 && e.rect[3] > 100 && e.rect[3] < 200),
    ph.elements.map((e) => `${e.semanticHint}/${e.renderMode}@${e.rect.join(",")}${e.renderPatch ? "P" : ""}`).join(" "));

  // renderCheck:false なら判定を通さない（切り分け用）
  const raw = await detectUiElements(hostCf, cfPng, { minArea: 576, workingMax: 1280, maxElements: 120, renderCheck: false });
  const rawRight = raw.elements.find((e) => e.rect[0] >= 265 && e.rect[0] <= 275 && e.rect[2] > 150 && e.rect[2] < 200);
  check("renderCheck:false では破線の矩形も vector-panel", rawRight && rawRight.renderMode === "vector-panel", rawRight && rawRight.renderMode);

  // applyRenderCheck は純関数として: 閾値ちょうどは残し、超えたら落とす
  const els = [
    { id: 1, parent: null, children: [], renderMode: "vector-panel", semanticHint: "panel", rect: [0, 0, 10, 10], fill: "#000000", cornerRadius: 3, coveredByText: true },
    { id: 2, parent: null, children: [], renderMode: "vector-panel", semanticHint: "panel", rect: [20, 0, 10, 10], fill: "#000000" },
  ];
  const r = applyRenderCheck(els, [{ id: 1, exposed: 100, risk: RENDER_RISK_TAU }, { id: 2, exposed: 100, risk: RENDER_RISK_TAU + 0.001 }]);
  check("閾値ちょうどは vector-panel のまま", els[0].renderMode === "vector-panel" && els[0].coveredByText === true);
  check("閾値超はラスタ・image・角丸0・coveredByText 無し",
    els[1].renderMode === "raster" && els[1].semanticHint === "image" && els[1].cornerRadius === 0 && !("coveredByText" in els[1]) && r.demoted === 1);
  check("zOrder は親を子より前に置く",
    (() => { const o = zOrder(cf.elements); const pos = new Map(o.map((e, i) => [e.id, i])); return cf.elements.every((e) => e.parent === null || pos.get(e.parent) < pos.get(e.id)); })());
} finally {
  await hostCf.close();
}

// --- 以降のタスクのテストはこの行の上に追記する（process.exit より下は実行されない） ---
process.exit(failed ? 1 : 0);
