// koneko をパーツ切り出しして確認（座標調整用）
import { readFileSync, writeFileSync } from "node:fs";
import { RiveHost } from "../dist/riveHost.js";
import { PAGE_SCRIPT } from "../dist/pageScript.js";

export const REGIONS = [
  { name: "earL", polygon: [[535, 345], [555, 165], [660, 300], [680, 345]] },
  { name: "earR", polygon: [[870, 330], [905, 270], [960, 130], [1060, 320], [1040, 350]] },
  { name: "tail", polygon: [[505, 700], [650, 670], [745, 780], [730, 935], [540, 930]] },
];

const png = readFileSync("samples/uchinoko_character/koneko_base.png");
const host = new RiveHost(PAGE_SCRIPT);
try {
  const result = await host.sliceImage(png, REGIONS);
  for (const p of result.parts) {
    writeFileSync(`samples/part-${p.name}.png`, Buffer.from(p.png, "base64"));
    console.log(p.name, `bbox(${p.x},${p.y} ${p.width}x${p.height})`);
  }
  writeFileSync("samples/part-base.png", Buffer.from(result.base, "base64"));
  console.log("saved: part-earL/earR/tail/base");
} finally {
  await host.close();
}
