// README の多言語版が英語版(README.md)と同じ構造かを検査する。
//   node scripts/check-readme-i18n.mjs        検査のみ（不一致があれば exit 1）
//   node scripts/check-readme-i18n.mjs --fix  言語リンク行(🌐)を全ファイルに書き込む
// 英語版が正本。README.ja.md は独自構成のため言語リンク行だけを検査する。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LANGS = [
  ["en", "English", "README.md"],
  ["ja", "日本語", "README.ja.md"],
  ["zh-CN", "简体中文", "README.zh-CN.md"],
  ["ko", "한국어", "README.ko.md"],
  ["es", "Español", "README.es.md"],
  ["fr", "Français", "README.fr.md"],
  ["de", "Deutsch", "README.de.md"],
  ["pt-BR", "Português (Brasil)", "README.pt-BR.md"],
];
const SELECTOR_PREFIX = "🌐 ";
const fix = process.argv.includes("--fix");

const selectorFor = (code) =>
  SELECTOR_PREFIX +
  LANGS.map(([c, name, file]) => (c === code ? `**${name}**` : `[${name}](./${file})`)).join(" | ");

const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const errors = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);

// 言語リンク行を、`🌐 ` 行 → 旧リンク行 → 見出し直後 の順で探して差し替える
function applySelector(file, code) {
  let text = read(file);
  const line = selectorFor(code);
  const lines = text.split("\n");
  let i = lines.findIndex((l) => l.startsWith(SELECTOR_PREFIX));
  if (i < 0) i = lines.findIndex((l) => /^\[(English README is here|日本語 README はこちら)\]/.test(l));
  if (i < 0) return err(file, "言語リンク行(🌐)が無い");
  lines[i] = line;
  fs.writeFileSync(path.join(root, file), lines.join("\n"));
}

if (fix) {
  for (const [code, , file] of LANGS) if (fs.existsSync(path.join(root, file))) applySelector(file, code);
}

const en = read("README.md");
const strip = (t) => t.split("\n").filter((l) => !l.startsWith(SELECTOR_PREFIX));
const headings = (t) => strip(t).filter((l) => /^#{1,6} /.test(l)).map((l) => l.match(/^#+/)[0]);
const fences = (t) => strip(t).filter((l) => /^\s*```/.test(l)).map((l) => l.trim().replace(/\s+/g, " "));
const urls = (t) =>
  [...strip(t).join("\n").matchAll(/\]\(([^)\s]+)[^)]*\)|(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1] || m[2])
    .filter((u) => !/^\.\/README[\w.-]*\.md$/.test(u))
    .sort();
const tableRows = (t) => strip(t).filter((l) => l.startsWith("|")).length;
const comments = (t) => [...t.matchAll(/<!--[\s\S]*?-->/g)].map((m) => m[0]);

const same = (file, label, a, b) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) err(file, `${label} が英語版と一致しない（英語 ${a.length} / ここ ${b.length}）`);
};

for (const [code, , file] of LANGS) {
  if (!fs.existsSync(path.join(root, file))) {
    err(file, "ファイルが無い");
    continue;
  }
  const t = read(file);
  const sel = t.split("\n").find((l) => l.startsWith(SELECTOR_PREFIX));
  if (sel !== selectorFor(code)) err(file, "言語リンク行(🌐)が正しくない（--fix で直る）");
  if (code === "en" || code === "ja") continue;
  same(file, "見出しの階層・数", headings(en), headings(t));
  same(file, "コードフェンス", fences(en), fences(t));
  same(file, "リンク・画像の URL", urls(en), urls(t));
  same(file, "表の行数", [tableRows(en)], [tableRows(t)]);
  same(file, "HTML コメント", comments(en), comments(t));
  if (/SELECTOR/.test(t) && !sel) err(file, "SELECTOR の仮置きが残っている");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`OK: ${LANGS.length} 言語の README が整合`);
