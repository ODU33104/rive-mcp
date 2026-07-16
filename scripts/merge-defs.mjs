// vendor/rive-defs/raw/**.json → vendor/rive-defs/defs.json 統合（alternates含む）
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RAW = "vendor/rive-defs/raw";
const files = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e.endsWith(".json")) files.push(p);
  }
})(RAW);

const types = {};
for (const f of files) {
  const j = JSON.parse(readFileSync(f, "utf8"));
  if (!j.name) continue;
  const props = {};
  for (const [pn, p] of Object.entries(j.properties ?? {})) {
    if (p.key?.int == null) continue;
    props[pn] = { key: p.key.int, type: p.type };
    // 旧フォーマット互換の代替キー（例: node.x の alternate 9 = xArtboard）
    for (const alt of p.key.alternates ?? []) {
      if (alt.int != null) props[`${pn}@${alt.string ?? alt.int}`] = { key: alt.int, type: p.type };
    }
  }
  types[j.name] = {
    typeKey: j.key?.int ?? null,
    extends: j.extends ?? null,
    file: relative(RAW, f).replaceAll("\\", "/"),
    abstract: j.key?.int == null,
    properties: props,
  };
}
writeFileSync("vendor/rive-defs/defs.json", JSON.stringify({ types }, null, 1));
console.log(`merged ${files.length} files -> ${Object.keys(types).length} types`);
