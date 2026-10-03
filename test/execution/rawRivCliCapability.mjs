import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const asset = join(
  root,
  "test/tmp/real-world-corpus/assets/official-flutter-rapid-pointer.riv"
);
const outDir = join(root, "test/tmp/raw-riv-execution");
mkdirSync(outDir, { recursive: true });

const bytes = readFileSync(asset);
const sha256 = createHash("sha256").update(bytes).digest("hex");
assert.equal(
  sha256,
  "e0584ba73df9bf8a7ac1a4ff1c3e381212967b10025d936e49ddab3d30a13079",
  "rapid-pointer fixture hash drift"
);
assert.equal(bytes.length, 528, "rapid-pointer fixture size drift");

const rive = process.env.RIVE_CLI_BIN || "rive";

function run(args) {
  const result = spawnSync(rive, args, {
    encoding: "utf8",
    env: { ...process.env, RIVE_NO_TUI: "1", TERM: "dumb" },
  });
  return {
    args,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ? String(result.error) : null,
  };
}

const version = run(["--version"]);
assert.equal(version.status, 0, version.stderr || version.stdout || version.error);

const screenshotArg = "--screenshot=" + join(outDir, "cli-direct.png");
const actionProbes = {
  pointer: run([asset, screenshotArg, "--pointer=down@250,250"]),
  data: run([asset, screenshotArg, "--data=hasReached=true"]),
  key: run([asset, screenshotArg, "--key=enter"]),
  advance: run([asset, screenshotArg, "--advance=16ms"]),
};

for (const [action, probe] of Object.entries(actionProbes)) {
  assert.equal(probe.status, 1, action + " raw .riv probe unexpectedly succeeded");
  assert.match(
    probe.stderr,
    /is a built \.riv; rive previews projects, not \.riv files/,
    action + " probe did not hit the expected raw .riv project boundary"
  );
}

const directScenario = run([
  asset,
  screenshotArg,
  "--pointer=down@250,250",
  "--pointer=up@250,250",
  "--advance=16ms",
  "--data-dump=-",
]);

const directInspect = run(["inspect", asset, "--json"]);

const result = {
  schemaVersion: "rive-mcp.raw-riv-cli-capability/v1",
  fixture: "official-flutter-rapid-pointer",
  artifact: {
    sha256,
    bytes: bytes.length,
  },
  cliVersion: (version.stdout || version.stderr).trim(),
  exactSameBytesAttempted: true,
  conversionsPerformed: false,
  actionProbes,
  commands: {
    directScenario,
    directInspect,
  },
  conclusion:
    directScenario.status === 0 || directInspect.status === 0
      ? "raw-riv-accepted-by-at-least-one-probed-cli-path"
      : "raw-riv-not-accepted-by-probed-cli-project-and-inspect-paths",
};

writeFileSync(
  join(outDir, "cli-capability.json"),
  JSON.stringify(result, null, 2) + "\n"
);

console.log(JSON.stringify(result, null, 2));
