import { ROLE_MOTION, motionFor, motionCapabilityOf } from "../dist/uiPrototype.js";
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
  { id: 1, parent: null, children: [2, 3], renderMode: "vector-panel", semanticHint: "panel", rect: [0, 0, 400, 300], fill: "#1E1E2E", cornerRadius: 0, role: "background" },
  { id: 2, parent: 1, children: [], renderMode: "vector-panel", semanticHint: "panel", rect: [20, 20, 120, 40], fill: "#6C7BFF", cornerRadius: 8, role: "button" },
  { id: 3, parent: 1, children: [], renderMode: "raster", semanticHint: "text",  rect: [20, 80, 200, 18], fill: "#E6E6E6", fontSizePx: 16, role: "text" },
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
    { id: 1, parent: null, children: [2], renderMode: "vector-panel", semanticHint: "panel", rect: [0, 0, 300, 300], fill: "#111111", role: "card" },
    { id: 2, parent: 1, children: [3], renderMode: "vector-panel", semanticHint: "panel", rect: [20, 20, 200, 100], fill: "#6C7BFF", role: "button" },
    { id: 3, parent: 2, children: [], renderMode: "raster", semanticHint: "text", rect: [30, 30, 100, 20], fill: "#FFFFFF", role: "text" },
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

// --- z順(逆パターン): image祖先 -> panel子孫。前段のfixtureは祖先が常にshape、子孫が常に
// imageだったため、「木の順でzを振る」ことと「shapeを全部images(1000+)より前に置く」
// (rivWriter.tsの既定値そのもの)が同じ結果になり、実装を後者に差し替えても見分けが
// つかなかった。ここでは祖先をimage、子孫をpanelにして組を逆転させ、両者が一致しない
// ケースを作る
{
  const inverted = [
    { id: 1, parent: null, children: [2], renderMode: "raster", semanticHint: "image", rect: [0, 0, 300, 200], role: "image" },
    { id: 2, parent: 1, children: [], renderMode: "vector-panel", semanticHint: "panel", rect: [40, 40, 120, 40], fill: "#6C7BFF", role: "button" },
  ];
  const b = buildPrototypeScene({
    elements: inverted, source: { width: 300, height: 200 }, interactions: false, motion: {},
  });
  const zImage = b.spec.images.find((im) => im.id === "el1_image")?.z;
  const zPanel = b.spec.shapes.find((s) => s.id === "el2")?.z;
  check("z(逆パターン): image祖先とpanel子孫がすべて見つかる", zImage !== undefined && zPanel !== undefined,
    `${zImage},${zPanel}`);
  check("z(逆パターン): panel子孫はimage祖先より厳密に大きい", zPanel > zImage, `${zPanel} vs ${zImage}`);
}

// --- idle: RoleMotion.idle を持つ要素だけに適用されるフィルタそのものを検証する。
// 旧テストは json.includes("idle") だけを見ており、アニメーション名が"idle"であれば
// フィルタを反転/削除しても常に通ってしまっていた（対象0件でもタイムライン自体は作る仕様のため）
{
  const idleFixture = [
    { id: 1, parent: null, children: [2], renderMode: "vector-panel", semanticHint: "panel", rect: [0, 0, 300, 300], fill: "#111111", role: "card" }, // idle: float を持つ
    { id: 2, parent: 1, children: [], renderMode: "raster", semanticHint: "text", rect: [20, 20, 100, 20], fill: "#FFFFFF", role: "text" }, // idle を持たない
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
    { id: 1, parent: null, children: [], renderMode: "vector-panel", semanticHint: "panel", rect: [40, 60, 80, 120], fill: "#22AA55", role: "chart" },
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
  elements: [{ id: 1, parent: null, children: [], renderMode: "vector-panel", semanticHint: "panel", rect: [380, 0, 100, 50], fill: "#FFFFFF", role: "panel" }],
  source: { width: 400, height: 300 },
  interactions: false,
  motion: {},
});
check("はみ出しを警告する", over.warnings.length === 1, over.warnings.join(" / "));
check("警告に元と後の値が載る", over.warnings[0].includes("380") && over.warnings[0].includes("20"),
  over.warnings[0]);

