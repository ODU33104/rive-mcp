// gen-space-bg.mjs の出力とタイトルロゴ演出をマージし、scene.json を書き出す
// 使い方: node gen-space-bg.mjs && node build-scene.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const spaceBg = JSON.parse(fs.readFileSync(path.join(HERE, "space-bg-parts.json"), "utf8"));

const scene = {
  artboard: { name: "Showcase", width: 480, height: 270 },
  backgroundColor: "#07060f",
  fonts: [{ id: "inter", path: path.join(HERE, "../../assets/inter.ttf") }],
  groups: [
    { id: "meteor1", x: -30, y: 10, rotation: 31 },
    { id: "meteor2", x: -50, y: -20, rotation: 31 },
  ],
  shapes: [
    ...spaceBg.shapes,
    { id: "tri", type: "polygon", x: 90, y: 70, points: [{ x: 0, y: -18 }, { x: 16, y: 10 }, { x: -16, y: 10 }], fill: { color: "#ffd700" }, opacity: 0.9 },
    { id: "circ", type: "ellipse", x: 400, y: 60, width: 34, height: 34, fill: { gradient: { type: "linear", stops: [{ color: "#00d9ff" }, { color: "#0066ff" }] } } },
    { id: "box", type: "rect", x: 420, y: 210, width: 30, height: 30, cornerRadius: 8, fill: { color: "#e94560" }, rotation: 20 },
    { id: "tri2", type: "polygon", x: 60, y: 210, points: [{ x: 0, y: -14 }, { x: 12, y: 8 }, { x: -12, y: 8 }], fill: { color: "#45e960" }, opacity: 0.85 },
    { id: "meteor1tail", type: "rect", x: 0, y: 0, width: 55, height: 3, parent: "meteor1", fill: { gradient: { type: "linear", stops: [{ color: "#ffffffff", position: 0 }, { color: "#00ffffff", position: 1 }], start: { x: -27, y: 0 }, end: { x: 27, y: 0 } } } },
    { id: "meteor1head", type: "ellipse", x: 27, y: 0, width: 7, height: 7, parent: "meteor1", fill: { color: "#ffffff" } },
    { id: "meteor2tail", type: "rect", x: 0, y: 0, width: 45, height: 2.5, parent: "meteor2", fill: { gradient: { type: "linear", stops: [{ color: "#dff6ffff", position: 0 }, { color: "#00dff6ff", position: 1 }], start: { x: -22, y: 0 }, end: { x: 22, y: 0 } } } },
    { id: "meteor2head", type: "ellipse", x: 22, y: 0, width: 5, height: 5, parent: "meteor2", fill: { color: "#dff6ff" } },
  ],
  texts: [
    { id: "title-glow", x: 5, y: 98, width: 470, height: 70, align: "center", runs: [{ text: "rive-mcp", fontSize: 68, color: "#4000d9ff", font: "inter" }] },
    { id: "title-b2", x: 16.4, y: 105.8, width: 450, height: 60, align: "center", runs: [{ text: "rive-mcp", fontSize: 58, color: "#ffffff", font: "inter" }] },
    { id: "title", x: 15, y: 105, width: 450, height: 60, align: "center", runs: [{ text: "rive-mcp", fontSize: 58, color: "#ffffff", font: "inter" }] },
  ],
  animations: [
    {
      name: "intro", fps: 60, duration: 270, loop: "loop",
      tracks: [
        ...spaceBg.tracks,
        { target: "title-glow", property: "opacity", keyframes: [{ frame: 0, value: 0 }, { frame: 15, value: 0 }, { frame: 120, value: 0.5, easing: "ease-out" }, { frame: 250, value: 0.5 }, { frame: 270, value: 0 }] },
        { target: "title-glow", property: "scaleX", keyframes: [{ frame: 15, value: 0.15 }, { frame: 130, value: 1, easing: "ease-out" }] },
        { target: "title-glow", property: "scaleY", keyframes: [{ frame: 15, value: 0.15 }, { frame: 130, value: 1, easing: "ease-out" }] },
        { target: "title-b2", property: "opacity", keyframes: [{ frame: 0, value: 0 }, { frame: 15, value: 0 }, { frame: 120, value: 1, easing: "ease-out" }, { frame: 250, value: 1 }, { frame: 270, value: 0 }] },
        { target: "title-b2", property: "scaleX", keyframes: [{ frame: 15, value: 0.15 }, { frame: 130, value: 1, easing: "ease-out" }] },
        { target: "title-b2", property: "scaleY", keyframes: [{ frame: 15, value: 0.15 }, { frame: 130, value: 1, easing: "ease-out" }] },
        { target: "title", property: "opacity", keyframes: [{ frame: 0, value: 0 }, { frame: 15, value: 0 }, { frame: 120, value: 1, easing: "ease-out" }, { frame: 250, value: 1 }, { frame: 270, value: 0 }] },
        { target: "title", property: "scaleX", keyframes: [{ frame: 15, value: 0.15 }, { frame: 130, value: 1, easing: "ease-out" }] },
        { target: "title", property: "scaleY", keyframes: [{ frame: 15, value: 0.15 }, { frame: 130, value: 1, easing: "ease-out" }] },
        { target: "tri", property: "rotation", bake: { type: "pendulum", from: 0, amplitude: 25, frequency: 0.5, decay: 0.03 } },
        { target: "circ", property: "y", bake: { type: "pendulum", from: 60, amplitude: 15, frequency: 0.4, decay: 0.03 } },
        { target: "box", property: "rotation", bake: { type: "wind", from: 20, strength: 30, gustiness: 0.5 } },
        { target: "tri2", property: "y", bake: { type: "pendulum", from: 210, amplitude: 12, frequency: 0.6, decay: 0.03 } },
        { target: "meteor1", property: "x", keyframes: [{ frame: 0, value: -30 }, { frame: 24, value: 340, easing: "linear" }, { frame: 25, value: -30, easing: "hold" }, { frame: 270, value: -30 }] },
        { target: "meteor1", property: "y", keyframes: [{ frame: 0, value: 10 }, { frame: 24, value: 230, easing: "linear" }] },
        { target: "meteor1", property: "opacity", keyframes: [{ frame: 0, value: 1 }, { frame: 20, value: 1 }, { frame: 24, value: 0 }, { frame: 25, value: 0, easing: "hold" }, { frame: 269, value: 0 }, { frame: 270, value: 1 }] },
        { target: "meteor2", property: "x", keyframes: [{ frame: 0, value: -50 }, { frame: 145, value: -50 }, { frame: 169, value: 300, easing: "linear" }, { frame: 170, value: -50, easing: "hold" }, { frame: 270, value: -50 }] },
        { target: "meteor2", property: "y", keyframes: [{ frame: 0, value: -20 }, { frame: 145, value: -20 }, { frame: 169, value: 190, easing: "linear" }] },
        { target: "meteor2", property: "opacity", keyframes: [{ frame: 0, value: 0 }, { frame: 145, value: 1 }, { frame: 165, value: 1 }, { frame: 169, value: 0 }] },
      ],
    },
  ],
  particles: [
    { prefab: "confetti", count: 16, area: { x: 0, y: -20, width: 480, height: 40 }, animation: "intro", fallDistance: 320, seed: 7 },
    { prefab: "sparks", count: 8, area: { x: 0, y: 0, width: 480, height: 270 }, animation: "intro", fallDistance: 60, seed: 3 },
  ],
};

fs.writeFileSync(path.join(HERE, "scene.json"), JSON.stringify(scene, null, 2));
console.log(`shapes=${scene.shapes.length} tracks=${scene.animations[0].tracks.length} -> scene.json`);
