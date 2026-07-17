// 惑星系 (orbit) ショーケース。星空背景 + リング付き惑星 + 公転する衛星2つ + 彗星 + ロゴ
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const W = 480, H = 270;
const DUR = 300; // 60fps, 5秒ループ

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260718);

const shapes = [];
const tracks = [];

// ---- 背景: 宇宙グラデーション + 星雲 + 瞬く星 ----
shapes.push({
  id: "bgSpace", type: "rect", x: W / 2, y: H / 2, width: W, height: H, z: -200,
  fill: { gradient: { type: "radial", stops: [
    { color: "#241a3a", position: 0 }, { color: "#120e26", position: 0.55 }, { color: "#05040c", position: 1 }
  ] } }
});
const nebulae = [
  { x: 90, y: 200, w: 220, h: 170, c1: "#3a2a6b", c2: "#00000000" },
  { x: 420, y: 60, w: 200, h: 160, c1: "#1c5f8f", c2: "#00000000" },
];
nebulae.forEach((n, i) => {
  shapes.push({
    id: `nebula${i}`, type: "ellipse", x: n.x, y: n.y, width: n.w, height: n.h, z: -190 + i, opacity: 0.3,
    fill: { gradient: { type: "radial", stops: [{ color: n.c1, position: 0 }, { color: n.c2, position: 1 }] } }
  });
});
const STAR_COUNT = 45;
for (let i = 0; i < STAR_COUNT; i++) {
  const id = `star_${i}`;
  const x = rand() * W;
  const y = rand() * H;
  const size = 1 + rand() * 1.6;
  const baseOpacity = 0.3 + rand() * 0.5;
  shapes.push({ id, type: "ellipse", x, y, width: size, height: size, z: -150 + i, opacity: baseOpacity, fill: { color: "#ffffff" } });
  if (i % 3 === 0) {
    const dur = 90 + Math.floor(rand() * 90);
    const phase = Math.floor(rand() * dur);
    const dim = baseOpacity * (0.3 + 0.3 * Math.abs(Math.sin(phase)));
    const mid = Math.round((phase + dur / 2) % (DUR - 1)) + 1;
    tracks.push({ target: id, property: "opacity", keyframes: [
      { frame: 0, value: dim }, { frame: mid, value: baseOpacity, easing: "ease-in-out" }, { frame: DUR, value: dim },
    ].sort((a, b) => a.frame - b.frame) });
  }
}

// ---- 惑星本体 + リング ----
const PLANET_CX = 300, PLANET_CY = 185, PLANET_R = 78;
shapes.push({
  id: "ringBack", type: "ellipse", x: PLANET_CX, y: PLANET_CY, width: PLANET_R * 2.7, height: PLANET_R * 0.85,
  z: -5, opacity: 0.8, rotation: -12,
  fill: { gradient: { type: "linear", stops: [{ color: "#00000000", position: 0 }, { color: "#e0c9a0", position: 0.5 }, { color: "#00000000", position: 1 }] } },
});
shapes.push({
  id: "planet", type: "ellipse", x: PLANET_CX, y: PLANET_CY, width: PLANET_R * 2, height: PLANET_R * 2, z: -3,
  fill: { gradient: { type: "radial", stops: [
    { color: "#ffd9a0", position: 0 }, { color: "#e0893f", position: 0.55 }, { color: "#9c4a1f", position: 1 },
  ], start: { x: -PLANET_R * 0.35, y: -PLANET_R * 0.35 }, end: { x: PLANET_R * 0.9, y: PLANET_R * 0.9 } } },
});
// 表面模様（自転しているように見せる有機的な大陸パッチ。cubic頂点で不定形に）
function blobPoints(rx, ry, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * 360;
    const rad = (angle * Math.PI) / 180;
    const wobble = 1 + (rand() - 0.5) * 0.35;
    const x = Math.cos(rad) * rx * wobble;
    const y = Math.sin(rad) * ry * wobble;
    const distance = ((rx + ry) / 2) * wobble * 0.5523 * (0.8 + rand() * 0.4);
    pts.push({ x, y, cubic: { rotation: angle + 90, distance } });
  }
  return pts;
}
const spotCount = 5;
for (let i = 0; i < spotCount; i++) {
  const sx = PLANET_CX + (rand() - 0.5) * PLANET_R * 1.3;
  const sy = PLANET_CY + (rand() - 0.5) * PLANET_R * 1.1;
  const id = `spot_${i}`;
  const rx = 8 + rand() * 12, ry = 4 + rand() * 7;
  shapes.push({ id, type: "polygon", x: sx, y: sy, z: -2, opacity: 0.28,
    points: blobPoints(rx, ry, 6),
    fill: { color: "#7a3210" } });
  tracks.push({ target: id, property: "x", keyframes: [
    { frame: 0, value: sx - 20 }, { frame: DUR, value: sx + 20, easing: "linear" },
  ] });
}
shapes.push({
  id: "ringFront", type: "ellipse", x: PLANET_CX, y: PLANET_CY, width: PLANET_R * 2.7, height: PLANET_R * 0.85,
  z: -1, opacity: 0.9, rotation: -12,
  fill: { gradient: { type: "linear", stops: [{ color: "#00000000", position: 0 }, { color: "#fff2d8", position: 0.5 }, { color: "#00000000", position: 1 }] } },
});
// リングを線状に見せるため、上下2本のストローク付き薄い帯にする代わりにopacityで抜け感を出す
shapes.push({
  id: "ringFrontThin", type: "rect", x: PLANET_CX, y: PLANET_CY + PLANET_R * 0.05, width: PLANET_R * 2.6, height: 3, z: 0,
  rotation: -12, opacity: 0.5, fill: { color: "#fff6e6" },
});

