// Lottie → riv_create シーン仕様変換器 の検証
// フィクスチャはネット不要のJSONリテラル。末尾で任意に npm pack lottie-web の実例も通す。
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importLottie } from "../dist/lottieImport.js";
import { createRiv } from "../dist/rivWriter.js";
import { RiveHost } from "../dist/riveHost.js";
import { PAGE_SCRIPT } from "../dist/pageScript.js";

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
const toHex = (v) => Math.round(v * 255).toString(16).padStart(2, "0");

// ============================================================
// 1. バウンシングボール: 位置キーフレーム3点 + カスタムベジェi/o + 不透明度フェード
// ============================================================
console.log("1. bouncing ball");
const bounceLottie = {
  v: "5.9.0", fr: 60, ip: 0, op: 60, w: 200, h: 200, nm: "bounce",
  layers: [
    {
      ddd: 0, ind: 1, ty: 4, nm: "ball", sr: 1,
      ks: {
        o: { a: 1, k: [
          { t: 0, s: [100], e: [30], i: { x: [0.5], y: [1] }, o: { x: [0.5], y: [0] } },
          { t: 60, s: [30] },
        ] },
        r: { a: 0, k: 0 },
        p: { a: 1, k: [
          { t: 0, s: [100, 150, 0], e: [100, 50, 0], o: { x: [0.58, 0.3, 0.58], y: [1, 0.1, 1] } },
          { t: 30, s: [100, 50, 0], e: [100, 150, 0], i: { x: [0.42, 0.6, 0.42], y: [0, 0.9, 0] }, o: { x: [0.8, 0.8, 0.8], y: [0.2, 0.2, 0.2] } },
          { t: 60, s: [100, 150, 0], i: { x: [0.2, 0.2, 0.2], y: [0.8, 0.8, 0.8] } },
        ] },
        a: { a: 0, k: [0, 0, 0] },
        s: { a: 0, k: [100, 100, 100] },
      },
      ao: 0, ip: 0, op: 60, st: 0,
      shapes: [
        { ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [80, 80] }, nm: "ellipse" },
        { ty: "fl", c: { a: 0, k: [0.9, 0.2, 0.2, 1] }, o: { a: 0, k: 100 }, nm: "fill" },
      ],
    },
    // 未対応機能が隠されず coverage に積まれることの確認用テキストレイヤー
    { ind: 2, ty: 5, nm: "caption", ip: 0, op: 60, st: 0, ks: {} },
  ],
};
const bounceRes = importLottie(bounceLottie, { idPrefix: "" });

