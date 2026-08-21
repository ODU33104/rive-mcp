// Task 12: 実画像に対する現行(未変更)検出器のベースライン。
//
// **なぜアルゴリズムを変える前にこれを取るのか。**
// 全部作ってから実画像を見ると、そのときには「合成生成器に最適化された検出器」が
// 完成している。合成シーンで詰めた閾値が実画像で通用するかは別問題なので、
// 基準点だけ先に固定する。
//
// **画像そのものはこのリポジトリに入れない。** 他人の画面の画素を再配布しないため、
// スクリーンショットと正解アンカーは公開除外のディレクトリに置き、ここでは
// 数値（metrics）だけを書き出してコミットする。fixtures の場所は
// RIVE_UI_FIXTURES で差し替えられるので、自分の画面で同じ計測をすることもできる。
//
// tuning / holdout:
//   tuning は閾値決定に使ってよい。**holdout は Task 19 まで開けない。**
//   数値は記録するが、それを見て閾値を動かした時点で holdout の意味が消える。
//   そのため既定では holdout の内訳を表示しない（SHOW_HOLDOUT=1 で開く）。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { RiveHost } from "../dist/riveHost.js";
import { PAGE_SCRIPT } from "../dist/pageScript.js";
import { buildTree } from "../dist/uiDetect.js";
import { reconstructionStats, guardrails, truthAlignment } from "./detectorMetrics.mjs";

