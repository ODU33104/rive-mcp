// ベクター入力の忠実度をブラウザで実測する。
//   node test/vectorScene.mjs
// 比較するのは **生成した .riv を実際にレンダリングした静止フレーム** と
// **同じ SVG をブラウザにラスタライズさせた絵**。スクリーンショット経路の
// reconstructionStats（合成をシミュレートする）と違い、ここは往復を全部通す。
//
// 正解ラベルを人が作る必要が無いのがベクター経路の利点: SVG 自身が画素の正解。
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RiveHost } from "../dist/riveHost.js";
import { PAGE_SCRIPT } from "../dist/pageScript.js";
import { parseVectorScene, editableRatio } from "../dist/vectorScene.js";
import { buildPrototypeScene } from "../dist/uiPrototype.js";
import { createRiv } from "../dist/rivWriter.js";
import { VECTOR_FIXTURES } from "./fixtures/vectorSvg.mjs";

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

/** 2 枚の PNG を同じ白地の上に重ねて画素比較する。region を渡すとその矩形だけ測る */
async function compare(host, aPng, bPng, regions) {
  const page = await host.getPage();
  return page.evaluate(async ({ a, b, regions }) => {
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
    return {
      size: { a: [ia.width, ia.height], b: [ib.width, ib.height] },
      overall: measure([0, 0, W, H]),
      regions: regions.map((r) => ({ name: r.name, ...measure(r.box, r.exclude) })),
    };
  }, { a: aPng, b: bPng, regions });
}

const host = new RiveHost(PAGE_SCRIPT);
const rows = [];
try {
  for (const fx of VECTOR_FIXTURES) {
    const scene = parseVectorScene(fx.svg);
    check(`[${fx.name}] 同一入力 → 同一 id`,
      JSON.stringify(parseVectorScene(fx.svg)) === JSON.stringify(scene));

    // riv_ui_prototype と同じ組み立て。ロールはレイヤー名のヒント任せ（既定の経路）
    const withRoles = scene.elements.map((e) => ({ ...e, role: e.roleHint ?? "panel" }));
    const built = buildPrototypeScene({
      elements: withRoles,
      source: { width: scene.width, height: scene.height },
      interactions: true,
      motion: { entranceMs: 800, ambient: true },
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
    const visible = scene.elements.filter((e) => e.fill || e.shapes);
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
    const cmp = await compare(host, svgPng, shot.frames[0], insides);
    check(`[${fx.name}] 同じ寸法で描かれる`,
      cmp.size.a.join() === cmp.size.b.join(), JSON.stringify(cmp.size));

    // 測る画素が残った領域だけを見る（小さな矩形は除外で全部消えることがある）
    const sampled = cmp.regions.filter((r) => r.pixels > 100);
    const worstInside = sampled.reduce((m, r) => Math.max(m, r.worst), 0);
    const ratio = editableRatio(scene.elements);
    rows.push({
      name: fx.name,
      hasText: fx.hasText,
      size: `${scene.width}x${scene.height}`,
      elements: scene.elements.length,
      editable: `${ratio.editable}/${ratio.total}`,
      ratio: ratio.ratio,
      mae: cmp.overall.mae,
      worst: cmp.overall.worst,
      rectInteriorWorst: worstInside,
      bytes: bytes.length,
    });

    // <text> を含むフィクスチャは、取り込めなかった文字の穴が矩形の内側に開く。
    // それは既知の欠落（M3）であってラスタライザの差ではないので、この検査からは外す
    if (!fx.hasText) {
      check(`[${fx.name}] 矩形の内側は画素一致（塗りも角丸も推定していない）`,
        worstInside <= 2, `worst=${worstInside} over ${sampled.length} rects`);
    }
    check(`[${fx.name}] 再構成 MAE ${cmp.overall.mae.toFixed(6)} <= ${PER_FIXTURE_MAX}`,
      cmp.overall.mae <= PER_FIXTURE_MAX, `worst pixel diff ${cmp.overall.worst}`);
    check(`[${fx.name}] 編集可能要素 80% 以上`, ratio.ratio >= 0.8, `${ratio.editable}/${ratio.total}`);
  }

  const mean = rows.reduce((s, r) => s + r.mae, 0) / rows.length;
  const meanNoText = (() => {
    const r = rows.filter((x) => !x.hasText);
    return r.reduce((s, x) => s + x.mae, 0) / r.length;
  })();
  console.log("\n" + JSON.stringify({ rows, reconstructionMaeMean: mean, reconstructionMaeMeanWithoutText: meanNoText }, null, 1));
  check(`再構成 MAE の平均 ${mean.toFixed(6)} <= スクショ経路の ${SCREENSHOT_MAE_MEAN}`,
    mean <= SCREENSHOT_MAE_MEAN);
} finally {
  await host.close();
}

console.log(failed === 0 ? "\nVECTOR SCENE PASS" : `\n${failed} FAILURES`);
process.exit(failed ? 1 : 0);
