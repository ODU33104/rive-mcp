// 星空背景パーツ（背景グラデ矩形・星雲光暈・瞬く星）を生成し、build-scene.mjs がマージする
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260717);
const W = 480, H = 270;

const shapes = [];
const tracks = [];

// 背景の宇宙グラデーション（画面全体を覆う矩形、放射グラデーション）
shapes.push({
  id: "bgSpace", type: "rect", x: W / 2, y: H / 2, width: W, height: H, z: -100,
  fill: { gradient: { type: "radial", stops: [
    { color: "#2a1a4a", position: 0 }, { color: "#140e2e", position: 0.55 }, { color: "#07060f", position: 1 }
  ] } }
});

// 星雲の光暈（大きな低opacity楕円、色違いを3枚）
const nebulae = [
  { x: 110, y: 70, w: 260, h: 200, c1: "#5b2a86", c2: "#00000000" },
  { x: 370, y: 190, w: 220, h: 180, c1: "#1c5f8f", c2: "#00000000" },
  { x: 300, y: 60, w: 180, h: 150, c1: "#8f2a6b", c2: "#00000000" },
];
nebulae.forEach((n, i) => {
  shapes.push({
    id: `nebula${i}`, type: "ellipse", x: n.x, y: n.y, width: n.w, height: n.h, z: -90 + i, opacity: 0.35,
    fill: { gradient: { type: "radial", stops: [{ color: n.c1, position: 0 }, { color: n.c2, position: 1 }] } }
  });
});

// 星: 70個、うち1/3を瞬かせる
const STAR_COUNT = 40;
for (let i = 0; i < STAR_COUNT; i++) {
  const id = `star_${i}`;
  const x = rand() * W;
  const y = rand() * H;
  const size = 1 + rand() * 1.8;
  const baseOpacity = 0.35 + rand() * 0.5;
  shapes.push({ id, type: "ellipse", x, y, width: size, height: size, z: -50 + i, opacity: baseOpacity, fill: { color: "#ffffff" } });
  if (i % 3 === 0) {
    const dur = 90 + Math.floor(rand() * 90);
    const phase = Math.floor(rand() * dur);
    const dimOpacity = baseOpacity * (0.3 + 0.3 * Math.abs(Math.sin(phase)));
    const midFrame = Math.round((phase + dur / 2) % 269) + 1;
    tracks.push({
      target: id, property: "opacity",
      keyframes: [
        { frame: 0, value: dimOpacity },
        { frame: midFrame, value: baseOpacity, easing: "ease-in-out" },
        { frame: 270, value: dimOpacity },
      ].sort((a, b) => a.frame - b.frame)
    });
  }
}

fs.writeFileSync(path.join(HERE, "space-bg-parts.json"), JSON.stringify({ shapes, tracks }, null, 2));
console.log(`generated ${shapes.length} shapes, ${tracks.length} twinkle tracks`);
