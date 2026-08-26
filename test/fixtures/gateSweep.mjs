// 境界コントラスト gate の閾値を**実測の分布から**決めるための掃引。
//
// 「妥当そうな値」を書かないための道具。gate を通すべきもの(合成・実画像の positive)と
// 落とすべきもの(グラデーションの縞)で、辺のコントラストの分布がどこで分かれるかを見る。
// 分布が重なっているなら、その閾値では原理的に両立しない —— それが分かることに価値がある。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { RiveHost } from "../../dist/riveHost.js";
import { PAGE_SCRIPT } from "../../dist/pageScript.js";
import { detectUiElements } from "../../dist/uiDetect.js";
import { generateScene } from "./synth.mjs";
import { truthAlignment } from "../detectorMetrics.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(process.env.RIVE_UI_FIXTURES || join(HERE, "..", "..", ".claude", "ui-fixtures"));
const SCENES = [1, 2, 3, 4, 5, 6];
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

const MINS = [0, 8, 10, 12, 14, 16, 20, 24, 32];
const SIDES = [3, 4];

const host = new RiveHost(PAGE_SCRIPT);
try {
  // 合成: グラデーションを何枚のベクターパネルに砕くか / positive を何件拾えるか
  const synthPngs = [];
  for (const seed of SCENES) {
    const { svg, truth } = generateScene(seed);
    synthPngs.push({ png: await host.rasterize(svg), truth });
  }
  // 実画像(tuning のみ。holdout は開けない)
  const fx = JSON.parse(readFileSync(join(FIXTURE_DIR, "fixtures.json"), "utf8"))
    .fixtures.filter((f) => f.split === "tuning");
  const realPngs = fx.map((f) => ({
    png: readFileSync(join(FIXTURE_DIR, f.image)),
    truth: { width: f.width, height: f.height, elements: f.anchors },
  }));

  console.log("min sides |  合成: gradPanel  recall  leakMax |  実画像: recall  leakMax  候補数");
  for (const boundarySidesRequired of SIDES) {
    for (const boundaryContrastMin of MINS) {
      const opts = { minArea: 576, workingMax: 1280, boundaryContrastMin, boundarySidesRequired };
      const run = async (items) => {
        const out = [];
        for (const it of items) {
          const det = await detectUiElements(host, it.png, { ...opts, maxElements: 120 });
          const { elements } = det;
          const t = truthAlignment(elements, it.truth);
          out.push({
            grad: (t.perNegative.find((n) => /grad/.test(n.label)) || {}).vectorPanelCount ?? 0,
            recall: t.positivePanelInstanceRecall,
            leakMax: t.negativeLeakMaxPerRegion,
            cands: elements.filter((e) => e.renderMode === "vector-panel").length,
          });
        }
        return out;
      };
      const s = await run(synthPngs);
      const r = await run(realPngs);
      console.log(
        `${String(boundaryContrastMin).padStart(3)} ${boundarySidesRequired}     |` +
        `      ${mean(s.map((x) => x.grad)).toFixed(1).padStart(5)}   ${mean(s.map((x) => x.recall)).toFixed(3)}   ${mean(s.map((x) => x.leakMax)).toFixed(3)} |` +
        `        ${mean(r.map((x) => x.recall)).toFixed(3)}   ${mean(r.map((x) => x.leakMax)).toFixed(3)}   ${mean(r.map((x) => x.cands)).toFixed(1)}`
      );
    }
  }
} finally {
  await host.close();
}
