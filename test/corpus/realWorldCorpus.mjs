import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RiveHost } from "../../dist/riveHost.js";
import { PAGE_SCRIPT } from "../../dist/pageScript.js";
import { readRiv } from "../../dist/rivBinary.js";
import { decodeDataBinding } from "../../dist/dataBinding.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = join(root, "test/fixtures/real-world/manifest.json");
const baselinePath = join(root, "test/fixtures/real-world/observed-baseline.json");
const assetDir = resolve(process.env.RIVE_REAL_WORLD_CORPUS || join(root, "test/tmp/real-world-corpus/assets"));
const outPath = join(root, "test/tmp/real-world-corpus/validation.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const observedBaseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

assert.equal(manifest.schemaVersion, "rive-mcp.real-world-corpus/v1");
assert.ok(manifest.fixtures.length >= 3 && manifest.fixtures.length <= 6, "corpus must stay deliberately small");

const ids = new Set();
const allowedSteps = new Set(["data", "pointer", "key", "advance"]);
const requiredFixtureFields = [
  "id",
  "name",
  "origin",
  "source",
  "license",
  "artifact",
  "featureTags",
  "expectedSupportedActions",
  "knownUnsupportedFeatures",
  "scenarioRefs",
  "expectedBehaviorStatus",
  "expectedAssertions",
  "observedBaseline",
];

for (const fixture of manifest.fixtures) {
  for (const field of requiredFixtureFields) assert.ok(field in fixture, `${fixture.id ?? "<unknown>"} missing ${field}`);
  assert.ok(!ids.has(fixture.id), `duplicate fixture id: ${fixture.id}`);
  ids.add(fixture.id);
  assert.match(fixture.artifact.sha256, /^[0-9a-f]{64}$/);
  assert.ok(fixture.source.retrievalRef?.length >= 40, `${fixture.id}: retrieval ref must be immutable`);
  assert.ok(fixture.source.url.includes(fixture.source.retrievalRef), `${fixture.id}: source URL must contain retrieval ref`);
  assert.ok(fixture.license.spdx, `${fixture.id}: license missing`);
  assert.ok(fixture.license.evidenceUrl.includes(fixture.source.retrievalRef), `${fixture.id}: license evidence must be pinned`);
  assert.ok(existsSync(join(root, fixture.license.evidencePath)), `${fixture.id}: vendored license evidence missing`);
  assert.ok(Array.isArray(fixture.expectedAssertions));
  assert.ok(fixture.observedBaseline.oracle === false, `${fixture.id}: observed baseline must never be an oracle`);

  for (const scenarioRef of fixture.scenarioRefs) {
    const scenarioPath = join(root, scenarioRef);
    assert.ok(existsSync(scenarioPath), `${fixture.id}: missing scenario ${scenarioRef}`);
    const scenario = JSON.parse(readFileSync(scenarioPath, "utf8"));
    assert.ok(Array.isArray(scenario.steps), `${fixture.id}: scenario steps missing`);
    for (const step of scenario.steps) {
      assert.ok(allowedSteps.has(step.type), `${fixture.id}: unsupported corpus step type ${step.type}`);
    }
  }

  if (fixture.featureTags.includes("pointer-interaction")) {
    const scenarios = fixture.scenarioRefs.map((p) => JSON.parse(readFileSync(join(root, p), "utf8")));
    assert.ok(scenarios.some((s) => s.steps.some((step) => step.type === "pointer")), `${fixture.id}: pointer fixture needs pointer scenario`);
  }
  if (fixture.featureTags.includes("keyboard-interaction")) {
    const scenarios = fixture.scenarioRefs.map((p) => JSON.parse(readFileSync(join(root, p), "utf8")));
    assert.ok(scenarios.some((s) => s.steps.some((step) => step.type === "key")), `${fixture.id}: keyboard fixture needs key scenario`);
  }
  if (fixture.featureTags.includes("data-binding")) {
    const scenarios = fixture.scenarioRefs.map((p) => JSON.parse(readFileSync(join(root, p), "utf8")));
    assert.ok(scenarios.some((s) => s.steps.some((step) => step.type === "data")), `${fixture.id}: data-binding fixture needs data scenario`);
  }
}

function objectTypeCounts(dump) {
  const counts = {};
  for (const object of dump.objects) counts[object.typeName] = (counts[object.typeName] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function summarizeDataBinding(db) {
  if (!db) return null;
  return {
    viewModels: db.viewModels.map((vm) => ({
      name: vm.name,
      properties: vm.properties.map((p) => ({ name: p.name, kind: p.kind })),
    })),
    instances: db.viewModelInstances.map((instance) => ({
      name: instance.name ?? null,
      viewModelIndex: instance.viewModelIndex,
    })),
    dataBindCount: db.dataBinds.length,
    converterCount: db.converters.length,
    enumCount: db.enums.length,
  };
}

const runtimePackage = JSON.parse(
  readFileSync(join(root, "node_modules/@rive-app/canvas-advanced/package.json"), "utf8")
);
assert.equal(observedBaseline.schemaVersion, "rive-mcp.real-world-corpus-observed-baseline/v1");
assert.equal(observedBaseline.oracle, false, "observed baseline must never be promoted to a correctness oracle");
assert.equal(
  runtimePackage.version,
  observedBaseline.riveRuntime.version,
  "runtime version changed: refresh observed-only baseline deliberately after reviewing drift"
);

const host = new RiveHost(PAGE_SCRIPT);
const observations = [];
const observedProjection = [];
try {
  for (const fixture of manifest.fixtures) {
    const path = join(assetDir, `${fixture.id}.riv`);
    assert.ok(existsSync(path), `fixture not acquired: ${path}`);
    const bytes = readFileSync(path);
    assert.equal(sha256(bytes), fixture.artifact.sha256, `${fixture.id}: artifact hash drift`);
    assert.equal(bytes.length, fixture.artifact.bytes, `${fixture.id}: artifact byte-size drift`);

    const inspectA = await host.inspect(bytes);
    const inspectB = await host.inspect(bytes);
    assert.deepEqual(inspectA, inspectB, `${fixture.id}: runtime inspect is not deterministic`);

    const dumpA = readRiv(bytes, { tolerant: true });
    const dumpB = readRiv(bytes, { tolerant: true });
    const parseA = {
      error: dumpA.error ?? null,
      objectTypeCounts: objectTypeCounts(dumpA),
      dataBinding: summarizeDataBinding(decodeDataBinding(dumpA)),
    };
    const parseB = {
      error: dumpB.error ?? null,
      objectTypeCounts: objectTypeCounts(dumpB),
      dataBinding: summarizeDataBinding(decodeDataBinding(dumpB)),
    };
    assert.deepEqual(parseA, parseB, `${fixture.id}: static parse is not deterministic`);

    observations.push({
      id: fixture.id,
      artifact: {
        sha256: fixture.artifact.sha256,
        bytes: bytes.length,
      },
      runtimeInspect: inspectA,
      staticParse: parseA,
      deterministic: {
        artifact: true,
        runtimeInspect: true,
        staticParse: true,
      },
      expectedAssertionsWereUsedAsOracle: false,
    });

    const names = (items) => [...new Set(items)].sort((a, b) => a.localeCompare(b));
    const counts = parseA.objectTypeCounts;
    observedProjection.push({
      id: fixture.id,
      artifactSha256: fixture.artifact.sha256,
      artifactBytes: bytes.length,
      artboardCount: inspectA.artboardCount,
      artboardNames: names(inspectA.artboards.map((artboard) => artboard.name)),
      animationNames: names(inspectA.artboards.flatMap((artboard) => artboard.animations.map((animation) => animation.name))),
      stateMachineNames: names(inspectA.artboards.flatMap((artboard) => artboard.stateMachines.map((machine) => machine.name))),
      keyObjectTypeCounts: {
        Artboard: counts.Artboard ?? 0,
        LinearAnimation: counts.LinearAnimation ?? 0,
        StateMachine: counts.StateMachine ?? 0,
        StateTransition: counts.StateTransition ?? 0,
        Text: counts.Text ?? 0,
        TextValueRun: counts.TextValueRun ?? 0,
        ViewModel: counts.ViewModel ?? 0,
        DataBindContext: counts.DataBindContext ?? 0,
        ListenerViewModelChange: counts.ListenerViewModelChange ?? 0,
      },
      dataBinding: parseA.dataBinding
        ? {
            viewModels: parseA.dataBinding.viewModels,
            dataBindCount: parseA.dataBinding.dataBindCount,
          }
        : null,
    });
  }
} finally {
  await host.close();
}

assert.deepEqual(
  observedProjection,
  observedBaseline.fixtures,
  "observed-only baseline drifted; inspect the change and refresh the baseline only if the new observation is intentional"
);

mkdirSync(dirname(outPath), { recursive: true });
const result = {
  schemaVersion: "rive-mcp.real-world-corpus-validation/v1",
  corpusSchemaVersion: manifest.schemaVersion,
  riveRuntime: {
    package: "@rive-app/canvas-advanced",
    version: runtimePackage.version,
  },
  fixtureCount: observations.length,
  observedBaseline: {
    path: "test/fixtures/real-world/observed-baseline.json",
    oracle: false,
    matched: true,
  },
  observations,
};
writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ ok: true, fixtureCount: observations.length, outPath, runtimeVersion: runtimePackage.version }, null, 2));
