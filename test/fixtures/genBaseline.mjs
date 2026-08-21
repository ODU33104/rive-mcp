// 現在(未変更)の検出器を合成シーンに通し、baseline.json を書き出す。
//
// この baseline は「今の検出器がどれだけ壊れているか」の記録であって、目標値ではない。
// 上書きしてよいのは「計器を直したので基準点を取り直す」と明示的に判断したときだけ。
// **検出器そのものを変えた直後に再生成してはならない**（比較対象を消す行為になる）。
// 実際、下の checkDetectorUntouched() は src/ に変更があれば書き出しを拒否する。
//
// 2026-08-21 (Task 11): 計器の抜け道を塞いだため一度だけ取り直した。
// このときも src/ は 1 行も変えていない。
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { RiveHost } from "../../dist/riveHost.js";
import { PAGE_SCRIPT } from "../../dist/pageScript.js";
import { buildTree } from "../../dist/uiDetect.js";
import { generateScene } from "./synth.mjs";
import { reconstructionStats, guardrails, truthAlignment } from "../detectorMetrics.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

// 生産側のデフォルト(src/index.ts の riv_from_screenshot 定義済みデフォルト)と同じ値を使う。
// ここを変えると baseline が検出器そのものの変更なしに動いてしまうので固定する。
const DETECT_OPTS = { minArea: 576, workingMax: 1280 };
const MAX_ELEMENTS = 120;

// 6シード: 色・グラデーション位相・ノイズ周波数/シードがシーンごとに変わるので、
// 単一シーンだけでは「たまたま今回は縞が少なかった」を拾ってしまう。
// pixelScale=2 の1件は**縮小経路(workingMax 超え → inv で元座標へ戻す)を踏ませるため**。
// これが無いと scale が常に厳密に 1 で、座標変換が一度も実行されない。
const SCENES = [
  { seed: 1, pixelScale: 1 },
  { seed: 2, pixelScale: 1 },
  { seed: 3, pixelScale: 1 },
  { seed: 4, pixelScale: 1 },
  { seed: 5, pixelScale: 1 },
  { seed: 6, pixelScale: 1 },
  { seed: 1, pixelScale: 2 },
];

