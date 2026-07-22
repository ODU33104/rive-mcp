// canvas-advanced ランタイム(JS/WASM)を assets/ へ vendor する。
// 実行時ネットワーク不要にするためビルド時にコピーしておく。
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "node_modules", "@rive-app", "canvas-advanced");
const dst = join(root, "assets");

mkdirSync(dst, { recursive: true });
for (const f of ["canvas_advanced.mjs", "rive.wasm"]) {
  copyFileSync(join(src, f), join(dst, f));
  console.log(`vendored: ${f}`);
}

// スタジオUI用の高レベルランタイム (@rive-app/canvas)
const canvasSrc = join(root, "node_modules", "@rive-app", "canvas");
copyFileSync(join(canvasSrc, "rive.js"), join(dst, "rive-canvas.js"));
copyFileSync(join(canvasSrc, "rive.wasm"), join(dst, "rive-canvas.wasm"));
console.log("vendored: rive-canvas.js / rive-canvas.wasm");

// skills/ が正本。プラグイン(plugin/skills/)へ同期して二重メンテを防ぐ
// (プラグインは git から直接インストールされるため、同期結果はコミットする)
const skillSrc = join(root, "skills", "rive-design-guidelines", "SKILL.md");
const skillDst = join(root, "plugin", "skills", "rive-design-guidelines", "SKILL.md");
mkdirSync(dirname(skillDst), { recursive: true });
copyFileSync(skillSrc, skillDst);
console.log("synced: plugin/skills/rive-design-guidelines/SKILL.md");
