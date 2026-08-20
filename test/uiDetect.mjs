import { buildTree } from "../dist/uiDetect.js";
import { paletteFromColors } from "../dist/designTokens.js";

let failed = 0;
function check(label, cond, detail = "") {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed++;
}

// 外側カード(0,0,200,200) の中にボタン(20,20,60,30) がある
const regions = [
  { kind: "panel", rect: [0, 0, 200, 200], fill: "#1E1E2E" },
  { kind: "panel", rect: [20, 20, 60, 30], fill: "#6C7BFF" },
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
  kind: "panel", rect: [0, 0, 10 * (i + 1), 10], fill: "#000000",
}));
const cut = buildTree(many, 3);
check("maxElements で 3 件に絞る", cut.elements.length === 3, String(cut.elements.length));
check("落とした数を返す", cut.dropped === 2, String(cut.dropped));
check("残るのは面積上位", cut.elements.every((e) => e.rect[2] >= 30));

// 親候補が複数あるときは「95%以上含む最小の矩形」を選ぶ
const nested = [
  { kind: "panel", rect: [0, 0, 300, 300], fill: "#111111" },
  { kind: "panel", rect: [0, 0, 200, 200], fill: "#222222" },
  { kind: "panel", rect: [10, 10, 50, 50], fill: "#333333" },
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
  check("kind は panel", btn && btn.kind === "panel", btn && btn.kind);
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

// --- 以降のタスクのテストはこの行の上に追記する（process.exit より下は実行されない） ---
process.exit(failed ? 1 : 0);
