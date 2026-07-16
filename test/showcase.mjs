// riv_create のショーケース: シーン生成 → 公式ランタイムでGIF化
import { writeFileSync } from "node:fs";
import { createRiv } from "../dist/rivWriter.js";
import { RiveHost } from "../dist/riveHost.js";
import { PAGE_SCRIPT } from "../dist/pageScript.js";
import { encodeGif } from "../dist/gif.js";

const spec = {
  artboard: { name: "Showcase", width: 480, height: 320 },
  backgroundColor: "#16213e",
  shapes: [
    { id: "sun", type: "ellipse", x: 400, y: 60, width: 60, height: 60,
      fill: { gradient: { type: "radial", stops: [{ color: "#ffd700" }, { color: "#ff8c00" }] } } },
    { id: "tri", type: "polygon", x: 240, y: 210,
      points: [{ x: 0, y: -70 }, { x: 60, y: 40 }, { x: -60, y: 40 }],
      fill: { color: "#0f3460" }, stroke: { color: "#533483", thickness: 4 } },
    { id: "box", type: "rect", x: 100, y: 240, width: 70, height: 70, cornerRadius: 14,
      fill: { color: "#e94560" } },
    { id: "ball", type: "ellipse", x: 380, y: 240, width: 56, height: 56,
      fill: { gradient: { stops: [{ color: "#00d9ff" }, { color: "#0066ff" }] } },
      stroke: { color: "#ffffff", thickness: 3 } },
  ],
  animations: [
    { name: "loop", duration: 120, fps: 60, loop: "loop", tracks: [
      { target: "box", property: "rotation",
        keyframes: [{ frame: 0, value: 0 }, { frame: 120, value: 360, easing: "linear" }] },
      { target: "ball", property: "y",
        keyframes: [{ frame: 0, value: 240 }, { frame: 60, value: 120, easing: "ease-out" }, { frame: 120, value: 240, easing: "ease-in" }] },
      { target: "ball", property: "scaleY",
        keyframes: [{ frame: 0, value: 0.85 }, { frame: 15, value: 1, easing: "ease-out" }, { frame: 105, value: 1 }, { frame: 120, value: 0.85, easing: "ease-in" }] },
      { target: "sun", property: "scaleX",
        keyframes: [{ frame: 0, value: 1 }, { frame: 60, value: 1.25, easing: "ease-in-out" }, { frame: 120, value: 1, easing: "ease-in-out" }] },
      { target: "sun", property: "scaleY",
        keyframes: [{ frame: 0, value: 1 }, { frame: 60, value: 1.25, easing: "ease-in-out" }, { frame: 120, value: 1, easing: "ease-in-out" }] },
      { target: "box", property: "fillColor",
        keyframes: [{ frame: 0, color: "#e94560" }, { frame: 60, color: "#f0a500" }, { frame: 120, color: "#e94560" }] },
    ] },
  ],
};

const { bytes } = createRiv(spec);
writeFileSync("samples/showcase.riv", Buffer.from(bytes));
const host = new RiveHost(PAGE_SCRIPT);
try {
  const r = await host.renderFrames(Buffer.from(bytes), {
    animation: "loop", frameCount: 40, fps: 20, width: 480, background: "#16213e", format: "rgba",
  });
  const gif = encodeGif(r.frames.map((f) => Buffer.from(f, "base64")), r.width, r.height, 20);
  writeFileSync("samples/showcase.gif", gif);
  console.log(`riv: ${bytes.length} bytes / gif: ${gif.length} bytes ${r.width}x${r.height}`);
} finally {
  await host.close();
}
