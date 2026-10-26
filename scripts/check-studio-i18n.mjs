// Studio UI の文言（src/studioI18n/<言語>.ts）の整合を検査する。終了コード 0 = 合格、1 = エラーあり。
// - キー集合: 全言語で ja との余剰キーはエラー。不足は en でエラー、en 以外では警告（翻訳を後から足す前提）
// - 空文字の値はエラー
// - プレースホルダー（{n} など）の集合が ja と一致しない言語はエラー
// - src/studio.ts が参照する t('キー') と data-i18n / -ph / -aria / -title のキーが ja に無いとエラー
// - src/studioI18n/ の言語ファイルが src/studioI18n.ts に登録されていないとエラー
import ts from "typescript";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "src", "studioI18n");
const INDEX = join(ROOT, "src", "studioI18n.ts");
const STUDIO = join(ROOT, "src", "studio.ts");

const errors = [];
const warnings = [];

// 言語ファイルは import を持たない単独の TS なので、型を外して JS にしてから評価する
function loadDict(file) {
  const src = readFileSync(file, "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  let dict;
  try {
    dict = new Function(js.replace(/^export\s+/m, "") + "\nreturn dict;")();
  } catch (e) {
    errors.push(`${basename(file)}: 読み込みに失敗（構文エラーの可能性）: ${e.message}`);
    return null;
  }
  if (!dict || typeof dict !== "object") {
    errors.push(`${basename(file)}: export const dict が無い`);
    return null;
  }
  return dict;
}

const placeholders = (s) => [...new Set(s.match(/\{[A-Za-z_][A-Za-z0-9_]*\}/g) ?? [])].sort().join(",");

const files = readdirSync(DIR).filter((f) => f.endsWith(".ts")).sort();
const langs = {};
for (const f of files) {
  const lang = basename(f, ".ts");
  langs[lang] = await loadDict(join(DIR, f));
}
if (!langs.ja) errors.push("src/studioI18n/ja.ts が無い（キーの正本）");

const indexSrc = readFileSync(INDEX, "utf8");
for (const lang of Object.keys(langs)) {
  if (!indexSrc.includes(`"./studioI18n/${lang}.js"`)) errors.push(`${lang}: src/studioI18n.ts に登録されていない`);
}

const ja = langs.ja ?? {};
const jaKeys = Object.keys(ja);
for (const [lang, dict] of Object.entries(langs)) {
  if (lang === "ja") continue;
  const keys = Object.keys(dict);
  const missing = jaKeys.filter((k) => !(k in dict));
  const extra = keys.filter((k) => !(k in ja));
  if (missing.length) {
    const msg = `${lang}: 不足キー ${missing.length} 件: ${missing.join(", ")}`;
    if (lang === "en") errors.push(msg);
    else warnings.push(msg);
  }
  if (extra.length) errors.push(`${lang}: 余剰キー ${extra.length} 件（ja に無い）: ${extra.join(", ")}`);
  for (const k of keys) {
    if (k in ja && placeholders(dict[k]) !== placeholders(ja[k])) {
      errors.push(`${lang}.${k}: プレースホルダーが ja と一致しない（ja: ${placeholders(ja[k]) || "なし"} / ${lang}: ${placeholders(dict[k]) || "なし"}）`);
    }
  }
}
for (const [lang, dict] of Object.entries(langs)) {
  const empty = Object.keys(dict).filter((k) => typeof dict[k] !== "string" || dict[k].trim() === "");
  if (empty.length) errors.push(`${lang}: 空の値 ${empty.length} 件: ${empty.join(", ")}`);
}

// 参照キーの確認（src/studio.ts のテンプレートと t() 呼び出し）
const studioSrc = readFileSync(STUDIO, "utf8");
const refs = new Set();
for (const m of studioSrc.matchAll(/\bt\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)/g)) refs.add(m[1]);
for (const m of studioSrc.matchAll(/data-i18n(?:-ph|-aria|-title)?=\\?["']([A-Za-z0-9_]+)\\?["']/g)) refs.add(m[1]);
const unknownRefs = [...refs].filter((k) => !(k in ja)).sort();
if (unknownRefs.length) errors.push(`src/studio.ts が参照するキーが ja に無い ${unknownRefs.length} 件: ${unknownRefs.join(", ")}`);

for (const w of warnings) console.warn("WARN  " + w);
for (const e of errors) console.error("ERROR " + e);
const counts = Object.entries(langs).map(([l, d]) => `${l}=${Object.keys(d).length}`).join(" ");
console.log(`studio i18n: ${counts} / 参照キー ${refs.size} 件 / エラー ${errors.length} / 警告 ${warnings.length}`);
process.exit(errors.length ? 1 : 0);