// baseline は「検出器を変えていない」ことが前提の記録。変更後の数値を既定ファイルへ
// 書き込むと比較対象そのものが消える。src/ に変更があるときは --out を必須にする。
function outArgPath() {
  const i = process.argv.indexOf("--out");
  return i >= 0 ? process.argv[i + 1] : null;
}
function guard(repo) {
  try {
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "src"], { cwd: repo, encoding: "utf8" }).trim();
    if (dirty && !outArgPath()) {
      console.error("src/ に未コミットの変更があります。--out <path> を付けてください（real-baseline.json を上書きさせない）。");
      process.exit(1);
    }
    return !dirty;
  } catch (e) {
    console.error("git status を実行できませんでした: " + e.message);
    process.exit(1);
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_CLEAN = guard(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const FIXTURE_DIR = resolve(process.env.RIVE_UI_FIXTURES || join(HERE, "..", ".claude", "ui-fixtures"));

// 合成ベースラインと同じ設定でなければ比較にならない。
const DETECT_OPTS = { minArea: 576, workingMax: 1280 };
const MAX_ELEMENTS = 120;

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

let manifest;
try {
  manifest = JSON.parse(readFileSync(join(FIXTURE_DIR, "fixtures.json"), "utf8"));
} catch (e) {
  console.error(`fixtures.json が読めません: ${join(FIXTURE_DIR, "fixtures.json")}`);
  console.error("実画像 fixture は公開除外のディレクトリにあります（画素を再配布しないため）。");
  console.error("自分で用意する場合は RIVE_UI_FIXTURES でディレクトリを指定してください。");
  process.exit(1);
}

const host = new RiveHost(PAGE_SCRIPT);
const results = [];
try {
  mkdirSync(join(FIXTURE_DIR, "overlays"), { recursive: true });
  for (const fx of manifest.fixtures) {
    const png = readFileSync(join(FIXTURE_DIR, fx.image));
    const det = await host.detectUiRegions(png, DETECT_OPTS);
    const { elements, dropped } = buildTree(det.regions, MAX_ELEMENTS);

    const truth = { width: fx.width, height: fx.height, elements: fx.anchors };
    const inkProbes = fx.anchors.filter((a) => a.inkColor)
      .map((a) => ({ label: a.label, rect: a.rect, inkColor: a.inkColor }));

    const recon = await reconstructionStats(host, png, elements, inkProbes);
    const g = guardrails(elements, { width: det.width, height: det.height }, { dropped, rawRegions: det.regions });
    const t = truthAlignment(elements, truth);

    // オーバーレイは元画素を含むので公開除外側にだけ書く。目視確認用。
    const labels = elements.map((e) => ({
      id: e.id, box: e.rect,
      color: e.renderMode === "vector-panel" ? "#00FF66" : "#FF3B30",
      labelX: e.rect[0] + 2, labelY: e.rect[1] + 16,
    }));
    writeFileSync(join(FIXTURE_DIR, "overlays", `${fx.id}.png`), await host.drawOverlay(png, labels));
    writeFileSync(join(FIXTURE_DIR, "overlays", `${fx.id}.elements.json`), JSON.stringify(elements, null, 2) + "\n");

    results.push({
      id: fx.id, url: fx.url, category: fx.category, split: fx.split,
      size: { width: det.width, height: det.height },
      downscaled: det.width > DETECT_OPTS.workingMax || det.height > DETECT_OPTS.workingMax,
      anchorCounts: {
        panel: fx.anchors.filter((a) => a.expectVectorPanel).length,
        image: fx.anchors.filter((a) => !a.expectVectorPanel && a.semanticHint === "image").length,
        text: fx.anchors.filter((a) => !a.expectVectorPanel && a.semanticHint === "text").length,
      },
      elementCount: elements.length,
      reconstruction: recon,
      guardrails: g,
      truthAlignment: t,
    });

    const show = fx.split === "tuning" || process.env.SHOW_HOLDOUT === "1";
    console.log(
      `${fx.split === "holdout" ? "[holdout] " : "[tuning]  "}${fx.id.padEnd(20)}` +
      (show
        ? ` elements=${String(elements.length).padStart(3)} leakMax=${t.negativeLeakMaxPerRegion.toFixed(3)} ` +
          `recall=${t.positivePanelInstanceRecall.toFixed(3)} (${t.positiveHitCount}/${t.positiveTotal}) ` +
          `stripe=${g.stripeRunScore} ink=${mean(recon.inkCoverage.map((i) => i.rasterCoverRatio)).toFixed(2)}`
        : " (Task 19 まで内訳は見ない。SHOW_HOLDOUT=1 で開く)")
    );
  }
} finally {
  await host.close();
}

const sum = (rows) => ({
  scenes: rows.length,
  negativeLeakOverallMean: mean(rows.map((r) => r.truthAlignment.negativeLeakOverall)),
  negativeLeakMaxPerRegionWorst: rows.length ? Math.max(...rows.map((r) => r.truthAlignment.negativeLeakMaxPerRegion)) : 0,
  negativeRegionsWithAnyLeakTotal: rows.reduce((a, r) => a + r.truthAlignment.negativeRegionsWithAnyLeak, 0),
  positivePanelInstanceRecallMean: mean(rows.map((r) => r.truthAlignment.positivePanelInstanceRecall)),
  positivePanelMedianIoUMean: mean(rows.map((r) => r.truthAlignment.positivePanelMedianIoU)),
  cornerRadiusMAEMean: mean(rows.map((r) => r.truthAlignment.cornerRadiusMAE)),
  textInkRasterCoverMean: mean(rows.flatMap((r) => r.reconstruction.inkCoverage.map((i) => i.rasterCoverRatio))),
  textInkVectorCoverMean: mean(rows.flatMap((r) => r.reconstruction.inkCoverage.map((i) => i.vectorCoverRatio))),
  rasterOverdrawRatioMean: mean(rows.map((r) => r.guardrails.rasterOverdrawRatio)),
  rasterContainmentCountTotal: rows.reduce((a, r) => a + r.guardrails.rasterContainmentCount, 0),
  reconstructionMaeMean: mean(rows.map((r) => r.reconstruction.mae)),
  reconstructionP99Mean: mean(rows.map((r) => r.reconstruction.p99)),
  vectorAreaReconstructionMaeMean: mean(rows.map((r) => r.reconstruction.vectorAreaMae)),
  keptElementsPerMegapixelMean: mean(rows.map((r) => r.guardrails.keptElementsPerMegapixel)),
  droppedTotal: rows.reduce((a, r) => a + r.guardrails.dropped, 0),
  stripeRunScoreMean: mean(rows.map((r) => r.guardrails.stripeRunScore)),
  cycleCountTotal: rows.reduce((a, r) => a + r.guardrails.cycleCount, 0),
});

const tuning = results.filter((r) => r.split === "tuning");
const holdout = results.filter((r) => r.split === "holdout");

const out = {
  generatedAt: new Date().toISOString(),
  note: "実画像に対する検出器のベースライン。画像とオーバーレイは公開除外側にあり、ここには数値だけを置く。",
  srcClean: SRC_CLEAN,
  capturedAt: manifest.capturedAt,
  detectOpts: DETECT_OPTS,
  maxElements: MAX_ELEMENTS,
  summaryTuning: sum(tuning),
  summaryHoldout: sum(holdout),
  perImage: results,
};
writeFileSync(outArgPath() ? resolve(outArgPath()) : join(HERE, "fixtures", "real-baseline.json"), JSON.stringify(out, null, 2) + "\n");

console.log("\n--- tuning set ---");
console.log(JSON.stringify(out.summaryTuning, null, 2));
console.log("\n--- holdout ---");
console.log(process.env.SHOW_HOLDOUT === "1"
  ? JSON.stringify(out.summaryHoldout, null, 2)
  : "Task 19 まで見ない（real-baseline.json には記録済み）。");