// ---- 衛星2つ: 楕円軌道で公転 ----
function orbitTrack(id, cx, cy, rx, ry, phaseDeg, steps, dir) {
  const xs = [], ys = [];
  for (let i = 0; i <= steps; i++) {
    const frame = Math.round((i / steps) * DUR);
    const theta = ((phaseDeg + dir * 360 * (i / steps)) * Math.PI) / 180;
    const kx = { frame, value: cx + rx * Math.cos(theta) };
    const ky = { frame, value: cy + ry * Math.sin(theta) };
    if (i > 0) { kx.easing = "linear"; ky.easing = "linear"; }
    xs.push(kx);
    ys.push(ky);
  }
  tracks.push({ target: id, property: "x", keyframes: xs });
  tracks.push({ target: id, property: "y", keyframes: ys });
}
shapes.push({ id: "moon1", type: "ellipse", x: PLANET_CX + 150, y: PLANET_CY, width: 16, height: 16, z: 5,
  fill: { gradient: { type: "linear", stops: [{ color: "#cfd8e8" }, { color: "#8b93a8" }] } } });
orbitTrack("moon1", PLANET_CX, PLANET_CY, 150, 55, 0, 24, 1);
shapes.push({ id: "moon2", type: "ellipse", x: PLANET_CX - 100, y: PLANET_CY, width: 10, height: 10, z: 5,
  fill: { color: "#9be8ff" } });
orbitTrack("moon2", PLANET_CX, PLANET_CY, 100, 38, 180, 24, -1);

// ---- 彗星 (左上 -> 右下、1回) ----
const groups = [{ id: "meteor1", x: -30, y: -10, rotation: 31 }];
shapes.push({ id: "meteor1tail", type: "rect", x: 0, y: 0, width: 55, height: 3, parent: "meteor1",
  fill: { gradient: { type: "linear", stops: [{ color: "#ffffffff", position: 0 }, { color: "#00ffffff", position: 1 }], start: { x: -27, y: 0 }, end: { x: 27, y: 0 } } } });
shapes.push({ id: "meteor1head", type: "ellipse", x: 27, y: 0, width: 7, height: 7, parent: "meteor1", fill: { color: "#ffffff" } });
tracks.push({ target: "meteor1", property: "x", keyframes: [
  { frame: 60, value: -30 }, { frame: 84, value: 340, easing: "linear" }, { frame: 85, value: -30, easing: "hold" }, { frame: DUR, value: -30 },
] });
tracks.push({ target: "meteor1", property: "y", keyframes: [
  { frame: 60, value: -10 }, { frame: 84, value: 230, easing: "linear" },
] });
tracks.push({ target: "meteor1", property: "opacity", keyframes: [
  { frame: 0, value: 0 }, { frame: 60, value: 1 }, { frame: 80, value: 1 }, { frame: 84, value: 0 },
] });

// ---- ロゴ (控えめ、左上) ----
const texts = [
  { id: "logo-glow", x: 14, y: 20, width: 260, height: 40, align: "left", runs: [{ text: "rive-mcp", fontSize: 34, color: "#3000d9ff", font: "inter" }] },
  { id: "logo", x: 20, y: 22, width: 250, height: 40, align: "left", runs: [{ text: "rive-mcp", fontSize: 30, color: "#ffffff", font: "inter" }] },
];
tracks.push({ target: "logo-glow", property: "opacity", keyframes: [{ frame: 0, value: 0 }, { frame: 40, value: 0.4, easing: "ease-out" }] });
tracks.push({ target: "logo", property: "opacity", keyframes: [{ frame: 0, value: 0 }, { frame: 30, value: 1, easing: "ease-out" }] });
tracks.push({ target: "logo", property: "x", keyframes: [
  { frame: 0, value: -14 }, { frame: 55, value: 20, easing: "elastic-out", amplitude: 1.3, period: 0.55 },
] });

// ---- パーティクル: 控えめな sparks のみ ----
const particles = [
  { prefab: "sparks", count: 10, area: { x: 0, y: 0, width: W, height: H }, animation: "orbit", fallDistance: 40, seed: 11 },
];

const scene = {
  artboard: { name: "Orbit", width: W, height: H },
  backgroundColor: "#05040c",
  fonts: [{ id: "inter", path: path.join(HERE, "../../assets/inter.ttf") }],
  groups,
  shapes,
  texts,
  animations: [{ name: "orbit", fps: 60, duration: DUR, loop: "loop", tracks }],
  particles,
};

fs.writeFileSync(path.join(HERE, "scene.json"), JSON.stringify(scene, null, 2));
console.log(`shapes=${scene.shapes.length} tracks=${scene.animations[0].tracks.length} -> scene.json`);
