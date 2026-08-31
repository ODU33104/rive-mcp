// ベクター入力の忠実度をブラウザで実測する。
//   node test/vectorScene.mjs [--out <path>]
// 比較するのは **生成した .riv を実際にレンダリングした静止フレーム** と
// **同じ SVG をブラウザにラスタライズさせた絵**。スクリーンショット経路の
// reconstructionStats（合成をシミュレートする）と違い、ここは往復を全部通す。
//
// 正解ラベルを人が作る必要が無いのがベクター経路の利点: SVG 自身が画素の正解。
//
// **テキストを含むフィクスチャは画素一致では測らない。** .riv は同梱 Inter を埋め込み、
// ブラウザは自分の既定サンセリフで描くので、字形が違うのは当たり前で、そこを MAE で
// 詰めても字が正しく置かれたことの証明にならない。代わりに「インクがあるか・
// どこにあるか」（被覆と bbox の IoU）で見る。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RiveHost } from "../dist/riveHost.js";
import { PAGE_SCRIPT } from "../dist/pageScript.js";
import { parseVectorScene, editableRatio, attachTextRasters } from "../dist/vectorScene.js";
import { buildPrototypeScene } from "../dist/uiPrototype.js";
import { createRiv } from "../dist/rivWriter.js";
import { VECTOR_FIXTURES } from "./fixtures/vectorSvg.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const outArg = (() => {
  const i = process.argv.indexOf("--out");
  return i >= 0 ? resolve(process.argv[i + 1]) : join(HERE, "fixtures", "vector-baseline.json");
})();

let failed = 0;
function check(label, cond, detail = "") {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed++;
}

// スクリーンショット経路の実測値（test/fixtures/after-batch-real.json の
// reconstructionMaeMean）。ベクター経路はこれ以下でなければ「元データを使う意味」が無い。
const SCREENSHOT_MAE_MEAN = 0.0004;
// 1 枚あたりの上限。曲線と斜め線のアンチエイリアスは 2 つのラスタライザで
// 一致しないので 0 にはならない（実測は下の出力を見ること）
const PER_FIXTURE_MAX = 0.001;

const INTER = new Uint8Array(readFileSync(join(HERE, "..", "assets", "inter.ttf")));

/** 2 枚の PNG を同じ白地の上に重ねて画素比較する。region を渡すとその矩形だけ測る。
 *  inks を渡すと、その矩形の「地の色から外れた画素」の被覆と bbox を両方の絵で測る。 */
