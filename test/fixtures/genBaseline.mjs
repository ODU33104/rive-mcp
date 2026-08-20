// Task 10 Step4: 現在(未変更)の検出器を合成シーンに通し、baseline.json を書き出す。
//
// この baseline は「今の検出器がどれだけ壊れているか」の記録であって、目標値ではない。
// このスクリプトを再実行して baseline.json を上書きするのは、意図的に「新しい基準点を
// 置き直す」判断をしたときだけ(このタスクでは行わない)。Task 11以降は自分の計測結果を
// このファイルの値と比較するだけで、baseline.json 自体を書き換えてはならない。
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { RiveHost } from "../../dist/riveHost.js";
import { PAGE_SCRIPT } from "../../dist/pageScript.js";
import { buildTree } from "../../dist/uiDetect.js";
import { generateScene } from "./synth.mjs";
import { reconstructionError, guardrails, truthAlignment } from "../detectorMetrics.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// 生産側のデフォルト(src/index.ts の riv_from_screenshot 定義済みデフォルト)と同じ値を使う。
// ここを変えると baseline が検出器そのものの変更なしに動いてしまうので固定する。
const DETECT_OPTS = { minArea: 576, workingMax: 1280 };
const MAX_ELEMENTS = 120;

// 6シード: 色・グラデーション位相・ノイズ周波数/シードがシーンごとに変わるので、
// 単一シーンだけでは「たまたま今回は縞が少なかった」を拾ってしまう。数を増やすほど
// 安定するが、1シードあたりheadless Chromiumの検出+再構成が要るため実行コストとの
// バランスでこの数にした。
const SEEDS = [1, 2, 3, 4, 5, 6];

function mean(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

async function main() {
  const host = new RiveHost(PAGE_SCRIPT);
  const perScene = [];
  try {
    for (const seed of SEEDS) {
      const { svg, truth } = generateScene(seed);
      const png = await host.rasterize(svg);
      const det = await host.detectUiRegions(png, DETECT_OPTS);
      const { elements, dropped } = buildTree(det.regions, MAX_ELEMENTS);

      const mae = await reconstructionError(host, png, elements);
      const g = guardrails(elements, { width: det.width, height: det.height }, dropped);
      const t = truthAlignment(elements, truth);

      perScene.push({
        seed,
        sourceSize: { width: det.width, height: det.height },
        elementCount: elements.length,
        reconstructionMae: mae,
        guardrails: g,
        truthAlignment: t,
      });
      console.log(
        `seed=${seed} elements=${elements.length} dropped=${dropped} mae=${mae.toFixed(4)} ` +
          `gradientBandScore=${g.gradientBandScore} negativeLeakMean=${t.negativeLeakAreaRatioMean.toFixed(3)}`
      );
    }
  } finally {
    await host.close();
  }

  const summary = {
    reconstructionMaeMean: mean(perScene.map((s) => s.reconstructionMae)),
    gradientBandScoreMean: mean(perScene.map((s) => s.guardrails.gradientBandScore)),
    elementsPerMegapixelMean: mean(perScene.map((s) => s.guardrails.elementsPerMegapixel)),
    tinyFractionMean: mean(perScene.map((s) => s.guardrails.tinyFraction)),
    negativeLeakAreaRatioMeanOverall: mean(perScene.map((s) => s.truthAlignment.negativeLeakAreaRatioMean)),
    positiveCoverRateMean: mean(
      perScene.map((s) => (s.truthAlignment.positiveTotal ? s.truthAlignment.positiveCoverCount / s.truthAlignment.positiveTotal : 0))
    ),
    cycleCountTotal: perScene.reduce((a, s) => a + s.guardrails.cycleCount, 0),
  };

  const baseline = {
    generatedAt: new Date().toISOString(),
    note:
      "現在(未変更)の検出器のスナップショット。改善の目標値ではなく、後続タスクが自分の変更の効果を測るための固定参照点。このファイル自体は再生成しないこと。",
    detectOpts: DETECT_OPTS,
    maxElements: MAX_ELEMENTS,
    seeds: SEEDS,
    summary,
    scenes: perScene,
  };

  const outPath = join(HERE, "baseline.json");
  writeFileSync(outPath, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`\nwrote ${outPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

await main();
