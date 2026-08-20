import { buildTree } from "../dist/uiDetect.js";

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

// --- 以降のタスクのテストはこの行の上に追記する（process.exit より下は実行されない） ---
process.exit(failed ? 1 : 0);
