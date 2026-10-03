import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RawRivScenarioBridge } from "../../dist/executionCompatibility/rawRivScenario.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const assetPath = join(
  root,
  "test/tmp/real-world-corpus/assets/official-flutter-rapid-pointer.riv"
);
const scenarioPath = join(
  root,
  "test/fixtures/real-world/scenarios/rapid-pointer-down-up.json"
);
const outDir = join(root, "test/tmp/raw-riv-execution");
mkdirSync(outDir, { recursive: true });

const bytes = readFileSync(assetPath);
const scenario = JSON.parse(readFileSync(scenarioPath, "utf8"));
const artifactHash = createHash("sha256").update(bytes).digest("hex");

assert.equal(
  artifactHash,
  "e0584ba73df9bf8a7ac1a4ff1c3e381212967b10025d936e49ddab3d30a13079"
);
assert.equal(bytes.length, 528);

const upstreamOracle = {
  source: "rive-app/rive-flutter@test/rapid_pointer_events_test.dart",
  pinnedCommit: "58fcac2171f655757907356a4bead2ebd008e4f7",
  assertion:
    "pointer down then pointer up at (250,250), followed by 16ms advance, drives hasReached from false to true",
  expected: {
    initialHasReached: false,
    finalHasReached: true,
  },
};

const runs = [];
for (let i = 0; i < 3; i++) {
  const result = await new RawRivScenarioBridge().execute(bytes, scenario);
  assert.equal(result.status, "executed", result.error ?? result.unsupported.join("; "));
  assert.equal(result.artifact.sha256, artifactHash);
  assert.equal(result.artifact.unchangedAfterExecution, true);
  assert.deepEqual(result.capabilities.supportedActions, [
    "pointer:down",
    "pointer:up",
    "advance",
  ]);
  assert.deepEqual(result.capabilities.unsupportedActions, [
    "data",
    "key",
    "pointer:move",
    "pointer:exit",
    "pointer:click",
  ]);
  assert.deepEqual(result.unsupported, []);

  assert.equal(
    result.observations?.initialData.values.hasReached,
    false,
    "observed initial hasReached must be false"
  );
  assert.equal(
    result.observations?.finalData?.values.hasReached,
    true,
    "observed final hasReached must be true"
  );
  assert.ok(result.observations?.screenshot, "final visual observation missing");

  runs.push(result);
}

const deterministicProjection = (result) => ({
  artifact: result.artifact,
  backend: result.backend,
  capabilities: result.capabilities,
  unsupported: result.unsupported,
  scenarioHash: result.scenarioHash,
  initialStatesChanged: result.observations.initialStatesChanged,
  steps: result.observations.steps,
  initialData: result.observations.initialData,
  finalData: result.observations.finalData,
  screenshot: {
    width: result.observations.screenshot.width,
    height: result.observations.screenshot.height,
    sha256: result.observations.screenshot.sha256,
    bytes: result.observations.screenshot.bytes,
  },
});

assert.deepEqual(
  deterministicProjection(runs[0]),
  deterministicProjection(runs[1]),
  "fresh runtime run 2 diverged"
);
assert.deepEqual(
  deterministicProjection(runs[0]),
  deterministicProjection(runs[2]),
  "fresh runtime run 3 diverged"
);

const unsupportedScenario = {
  ...scenario,
  steps: [{ type: "key", key: "enter" }],
};
const unsupportedResult = await new RawRivScenarioBridge().execute(
  bytes,
  unsupportedScenario
);
assert.equal(unsupportedResult.status, "unsupported");
assert.match(unsupportedResult.unsupported[0], /key is not implemented/);
assert.equal(unsupportedResult.error, undefined);

const unsupportedDataResult = await new RawRivScenarioBridge().execute(bytes, {
  ...scenario,
  steps: [{ type: "data", path: "hasReached", value: true }],
});
assert.equal(unsupportedDataResult.status, "unsupported");
assert.match(unsupportedDataResult.unsupported[0], /data is not implemented/);
assert.equal(unsupportedDataResult.error, undefined);

