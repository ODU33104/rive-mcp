// Phase 2 検証: ライター新機能(trim/clip/follow/solo/開パス/detached) + SVGインポート + 逆コンパイル
import { strict as assert } from "node:assert";
import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRiv } from "../dist/rivWriter.js";
import { lintRiv } from "../dist/rivLint.js";
import { importSvg } from "../dist/svgImport.js";
import { decompileRiv } from "../dist/rivDecompile.js";
import { RiveHost } from "../dist/riveHost.js";
import { PAGE_SCRIPT } from "../dist/pageScript.js";

const out = mkdtempSync(join(tmpdir(), "rive-phase2-"));
let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log("  ok", name); }
  catch (e) { failures++; console.error("  FAIL", name, "-", e.message); }
};

// ---- 1. ライター新機能 ------------------------------------------------------
console.log("writer features");
const featScene = {
  artboard: { name: "Feat", width: 400, height: 300 },
  backgroundColor: "#141a22",
  groups: [
    { id: "orbiter", x: 0, y: 0 },
    { id: "poses", x: 320, y: 240, solo: true, active: "poseA" },
  ],
  shapes: [
    { id: "check", type: "polygon", x: 120, y: 150, closed: false,
      points: [{ x: -40, y: 0 }, { x: -10, y: 30 }, { x: 45, y: -35 }],
      stroke: { color: "#54ca75", thickness: 12, cap: "round", join: "round", trim: { start: 0, end: 0 } } },
    { id: "orbitPath", type: "ellipse", x: 270, y: 110, width: 140, height: 90 },
    { id: "sat", type: "ellipse", x: 0, y: 0, parent: "orbiter", width: 18, height: 18, fill: { color: "#28bce5" } },
    { id: "mask", type: "ellipse", x: 120, y: 240, width: 80, height: 80 },
    { id: "clipped", type: "rect", x: 120, y: 240, width: 120, height: 120, clipBy: "mask",
      fill: { gradient: { type: "linear", stops: [{ color: "#e5a428" }, { color: "#e55c28" }] } } },
    { id: "poseA", type: "rect", x: 0, y: 0, parent: "poses", width: 40, height: 40, fill: { color: "#c084fc" } },
    { id: "poseB", type: "ellipse", x: 0, y: 0, parent: "poses", width: 44, height: 44, fill: { color: "#54ca75" } },
  ],
  constraints: [{ type: "followPath", item: "orbiter", path: "orbitPath", distance: 0, orient: true }],
  animations: [{ name: "play", duration: 120, fps: 60, loop: "loop", tracks: [
    { target: "check", property: "trimEnd", keyframes: [
      { frame: 0, value: 0 }, { frame: 40, value: 1, easing: "emphasized-decel" }, { frame: 120, value: 1 } ] },
    { target: "orbiter", property: "followDistance", keyframes: [
      { frame: 0, value: 0 }, { frame: 120, value: 1, easing: "linear" } ] },
    { target: "poses", property: "soloActive", keyframes: [
      { frame: 0, ref: "poseA" }, { frame: 60, ref: "poseB" } ] },
  ] }],
};
const featBytes = createRiv(structuredClone(featScene)).bytes;
const featPath = join(out, "features.riv");
writeFileSync(featPath, featBytes);
check("no lint errors", () => {
  const bad = lintRiv(featBytes).filter((f) => f.severity === "error");
  assert.equal(bad.length, 0, JSON.stringify(bad));
});
check("detached vertex via cubic.inRotation", () => {
  const b = createRiv({
    artboard: { width: 100, height: 100 },
    shapes: [{ id: "d", type: "polygon", x: 50, y: 50, points: [
      { x: -20, y: 0, cubic: { rotation: 90, inRotation: 180, inDistance: 8, outDistance: 12 } },
      { x: 20, y: 0 }, { x: 0, y: 20 },
    ], fill: { color: "#204060" } }],
  }).bytes;
  assert.ok(b.length > 100);
});

