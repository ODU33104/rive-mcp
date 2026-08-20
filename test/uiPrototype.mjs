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
check("interactions で SM がある", json.includes("Interactions"));
check("button の press 入力がある", json.includes("press_2"));
check("警告なし", built.warnings.length === 0, built.warnings.join(" / "));

// --- z順: card(1) -> button(2) -> text(3) の3階層。祖先は常に子孫より小さいzでなければ
// ならない。特定の数値ではなく「親<子」の関係だけを見る（カウンタの基準値や刻み幅が
// 変わっても壊れないように）
{
  const nested = [
    { id: 1, parent: null, children: [2], kind: "panel", rect: [0, 0, 300, 300], fill: "#111111", role: "card" },
    { id: 2, parent: 1, children: [3], kind: "panel", rect: [20, 20, 200, 100], fill: "#6C7BFF", role: "button" },
    { id: 3, parent: 2, children: [], kind: "text", rect: [30, 30, 100, 20], fill: "#FFFFFF", role: "text" },
  ];
  const b = buildPrototypeScene({
    elements: nested, source: { width: 300, height: 300 }, interactions: false, motion: {},
  });
  const zCard = b.spec.shapes.find((s) => s.id === "el1")?.z;
  const zButton = b.spec.shapes.find((s) => s.id === "el2")?.z;
  const zText = b.spec.images.find((im) => im.id === "el3_text")?.z;
  check("z: card/button/text がすべて見つかる", zCard !== undefined && zButton !== undefined && zText !== undefined,
    `${zCard},${zButton},${zText}`);
  check("z: button は親cardより厳密に大きい", zButton > zCard, `${zButton} vs ${zCard}`);
  check("z: text は親buttonより厳密に大きい", zText > zButton, `${zText} vs ${zButton}`);
  check("z: text は祖先cardより厳密に大きい（推移律）", zText > zCard, `${zText} vs ${zCard}`);
}

// --- idle: RoleMotion.idle を持つ要素だけに適用されるフィルタそのものを検証する。
// 旧テストは json.includes("idle") だけを見ており、アニメーション名が"idle"であれば
// フィルタを反転/削除しても常に通ってしまっていた（対象0件でもタイムライン自体は作る仕様のため）
{
  const idleFixture = [
    { id: 1, parent: null, children: [2], kind: "panel", rect: [0, 0, 300, 300], fill: "#111111", role: "card" }, // idle: float を持つ
    { id: 2, parent: 1, children: [], kind: "text", rect: [20, 20, 100, 20], fill: "#FFFFFF", role: "text" }, // idle を持たない
  ];
  const withAmbient = buildPrototypeScene({
    elements: idleFixture, source: { width: 300, height: 300 }, interactions: false, motion: { ambient: true },
  });
  const idleAnim = withAmbient.spec.animations.find((a) => a.name === "idle");
  check("idle: ambient trueでタイムラインが存在", !!idleAnim);
  const idleTargets = (idleAnim?.presets ?? []).map((p) => p.target);
  check("idle: idleを持つcardが対象に含まれる", idleTargets.includes("el1"), idleTargets.join(","));
  check("idle: idleを持たないtextは対象に含まれない", !idleTargets.includes("el2_text"), idleTargets.join(","));

  const withoutAmbient = buildPrototypeScene({
    elements: idleFixture, source: { width: 300, height: 300 }, interactions: false, motion: { ambient: false },
  });
  check("idle: ambient falseならidleタイムライン自体が無い",
    !(withoutAmbient.spec.animations ?? []).some((a) => a.name === "idle"));
}

// --- chart-grow: 下端中心にグループを置き、シェイプをそのグループのローカル(0, -h/2)へ
// 移してから、グループのscaleYを0→1する構造そのものを検証する
{
  const chartFixture = [
    { id: 1, parent: null, children: [], kind: "panel", rect: [40, 60, 80, 120], fill: "#22AA55", role: "chart" },
  ];
  const b = buildPrototypeScene({
    elements: chartFixture, source: { width: 200, height: 200 }, interactions: false, motion: { entranceMs: 800 },
  });
  const group = (b.spec.groups ?? [])[0];
  check("chart-grow: 矩形下端中心にグループがある", !!group && group.x === 80 && group.y === 180,
    JSON.stringify(group));
  const shape = b.spec.shapes.find((s) => s.id === "el1");
  check("chart-grow: シェイプがグループへ再親付けされる", shape?.parent === group?.id, shape?.parent);
  check("chart-grow: シェイプのローカル位置が (0, -h/2)", shape?.x === 0 && shape?.y === -60,
    `${shape?.x},${shape?.y}`);
  const entranceAnim = b.spec.animations.find((a) => a.name === "entrance");
  const growTrack = entranceAnim?.tracks.find((t) => t.target === group?.id && t.property === "scaleY");
  check("chart-grow: グループにscaleYトラックがある", !!growTrack);
  check("chart-grow: scaleY が 0→1", growTrack?.keyframes[0]?.value === 0 &&
    growTrack?.keyframes[growTrack.keyframes.length - 1]?.value === 1,
    JSON.stringify(growTrack?.keyframes));
}

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
