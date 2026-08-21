import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { RiveHost } from "../../dist/riveHost.js";
import { PAGE_SCRIPT } from "../../dist/pageScript.js";
import { buildTree } from "../../dist/uiDetect.js";
import { buildPrototypeScene, attachRasterAssets } from "../../dist/uiPrototype.js";
import { createRiv } from "../../dist/rivWriter.js";
import { encodeGif } from "../../dist/gif.js";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "media");
mkdirSync(OUT, { recursive: true });

// README と docs のデモを作り直す。
// デモ用の画面は**自前で描く**（他人の画面を配布しないため）。
// ロール付けは本来モデルがやる部分だが、ここでは幾何から素直に割り当てて
// 「人手の調整なしでどこまで行くか」を見せる。
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="440">
  <rect width="720" height="440" fill="#0F1319"/>
  <rect x="24" y="20" width="672" height="52" rx="10" fill="#1B2430"/>
  <text x="44" y="52" font-family="Arial, sans-serif" font-size="19" fill="#E8EDF4">Analytics</text>
  <rect x="596" y="32" width="80" height="28" rx="8" fill="#3D7BFF"/>
  <text x="614" y="51" font-family="Arial, sans-serif" font-size="13" fill="#FFFFFF">Share</text>

  <rect x="24" y="92" width="324" height="150" rx="12" fill="#18202B"/>
  <text x="46" y="124" font-family="Arial, sans-serif" font-size="13" fill="#8A99AD">Revenue</text>
  <text x="46" y="166" font-family="Arial, sans-serif" font-size="34" fill="#F2F6FB">248,900</text>
  <rect x="46" y="192" width="118" height="30" rx="8" fill="#22C55E"/>
  <text x="62" y="212" font-family="Arial, sans-serif" font-size="13" fill="#06210F">+12.4%</text>

  <rect x="372" y="92" width="156" height="150" rx="12" fill="#18202B"/>
  <text x="394" y="124" font-family="Arial, sans-serif" font-size="13" fill="#8A99AD">Active</text>
  <text x="394" y="166" font-family="Arial, sans-serif" font-size="30" fill="#F2F6FB">1,204</text>

  <rect x="548" y="92" width="148" height="150" rx="12" fill="#18202B"/>
  <text x="570" y="124" font-family="Arial, sans-serif" font-size="13" fill="#8A99AD">Errors</text>
  <text x="570" y="166" font-family="Arial, sans-serif" font-size="30" fill="#FF6B6B">17</text>

  <rect x="24" y="262" width="672" height="120" rx="12" fill="#18202B"/>
  <rect x="52" y="352" width="44" height="14" rx="3" fill="#3D7BFF"/>
  <rect x="112" y="330" width="44" height="36" rx="3" fill="#3D7BFF"/>
  <rect x="172" y="306" width="44" height="60" rx="3" fill="#3D7BFF"/>
  <rect x="232" y="318" width="44" height="48" rx="3" fill="#3D7BFF"/>
  <rect x="292" y="292" width="44" height="74" rx="3" fill="#3D7BFF"/>
  <rect x="352" y="300" width="44" height="66" rx="3" fill="#3D7BFF"/>
  <rect x="412" y="284" width="44" height="82" rx="3" fill="#3D7BFF"/>
  <rect x="24" y="404" width="672" height="2" fill="#2A3442"/>
</svg>`;

const host = new RiveHost(PAGE_SCRIPT);
try {
  const png = await host.rasterize(svg);
  writeFileSync(`${OUT}/ui-prototype-source.png`, png);

  const det = await host.detectUiRegions(png, { minArea: 576, workingMax: 1280 });
  const { elements } = buildTree(det.regions, 120);
  console.log(`検出 ${elements.length} 要素 / vector-panel ${elements.filter(e => e.renderMode === "vector-panel").length}`);

  // ロール付けは本来モデルがやる部分。デモでは幾何から素直に割り当てる。
  const withRoles = elements.map((e) => {
    let role = "panel";
    if (e.rect[2] >= det.width * 0.9 && e.rect[3] >= det.height * 0.9) role = "background";
    else if (e.semanticHint === "line") role = "divider";
    else if (e.semanticHint === "text") role = "text";
    else if (e.rect[1] < 80 && e.rect[2] > 400) role = "header";
    else if (e.rect[3] >= 120) role = "card";
    else if (e.rect[1] > 260) role = "chart";
    else if (e.rect[2] <= 130 && e.rect[3] <= 40) role = "button";
    return { ...e, role };
  });

  const built = buildPrototypeScene({
    elements: withRoles,
    source: { width: det.width, height: det.height },
    interactions: true,
    motion: { entranceMs: 1400, ambient: true },
  });
  const sliced = built.rasterRegions.length
    ? await host.sliceImage(png, built.rasterRegions)
    : { width: det.width, height: det.height, parts: [], base: png.toString("base64") };
  attachRasterAssets(built.spec, sliced);
  const { bytes } = createRiv(built.spec);
  writeFileSync(`${OUT}/ui-prototype-demo.riv`, bytes);
  console.log(`riv ${(bytes.length / 1024).toFixed(0)}KB  警告: ${built.warnings.length ? built.warnings.join(" / ") : "なし"}`);
  const counts = {};
  for (const e of withRoles) counts[e.role] = (counts[e.role] || 0) + 1;
  console.log("ロール:", JSON.stringify(counts));

  const fps = 24;
  const frames = await host.renderFrames(Buffer.from(bytes), {
    animation: "entrance", startTime: 0, frameCount: Math.round(fps * 2.6), fps,
    width: 600, background: "#0F1319", format: "rgba",
  });
  writeFileSync(`${OUT}/ui-prototype-demo.gif`,
    encodeGif(frames.frames.map((f) => Buffer.from(f, "base64")), frames.width, frames.height, fps));
  console.log(`gif ${frames.width}x${frames.height} ${frames.frames.length}f`);
} finally { await host.close(); }
