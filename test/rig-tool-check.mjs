// riv_rig_character 相当のワンコール生成を koneko で確認
import { readFileSync, writeFileSync } from "node:fs";
import { RiveHost } from "../dist/riveHost.js";
import { PAGE_SCRIPT } from "../dist/pageScript.js";
import { buildCharacterRig } from "../dist/rigCharacter.js";
import { createRiv } from "../dist/rivWriter.js";
import { encodeGif } from "../dist/gif.js";

const png = readFileSync("samples/uchinoko_character/koneko_base.png");
const parts = {
  earL: { polygon: [[505, 360], [525, 150], [575, 140], [690, 335], [690, 360]], pivot: [600, 345] },
  earR: { polygon: [[865, 335], [895, 265], [945, 115], [1005, 105], [1080, 335], [1050, 365]], pivot: [975, 340] },
  tail: { polygon: [[495, 690], [660, 655], [750, 780], [735, 940], [530, 940]], pivot: [735, 800], behindBody: true },
};
const host = new RiveHost(PAGE_SCRIPT);
try {
  const sliced = await host.sliceImage(png, Object.entries(parts).map(([name, d]) => ({ name, polygon: d.polygon })));
  const spec = buildCharacterRig(new Uint8Array(png), sliced, {
    parts,
    eyes: [{ x: 655, y: 380, width: 95, height: 110 }, { x: 858, y: 375, width: 95, height: 110 }],
    backgroundColor: "#fdf6ec",
    furColor: "#f8eee2",
    headRatio: 0.5,
  });
  const { bytes } = createRiv(spec);
  writeFileSync("samples/koneko-onecall.riv", Buffer.from(bytes));
  const r = await host.renderFrames(Buffer.from(bytes), {
    animation: "idle", frameCount: 60, fps: 15, width: 480, background: "#fdf6ec", format: "rgba" });
  writeFileSync("samples/koneko-onecall.gif",
    encodeGif(r.frames.map((f) => Buffer.from(f, "base64")), r.width, r.height, 15));
  console.log("one-call rig:", bytes.length, "bytes -> koneko-onecall.gif");
} finally {
  await host.close();
}