function mean(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

/**
 * baseline は「検出器を変えていない」ことが前提の記録。src/ に未コミットの変更が
 * あるまま再生成すると、比較対象が静かに動いて以降の全タスクの判断が壊れる。
 * ALLOW_DIRTY_SRC=1 で意図的に外せるが、外した事実は baseline に書き残す。
 */
function checkDetectorUntouched() {
  if (process.env.ALLOW_DIRTY_SRC === "1") return { clean: false, overridden: true };
  try {
    const out = execFileSync("git", ["status", "--porcelain", "--", "src"], {
      cwd: REPO,
      encoding: "utf8",
    }).trim();
    if (out) {
      console.error("src/ に未コミットの変更があります:\n" + out);
      console.error("検出器を変えた直後に baseline を取り直すと比較対象が消えます。");
      console.error("意図的に取り直すなら ALLOW_DIRTY_SRC=1 を付けてください。");
      process.exit(1);
    }
    return { clean: true, overridden: false };
  } catch (e) {
    console.error("git status を実行できませんでした: " + e.message);
    process.exit(1);
  }
}

async function main() {
  const srcState = checkDetectorUntouched();
  const host = new RiveHost(PAGE_SCRIPT);
  const perScene = [];
  try {
    for (const { seed, pixelScale } of SCENES) {
      const { svg, truth } = generateScene(seed, { pixelScale });
      const png = await host.rasterize(svg);
      const det = await host.detectUiRegions(png, DETECT_OPTS);
      const { elements, dropped } = buildTree(det.regions, MAX_ELEMENTS);

      // インク probe: テキストの GT bbox は近似だが、インク色の画素は画素厳密。
      // これが無いと「テキストを一切検出しない検出器」がどの gate にも掛からない
      // (実測: 文字が全画素の0.1%未満だと p99 は無反応、mae の差 0.00054 は
      //  ベースライン全体の mae 0.00066 に埋もれる)。
      const inkProbes = truth.elements
        .filter((e) => e.inkColor)
        .map((e) => ({ label: e.label, rect: e.rect, inkColor: e.inkColor }));
      const recon = await reconstructionStats(host, png, elements, inkProbes);
      const g = guardrails(elements, { width: det.width, height: det.height }, {
        dropped,
        rawRegions: det.regions,
      });
      const t = truthAlignment(elements, truth);

      perScene.push({
        seed,
        pixelScale,
        sourceSize: { width: det.width, height: det.height },
        // 検出器が縮小経路を通ったか。false のシーンしか無い baseline は inv を検証していない。
        downscaled: det.width > DETECT_OPTS.workingMax || det.height > DETECT_OPTS.workingMax,
        elementCount: elements.length,
        reconstruction: recon,
        guardrails: g,
        truthAlignment: t,
      });
      console.log(
        `seed=${seed} x${pixelScale} elements=${elements.length} dropped=${dropped} ` +
          `mae=${recon.mae.toFixed(5)} p99=${recon.p99.toFixed(3)} ` +
          `leakOverall=${t.negativeLeakOverall.toFixed(3)} leakMax=${t.negativeLeakMaxPerRegion.toFixed(3)} ` +
          `recall=${t.positivePanelInstanceRecall.toFixed(3)} stripe=${g.stripeRunScore} ` +
          `ink=${recon.inkCoverage.map((i) => i.rasterCoverRatio.toFixed(2)).join("/")}`
      );
    }
  } finally {
    await host.close();
  }

  const gradientOf = (s) => s.truthAlignment.perNegative.find((n) => n.label === "gradient-band") || {};

  const summary = {
    // --- P0: 見た目を壊す側（非対称損失の重いほう） ---
    negativeLeakOverallMean: mean(perScene.map((s) => s.truthAlignment.negativeLeakOverall)),
    negativeLeakMaxPerRegionWorst: Math.max(...perScene.map((s) => s.truthAlignment.negativeLeakMaxPerRegion)),
    negativeRegionsWithAnyLeakTotal: perScene.reduce((a, s) => a + s.truthAlignment.negativeRegionsWithAnyLeak, 0),
    // gate 対象外(テキスト)を含めた最悪値。gate には使わないが、**要約から消してはいけない** —
    // 実測でテキストの leak が gradient/noise の最悪値を上回るシーンが 7 中 2 件ある。
    negativeLeakMaxPerRegionAllWorst: Math.max(...perScene.map((s) => s.truthAlignment.negativeLeakMaxPerRegionAll)),
    // 理想 0。negative なのだから 1 枚でも誤り。
    gradientVectorPanelCountMean: mean(perScene.map((s) => gradientOf(s).vectorPanelCount ?? 0)),
    // 理想 1。何枚の raster にまとまったか。
    gradientRasterRegionCountMean: mean(perScene.map((s) => gradientOf(s).rasterCount ?? 0)),
    // --- P1: 編集性を落とす側（抜け道1「全部raster」を塞ぐ） ---
    // テキスト忠実度。理想は raster 1 / vector 0。これが無いと「テキストを検出しない」で満点が取れる。
    textInkRasterCoverMean: mean(perScene.flatMap((s) => s.reconstruction.inkCoverage.map((i) => i.rasterCoverRatio))),
    textInkVectorCoverMean: mean(perScene.flatMap((s) => s.reconstruction.inkCoverage.map((i) => i.vectorCoverRatio))),
    textInkRasterCoverWorst: Math.min(...perScene.flatMap((s) => s.reconstruction.inkCoverage.map((i) => i.rasterCoverRatio))),
    positivePanelInstanceRecallMean: mean(perScene.map((s) => s.truthAlignment.positivePanelInstanceRecall)),
    positivePanelMedianIoUMean: mean(perScene.map((s) => s.truthAlignment.positivePanelMedianIoU)),
    cornerRadiusMAEMean: mean(perScene.map((s) => s.truthAlignment.cornerRadiusMAE)),
    // --- 抜け道2「巨大な raster 1枚」を塞ぐ ---
    rasterOverdrawRatioMean: mean(perScene.map((s) => s.guardrails.rasterOverdrawRatio)),
    rasterContainmentCountTotal: perScene.reduce((a, s) => a + s.guardrails.rasterContainmentCount, 0),
    // --- 再構成（平均は局所事故を隠すので分位も持つ） ---
    reconstructionMaeMean: mean(perScene.map((s) => s.reconstruction.mae)),
    reconstructionP95Mean: mean(perScene.map((s) => s.reconstruction.p95)),
    reconstructionP99Mean: mean(perScene.map((s) => s.reconstruction.p99)),
    vectorAreaReconstructionMaeMean: mean(perScene.map((s) => s.reconstruction.vectorAreaMae)),
    // --- 要素数は cap 前後を分ける（押し出されただけの偽改善を検出する） ---
    keptElementsPerMegapixelMean: mean(perScene.map((s) => s.guardrails.keptElementsPerMegapixel)),
    rawElementsPerMegapixelMean: mean(perScene.map((s) => s.guardrails.rawElementsPerMegapixel)),
    droppedTotal: perScene.reduce((a, s) => a + s.guardrails.dropped, 0),
    stripeRunScoreMean: mean(perScene.map((s) => s.guardrails.stripeRunScore)),
    stripeRunScoreRawMean: mean(perScene.map((s) => s.guardrails.stripeRunScoreRaw)),
    tinyFractionMean: mean(perScene.map((s) => s.guardrails.tinyFraction)),
    cycleCountTotal: perScene.reduce((a, s) => a + s.guardrails.cycleCount, 0),
  };

  const baseline = {
    generatedAt: new Date().toISOString(),
    note:
      "現在(未変更)の検出器のスナップショット。改善の目標値ではなく、後続タスクが自分の変更の効果を測るための固定参照点。",
    srcClean: srcState.clean,
    detectOpts: DETECT_OPTS,
    maxElements: MAX_ELEMENTS,
    scenes: SCENES,
    summary,
    perScene,
  };

  const outPath = join(HERE, "baseline.json");
  writeFileSync(outPath, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`\nwrote ${outPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

await main();
