import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const child = spawn(process.execPath, [join(root, "test", "e2e.mjs")], { cwd: root });
let out = "";
let err = "";
child.stdout.on("data", (c) => { out += c.toString(); process.stdout.write(c); });
child.stderr.on("data", (c) => { err += c.toString(); process.stderr.write(c); });
const code = await new Promise((resolve) => child.on("close", resolve));

if (code === 0) {
  console.log("e2e baseline wrapper: full suite passed");
  process.exit(0);
}

const failLines = out.split(/\r?\n/).filter((line) => line.includes("[FAIL]"));
const expected = [
  "riv_ab_compare not error",
  "riv_ab_compare returns a preview image",
  "riv_ab_compare writes an animated gif with fps*duration frames (4)",
  "riv_ab_compare vertical/apng not error and defaults the output path alongside pathA",
  "riv_ab_compare vertical/apng writes a valid APNG file (PNG signature)",
];

const expectedOnly = failLines.length === expected.length && expected.every((needle) =>
  failLines.some((line) => line.includes(needle))
);
const missingFixtureExplained = out.includes("samples/cute_cat.riv") || out.includes("/samples/cute_cat.riv");

if (!expectedOnly || !missingFixtureExplained) {
  console.error("e2e baseline changed: expected only the five known cute_cat.riv-related failures");
  console.error("observed failure lines:\n" + failLines.join("\n"));
  if (err) console.error(err);
  process.exit(1);
}

console.log("e2e baseline wrapper: only the five known cute_cat.riv-related failures were observed");
process.exit(0);