async function compare(host, aPng, bPng, regions, inks = []) {
  const page = await host.getPage();
  return page.evaluate(async ({ a, b, regions, inks }) => {
    const dec = (s) => {
      const bin = atob(s);
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return u;
    };
    const load = (s) => createImageBitmap(new Blob([dec(s)], { type: "image/png" }));
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const W = ia.width, H = ia.height;
    // 透明部分の扱いを揃えるため、両方とも白地に描いてから読む
    const draw = (img) => {
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const x = c.getContext("2d");
      x.fillStyle = "#ffffff";
      x.fillRect(0, 0, W, H);
      x.drawImage(img, 0, 0, W, H);
      return x.getImageData(0, 0, W, H).data;
    };
    const da = draw(ia), db = draw(ib);
    const measure = ([x0, y0, x1, y1], exclude = []) => {
      let sum = 0, n = 0, worst = 0;
      for (let y = Math.max(0, Math.round(y0)); y < Math.min(H, Math.round(y1)); y++)
        for (let x = Math.max(0, Math.round(x0)); x < Math.min(W, Math.round(x1)); x++) {
          if (exclude.some((e) => x >= e[0] && x < e[2] && y >= e[1] && y < e[3])) continue;
          const i = (y * W + x) * 4;
          for (let k = 0; k < 3; k++) {
            const d = Math.abs(da[i + k] - db[i + k]);
            sum += d;
            if (d > worst) worst = d;
          }
          n++;
        }
      return { mae: n ? sum / (n * 3) / 255 : 0, worst, pixels: n };
    };
    // 「インク」= その矩形で一番多い色（＝地）から離れた画素。文字色を知らなくても測れる
    const ink = (data, [x0, y0, x1, y1]) => {
      const X0 = Math.max(0, Math.round(x0)), Y0 = Math.max(0, Math.round(y0));
      const X1 = Math.min(W, Math.round(x1)), Y1 = Math.min(H, Math.round(y1));
      const hist = new Map();
      for (let y = Y0; y < Y1; y++)
        for (let x = X0; x < X1; x++) {
          const i = (y * W + x) * 4;
          const key = (data[i] >> 3 << 10) | (data[i + 1] >> 3 << 5) | (data[i + 2] >> 3);
          hist.set(key, (hist.get(key) ?? 0) + 1);
        }
      let best = 0, bestN = -1;
      for (const [k, n] of hist) if (n > bestN) { bestN = n; best = k; }
      const br = ((best >> 10) & 31) * 8, bg = ((best >> 5) & 31) * 8, bb = (best & 31) * 8;
      let n = 0, total = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let y = Y0; y < Y1; y++)
        for (let x = X0; x < X1; x++) {
          const i = (y * W + x) * 4;
          total++;
          const d = Math.abs(data[i] - br) + Math.abs(data[i + 1] - bg) + Math.abs(data[i + 2] - bb);
          if (d > 96) {
            n++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      return {
        coverage: total ? n / total : 0,
        box: n ? [minX, minY, maxX - minX + 1, maxY - minY + 1] : [0, 0, 0, 0],
      };
    };
    return {
      size: { a: [ia.width, ia.height], b: [ib.width, ib.height] },
      overall: measure([0, 0, W, H]),
      regions: regions.map((r) => ({ name: r.name, ...measure(r.box, r.exclude) })),
      inks: inks.map((r) => ({ name: r.name, svg: ink(da, r.box), riv: ink(db, r.box) })),
    };
  }, { a: aPng, b: bPng, regions, inks });
}

const iou = (a, b) => {
  const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  const i = ix * iy;
  const u = a[2] * a[3] + b[2] * b[3] - i;
  return u > 0 ? i / u : 0;
};

const host = new RiveHost(PAGE_SCRIPT);
const rows = [];
try {
  for (const fx of VECTOR_FIXTURES) {
    const opts = { fallbackFont: { label: "inter.ttf", bytes: INTER } };
    const scene = parseVectorScene(fx.svg, opts);
    check(`[${fx.name}] 同一入力 → 同一 id`,
      JSON.stringify(parseVectorScene(fx.svg, opts).elements) === JSON.stringify(scene.elements));
    await attachTextRasters(scene.elements, host);

    // riv_ui_prototype と同じ組み立て。ロールはレイヤー名のヒント任せ（既定の経路）
    const withRoles = scene.elements.map((e) => ({ ...e, role: e.roleHint ?? "panel" }));
    const built = buildPrototypeScene({
      elements: withRoles,
      source: { width: scene.width, height: scene.height },
      interactions: true,
      motion: { entranceMs: 800, ambient: true },
      fonts: scene.fonts,
    });
    check(`[${fx.name}] 元画像を埋め込まない`, built.rasterRegions.length === 0,
      String(built.rasterRegions.length));
    const { bytes } = createRiv(built.spec);

    const svgPng = (await host.rasterize(fx.svg)).toString("base64");
    // 入場アニメの終わったあと = プロトタイプの静止状態
    const shot = await host.renderFrames(Buffer.from(bytes), {
      animation: "entrance", frameCount: 1, startTime: 5, width: scene.width, format: "png",
    });

    // 軸平行の矩形は「属性値そのまま」なので、縁のアンチエイリアスと**上に乗る他の要素**を
    // 除けば画素まで一致するはず。残差が本当に縁と曲線だけであることをここで示す。
    // 除外の余白 6px は、ストロークがパスの両側に太るぶん（このフィクスチャの最大は 8px 幅＝片側 4px）
    // とアンチエイリアスを合わせた値。
    const MARGIN = 6;
    const visible = scene.elements.filter((e) => e.fill || e.shapes || e.textRun || e.imageBytes);
    const insides = scene.elements
      .filter((e) => e.renderMode === "vector-panel" && e.fill && e.rect[2] > 12 && e.rect[3] > 12)
      .map((e) => ({
        name: `#${e.id}`,
        // 角丸のぶんも内側に寄せる。半径 22 の丸ボタンを 3px しか削らないと、
        // 「矩形の内側」のつもりで円弧の外側（＝地の色）を測ってしまう
        box: (() => {
          const d = Math.max(3, e.cornerRadius ?? 0);
          return [e.rect[0] + d, e.rect[1] + d, e.rect[0] + e.rect[2] - d, e.rect[1] + e.rect[3] - d];
        })(),
        // 上に乗るものだけを除く。面積が小さい方が上、はこのフィクスチャでは常に成り立つ
        // （全面の背景を「他の要素」として除くと、測る画素が 1 つも残らなくなる）
        exclude: visible.filter((o) => o !== e && o.rect[2] * o.rect[3] < e.rect[2] * e.rect[3]).map((o) => [
          o.rect[0] - MARGIN, o.rect[1] - MARGIN,
          o.rect[0] + o.rect[2] + MARGIN, o.rect[1] + o.rect[3] + MARGIN,
        ]),
      }));
    // テキストの置き場所は「インクが SVG と同じところにあるか」で見る。
    // 枠は行の周りに少し広げる（字形が違うぶん、はみ出しを切り落とさないため）
    const inkProbes = scene.elements
      .filter((e) => e.semanticHint === "text")
      .map((e) => ({
        name: `#${e.id}`,
        box: [e.rect[0] - 4, e.rect[1] - 4, e.rect[0] + e.rect[2] + 4, e.rect[1] + e.rect[3] + 4],
      }));
    const cmp = await compare(host, svgPng, shot.frames[0], insides, inkProbes);
    check(`[${fx.name}] 同じ寸法で描かれる`,
      cmp.size.a.join() === cmp.size.b.join(), JSON.stringify(cmp.size));

    // 測る画素が残った領域だけを見る（小さな矩形は除外で全部消えることがある）
    const sampled = cmp.regions.filter((r) => r.pixels > 100);
    const worstInside = sampled.reduce((m, r) => Math.max(m, r.worst), 0);
    const ratio = editableRatio(scene.elements);
    const inkIous = cmp.inks.map((r) => iou(r.svg.box, r.riv.box));
    // <text> を含むフィクスチャは、字形の違いが矩形の内側に出る。それは既知の非一致
    // （フォントファイルは SVG に入っていない）であってラスタライザの差ではない。
    // pixelExact:false も同じ扱い（objectBoundingBox の斜め gradient は原理的に一致しない）
    const pixelExact = fx.pixelExact ?? !fx.hasText;
    rows.push({
      name: fx.name,
      hasText: fx.hasText,
      pixelExact,
      size: `${scene.width}x${scene.height}`,
      elements: scene.elements.length,
      editable: `${ratio.editable}/${ratio.total}`,
      ratio: ratio.ratio,
      text: scene.textStats,
      textRatio: scene.textStats.total ? scene.textStats.asText / scene.textStats.total : 1,
      mae: cmp.overall.mae,
      worst: cmp.overall.worst,
      rectInteriorWorst: worstInside,
      inkIouMin: inkIous.length ? Math.min(...inkIous) : null,
      inkCoverageMin: cmp.inks.length ? Math.min(...cmp.inks.map((r) => r.riv.coverage)) : null,
      bytes: bytes.length,
    });

    if (pixelExact) {
      check(`[${fx.name}] 矩形の内側は画素一致（塗りも角丸も推定していない）`,
        worstInside <= 2, `worst=${worstInside} over ${sampled.length} rects`);
      check(`[${fx.name}] 再構成 MAE ${cmp.overall.mae.toFixed(6)} <= ${PER_FIXTURE_MAX}`,
        cmp.overall.mae <= PER_FIXTURE_MAX, `worst pixel diff ${cmp.overall.worst}`);
    } else {
      for (const r of cmp.inks) {
        check(`[${fx.name}] ${r.name} に文字のインクがある`,
          r.riv.coverage > 0.02, `riv ${r.riv.coverage.toFixed(3)} / svg ${r.svg.coverage.toFixed(3)}`);
        check(`[${fx.name}] ${r.name} のインクが SVG と同じ場所にある`,
          iou(r.svg.box, r.riv.box) >= 0.5,
          `IoU ${iou(r.svg.box, r.riv.box).toFixed(2)} svg=${r.svg.box.join()} riv=${r.riv.box.join()}`);
      }
    }
    const minEditable = fx.minEditable ?? 0.8;
    check(`[${fx.name}] 編集可能要素 ${(minEditable * 100).toFixed(0)}% 以上`,
      ratio.ratio >= minEditable - 1e-9, `${ratio.editable}/${ratio.total}`);
  }

  const exact = rows.filter((r) => r.pixelExact);
  const mean = rows.reduce((s, r) => s + r.mae, 0) / rows.length;
  const meanExact = exact.reduce((s, x) => s + x.mae, 0) / exact.length;
  const summary = {
    recordedAt: new Date().toISOString(),
    note: "SVG 入力の実測。テキスト入りは字形が違い(フォントは SVG に入っていない)、" +
      "objectBoundingBox の斜め/放射 gradient は Rive では原理的に一致しないので、" +
      "その 2 種は MAE を退行検知にだけ使う。文字の置き場所はインクの被覆と bbox の IoU で見る。",
    fixtures: rows.length,
    reconstructionMaeMean: mean,
    reconstructionMaeMeanExact: meanExact,
    editableRatioMin: Math.min(...rows.map((r) => r.ratio)),
    textRatioMin: Math.min(...rows.map((r) => r.textRatio)),
    rows,
  };
  console.log("\n" + JSON.stringify(summary, null, 1));
  writeFileSync(outArg, JSON.stringify(summary, null, 2) + "\n");
  console.log(`\nwrote ${outArg}`);
  check(`画素一致するはずのフィクスチャの MAE 平均 ${meanExact.toFixed(6)} <= スクショ経路の ${SCREENSHOT_MAE_MEAN}`,
    meanExact <= SCREENSHOT_MAE_MEAN);
} finally {
  await host.close();
}

console.log(failed === 0 ? "\nVECTOR SCENE PASS" : `\n${failed} FAILURES`);
process.exit(failed ? 1 : 0);
