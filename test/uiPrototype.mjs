import { ROLE_MOTION, motionFor } from "../dist/uiPrototype.js";
import { PRESET_NAMES, AMBIENT_PRESETS } from "../dist/motionPresets.js";

let failed = 0;
function check(label, cond, detail = "") {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed++;
}

const roles = Object.keys(ROLE_MOTION);
check("16 の役割を網羅", roles.length === 16, String(roles.length));
check("button は press する", ROLE_MOTION.button.press === true);
check("background は press しない", !ROLE_MOTION.background.press);
check("card は idle を持つ", !!ROLE_MOTION.card.idle);

// entrance に書いたプリセットは実在しなければならない。
// 存在しない名前を書くと展開時に黙って無視され「動かない .riv」ができる
const known = new Set([...PRESET_NAMES, "chart-grow"]);
for (const [role, m] of Object.entries(ROLE_MOTION)) {
  check(`${role} の entrance が実在`, known.has(m.entrance), m.entrance);
  // idle は常時ループ枠。ワンショット系(attention/heartbeat等)を書くと
  // シーンの「待機中の動き」が一瞬で終わり、以降静止したままになる
  if (m.idle) check(`${role} の idle が ambient`, AMBIENT_PRESETS.has(m.idle), m.idle);
}
check("未知の役割は panel 相当にフォールバック", motionFor("unknown-role") === ROLE_MOTION.panel);

import { buildPrototypeScene } from "../dist/uiPrototype.js";

const elements = [
  { id: 1, parent: null, children: [2, 3], kind: "panel", rect: [0, 0, 400, 300], fill: "#1E1E2E", cornerRadius: 0, role: "background" },
  { id: 2, parent: 1, children: [], kind: "panel", rect: [20, 20, 120, 40], fill: "#6C7BFF", cornerRadius: 8, role: "button" },
  { id: 3, parent: 1, children: [], kind: "text",  rect: [20, 80, 200, 18], fill: "#E6E6E6", fontSizePx: 16, role: "text" },
];
const built = buildPrototypeScene({
  elements,
  source: { width: 400, height: 300 },
  interactions: true,
  motion: { entranceMs: 1200, ambient: true },
});
const json = JSON.stringify(built.spec);

check("panel はベクター化される", json.includes("6C7BFF"));
check("text はラスタ切り出し対象", built.rasterRegions.some((r) => r.name.includes("3")),
  built.rasterRegions.map((r) => r.name).join(","));
check("panel はラスタにしない", !built.rasterRegions.some((r) => r.name.includes("el2")));
check("entrance タイムラインがある", json.includes("entrance"));
check("ambient で idle タイムラインがある", json.includes("idle"));
check("interactions で SM がある", json.includes("Interactions"));
check("button の press 入力がある", json.includes("press_2"));
check("警告なし", built.warnings.length === 0, built.warnings.join(" / "));

// 画像外へはみ出す矩形はクランプし、警告に載せる（黙って直さない）
const over = buildPrototypeScene({
  elements: [{ id: 1, parent: null, children: [], kind: "panel", rect: [380, 0, 100, 50], fill: "#FFFFFF", role: "panel" }],
  source: { width: 400, height: 300 },
  interactions: false,
  motion: {},
});
check("はみ出しを警告する", over.warnings.length === 1, over.warnings.join(" / "));
check("警告に元と後の値が載る", over.warnings[0].includes("380") && over.warnings[0].includes("20"),
  over.warnings[0]);

// --- 以降のタスクのテストはこの行の上に追記する（process.exit より下は実行されない） ---
process.exit(failed ? 1 : 0);
