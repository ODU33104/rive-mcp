import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareObservations } from "../../dist/differential/compare.js";
import { normalizeObservation } from "../../dist/differential/normalize.js";
import { encodePng } from "../../dist/critique.js";

const workspace = mkdtempSync(join(tmpdir(), "rive-differential-core-"));
const samePixels = new Uint8Array([
  255, 0, 0, 255,
  0, 255, 0, 255,
  0, 0, 255, 255,
  255, 255, 255, 255,
]);
const differentPixels = samePixels.slice();
differentPixels[0] = 254;
const screenshotA = join(workspace, "same-a.png");
const screenshotB = join(workspace, "same-b.png");
const screenshotDifferent = join(workspace, "different.png");
const encodedSame = Buffer.from(encodePng(samePixels, 2, 2));
writeFileSync(screenshotA, encodedSame);
writeFileSync(screenshotB, Buffer.concat([encodedSame, Buffer.from("evidence-only-trailer")]));
writeFileSync(screenshotDifferent, Buffer.from(encodePng(differentPixels, 2, 2)));

const scenario = {
  id: "core-fixture",
  steps: [{ type: "advance", ms: 100 }],
  capture: { screenshot: true },
};

function input({
  backendId,
  screenshotHash = "sha256:same",
  screenshotPath = screenshotA,
  elapsedMs = 1,
  stepStatus = "applied",
  unsupported = [],
  inspectCounts = { animationCount: 1, stateMachineCount: 1 },
  inspectDiagnostics = [],
}) {
  const backend = {
    id: backendId,
    name: backendId,
    version: "1.0.0",
    runtimeVersion: "2.0.0",
    capabilities: {
      projectKinds: ["riv"],
      scenarioSteps: { data: false, pointer: false, key: false, advance: true },
      verify: true,
      inspect: true,
      screenshot: true,
      dataSnapshot: false,
    },
  };
  return {
    artifactHash: "sha256:artifact",
    executionArtifactHash: "sha256:compiled",
    scenario,
    verify: { ok: true, diagnostics: [], elapsedMs },
    inspect: {
      ok: true,
      summary: {
        artboardCount: 1,
        artboards: [{ name: "Artboard", ...inspectCounts }],
      },
      diagnostics: inspectDiagnostics,
      elapsedMs,
    },
    execution: {
      ok: unsupported.length === 0,
      backend,
      eventSequence: [{
        index: 0,
        step: scenario.steps[0],
        status: stepStatus,
      }],
      unsupported,
      diagnostics: unsupported.map((message) => ({
        severity: "error",
        code: "UNSUPPORTED_SCENARIO_CAPABILITY",
        message,
      })),
      artifacts: screenshotHash ? [{
        kind: "screenshot",
        path: screenshotPath,
        sha256: screenshotHash,
        bytes: 123,
        mediaType: "image/png",
      }] : [],
      dataSnapshots: [],
      performance: { elapsedMs },
    },
  };
}

const left = normalizeObservation(input({
  backendId: "left",
  screenshotPath: screenshotA,
  screenshotHash: "sha256:encoded-a",
  elapsedMs: 4,
}));
const leftRepeat = normalizeObservation(input({
  backendId: "left",
  screenshotPath: screenshotB,
  screenshotHash: "sha256:encoded-b",
  elapsedMs: 999,
}));
assert.equal(left.deterministicKey, leftRepeat.deterministicKey, "paths/timing must not affect observation identity");

const right = normalizeObservation(input({
  backendId: "right",
  screenshotPath: screenshotB,
  screenshotHash: "sha256:encoded-b",
}));
const equivalent = compareObservations(left, right);
assert.equal(equivalent.classification, "equivalent");
assert.equal(
  left.checkpoints.find((item) => item.id === "capture:screenshot")?.valueHash,
  right.checkpoints.find((item) => item.id === "capture:screenshot")?.valueHash,
  "PNG byte differences must collapse to the same decoded pixel identity"
);

const inspectShapeMismatch = normalizeObservation(input({
  backendId: "right",
  inspectCounts: { animationCount: undefined, stateMachineCount: undefined },
  inspectDiagnostics: [{
    severity: "warning",
    code: "backend-specific-warning",
    message: "warning only exposed by one backend",
  }],
}));
const inspectComparable = compareObservations(left, inspectShapeMismatch);
assert.equal(
  inspectComparable.classification,
  "equivalent",
  "backend-specific inspect detail must not mask runtime behavior"
);

const visual = normalizeObservation(input({
  backendId: "right",
  screenshotHash: "sha256:different",
  screenshotPath: screenshotDifferent,
}));
const visualDiff = compareObservations(left, visual);
assert.equal(visualDiff.classification, "divergent");
assert.equal(visualDiff.firstDivergentCheckpoint?.checkpointId, "capture:screenshot");

const unsupported = normalizeObservation(input({
  backendId: "right",
  screenshotHash: "",
  stepStatus: "unsupported",
  unsupported: ["advance is unavailable"],
}));
const unsupportedDiff = compareObservations(left, unsupported);
assert.equal(unsupportedDiff.classification, "unsupported");
assert.equal(unsupportedDiff.firstDivergentCheckpoint?.checkpointId, "step:0");

const rerun = compareObservations(left, right);
assert.equal(equivalent.deterministicKey, rerun.deterministicKey);

console.log(JSON.stringify({
  ok: true,
  equivalent: equivalent.classification,
  visual: {
    classification: visualDiff.classification,
    first: visualDiff.firstDivergentCheckpoint,
  },
  unsupported: {
    classification: unsupportedDiff.classification,
    first: unsupportedDiff.firstDivergentCheckpoint,
  },
  deterministicKey: equivalent.deterministicKey,
}, null, 2));
