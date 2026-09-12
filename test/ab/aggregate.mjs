import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const root = resolve(process.argv[2] || join(repoRoot, "test", "tmp", "creative-ab"));
const out = resolve(process.argv[3] || join(root, "_summary"));
mkdirSync(out, { recursive: true });
const blindDir = join(out, "blind");
mkdirSync(blindDir, { recursive: true });

function walk(dir, name, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walk(p, name, acc);
    else if (ent.name === name) acc.push(p);
  }
  return acc;
}

const results = walk(root, "result.json").map((p) => JSON.parse(readFileSync(p, "utf8")));
results.sort((a,b) => [a.briefId,a.runIndex,a.version].join(":").localeCompare([b.briefId,b.runIndex,b.version].join(":")));

const median = (values) => {
  if (!values.length) return null;
  const a = [...values].sort((x,y)=>x-y);
  const mid = Math.floor(a.length/2);
  return a.length % 2 ? a[mid] : (a[mid-1]+a[mid])/2;
};

function versionStats(version) {
  const rows = results.filter((r)=>r.version===version);
  const complete = rows.filter((r)=>r.post?.deliverable && !r.failure);
  return {
    runs: rows.length,
    completed: complete.length,
    completionRate: rows.length ? complete.length / rows.length : 0,
    medianInputTokens: median(rows.map((r)=>r.usage?.input_tokens ?? 0)),
    medianOutputTokens: median(rows.map((r)=>r.usage?.output_tokens ?? 0)),
    medianTotalTokens: median(rows.map((r)=>r.usage?.total_tokens ?? 0)),
    medianCachedTokens: median(rows.map((r)=>r.usage?.cached_tokens ?? 0)),
    medianToolCalls: median(rows.map((r)=>r.toolCalls ?? 0)),
    medianElapsedMs: median(rows.map((r)=>r.elapsedMs ?? 0)),
    totalToolErrors: rows.reduce((n,r)=>n+(r.toolErrors||0),0),
  };
}

const blindCandidates = [];
for (const r of results) {
  const dir = join(root, r.briefId, r.version, "run-" + r.runIndex);
  const preview = join(dir, "preview.png");
  const filmstrip = join(dir, "filmstrip.png");
  if (!existsSync(preview)) continue;
  const opaque = createHash("sha256")
    .update("rive-ab-v1:" + r.briefId + ":" + r.version + ":" + r.runIndex)
    .digest("hex");
  blindCandidates.push({ opaque, r, preview, filmstrip });
}
blindCandidates.sort((a,b)=>a.opaque.localeCompare(b.opaque));

const map = [];
const manifest = [];
for (let i=0;i<blindCandidates.length;i++) {
  const item = blindCandidates[i];
  const label = "sample-" + String(i+1).padStart(3,"0");
  const previewOut = join(blindDir, label + "-preview.png");
  copyFileSync(item.preview, previewOut);
  let filmstripName = null;
  if (existsSync(item.filmstrip)) {
    filmstripName = label + "-filmstrip.png";
    copyFileSync(item.filmstrip, join(blindDir, filmstripName));
  }
  manifest.push({
    sample: label,
    briefId: item.r.briefId,
    runIndexWithinUnknownVersion: item.r.runIndex,
    preview: label + "-preview.png",
    filmstrip: filmstripName,
  });
  map.push({
    sample: label,
    briefId: item.r.briefId,
    version: item.r.version,
    runIndex: item.r.runIndex,
  });
}

const summary = {
  generatedAt: new Date().toISOString(),
  baseline: versionStats("baseline"),
  current: versionStats("current"),
  runs: results,
};
writeFileSync(join(out, "summary.json"), JSON.stringify(summary,null,2));
writeFileSync(join(out, "blind-manifest.json"), JSON.stringify(manifest,null,2));
writeFileSync(join(out, "blind-map.keep-hidden.json"), JSON.stringify(map,null,2));

function fmt(n) { return n == null ? "n/a" : typeof n === "number" ? n.toFixed(1).replace(/\.0$/,"") : String(n); }
let md = "# Creative A/B telemetry summary\n\n";
md += "| Metric | Baseline | Current |\n|---|---:|---:|\n";
for (const [label,key] of [
  ["Runs","runs"],["Completed","completed"],["Completion rate","completionRate"],
  ["Median input tokens","medianInputTokens"],["Median output tokens","medianOutputTokens"],
  ["Median total tokens","medianTotalTokens"],["Median cached tokens","medianCachedTokens"],
  ["Median tool calls","medianToolCalls"],["Median elapsed ms","medianElapsedMs"],["Total tool errors","totalToolErrors"]
]) {
  const b=summary.baseline[key], c=summary.current[key];
  md += `| ${label} | ${key==="completionRate" ? fmt(b*100)+"%" : fmt(b)} | ${key==="completionRate" ? fmt(c*100)+"%" : fmt(c)} |\n`;
}
md += "\nQuality scores are intentionally not included until blind evaluation is completed.\n";
writeFileSync(join(out, "summary.md"), md);
console.log(md);
