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

// --- 以降のタスクのテストはこの行の上に追記する（process.exit より下は実行されない） ---
process.exit(failed ? 1 : 0);
