import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RiveCliBackend } from "../../dist/backends/riveCliBackend.js";
import { createEvidenceManifest } from "../../dist/evidence/manifest.js";

function run(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, RIVE_NO_TUI: "1", TERM: "dumb" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

const binary = process.env.RIVE_CLI_BIN ?? "rive";
const workspace = mkdtempSync(join(tmpdir(), "rive-cli-backend-"));
const projectDir = join(workspace, "project");
const scaffold = await run(binary, ["create", projectDir]);
assert.equal(scaffold.code, 0, scaffold.stderr || scaffold.stdout);

const project = { kind: "directory", path: projectDir };
const scenario = {
  name: "official-cli-deterministic-frame",
  steps: [{ type: "advance", ms: 100 }],
  capture: { screenshot: true },
};
const backend = new RiveCliBackend({
  binary,
  outputDir: join(workspace, "artifacts"),
});

const identity = await backend.identify();
assert.equal(identity.id, "rive-cli");
assert.equal(identity.capabilities.scenarioSteps.data, true);

const verify = await backend.verify(project);
assert.equal(verify.ok, true, JSON.stringify(verify.diagnostics));

const inspect = await backend.inspect(project);
assert.equal(inspect.ok, true, JSON.stringify(inspect.diagnostics));
assert.ok((inspect.summary.artboardCount ?? 0) >= 1);

const first = await backend.execute(project, scenario);
const second = await backend.execute(project, scenario);
assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
assert.equal(second.ok, true, JSON.stringify(second.diagnostics));
assert.equal(first.artifacts[0]?.sha256, second.artifacts[0]?.sha256);

const manifestA = createEvidenceManifest({
  project,
  backend: identity,
  scenario,
  verify,
  inspect,
  execution: first,
  createdAt: "2026-10-03T00:00:00.000Z",
});
const manifestB = createEvidenceManifest({
  project,
  backend: identity,
  scenario,
  verify,
  inspect,
  execution: second,
  createdAt: "2026-10-03T00:00:01.000Z",
});
assert.equal(manifestA.result.pass, true);
assert.equal(manifestA.reproducibilityKey, manifestB.reproducibilityKey);

const badData = await backend.execute(project, {
  name: "bad-data-path-must-not-pass-silently",
  steps: [{ type: "data", path: "__rive_mcp_missing_property__", value: 42 }],
  capture: { screenshot: true },
});
assert.equal(badData.ok, false, "CLI input failure must remain failed evidence");
assert.ok(
  badData.diagnostics.some((d) => d.code === "RIVE_CLI_EXIT"),
  JSON.stringify(badData.diagnostics)
);

console.log(JSON.stringify({
  ok: true,
  cliVersion: identity.version,
  artifactHash: manifestA.subject.artifactHash,
  screenshotHash: first.artifacts[0]?.sha256,
  reproducibilityKey: manifestA.reproducibilityKey,
  inputFailureDiagnostic: badData.diagnostics,
}, null, 2));
