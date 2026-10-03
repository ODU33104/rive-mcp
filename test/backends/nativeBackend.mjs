import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeBackend } from "../../dist/backends/nativeBackend.js";
import { createEvidenceManifest } from "../../dist/evidence/manifest.js";
import { EvidenceStore } from "../../dist/evidence/store.js";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const workspace = mkdtempSync(join(tmpdir(), "rive-native-backend-"));
const fixture = join(root, "samples", "vehicles.riv");
const project = { kind: "riv", path: fixture };
const scenario = {
  name: "deterministic-idle-frame",
  target: { artboard: "Truck", animation: "idle" },
  viewport: { width: 320, height: 240 },
  steps: [{ type: "advance", ms: 250 }],
  capture: { screenshot: true },
};

const backend = new NativeBackend({ outputDir: join(workspace, "artifacts") });
try {
  const identity = await backend.identify();
  assert.equal(identity.id, "rive-mcp-native");
  assert.equal(identity.capabilities.scenarioSteps.advance, true);
  assert.equal(identity.capabilities.scenarioSteps.data, false);

  const verify = await backend.verify(project);
  assert.equal(verify.ok, true, JSON.stringify(verify.diagnostics));

  const inspect = await backend.inspect(project);
  assert.equal(inspect.ok, true, JSON.stringify(inspect.diagnostics));
  assert.ok((inspect.summary.artboardCount ?? 0) > 0);

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
    assertions: [{ name: "screenshot produced", pass: first.artifacts.length === 1 }],
    createdAt: "2026-10-03T00:00:00.000Z",
  });
  const manifestB = createEvidenceManifest({
    project,
    backend: identity,
    scenario,
    verify,
    inspect,
    execution: second,
    assertions: [{ name: "screenshot produced", pass: second.artifacts.length === 1 }],
    createdAt: "2026-10-03T00:00:01.000Z",
  });
  assert.equal(manifestA.result.pass, true);
  assert.equal(manifestA.scenario.hash, manifestB.scenario.hash);
  assert.equal(manifestA.subject.artifactHash, manifestB.subject.artifactHash);
  assert.equal(manifestA.reproducibilityKey, manifestB.reproducibilityKey);

  const store = new EvidenceStore(join(workspace, "evidence"));
  const stored = store.put(manifestA);
  assert.equal(stored.manifestHash, manifestA.manifestHash);

  const unsupported = await backend.execute(project, {
    name: "unsupported-data-is-explicit",
    steps: [{ type: "data", path: "score", value: 1 }],
  });
  assert.equal(unsupported.ok, false);
  assert.match(unsupported.diagnostics[0]?.code ?? "", /UNSUPPORTED/);

  console.log(JSON.stringify({
    ok: true,
    backend: identity,
    fixture,
    artifactHash: manifestA.subject.artifactHash,
    screenshotHash: first.artifacts[0]?.sha256,
    reproducibilityKey: manifestA.reproducibilityKey,
    unsupportedDiagnostic: unsupported.diagnostics[0],
  }, null, 2));
} finally {
  await backend.close();
}
