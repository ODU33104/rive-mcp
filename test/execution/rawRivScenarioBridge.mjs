import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { NativeBackend } from "../../dist/backends/nativeBackend.js";
import { RiveCliBackend } from "../../dist/backends/riveCliBackend.js";
import { runDifferentialPair } from "../../dist/differential/lab.js";
import { revisionHash } from "../../dist/evidence/hash.js";

const fixture = JSON.parse(readFileSync("test/fixtures/execution-compat/rapid-pointer.json", "utf8"));
const scenario = JSON.parse(readFileSync("test/fixtures/execution-compat/rapid-pointer-scenario.json", "utf8"));
const outDir = resolve("test/tmp/raw-riv-execution-compat");
const assetDir = join(outDir, "assets");
mkdirSync(assetDir, { recursive: true });

const response = await fetch(fixture.acquisitionUrl, {
  redirect: "follow",
  headers: { "user-agent": "rive-mcp-raw-riv-bridge/1" },
});
assert.equal(response.ok, true, `fixture fetch failed: HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const digest = createHash("sha256").update(bytes).digest("hex");
assert.equal(digest, fixture.artifact.sha256);
assert.equal(bytes.length, fixture.artifact.bytes);
const rivPath = join(assetDir, "rapid_pointer_events.riv");
writeFileSync(rivPath, bytes);
const sourceHashBefore = createHash("sha256").update(readFileSync(rivPath)).digest("hex");

async function nativeRun(label) {
  const backend = new NativeBackend({ outputDir: join(outDir, "native", label) });
  try {
    const identity = await backend.identify();
    const verify = await backend.verify({ kind: "riv", path: rivPath });
    const inspect = await backend.inspect({ kind: "riv", path: rivPath });
    const execution = await backend.execute({ kind: "riv", path: rivPath }, scenario);
    return { identity, verify, inspect, execution };
  } finally {
    await backend.close();
  }
}

const first = await nativeRun("first");
const second = await nativeRun("second");

assert.equal(first.identity.capabilities.scenarioSteps.pointer, true);
assert.equal(first.identity.capabilities.scenarioSteps.advance, true);
assert.equal(first.identity.capabilities.scenarioSteps.data, false);
assert.equal(first.identity.capabilities.scenarioSteps.key, false);
assert.equal(first.identity.capabilities.dataSnapshot, true);
assert.equal(first.verify.ok, true);
assert.equal(first.inspect.ok, true);
assert.equal(first.execution.ok, true, JSON.stringify(first.execution.diagnostics));
assert.equal(second.execution.ok, true, JSON.stringify(second.execution.diagnostics));

const firstRaw = first.execution.raw;
const secondRaw = second.execution.raw;
assert.equal(firstRaw.initial.data.hasReached, false, "observed initial hasReached must match the upstream source-defined precondition");
assert.equal(first.execution.dataSnapshots[0]?.value?.hasReached, true, "observed final hasReached must match the upstream source-defined expected result");
assert.deepEqual(first.execution.dataSnapshots[0]?.value, second.execution.dataSnapshots[0]?.value);
assert.deepEqual(firstRaw.initial, secondRaw.initial);
assert.deepEqual(firstRaw.steps, secondRaw.steps);

const firstScreenshot = first.execution.artifacts.find((a) => a.kind === "screenshot");
const secondScreenshot = second.execution.artifacts.find((a) => a.kind === "screenshot");
assert.ok(firstScreenshot);
assert.ok(secondScreenshot);
assert.equal(firstScreenshot.sha256, secondScreenshot.sha256, "fresh runtime runs must produce the same screenshot hash");
assert.equal(first.execution.dataSnapshots[0]?.sha256, second.execution.dataSnapshots[0]?.sha256, "fresh runtime runs must produce the same data snapshot hash");

const sourceHashAfter = createHash("sha256").update(readFileSync(rivPath)).digest("hex");
assert.equal(sourceHashAfter, sourceHashBefore, "scenario execution must not mutate/reproject the source .riv");
assert.equal(sourceHashAfter, fixture.artifact.sha256);

const cli = new RiveCliBackend({
  outputDir: join(outDir, "cli"),
});
const cliIdentity = await cli.identify();
const cliExecution = await cli.execute({ kind: "riv", path: rivPath }, scenario);
assert.equal(cliExecution.ok, false);
assert.ok(cliExecution.unsupported.includes("project: riv"));
assert.ok(cliExecution.diagnostics.some((d) => d.code === "UNSUPPORTED_PROJECT_KIND"));

const differentialNative = new NativeBackend({ outputDir: join(outDir, "differential-native") });
let differential;
try {
  differential = await runDifferentialPair({
    artifactHash: `sha256:${digest}`,
    scenario,
    left: {
      backend: cli,
      project: { kind: "riv", path: rivPath },
      executionArtifactHash: `sha256:${digest}`,
    },
    right: {
      backend: differentialNative,
      project: { kind: "riv", path: rivPath },
      executionArtifactHash: `sha256:${digest}`,
    },
  });
} finally {
  await differentialNative.close();
}

assert.equal(differential.result.classification, "unsupported");
assert.notEqual(differential.result.classification, "divergent");
assert.equal(differential.left.artifactHash, differential.right.artifactHash);
assert.equal(differential.left.executionArtifactHash, differential.right.executionArtifactHash);
assert.equal(differential.left.scenarioHash, differential.right.scenarioHash);

const unsupportedDataScenario = {
  id: "raw-data-remains-unsupported",
  steps: [{ type: "data", path: "hasReached", value: false }],
  capture: { screenshot: false },
};
const unsupportedKeyScenario = {
  id: "raw-key-remains-unsupported",
  steps: [{ type: "key", key: "tab" }],
  capture: { screenshot: false },
};
const unsupportedPointerMoveScenario = {
  id: "raw-pointer-move-remains-unsupported",
  steps: [{ type: "pointer", action: "move", x: 250, y: 250 }],
  capture: { screenshot: false },
};
const unsupportedBackend = new NativeBackend({ outputDir: join(outDir, "unsupported") });
let unsupportedData;
let unsupportedKey;
let unsupportedPointerMove;
try {
  unsupportedData = await unsupportedBackend.execute({ kind: "riv", path: rivPath }, unsupportedDataScenario);
  unsupportedKey = await unsupportedBackend.execute({ kind: "riv", path: rivPath }, unsupportedKeyScenario);
  unsupportedPointerMove = await unsupportedBackend.execute({ kind: "riv", path: rivPath }, unsupportedPointerMoveScenario);
} finally {
  await unsupportedBackend.close();
}
assert.equal(unsupportedData.ok, false);
assert.equal(unsupportedKey.ok, false);
assert.equal(unsupportedPointerMove.ok, false);
assert.ok(unsupportedData.diagnostics.some((d) => d.code === "UNSUPPORTED_SCENARIO_CAPABILITY"));
assert.ok(unsupportedKey.diagnostics.some((d) => d.code === "UNSUPPORTED_SCENARIO_CAPABILITY"));
assert.ok(unsupportedPointerMove.diagnostics.some((d) => d.code === "UNSUPPORTED_SCENARIO_CAPABILITY"));

const result = {
  schemaVersion: "rive-mcp.raw-riv-scenario-bridge/v1",
  fixture: {
    id: fixture.fixtureId,
    artifactSha256: `sha256:${digest}`,
    bytes: bytes.length,
    sourceHashBefore: `sha256:${sourceHashBefore}`,
    sourceHashAfter: `sha256:${sourceHashAfter}`,
    exactSourceBytesUnchanged: sourceHashBefore === sourceHashAfter && sourceHashAfter === fixture.artifact.sha256,
  },
  scenario: {
    id: scenario.id,
    hash: revisionHash(scenario),
    steps: scenario.steps,
  },
  upstreamExpected: fixture.upstreamExpected,
  observed: {
    oracle: false,
    native: {
      backend: first.identity,
      initialData: firstRaw.initial.data,
      finalData: first.execution.dataSnapshots[0]?.value ?? null,
      stateTrace: firstRaw.steps.map((step) => ({
        index: step.index,
        type: step.type,
        statesChanged: step.statesChanged,
      })),
      screenshot: firstScreenshot
        ? { sha256: firstScreenshot.sha256, bytes: firstScreenshot.bytes }
        : null,
      dataSnapshotSha256: first.execution.dataSnapshots[0]?.sha256 ?? null,
      deterministicRepeat: {
        data: JSON.stringify(first.execution.dataSnapshots[0]?.value) === JSON.stringify(second.execution.dataSnapshots[0]?.value),
        stateTrace: JSON.stringify(firstRaw.steps) === JSON.stringify(secondRaw.steps),
        screenshot: firstScreenshot?.sha256 === secondScreenshot?.sha256,
      },
    },
    cli: {
      backend: cliIdentity,
      exactRawRivExecutionSupported: false,
      wrapperDiagnosticCodes: cliExecution.diagnostics.map((d) => d.code),
      unsupported: cliExecution.unsupported,
    },
    differential: {
      classification: differential.result.classification,
      firstDivergentCheckpoint: differential.result.firstDivergentCheckpoint ?? null,
      deterministicKey: differential.result.deterministicKey,
      interpretation: "unsupported is a capability boundary, not a runtime divergence",
    },
  },
  supportedActions: {
    nativeRawRiv: ["pointer:down", "pointer:up", "advance"],
    officialCliRawRiv: [],
  },
  unsupportedActions: {
    nativeRawRiv: ["data", "key", "pointer:move", "pointer:exit", "pointer:click"],
    officialCliRawRiv: ["pointer", "data", "key", "advance"],
  },
  exactSameBytes: {
    offeredToBothBackendAdapters: true,
    consumedAndExecutedByBoth: false,
    nativeConsumedPinnedBytes: true,
    cliRejectedBeforeExecution: true,
  },
  oracleStatus: {
    dataTransition: "source-defined upstream oracle available",
    stateTrace: "observed-only",
    visual: "observed-only",
    crossBackendDivergence: "not available because Official CLI does not execute raw .riv",
  },
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "bridge-result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({
  ok: true,
  artifactSha256: result.fixture.artifactSha256,
  native: {
    version: first.identity.version,
    runtimeVersion: first.identity.runtimeVersion,
    initialData: result.observed.native.initialData,
    finalData: result.observed.native.finalData,
    screenshotSha256: result.observed.native.screenshot?.sha256,
    deterministicRepeat: result.observed.native.deterministicRepeat,
  },
  cli: {
    version: cliIdentity.version,
    rawRivExecutionSupported: false,
  },
  differential: result.observed.differential,
}, null, 2));