check("composition metadata", () => {
  assert.equal(bounceRes.width, 200);
  assert.equal(bounceRes.height, 200);
  assert.equal(bounceRes.fps, 60);
  assert.equal(bounceRes.durationFrames, 60);
});
check("one group, one ellipse shape", () => {
  assert.equal(bounceRes.groups.length, 1);
  assert.equal(bounceRes.shapes.length, 1);
  assert.equal(bounceRes.shapes[0].type, "ellipse");
  assert.equal(bounceRes.shapes[0].width, 80);
  assert.equal(bounceRes.shapes[0].height, 80);
});
check("fill color converted from 0-1 rgb + opacity", () => {
  const expected = "#" + toHex(1) + toHex(0.9) + toHex(0.2) + toHex(0.2);
  assert.equal(bounceRes.shapes[0].fill.color, expected);
});
check("text layer (ty=5) is skipped and counted, not silently dropped", () => {
  assert.equal(bounceRes.coverage.skipped["text-layer"], 1);
  assert.ok(bounceRes.warnings.some((w) => w.includes("text layers")));
});
check("one animation with x/y/opacity tracks, 3 position keyframes each", () => {
  assert.equal(bounceRes.animations.length, 1);
  const anim = bounceRes.animations[0];
  assert.equal(anim.name, "bounce");
  assert.equal(anim.fps, 60);
  assert.equal(anim.duration, 60);
  const gid = bounceRes.groups[0].id;
  const xTrack = anim.tracks.find((t) => t.target === gid && t.property === "x");
  const yTrack = anim.tracks.find((t) => t.target === gid && t.property === "y");
  const oTrack = anim.tracks.find((t) => t.target === gid && t.property === "opacity");
  assert.ok(xTrack && yTrack && oTrack, "expected x/y/opacity tracks");
  assert.equal(xTrack.keyframes.length, 3);
  assert.equal(yTrack.keyframes.length, 3);
  assert.deepEqual(xTrack.keyframes.map((k) => k.frame), [0, 30, 60]);
  assert.deepEqual(xTrack.keyframes.map((k) => k.value), [100, 100, 100]);
  assert.deepEqual(yTrack.keyframes.map((k) => k.value), [150, 50, 150]);
});
check("custom bezier i/o tangents preserved exactly (not collapsed to a named preset)", () => {
  const gid = bounceRes.groups[0].id;
  const anim = bounceRes.animations[0];
  const xTrack = anim.tracks.find((t) => t.target === gid && t.property === "x");
  const yTrack = anim.tracks.find((t) => t.target === gid && t.property === "y");
  assert.deepEqual(xTrack.keyframes[1].easing, [0.58, 1, 0.42, 0]);
  assert.deepEqual(xTrack.keyframes[2].easing, [0.8, 0.2, 0.2, 0.8]);
  assert.deepEqual(yTrack.keyframes[1].easing, [0.3, 0.1, 0.6, 0.9]);
});
check("opacity fade 100% -> 30%", () => {
  const gid = bounceRes.groups[0].id;
  const oTrack = bounceRes.animations[0].tracks.find((t) => t.target === gid && t.property === "opacity");
  assert.equal(oTrack.keyframes.length, 2);
  assert.equal(oTrack.keyframes[0].value, 1);
  assert.ok(Math.abs(oTrack.keyframes[1].value - 0.3) < 1e-9);
});
check("scene compiles via createRiv with no writer errors", () => {
  const { warnings } = createRiv({
    artboard: { name: "Bounce", width: bounceRes.width, height: bounceRes.height },
    groups: bounceRes.groups, shapes: bounceRes.shapes, animations: bounceRes.animations,
  });
  assert.equal(warnings.length, 0, JSON.stringify(warnings));
});

