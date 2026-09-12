import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const en = readFileSync(join(root, "README.md"), "utf8");
const ja = readFileSync(join(root, "README.ja.md"), "utf8");

assert.match(en, /## Tools \(33\)/);
assert.match(ja, /## ツール一覧 \(33\)/);
assert.ok(!en.includes("Tools (32)"), "English README still advertises 32 tools");
assert.ok(!en.includes("all 32 tools"), "English development docs still advertise 32 tools");
assert.ok(!ja.includes("6軸"), "Japanese README still documents the old 6-axis critique");

for (const doc of [en, ja]) {
  assert.ok(doc.includes("`riv_finalize`"), "README missing riv_finalize");
  assert.ok(doc.includes("assetRef"), "README missing immutable assetRef workflow");
  assert.ok(doc.includes("rive-author"), "README missing rive-author skill");
  assert.ok(doc.includes("rive-refine"), "README missing rive-refine skill");
  assert.ok(doc.includes("rive-qa"), "README missing rive-qa skill");
  assert.ok(doc.includes("rive-setup"), "README missing rive-setup skill");
  assert.ok(doc.includes("rive-design-guidelines"), "README missing craft reference skill");
}

assert.ok(en.includes("test:clean-room"), "English README missing clean-room release gate command");
assert.ok(en.includes("provenance"), "English README missing provenance documentation");
assert.ok(ja.includes("provenance"), "Japanese README missing provenance documentation");

console.log("documentation consistency tests passed");
