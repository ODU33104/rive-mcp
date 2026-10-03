import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { NativeBackend } from "../../dist/backends/nativeBackend.js";
import { normalizeViewModelExecutionObservation } from "../../dist/causal/viewModelObservation.js";
import { revisionHash } from "../../dist/evidence/hash.js";
import {
  explainPotentialWriters,
  staticProvenanceFromRiv,
} from "../../dist/staticProvenance.js";

const root = resolve(".");
const manifest = JSON.parse(
  readFileSync(join(root, "test/fixtures/real-world/manifest.json"), "utf8")
);
const fixture = manifest.fixtures.find(
  (item) => item.id === "official-flutter-rapid-pointer"
);
assert.ok(fixture, "qualified rapid-pointer fixture is missing");

const scenarioRef = fixture.scenarioRefs[0];
assert.equal(
  scenarioRef,
  "test/fixtures/real-world/scenarios/rapid-pointer-down-up.json"
);
const scenario = JSON.parse(readFileSync(join(root, scenarioRef), "utf8"));
assert.equal(scenario.id, "rapid-pointer-down-up");

const artifactPath = join(
  root,
  "test/tmp/real-world-corpus/assets/official-flutter-rapid-pointer.riv"
);
const bytes = readFileSync(artifactPath);
const artifactSha256 = createHash("sha256").update(bytes).digest("hex");
assert.equal(
  artifactSha256,
  "e0584ba73df9bf8a7ac1a4ff1c3e381212967b10025d936e49ddab3d30a13079"
);
assert.equal(bytes.length, 528);
assert.equal(artifactSha256, fixture.artifact.sha256);
assert.equal(bytes.length, fixture.artifact.bytes);

const scenarioHash = revisionHash(scenario);
assert.equal(
  scenarioHash,
  "sha256:020b7ca8ea60ed285d503271263671b8e96100f291e4a396d68ffe0655d35e56"
);

const expected = {
  kind: "source-defined",
  propertyPath: "hasReached",
  initial: false,
  final: true,
  evidence: fixture.expectedAssertions,
};

async function executeFresh(label) {
  const backend = new NativeBackend({
    outputDir: join(root, "test/tmp/real-causal-viewmodel", label),
  });
  try {
    const identity = await backend.identify();
    const execution = await backend.execute(
      { kind: "riv", path: artifactPath },
      scenario
    );
    assert.equal(execution.ok, true, JSON.stringify(execution.diagnostics));
    const observation = normalizeViewModelExecutionObservation(execution);
    assert.equal(
      observation.status,
      "observed",
      observation.unavailableReason ?? "ViewModel observation unavailable"
    );
    return { identity, execution, observation };
  } finally {
    await backend.close();
  }
}

const first = await executeFresh("first");
const second = await executeFresh("second");
assert.deepEqual(
  first.observation,
  second.observation,
  "fresh raw-runtime ViewModel observations must be deterministic"
);

const initial = first.observation.checkpoints.find(
  (checkpoint) => checkpoint.phase === "initial"
);
const final = [...first.observation.checkpoints]
  .reverse()
  .find((checkpoint) => checkpoint.phase === "final");
assert.ok(initial);
assert.ok(final);
assert.equal(typeof initial.values.hasReached, "boolean");
assert.equal(typeof final.values.hasReached, "boolean");

const observed = {
  kind: "runtime-observed",
  source: first.observation.source,
  propertyPath: "hasReached",
  initial: initial.values.hasReached,
  final: final.values.hasReached,
  checkpoints: first.observation.checkpoints.map((checkpoint) => ({
    id: checkpoint.id,
    phase: checkpoint.phase,
    stepIndex: checkpoint.stepIndex ?? null,
    stepType: checkpoint.stepType ?? null,
    value: checkpoint.values.hasReached,
  })),
  changes: first.observation.changes.filter(
    (change) => change.path === "hasReached"
  ),
};

assert.equal(observed.initial, false);
assert.equal(observed.final, true);
assert.ok(
  observed.changes.some(
    (change) => change.before === false && change.after === true
  ),
  "runtime evidence must contain the observed hasReached false -> true change"
);