// ============================================================
// 2. グラデーション矩形 + トリムパスアニメ (JSON文字列入力での動作も兼ねて検証)
// ============================================================
console.log("2. gradient rect + trim animation");
const trimRectLottie = {
  v: "5.9.0", fr: 30, ip: 0, op: 30, w: 300, h: 200, nm: "trimrect",
  layers: [
    {
      ind: 1, ty: 4, nm: "bar", ip: 0, op: 30, st: 0,
      ks: { p: { a: 0, k: [150, 100] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
      shapes: [
        { ty: "rc", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [160, 40] }, r: { a: 0, k: 0 } },
        { ty: "gf", t: 1, g: { p: 2, k: { a: 0, k: [0, 1, 0, 0, 1, 0, 0, 1] } }, s: { a: 0, k: [-80, 0] }, e: { a: 0, k: [80, 0] } },
        { ty: "st", c: { a: 0, k: [1, 1, 1, 1] }, o: { a: 0, k: 100 }, w: { a: 0, k: 4 }, lc: 2, lj: 2 },
        {
          ty: "tm", s: { a: 0, k: 0 }, o: { a: 0, k: 0 },
          e: { a: 1, k: [
            { t: 0, s: [0], e: [100], o: { x: [0.67], y: [1] } },
            { t: 30, s: [100], i: { x: [0.33], y: [0] } },
          ] },
        },
      ],
    },
  ],
};
const trimRes = importLottie(JSON.stringify(trimRectLottie), { idPrefix: "tr_" });

check("rect stays a native rect (single geometry item)", () => {
  assert.equal(trimRes.shapes.length, 1);
  const s = trimRes.shapes[0];
  assert.equal(s.type, "rect");
  assert.equal(s.width, 160);
  assert.equal(s.height, 40);
  assert.ok(s.id.startsWith("tr_"));
});
check("gradient fill stops + endpoints", () => {
  const g = trimRes.shapes[0].fill.gradient;
  assert.equal(g.type, "linear");
  assert.equal(g.stops.length, 2);
  assert.equal(g.stops[0].color, "#ff" + toHex(1) + toHex(0) + toHex(0));
  assert.equal(g.stops[1].color, "#ff" + toHex(0) + toHex(0) + toHex(1));
  assert.deepEqual(g.start, { x: -80, y: 0 });
  assert.deepEqual(g.end, { x: 80, y: 0 });
});
check("stroke cap/join/color/thickness", () => {
  const st = trimRes.shapes[0].stroke;
  assert.equal(st.thickness, 4);
  assert.equal(st.cap, "round");
  assert.equal(st.join, "round");
  assert.equal(st.color, "#ffffffff");
});
check("stroke.trim baseline + trimEnd track", () => {
  const shape = trimRes.shapes[0];
  assert.ok(shape.stroke.trim);
  assert.equal(shape.stroke.trim.start, 0);
  const track = trimRes.animations[0].tracks.find((t) => t.target === shape.id && t.property === "trimEnd");
  assert.ok(track, "expected a trimEnd track");
  assert.equal(track.keyframes.length, 2);
  assert.equal(track.keyframes[0].value, 0);
  assert.equal(track.keyframes[1].value, 1);
  assert.deepEqual(track.keyframes[1].easing, [0.67, 1, 0.33, 0]);
});
check("scene compiles via createRiv with no writer errors", () => {
  const { warnings } = createRiv({
    artboard: { name: "TrimRect", width: trimRes.width, height: trimRes.height },
    groups: trimRes.groups, shapes: trimRes.shapes, animations: trimRes.animations,
  });
  assert.equal(warnings.length, 0, JSON.stringify(warnings));
});

// ============================================================
// 3. sh ベジェパス（i/o制御点付きの閉じたダイヤモンド形）
// ============================================================
console.log("3. sh bezier path with control points");
const shPathLottie = {
  v: "5.9.0", fr: 30, ip: 0, op: 30, w: 200, h: 200, nm: "starpath",
  layers: [
    {
      ind: 1, ty: 4, nm: "diamond", ip: 0, op: 30, st: 0,
      ks: { p: { a: 0, k: [100, 100] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
      shapes: [
        {
          ty: "sh", ks: { a: 0, k: {
            c: true,
            v: [[0, -50], [50, 0], [0, 50], [-50, 0]],
            i: [[-20, 0], [0, -20], [20, 0], [0, 20]],
            o: [[20, 0], [0, 20], [-20, 0], [0, -20]],
          } },
        },
        { ty: "fl", c: { a: 0, k: [0, 0, 1, 1] }, o: { a: 0, k: 100 } },
      ],
    },
  ],
};
const shRes = importLottie(shPathLottie, {});

check("sh path becomes a polygon shape with 4 cubic vertices", () => {
  assert.equal(shRes.shapes.length, 1);
  const s = shRes.shapes[0];
  assert.equal(s.type, "polygon");
  assert.equal(s.subpaths.length, 1);
  assert.equal(s.subpaths[0].closed, true);
  assert.equal(s.subpaths[0].points.length, 4);
});
check("cubic tangent rotation/distance derived correctly from i/o offsets", () => {
  const pts = shRes.shapes[0].subpaths[0].points;
  // 頂点0: v=[0,-50], out=[20,0](→0°), in=[-20,0](→180°), 距離20
  assert.equal(pts[0].x, 0);
  assert.equal(pts[0].y, -50);
  assert.ok(Math.abs(pts[0].cubic.rotation - 0) < 1e-6);
  assert.ok(Math.abs(pts[0].cubic.inRotation - 180) < 1e-6);
  assert.ok(Math.abs(pts[0].cubic.outDistance - 20) < 1e-6);
  assert.ok(Math.abs(pts[0].cubic.inDistance - 20) < 1e-6);
  // 頂点1: v=[50,0], out=[0,20](→90°), in=[0,-20](→-90°)
  assert.ok(Math.abs(pts[1].cubic.rotation - 90) < 1e-6);
  assert.ok(Math.abs(pts[1].cubic.inRotation - (-90)) < 1e-6);
});
check("scene compiles via createRiv with no writer errors", () => {
  const { warnings } = createRiv({
    artboard: { name: "Diamond", width: shRes.width, height: shRes.height },
    groups: shRes.groups, shapes: shRes.shapes, animations: shRes.animations,
  });
  assert.equal(warnings.length, 0, JSON.stringify(warnings));
});

// ============================================================
// 4. precomp 1階層インライン展開 + null親子 + hold(可視範囲)キーフレーム
// ============================================================
console.log("4. precomp inline + null parent/child + hold keyframes");
const precompLottie = {
  v: "5.9.0", fr: 30, ip: 0, op: 90, w: 200, h: 200, nm: "precomptest",
  assets: [
    {
      id: "comp_child", nm: "childcomp", fr: 30, ip: 0, op: 60, w: 100, h: 100,
      layers: [
        {
          ind: 1, ty: 4, nm: "childShape", ip: 0, op: 60, st: 0,
          ks: { p: { a: 0, k: [50, 50] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
          shapes: [
            { ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [30, 30] } },
            { ty: "fl", c: { a: 0, k: [0, 1, 0, 1] }, o: { a: 0, k: 100 } },
          ],
        },
      ],
    },
  ],
  layers: [
    {
      ind: 1, ty: 3, nm: "nullParent", ip: 0, op: 90, st: 0,
      ks: { p: { a: 0, k: [100, 100] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
    },
    {
      ind: 2, ty: 0, nm: "precompChild", parent: 1, refId: "comp_child",
      ip: 20, op: 70, st: 10, w: 100, h: 100,
      ks: { p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
    },
  ],
};
const precompRes = importLottie(precompLottie, {});

check("null layer produces a group with no drawable content of its own", () => {
  assert.equal(precompRes.groups.length, 3); // nullParent + precompChild(outer) + inlined childShape
  const nullGroup = precompRes.groups.find((g) => g.id.includes("l1_grp0"));
  assert.ok(nullGroup);
  assert.equal(nullGroup.x, 100);
  assert.equal(nullGroup.y, 100);
});
check("precomp layer is parented to the null layer (parent by ind resolved)", () => {
  const precompGroup = precompRes.groups.find((g) => g.id.includes("grp1"));
  const nullGroup = precompRes.groups.find((g) => g.id.includes("grp0"));
  assert.ok(precompGroup && nullGroup);
  assert.equal(precompGroup.parent, nullGroup.id);
});
check("inlined precomp content (1 level) produces the child ellipse, parented under precomp group", () => {
  assert.equal(precompRes.shapes.length, 1);
  const s = precompRes.shapes[0];
  assert.equal(s.type, "ellipse");
  assert.equal(s.width, 30);
  const precompGroup = precompRes.groups.find((g) => g.id.includes("grp1"));
  const childGroup = precompRes.groups.find((g) => g.id === s.parent);
  assert.ok(childGroup);
  assert.equal(childGroup.parent, precompGroup.id);
});
check("narrower ip/op than composition produces a hold-opacity visibility track", () => {
  const precompGroup = precompRes.groups.find((g) => g.id.includes("grp1"));
  const track = precompRes.animations[0].tracks.find((t) => t.target === precompGroup.id && t.property === "opacity");
  assert.ok(track, "expected an opacity visibility track");
  assert.equal(track.keyframes.length, 3);
  assert.deepEqual(track.keyframes.map((k) => k.frame), [0, 20, 70]);
  assert.deepEqual(track.keyframes.map((k) => k.value), [0, 1, 0]);
  assert.equal(track.keyframes[1].easing, "hold");
  assert.equal(track.keyframes[2].easing, "hold");
});
check("scene compiles via createRiv with no writer errors", () => {
  const { warnings } = createRiv({
    artboard: { name: "Precomp", width: precompRes.width, height: precompRes.height },
    groups: precompRes.groups, shapes: precompRes.shapes, animations: precompRes.animations,
  });
  assert.equal(warnings.length, 0, JSON.stringify(warnings));
});

// ============================================================
// 5. 公式ランタイムでの受理確認（非空フレーム）
// ============================================================
console.log("5. official runtime validation");
const host = new RiveHost(PAGE_SCRIPT);
try {
  const scene = {
    artboard: { name: "Bounce", width: bounceRes.width, height: bounceRes.height },
    backgroundColor: "#202020",
    groups: bounceRes.groups, shapes: bounceRes.shapes, animations: bounceRes.animations,
  };
  const { bytes } = createRiv(scene);
  const info = await host.inspect(Buffer.from(bytes));
  check("runtime accepts the generated file and finds the animation", () => {
    assert.equal(info.artboards.length, 1);
    assert.ok(info.artboards[0].animations.some((a) => a.name === "bounce"));
  });
  const r = await host.renderFrames(Buffer.from(bytes), { animation: "bounce", startTime: 0.25, frameCount: 1, width: 300, format: "png" });
  check("rendered frame is non-empty", () => {
    assert.ok(r.frames[0].length > 1000, `frame data too small: ${r.frames[0].length}`);
  });
} catch (e) {
  failures++;
  console.error("  FAIL runtime -", e.message);
} finally {
  await host.close();
}

// ============================================================
// 6. パスモーフィング（頂点キーフレーム）: 三角形→別形状
//    頂点3つ・2キーフレーム。#p0_0(index0)は座標のみ動く、#p0_1(index1)は完全に静止、
//    #p0_2(index2)は既存の非ゼロin接線が回転しつつout接線が0→非0へ出現する
// ============================================================
console.log("6. path morph (shape morph -> vertex keyframes)");
const morphLottie = {
  v: "5.9.0", fr: 30, ip: 0, op: 30, w: 200, h: 200, nm: "morph",
  layers: [
    {
      ind: 1, ty: 4, nm: "tri", ip: 0, op: 30, st: 0,
      ks: { p: { a: 0, k: [100, 100] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
      shapes: [
        {
          ty: "sh", ks: { a: 1, k: [
            {
              t: 0,
              s: [{ c: true, v: [[0, -50], [50, 50], [-50, 50]], i: [[0, 0], [0, 0], [10, 0]], o: [[0, 0], [0, 0], [0, 0]] }],
              o: { x: [0.3], y: [0.1] },
            },
            {
              t: 30,
              s: [{ c: true, v: [[20, -50], [50, 50], [-50, 50]], i: [[0, 0], [0, 0], [0, -10]], o: [[0, 0], [0, 0], [15, 0]] }],
              i: { x: [0.6], y: [0.9] },
            },
          ] },
        },
        { ty: "fl", c: { a: 0, k: [0.1, 0.4, 0.9, 1] }, o: { a: 0, k: 100 } },
      ],
    },
  ],
};
const morphRes = importLottie(morphLottie, {});

check("morph produces a single polygon shape with 3 points, all cubic (detached)", () => {
  assert.equal(morphRes.shapes.length, 1);
  const s = morphRes.shapes[0];
  assert.equal(s.type, "polygon");
  assert.equal(s.subpaths[0].points.length, 3);
  assert.ok(s.subpaths[0].points.every((p) => !!p.cubic), "every point should carry a cubic handle (CubicDetachedVertex)");
});
check("no path-morph fallback warning was emitted (successful morph)", () => {
  assert.ok(!morphRes.warnings.some((w) => w.includes("shape morph")), JSON.stringify(morphRes.warnings));
});
check("moving vertex (#p0_0) has an x track", () => {
  const shapeId = morphRes.shapes[0].id;
  const track = morphRes.animations[0].tracks.find((t) => t.target === `${shapeId}#p0_0` && t.property === "x");
  assert.ok(track, "expected an x track for point 0");
  assert.equal(track.keyframes.length, 2);
  assert.deepEqual(track.keyframes.map((k) => k.value), [0, 20]);
});
check("static vertex (#p0_1) has no tracks at all", () => {
  const shapeId = morphRes.shapes[0].id;
  const anyTrack = morphRes.animations[0].tracks.some((t) => t.target === `${shapeId}#p0_1`);
  assert.ok(!anyTrack, "vertex 1 never changes and should not produce a track");
});
check("tangent-transition vertex (#p0_2): outDistance track exists (0 -> non-zero)", () => {
  const shapeId = morphRes.shapes[0].id;
  const track = morphRes.animations[0].tracks.find((t) => t.target === `${shapeId}#p0_2` && t.property === "outDistance");
  assert.ok(track, "expected an outDistance track for point 2");
  assert.equal(track.keyframes[0].value, 0);
  assert.ok(Math.abs(track.keyframes[1].value - 15) < 1e-6);
});
check("angle track (inRotation) inherits the path keyframe's easing", () => {
  const shapeId = morphRes.shapes[0].id;
  const track = morphRes.animations[0].tracks.find((t) => t.target === `${shapeId}#p0_2` && t.property === "inRotation");
  assert.ok(track, "expected an inRotation track for point 2 (its in-tangent rotates from 0deg to -90deg)");
  assert.deepEqual(track.keyframes[1].easing, [0.3, 0.1, 0.6, 0.9]);
});
check("scene compiles via createRiv with no writer errors", () => {
  const { warnings } = createRiv({
    artboard: { name: "Morph", width: morphRes.width, height: morphRes.height },
    groups: morphRes.groups, shapes: morphRes.shapes, animations: morphRes.animations,
  });
  assert.equal(warnings.length, 0, JSON.stringify(warnings));
});

console.log("6b. path morph: vertex count mismatch falls back to frozen first-keyframe shape");
const mismatchLottie = {
  v: "5.9.0", fr: 30, ip: 0, op: 30, w: 200, h: 200, nm: "mismatch",
  layers: [
    {
      ind: 1, ty: 4, nm: "tri2", ip: 0, op: 30, st: 0,
      ks: { p: { a: 0, k: [100, 100] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
      shapes: [
        {
          ty: "sh", ks: { a: 1, k: [
            { t: 0, s: [{ c: true, v: [[0, -50], [50, 50], [-50, 50]], i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]] }] },
            { t: 30, s: [{ c: true, v: [[0, -50], [50, 50], [-50, 50], [0, 50]], i: [[0, 0], [0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0], [0, 0]] }] },
          ] },
        },
        { ty: "fl", c: { a: 0, k: [0.9, 0.1, 0.1, 1] }, o: { a: 0, k: 100 } },
      ],
    },
  ],
};
const mismatchRes = importLottie(mismatchLottie, {});

check("mismatched vertex counts across keyframes: frozen to first keyframe, no morph tracks", () => {
  assert.equal(mismatchRes.shapes.length, 1);
  const s = mismatchRes.shapes[0];
  assert.equal(s.subpaths[0].points.length, 3, "should use the first keyframe's 3-point shape");
  assert.ok(mismatchRes.warnings.some((w) => w.includes("shape morph") && w.includes("vertex count mismatch")));
  assert.equal(mismatchRes.coverage.skipped["path-morph(vertex-count-mismatch)"], 1);
  const hasMorphTrack = mismatchRes.animations.some((a) => a.tracks.some((t) => t.target.startsWith(`${s.id}#p`)));
  assert.ok(!hasMorphTrack, "no vertex tracks should be produced when the morph is rejected");
});
check("scene compiles via createRiv with no writer errors", () => {
  const { warnings } = createRiv({
    artboard: { name: "Mismatch", width: mismatchRes.width, height: mismatchRes.height },
    groups: mismatchRes.groups, shapes: mismatchRes.shapes, animations: mismatchRes.animations,
  });
  assert.equal(warnings.length, 0, JSON.stringify(warnings));
});

console.log("6c. path morph: official runtime renders different pixels at frame 0 vs the last frame");
const morphHost = new RiveHost(PAGE_SCRIPT);
try {
  const scene = {
    artboard: { name: "Morph", width: morphRes.width, height: morphRes.height },
    backgroundColor: "#101010",
    groups: morphRes.groups, shapes: morphRes.shapes, animations: morphRes.animations,
  };
  const { bytes } = createRiv(scene);
  const info = await morphHost.inspect(Buffer.from(bytes));
  check("runtime accepts the morph file and finds the animation", () => {
    assert.equal(info.artboards.length, 1);
    assert.ok(info.artboards[0].animations.some((a) => a.name === "morph"));
  });
  const first = await morphHost.renderFrames(Buffer.from(bytes), { animation: "morph", startTime: 0, frameCount: 1, width: 200, format: "png" });
  const last = await morphHost.renderFrames(Buffer.from(bytes), { animation: "morph", startTime: 0.99, frameCount: 1, width: 200, format: "png" });
  check("frame 0 and the last frame render to different pixels (morph is actually animating)", () => {
    assert.ok(first.frames[0].length > 1000, `first frame too small: ${first.frames[0].length}`);
    assert.ok(last.frames[0].length > 1000, `last frame too small: ${last.frames[0].length}`);
    const a = Buffer.from(first.frames[0], "base64");
    const b = Buffer.from(last.frames[0], "base64");
    assert.ok(!a.equals(b), "frame 0 and last frame should differ if the morph is animating");
  });
} catch (e) {
  failures++;
  console.error("  FAIL morph runtime -", e.message);
} finally {
  await morphHost.close();
}

// ============================================================
// bonus: npm pack lottie-web の実サンプルを通す（取得できなければスキップ）
// ============================================================
console.log("bonus: real-world lottie-web sample");
try {
  const dir = mkdtempSync(join(tmpdir(), "rive-lottie-pack-"));
  execFileSync("npm", ["pack", "lottie-web", "--pack-destination", dir], { stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
  const tgz = readdirSync(dir).find((f) => f.endsWith(".tgz"));
  if (!tgz) {
    console.log("  skip: npm pack produced no tarball");
  } else {
    execFileSync("tar", ["xzf", tgz, "package/test/animations"], { cwd: dir, timeout: 30_000 });
    const animDir = join(dir, "package", "test", "animations");
    const candidates = readdirSync(animDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ f, size: statSync(join(animDir, f)).size }))
      .sort((a, b) => a.size - b.size);
    if (!candidates.length) {
      console.log("  skip: no demo .json found in the lottie-web package");
    } else {
      const pick = candidates[0].f;
      const data = JSON.parse(readFileSync(join(animDir, pick), "utf8"));
      check(`importLottie handles real-world sample '${pick}' without throwing`, () => {
        const res = importLottie(data, { idPrefix: "pack_" });
        assert.ok(res.coverage, "coverage must always be returned");
        assert.equal(typeof res.coverage.decompiled, "number");
        assert.equal(typeof res.coverage.skipped, "object");
        console.log(`    groups=${res.groups.length} shapes=${res.shapes.length} warnings=${res.warnings.length} skipped=${JSON.stringify(res.coverage.skipped)}`);
      });
      // 回帰: レイヤー前方参照(トポロジカルソート)と負フレームのクランプ。
      // starfish=前方参照する親レイヤー / bacon=負のprecomp開始オフセット を含む実ファイル
      for (const name of ["starfish.json", "bacon.json"]) {
        if (!readdirSync(animDir).includes(name)) continue;
        check(`real-world '${name}' converts AND recompiles via createRiv`, () => {
          const res = importLottie(JSON.parse(readFileSync(join(animDir, name), "utf8")), { idPrefix: "rw_" });
          assert.ok(res.animations.length >= 1, "expected keyframed animation");
          const { bytes } = createRiv({
            artboard: { name: "RW", width: res.width, height: res.height },
            groups: res.groups, shapes: res.shapes, animations: res.animations,
          });
          assert.ok(bytes.length > 1000);
          for (const a of res.animations) {
            for (const t of a.tracks) for (const k of t.keyframes) assert.ok(k.frame >= 0, "negative frame leaked");
          }
        });
      }
    }
  }
} catch (e) {
  console.log("  skip: npm pack lottie-web unavailable -", e.message.split("\n")[0]);
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nlottie: all checks passed");
