import assert from "node:assert/strict";
import { compareObservations } from "../../dist/differential/compare.js";
import { normalizeObservation } from "../../dist/differential/normalize.js";

const scenario = {
  id: "core-fixture",
  steps: [{ type: "advance", ms: 100 }],
  capture: { screenshot: true },
};

function input({
  backendId,
  screenshotHash = "sha256:same",
  screenshotPath = "/tmp/a.png",
  elapsedMs = 1,
  stepStatus = "applied",
  unsupported = [],
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
        artboards: [{ name: "Artboard", animationCount: 1, stateMachineCount: 1 }],
      },
      diagnostics: [],
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
  screenshotPath: "/tmp/run-1.png",
  elapsedMs: 4,
}));
const leftRepeat = normalizeObservation(input({
  backendId: "left",
  screenshotPath: "/another/path/run-2.png",
  elapsedMs: 999,
}));
assert.equal(left.deterministicKey, leftRepeat.deterministicKey, "paths/timing must not affect observation identity");

const right = normalizeObservation(input({ backendId: "right" }));
const equivalent = compareObservations(left, right);
assert.equal(equivalent.classification, "equivalent");

const visual = normalizeObservation(input({
  backendId: "right",
  screenshotHash: "sha256:different",
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