const firstScreenshot = first.execution.artifacts.find(
  (artifact) => artifact.kind === "screenshot"
);
const secondScreenshot = second.execution.artifacts.find(
  (artifact) => artifact.kind === "screenshot"
);
const firstData = first.execution.dataSnapshots.at(-1);
const secondData = second.execution.dataSnapshots.at(-1);
assert.ok(firstScreenshot);
assert.ok(secondScreenshot);
assert.ok(firstData);
assert.ok(secondData);
assert.equal(firstScreenshot.sha256, secondScreenshot.sha256);
assert.equal(firstData.sha256, secondData.sha256);

const graph = staticProvenanceFromRiv(bytes);
const bindingSources = graph.nodes
  .filter((node) => node.kind === "bindingSource")
  .map((node) => ({
    id: node.id,
    label: node.label,
    sourcePathIds: node.metadata.sourcePathIds ?? null,
    normalized: node.metadata.normalized === true,
  }))
  .sort((a, b) => a.id.localeCompare(b.id));

const semanticallyResolvedBindingSources = bindingSources.filter(
  (source) => source.normalized
);

const scenePropertyWriterPaths = graph.nodes
  .filter((node) => node.kind === "property")
  .flatMap((node) =>
    explainPotentialWriters(graph, node.id).map((path) => ({
      propertyNodeId: node.id,
      propertyLabel: node.label,
      nodeIds: path.nodeIds,
      edgeKinds: path.edgeKinds,
    }))
  )
  .sort(
    (a, b) =>
      a.propertyNodeId.localeCompare(b.propertyNodeId) ||
      a.nodeIds.join("/").localeCompare(b.nodeIds.join("/"))
  );

assert.equal(
  semanticallyResolvedBindingSources.length,
  0,
  "do not silently promote opaque Data Binding source IDs into semantic ViewModel paths"
);
assert.ok(
  graph.warnings.some((warning) => warning.includes("opaque numeric IDs")),
  "static provenance must disclose opaque ViewModel source-path semantics"
);

const connection = {
  classification: "unresolved",
  observedPropertyPath: "hasReached",
  staticPossiblePaths: [],
  observedSupportedPaths: [],
  competingPaths: [],
  unresolved: {
    reason:
      "runtime observed default-bound ViewModel property hasReached, but Static Provenance exposes Data Binding sourcePathIds only as opaque numeric IDs and has no semantically normalized ViewModel path that can be joined without guessing",
    opaqueBindingSources: bindingSources,
  },
  otherStaticScenePropertyWriterPaths: scenePropertyWriterPaths,
};

const result = {
  schemaVersion: "rive-mcp.real-viewmodel-causal-observation/v1",
  oracle: false,
  fixture: {
    id: fixture.id,
    artifactSha256: artifactSha256,
    bytes: bytes.length,
    scenarioId: scenario.id,
    scenarioHash,
  },
  backend: {
    id: first.identity.id,
    version: first.identity.version,
    runtimeVersion: first.identity.runtimeVersion ?? null,
  },
  expected,
  observed,
  connection,
  opaqueSemantics: graph.warnings.filter(
    (warning) =>
      warning.includes("opaque numeric IDs") ||
      warning.includes("script/listener")
  ),
  deterministic: {
    observation: true,
    screenshot:
      firstScreenshot.sha256 === secondScreenshot.sha256,
    dataSnapshot: firstData.sha256 === secondData.sha256,
  },
  evidence: {
    screenshotSha256: firstScreenshot.sha256,
    dataSnapshotSha256: firstData.sha256,
  },
};

assert.equal(
  result.connection.classification,
  "unresolved",
  "a real ViewModel change is not an exclusive causal attribution"
);
assert.equal(result.connection.observedSupportedPaths.length, 0);
assert.equal(result.connection.competingPaths.length, 0);

const outDir = join(root, "test/tmp/real-causal-viewmodel");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "rapid-pointer-viewmodel.json"),
  JSON.stringify(result, null, 2) + "\n"
);

console.log(JSON.stringify({
  ok: true,
  artifactSha256,
  scenarioHash,
  backend: result.backend,
  expected: result.expected,
  observed: result.observed,
  static: {
    propertyNodes: graph.nodes.filter((node) => node.kind === "property").length,
    bindingSources: bindingSources.length,
    semanticallyResolvedBindingSources:
      semanticallyResolvedBindingSources.length,
    scenePropertyWriterPaths: scenePropertyWriterPaths.length,
    warnings: graph.warnings,
  },
  connection: result.connection,
  deterministic: result.deterministic,
  evidence: result.evidence,
}, null, 2));