// ---- 2. SVG インポート ------------------------------------------------------
console.log("svg import");
const svg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#4facfe"/><stop offset="1" stop-color="#00f2fe"/>
  </linearGradient></defs>
  <rect x="10" y="10" width="80" height="60" rx="8" fill="url(#g1)"/>
  <path d="M50 30 a12 12 0 1 0 0.001 0 Z M50 36 a6 6 0 1 1 -0.001 0 Z" fill="#ffffff" fill-opacity="0.9"/>
  <g transform="translate(50,80) rotate(10)">
    <polyline points="-20,0 -8,8 16,-10" fill="none" stroke="#2dd36f" stroke-width="5" stroke-linecap="round"/>
  </g>
  <circle cx="82" cy="18" r="6" fill="#ff6b6b"/>
</svg>`;
const imported = importSvg(svg, { idPrefix: "ic_" });
check("4 shapes imported", () => assert.equal(imported.shapes.length, 4));
check("gradient carried over", () => assert.ok(imported.shapes.some((s) => s.fill?.gradient?.stops.length === 2)));
check("multi-contour donut (2 subpaths)", () => assert.ok(imported.shapes.some((s) => s.subpaths?.length === 2)));
check("open polyline stroke with round cap", () => {
  const pl = imported.shapes.find((s) => s.stroke && !s.fill);
  assert.ok(pl && pl.stroke.cap === "round" && pl.subpaths.every((sp) => !sp.closed));
});
const svgScene = {
  artboard: { name: "Svg", width: 120, height: 120 },
  groups: [{ id: "root", x: 10, y: 10 }],
  shapes: imported.shapes.map((s) => ({ ...s, parent: "root" })),
};
const svgBytes = createRiv(svgScene).bytes;

// ---- 3. 逆コンパイル --------------------------------------------------------
console.log("decompile");
const rt = decompileRiv(featBytes);
check("full coverage on own features file", () => assert.deepEqual(rt.coverage.skipped, {}));
check("trim/solo/follow restored", () => {
  const anim = rt.scene.animations[0];
  const props = new Set(anim.tracks.map((t) => t.property));
  assert.ok(props.has("trimEnd") && props.has("followDistance") && props.has("soloActive"), JSON.stringify([...props]));
  assert.ok(rt.scene.constraints?.some((c) => c.type === "followPath"));
  assert.ok(rt.scene.shapes.some((s) => s.clipBy === "mask"));
});
const rtBytes = createRiv(rt.scene).bytes;
check("decompiled scene recompiles", () => assert.ok(rtBytes.length > 500));
const vehicles = decompileRiv(new Uint8Array(readFileSync(new URL("../samples/vehicles.riv", import.meta.url))));
check("pro file decompiles at scale", () => {
  const abs = vehicles.scene.artboards ?? [vehicles.scene];
  const shapes = abs.reduce((n, a) => n + (a.shapes?.length ?? 0), 0);
  assert.ok(shapes > 100, `got ${shapes}`);
});

// ---- 4. 公式ランタイム検証 --------------------------------------------------
console.log("official runtime validation");
const host = new RiveHost(PAGE_SCRIPT);
try {
  for (const [name, bytes, anim] of [["features", featBytes, "play"], ["svg", svgBytes, undefined], ["roundtrip", rtBytes, "play"]]) {
    const info = await host.inspect(Buffer.from(bytes));
    assert.ok(info.artboards.length >= 1);
    const r = await host.renderFrames(Buffer.from(bytes), { animation: anim, startTime: anim ? 0.8 : 0, frameCount: 1, width: 300, format: "png" });
    assert.ok(r.frames[0].length > 1000);
    console.log(`  ok runtime accepts+renders ${name}`);
  }
} catch (e) {
  failures++;
  console.error("  FAIL runtime -", e.message);
} finally {
  await host.close();
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nphase2: all checks passed");
