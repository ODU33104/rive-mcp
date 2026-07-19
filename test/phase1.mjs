// Phase 1 検証: デザイントークン → プリセット展開 → 公式ランタイム受理 → モーションリント
import { strict as assert } from "node:assert";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateTokens, contrastRatio } from "../dist/designTokens.js";
import { createRiv } from "../dist/rivWriter.js";
import { lintRiv } from "../dist/rivLint.js";
import { computeMetrics, CRITIQUE_CHECKLIST } from "../dist/critique.js";
import { RiveHost } from "../dist/riveHost.js";
import { PAGE_SCRIPT } from "../dist/pageScript.js";

const out = mkdtempSync(join(tmpdir(), "rive-phase1-"));
let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log("  ok", name);
  } catch (e) {
    failures++;
    console.error("  FAIL", name, "-", e.message);
  }
};

// ---- 1. デザイントークン ---------------------------------------------------
console.log("design tokens");
const tokens = generateTokens({ mood: "tech", scheme: "dark" });
check("palette is valid hex", () => {
  for (const v of Object.values(tokens.palette)) assert.match(v, /^#[0-9a-f]{6}$/);
});
check("text/bg contrast >= 7 (AAA)", () => assert.ok(tokens.contrast.textOnBg >= 7, `got ${tokens.contrast.textOnBg}`));
check("deterministic", () => {
  assert.deepEqual(generateTokens({ mood: "tech", scheme: "dark" }), tokens);
});
check("seed hue is respected", () => {
  const t = generateTokens({ seed: "#e94560", mood: "playful" });
  assert.ok(contrastRatio(t.palette.text, t.palette.bg) >= 7);
});

// ---- 2. プリセット展開 + ランタイム受理 -------------------------------------
console.log("presets scene");
const P = tokens.palette;
const scene = {
  artboard: { name: "Phase1", width: 400, height: 300 },
  backgroundColor: P.bg,
  shapes: [
    { id: "card", type: "rect", x: 200, y: 150, width: 180, height: 110, cornerRadius: 12,
      fill: { gradient: { type: "linear", stops: tokens.gradients.primary.map((c) => ({ color: c })) } } },
    { id: "dot1", type: "ellipse", x: 140, y: 220, width: 20, height: 20, fill: { color: P.accent } },
    { id: "dot2", type: "ellipse", x: 200, y: 220, width: 20, height: 20, fill: { color: P.accent } },
    { id: "dot3", type: "ellipse", x: 260, y: 220, width: 20, height: 20, fill: { color: P.accentSoft } },
    { id: "lid", type: "ellipse", x: 200, y: 120, width: 30, height: 14, opacity: 0, fill: { color: P.surface } },
  ],
  animations: [
    { name: "intro", duration: 120, fps: 60, loop: "oneShot", presets: [
      { preset: "pop-in", target: "card" },
      { preset: "rise-in", targets: ["dot1", "dot2", "dot3"], at: 20, stagger: 4 },
      { preset: "pulse", target: "card", at: 70 },
    ], tracks: [] },
    { name: "idle", duration: 240, fps: 60, loop: "loop", presets: [
      { preset: "float", target: "card" },
      { preset: "breathing", target: "card" },
      { preset: "blink", target: "lid" },
    ], tracks: [] },
  ],
};
const { bytes } = createRiv(structuredClone(scene));
const rivPath = join(out, "phase1.riv");
writeFileSync(rivPath, bytes);
console.log("  wrote", rivPath, bytes.length, "bytes");

check("no lint errors and no motion warnings", () => {
  const findings = lintRiv(bytes);
  const bad = findings.filter((f) => f.severity !== "info");
  assert.equal(bad.length, 0, JSON.stringify(bad, null, 1));
});
check("overlapping preset conflict is rejected", () => {
  const dup = structuredClone(scene);
  dup.animations[0].tracks = [{ target: "card", property: "scaleX", keyframes: [{ frame: 0, value: 1 }, { frame: 10, value: 2 }] }];
  assert.throws(() => createRiv(dup), /overlaps/);
});
check("overflow preset is rejected with a clear error", () => {
  const shortAnim = structuredClone(scene);
  shortAnim.animations[0].duration = 10;
  assert.throws(() => createRiv(shortAnim), /duration/);
});

// ---- 3. モーションリンターが下手なファイルを検出する -------------------------
console.log("motion lint negative cases");
const robotic = createRiv({
  artboard: { name: "Bad", width: 400, height: 300 },
  shapes: [
    { id: "a", type: "rect", x: 50, y: 50, width: 40, height: 40, fill: { color: "#ff0000" } },
    { id: "b", type: "rect", x: 50, y: 120, width: 40, height: 40, opacity: 0, fill: { color: "#00ff00" } },
    { id: "c", type: "rect", x: 50, y: 190, width: 40, height: 40, opacity: 0, fill: { color: "#0000ff" } },
    { id: "d", type: "rect", x: 50, y: 260, width: 40, height: 40, opacity: 0, fill: { color: "#ffff00" } },
  ],
  animations: [{ name: "bad", duration: 60, tracks: [
    { target: "a", property: "x", keyframes: [{ frame: 0, value: 50 }, { frame: 20, value: 300 }, { frame: 40, value: 50 }, { frame: 60, value: 300 }] },
    { target: "a", property: "y", keyframes: [{ frame: 0, value: 50 }, { frame: 2, value: 280 }] },
    { target: "a", property: "scaleX", keyframes: [{ frame: 0, value: 1 }, { frame: 30, value: 1.5 }] },
    ...["b", "c", "d"].map((id) => ({ target: id, property: "opacity", keyframes: [{ frame: 0, value: 0 }, { frame: 20, value: 1 }] })),
  ] }],
}).bytes;
const badFindings = lintRiv(robotic);
const rules = new Set(badFindings.map((f) => f.rule));
check("motion-robotic detected", () => assert.ok(rules.has("motion-robotic"), JSON.stringify([...rules])));
check("motion-teleport detected", () => assert.ok(rules.has("motion-teleport")));
check("motion-no-stagger detected", () => assert.ok(rules.has("motion-no-stagger")));
check("motion-lopsided-scale detected", () => assert.ok(rules.has("motion-lopsided-scale")));

// ---- 4. critique メトリクス -------------------------------------------------
console.log("critique metrics");
const metrics = computeMetrics(bytes);
check("easing distribution counts cubic", () => assert.ok(metrics.motion.easingDistribution.cubic > 0));
check("palette extracted", () => assert.ok(metrics.color.distinctFills >= 3));
check("no oversaturated colors from tokens", () => assert.equal(metrics.color.oversaturated.length, 0, JSON.stringify(metrics.color.oversaturated)));
check("checklist mentions all 6 axes", () => assert.equal((CRITIQUE_CHECKLIST.match(/^\d\./gm) ?? []).length, 6));

// ---- 5. 公式ランタイムで受理・レンダリング ----------------------------------
console.log("official runtime validation");
const host = new RiveHost(PAGE_SCRIPT);
try {
  const info = await host.inspect(Buffer.from(bytes));
  assert.equal(info.artboards[0].animations.length, 2);
  console.log("  ok runtime accepts file:", JSON.stringify(info.artboards[0].animations.map((a) => a.name)));
  const r = await host.renderFrames(Buffer.from(bytes), { animation: "intro", startTime: 1.0, frameCount: 1, format: "png", width: 200 });
  assert.ok(r.frames[0].length > 1000);
  console.log("  ok rendered intro frame");
} catch (e) {
  failures++;
  console.error("  FAIL runtime validation -", e.message);
} finally {
  await host.close();
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nphase1: all checks passed");