const unsupportedMoveResult = await new RawRivScenarioBridge().execute(bytes, {
  ...scenario,
  steps: [{ type: "pointer", action: "move", x: 250, y: 250 }],
});
assert.equal(unsupportedMoveResult.status, "unsupported");
assert.match(unsupportedMoveResult.unsupported[0], /proven pointer down\/up subset/);
assert.equal(unsupportedMoveResult.error, undefined);

const cliCapabilityPath = join(outDir, "cli-capability.json");
const cliCapability = JSON.parse(readFileSync(cliCapabilityPath, "utf8"));
assert.equal(
  cliCapability.conclusion,
  "raw-riv-not-accepted-by-probed-cli-project-and-inspect-paths"
);
assert.equal(cliCapability.artifact.sha256, artifactHash);
assert.equal(cliCapability.exactSameBytesAttempted, true);
assert.equal(cliCapability.conversionsPerformed, false);

const observed = {
  sourceDefinedOracle: upstreamOracle,
  observedBaseline: {
    oracle: false,
    artifactSha256: artifactHash,
    artifactBytes: bytes.length,
    runtimeBridge: deterministicProjection(runs[0]),
    sourceDefinedOracleMatched:
      runs[0].observations.initialData.values.hasReached === false &&
      runs[0].observations.finalData.values.hasReached === true,
  },
  backendsTested: [
    {
      backend: "Official Rive CLI",
      version: cliCapability.cliVersion,
      exactSameBytesPresented: true,
      executedScenario: false,
      result: "unsupported-project-kind",
      supportedActionsOnRawRiv: [],
      unsupportedActionsOnRawRiv: ["data", "pointer", "key", "advance"],
      stateObservation: false,
      dataObservation: false,
      visualObservation: false,
    },
    {
      backend: runs[0].backend.name,
      version: runs[0].backend.version,
      runtimeVersion: runs[0].backend.runtime.version,
      exactSameBytesPresented: true,
      executedScenario: true,
      result: "executed",
      supportedActionsOnRawRiv: runs[0].capabilities.supportedActions,
      unsupportedActionsOnRawRiv: runs[0].capabilities.unsupportedActions,
      stateObservation: runs[0].capabilities.stateObservation,
      dataObservation: runs[0].capabilities.dataObservation,
      visualObservation: runs[0].capabilities.visualObservation,
    },
  ],
  exactSameBytes: {
    presentedToBothPaths: true,
    executedByBothPaths: false,
    transformedOrRecompiled: false,
  },
  determinism: {
    attempts: runs.length,
    identical: true,
  },
  divergence: {
    classification: "not-comparable",
    reason:
      "Official Rive CLI rejects standalone built .riv before Scenario interactions execute.",
  },
  oracleStatus: {
    dataBehavior: "source-defined-upstream-oracle",
    visual: "observation-only-no-upstream-pixel-oracle",
    stateChanges: "observation-only",
  },
};

writeFileSync(
  join(outDir, "runtime-bridge.json"),
  JSON.stringify(observed, null, 2) + "\n"
);

const png = Buffer.from(runs[0].observations.screenshot.base64, "base64");
writeFileSync(join(outDir, "runtime-final.png"), png);

console.log(JSON.stringify({
  ok: true,
  artifactSha256: artifactHash,
  backendVersion: runs[0].backend.version,
  runtimeVersion: runs[0].backend.runtime.version,
  scenarioHash: runs[0].scenarioHash,
  initialData: runs[0].observations.initialData,
  finalData: runs[0].observations.finalData,
  stateObservations: {
    initial: runs[0].observations.initialStatesChanged,
    steps: runs[0].observations.steps.map((step) => ({
      index: step.index,
      statesChanged: step.statesChanged,
      deliveryAdvanceSeconds: step.deliveryAdvanceSeconds,
    })),
  },
  screenshot: {
    width: runs[0].observations.screenshot.width,
    height: runs[0].observations.screenshot.height,
    sha256: runs[0].observations.screenshot.sha256,
    bytes: runs[0].observations.screenshot.bytes,
  },
  deterministic: observed.determinism,
  sourceDefinedOracleMatched: observed.observedBaseline.sourceDefinedOracleMatched,
  cliRawRiv: cliCapability.conclusion,
  divergence: observed.divergence,
}, null, 2));