// --- 信頼度 → 動かし方（Task 18） ---
// 守っている失敗: 矩形で切り出したラスタは背景が焼き付いており、最下層に元画像が
// 残るこの構成では、動かすと元の位置にも同じ絵が見えて二重になる。
// **静止していれば完全に一致するので再構成誤差では検出できない。**
{
  const el = (o) => ({ parent: null, children: [], semanticHint: "text", role: "text", ...o });

  check("matte 付きは自由に動かせる",
    motionCapabilityOf({ renderMode: "raster", matteEligible: true, matteConfidence: 0.7, rect: [0, 0, 80, 20] }) === "free");
  check("matte 無しは fade のみ",
    motionCapabilityOf({ renderMode: "raster", matteEligible: false, matteConfidence: 0.4, rect: [0, 0, 80, 20] }) === "fade-only");
  check("信頼度が極端に低い小片は背景へ統合",
    motionCapabilityOf({ renderMode: "raster", matteEligible: false, matteConfidence: 0.01, rect: [0, 0, 20, 12] }) === "merge");
  check("小さくても信頼度があれば統合しない",
    motionCapabilityOf({ renderMode: "raster", matteEligible: false, matteConfidence: 0.3, rect: [0, 0, 20, 12] }) === "fade-only");
  check("大きければ信頼度が低くても統合しない（背景ごと動かない大物は残す）",
    motionCapabilityOf({ renderMode: "raster", matteEligible: false, matteConfidence: 0.01, rect: [0, 0, 300, 200] }) === "fade-only");
  check("ベクター図形は制限しない（塗りで再構成されるので焼き付きが無い）",
    motionCapabilityOf({ renderMode: "vector-panel", rect: [0, 0, 80, 20] }) === "free");

  // シーン組み立てを通した挙動。ロールは card（本来 pop-cascade + float + hover:lift）を使い、
  // matte の有無だけで結果が変わることを見る。
  const source = { width: 400, height: 300 };
  const mk = (matteEligible, conf) => buildPrototypeScene({
    elements: [
      el({ id: 1, renderMode: "vector-panel", semanticHint: "panel", role: "background",
           rect: [0, 0, 400, 300], fill: "#101010", children: [2] }),
      el({ id: 2, parent: 1, renderMode: "raster", role: "card", rect: [40, 40, 200, 60],
           matteEligible, matteConfidence: conf }),
    ],
    source, interactions: true, motion: { ambient: true },
  });

  const good = mk(true, 0.7);
  const bad = mk(false, 0.4);

  const entranceOf = (b, target) =>
    (b.spec.animations.find((a) => a.name === "entrance")?.presets ?? [])
      .filter((p) => p.target === target).map((p) => p.preset);
  const idleTargets = (b) =>
    (b.spec.animations.find((a) => a.name === "idle")?.presets ?? []).map((p) => p.target);
  const smNames = (b) => (b.spec.stateMachine?.inputs ?? []).map((i) => i.name);
  const target = "el2_card";

  check("matte 付きはロールどおりの入場", entranceOf(good, target).includes(ROLE_MOTION.card.entrance),
    entranceOf(good, target).join(","));
  check("matte 無しは fade-in に落ちる", entranceOf(bad, target).join(",") === "fade-in",
    entranceOf(bad, target).join(","));
  check("matte 付きは idle が付く", idleTargets(good).includes(target), idleTargets(good).join(","));
  check("matte 無しは idle が付かない", !idleTargets(bad).includes(target), idleTargets(bad).join(","));
  check("matte 付きは hover 入力がある", smNames(good).includes("hover_2"), smNames(good).join(","));
  check("matte 無しは hover 入力が無い", !smNames(bad).includes("hover_2"), smNames(bad).join(","));
  check("制限したことを黙っていない",
    bad.warnings.some((w) => w.includes("fade in place")), bad.warnings.join(" / "));

  // merge: 独立した画像アセットとして出さず、背景に残す
  const merged = mk(false, 0.01);
  const mergedTiny = buildPrototypeScene({
    elements: [
      el({ id: 1, renderMode: "vector-panel", semanticHint: "panel", role: "background",
           rect: [0, 0, 400, 300], fill: "#101010", children: [2] }),
      el({ id: 2, parent: 1, renderMode: "raster", role: "text", rect: [40, 40, 30, 12],
           matteEligible: false, matteConfidence: 0.01 }),
    ],
    source, interactions: true, motion: { ambient: true },
  });
  check("大きい要素は信頼度が低くても切り出す",
    merged.rasterRegions.some((r) => r.name === target), merged.rasterRegions.map((r) => r.name).join(","));
  check("小さく信頼度の無い要素は切り出さない（背景に残す）",
    mergedTiny.rasterRegions.length === 0, mergedTiny.rasterRegions.map((r) => r.name).join(","));
  check("背景へ統合したことを警告に出す",
    mergedTiny.warnings.some((w) => w.includes("left in the background")), mergedTiny.warnings.join(" / "));
}

// --- 以降のタスクのテストはこの行の上に追記する（process.exit より下は実行されない） ---
process.exit(failed ? 1 : 0);
