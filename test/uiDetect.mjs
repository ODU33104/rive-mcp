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

// --- 以降のタスクのテストはこの行の上に追記する（process.exit より下は実行されない） ---
process.exit(failed ? 1 : 0);
