// 縞ファミリ統合のパラメータを**実測から**決めるための掃引（Task 15）。
// gateSweep.mjs と同じ目的: 「妥当そうな値」を書かないための道具。
//
// 見るのは2点だけ。
//   1. グラデーション帯が何枚のラスタとして残るか（理想 1）
//   2. **実画像の指標が動かないこと**。動くなら、それは統合が本物のUI要素を
//      飲み込み始めた合図なので、そこで止める。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { RiveHost } from "../../dist/riveHost.js";
import { PAGE_SCRIPT } from "../../dist/pageScript.js";
import { buildTree } from "../../dist/uiDetect.js";
import { generateScene } from "./synth.mjs";
import { truthAlignment, guardrails } from "../detectorMetrics.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(process.env.RIVE_UI_FIXTURES || join(HERE, "..", "..", ".claude", "ui-fixtures"));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// [bridgedMax, colorRatePerPx]
const GRID = [
  [0.25, 0], [0.25, 0.4], [0.35, 0.4], [0.45, 0.2], [0.45, 0.4], [0.45, 0.8], [0.60, 0.4],
];

const host = new RiveHost(PAGE_SCRIPT);
try {
  const synth = [];
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const g = generateScene(seed);
    synth.push({ png: await host.rasterize(g.svg), truth: g.truth });
  }
  const real = JSON.parse(readFileSync(join(FIXTURE_DIR, "fixtures.json"), "utf8"))
    .fixtures.filter((f) => f.split === "tuning")
    .map((f) => ({
      png: readFileSync(join(FIXTURE_DIR, f.image)),
      truth: { width: f.width, height: f.height, elements: f.anchors },
    }));

  const run = async (items, opts) => {
    const out = [];
    for (const it of items) {
      const det = await host.detectUiRegions(it.png, opts);
      const { elements, dropped } = buildTree(det.regions, 120);
      const t = truthAlignment(elements, it.truth);
      const g = guardrails(elements, { width: det.width, height: det.height }, { dropped });
      const grad = t.perNegative.find((n) => /grad/.test(n.label)) || {};
      out.push({
        gradRaster: grad.rasterCount ?? 0,
        gradVector: grad.vectorPanelCount ?? 0,
        leakMax: t.negativeLeakMaxPerRegion,
        recall: t.positivePanelInstanceRecall,
        perMP: g.keptElementsPerMegapixel,
      });
    }
    return out;
  };

  console.log("bridged rate | 合成: gradRaster gradVector leakMax recall elem/MP | 実画像: recall leakMax elem/MP");
  for (const [stripeBridgedMax, stripeColorRate] of GRID) {
    const opts = { minArea: 576, workingMax: 1280, stripeBridgedMax, stripeColorRate };
    const s = await run(synth, opts);
    const r = await run(real, opts);
    console.log(
      `   ${stripeBridgedMax.toFixed(2)} ${String(stripeColorRate).padStart(4)} |` +
      `      ${mean(s.map((x) => x.gradRaster)).toFixed(2).padStart(5)}      ${mean(s.map((x) => x.gradVector)).toFixed(2)}` +
      `   ${mean(s.map((x) => x.leakMax)).toFixed(4)} ${mean(s.map((x) => x.recall)).toFixed(3)} ${mean(s.map((x) => x.perMP)).toFixed(0).padStart(5)}  |` +
      `     ${mean(r.map((x) => x.recall)).toFixed(3)} ${mean(r.map((x) => x.leakMax)).toFixed(4)} ${mean(r.map((x) => x.perMP)).toFixed(0).padStart(4)}`
    );
  }
} finally {
  await host.close();
}
