import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RiveHost } from "../../dist/riveHost.js";
import { PAGE_SCRIPT } from "../../dist/pageScript.js";
import {
  staticProvenanceFromRiv,
  explainPotentialWriters,
} from "../../dist/staticProvenance.js";
import {
  observedTraceFromPlayResult,
  correlateObservedTrace,
} from "../../dist/observedTrace.js";
import { analyzeCausalAmbiguity } from "../../dist/causalAmbiguity.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(
  readFileSync(join(root, "test/fixtures/real-world/manifest.json"), "utf8")
);
const assetDir = join(root, "test/tmp/real-world-corpus/assets");
const outDir = join(root, "test/tmp/real-causal-calibration");
mkdirSync(outDir, { recursive: true });

const selectedIds = [
  "official-flutter-controller-basic",
  "official-flutter-rapid-pointer",
  "official-flutter-rewards-data-binding",
];
const supportedWatchProperties = new Set([
  "x", "y", "rotation", "scaleX", "scaleY", "text",
]);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const clone = (value) => JSON.parse(JSON.stringify(value));

function nodeMap(graph) {
  return new Map(graph.nodes.map((node) => [node.id, node]));
}

function writerDetails(graph, propertyNode) {
  const nodes = nodeMap(graph);
  return explainPotentialWriters(graph, propertyNode.id).map((path) => ({
    nodeIds: path.nodeIds,
    edgeKinds: path.edgeKinds,
    labels: path.nodeIds.map((id) => nodes.get(id)?.label ?? id),
    kinds: path.nodeIds.map((id) => nodes.get(id)?.kind ?? "unknown"),
  }));
}

function staticSummary(graph) {
  const properties = graph.nodes
    .filter((node) => node.kind === "property")
    .map((node) => ({
      id: node.id,
      artboard: node.artboard ?? null,
      targetName: node.metadata.targetName ?? null,
      targetType: node.metadata.targetType ?? null,
      propertyName: node.metadata.propertyName ?? null,
      propertyKey: node.metadata.propertyKey ?? null,
      writers: writerDetails(graph, node),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    nodeCounts: Object.fromEntries(
      [...new Set(graph.nodes.map((node) => node.kind))]
        .sort()
        .map((kind) => [kind, graph.nodes.filter((node) => node.kind === kind).length])
    ),
    edgeCounts: Object.fromEntries(
      [...new Set(graph.edges.map((edge) => edge.kind))]
        .sort()
        .map((kind) => [kind, graph.edges.filter((edge) => edge.kind === kind).length])
    ),
    propertyCount: properties.length,
    modeledPropertyCount: properties.filter((p) => p.writers.length > 0).length,
    multiWriterPropertyCount: properties.filter((p) => p.writers.length > 1).length,
    warnings: [...graph.warnings],
    properties,
  };
}

function watchCandidates(staticInfo, artboard) {
  const seen = new Set();
  const out = [];
  for (const property of staticInfo.properties) {
    if (property.artboard !== artboard) continue;
    if (typeof property.targetName !== "string") continue;
    if (!supportedWatchProperties.has(property.propertyName)) continue;
    const key = property.targetName + "\u0000" + property.propertyName;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ target: property.targetName, property: property.propertyName });
  }
  return out.sort(
    (a, b) => a.target.localeCompare(b.target) || a.property.localeCompare(b.property)
  );
}

function dynamicMetrics(trace, graph, correlation, ambiguity, play) {
  const changes = trace.events.filter((event) => event.type === "propertyValueChanged");
  const byObservation = new Map(
    ambiguity.properties.map((property) => [property.observationId, property])
  );
  return {
    observedPropertyChanges: changes.map((change) => {
      const analysis = byObservation.get(change.id);
      return {
        observationId: change.id,
        step: change.step,
        target: change.target,
        property: change.property,
        before: change.before,
        after: change.after,
        staticPossibleWriterCount: analysis?.writerPaths.length ?? 0,
        observedSupportedWriterCount: analysis?.supportedWriterPaths.length ?? 0,
        competingModeledWriterCount: analysis?.competingWriterPaths.length ?? 0,
        status: analysis?.status ?? "not-analyzed",
      };
    }),
    modeledStaticWriterForObservedChange: ambiguity.properties.filter(
      (item) => item.writerPaths.length > 0
    ).length,
    observedSupportedWriter: ambiguity.properties.filter(
      (item) => item.supportedWriterPaths.length > 0
    ).length,
    competingModeledWriter: ambiguity.properties.filter(
      (item) => item.competingWriterPaths.length > 0
    ).length,
    unattributedPropertyChange: ambiguity.properties.filter(
      (item) =>
        item.status === "unattributed-property-change" ||
        item.status === "single-modeled-writer-not-observed" ||
        item.status === "competing-modeled-writers-unattributed"
    ).length,
    ambiguousPropertyIdentity: ambiguity.properties.filter(
      (item) => item.status === "ambiguous-property-identity"
    ).length,
    stateChanges: trace.events
      .filter((event) => event.type === "stateChange")
      .map((event) => ({ step: event.step, stateName: event.stateName })),
    inputChanges: trace.events
      .filter((event) => event.type === "inputValueChanged")
      .map((event) => ({
        step: event.step,
        inputName: event.inputName,
        before: event.before,
        after: event.after,
      })),
    traceWarnings: trace.warnings,
    correlationWarnings: correlation.warnings,
    unmatchedStateObservations: correlation.unmatchedObservations,
    ambiguousStateObservations: correlation.ambiguousObservations,
    causalWarnings: ambiguity.warnings,
    runtimePropertyWarnings: [
      ...new Set(
        play.report.flatMap((entry) =>
          Array.isArray(entry.propertyWarnings) ? entry.propertyWarnings : []
        )
      ),
    ].sort(),
  };
}

async function runController(bytes, graph, scenario, runtimeVersion) {
  const host = new RiveHost(PAGE_SCRIPT);
  try {
    const inspect = await host.inspect(bytes);
    const artboard = scenario.target?.artboard ?? inspect.artboards[0]?.name;
    const artboardInfo = inspect.artboards.find((item) => item.name === artboard);
    const stateMachine =
      scenario.target?.stateMachine ?? artboardInfo?.stateMachines[0]?.name;
    assert.ok(artboard, "controller-basic must have a default artboard");
    assert.ok(stateMachine, "controller-basic must have a state machine");

    const staticInfo = staticSummary(graph);
    const watches = watchCandidates(staticInfo, artboard);
    const steps = scenario.steps.map((step) => {
      assert.equal(
        step.type,
        "advance",
        "controller-basic permanent calibration only supports the fixed advance scenario"
      );
      return { advance: step.ms / 1000 };
    });

    const play = await host.playStateMachine(bytes, {
      artboard,
      stateMachine,
      watchProperties: watches,
      steps,
    });
    const trace = observedTraceFromPlayResult(play, {
      artboard,
      stateMachine,
      backend: "RiveHost/canvas-advanced",
      backendVersion: runtimeVersion,
    });
    const correlation = correlateObservedTrace(trace, graph);
    const ambiguity = analyzeCausalAmbiguity(trace, graph, correlation);
    return {
      status: "executed",
      artboard,
      stateMachine,
      watchCandidates: watches,
      play,
      trace,
      correlation,
      ambiguity,
      metrics: dynamicMetrics(trace, graph, correlation, ambiguity, play),
    };
  } finally {
    await host.close();
  }
}

const runtimePackage = JSON.parse(
  readFileSync(
    join(root, "node_modules/@rive-app/canvas-advanced/package.json"),
    "utf8"
  )
);
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const runs = [];
for (const id of selectedIds) {
  const fixture = manifest.fixtures.find((item) => item.id === id);
  assert.ok(fixture, `missing corpus fixture ${id}`);
  const path = join(assetDir, `${id}.riv`);
  const bytes = readFileSync(path);
  assert.equal(sha256(bytes), fixture.artifact.sha256, `${id}: artifact hash drift`);
  assert.equal(bytes.length, fixture.artifact.bytes, `${id}: artifact size drift`);

  const graphA = staticProvenanceFromRiv(bytes);
  const graphB = staticProvenanceFromRiv(bytes);
  assert.deepEqual(graphA, graphB, `${id}: static provenance must be deterministic`);
  const staticInfo = staticSummary(graphA);
  const scenarioRef = fixture.scenarioRefs[0];
  const scenario = JSON.parse(readFileSync(join(root, scenarioRef), "utf8"));

  let dynamic;
  if (id === "official-flutter-controller-basic") {
    const first = await runController(
      bytes,
      graphA,
      scenario,
      runtimePackage.version
    );
    const second = await runController(
      bytes,
      graphA,
      scenario,
      runtimePackage.version
    );
    assert.deepEqual(
      first,
      second,
      "controller-basic real causal calibration must be deterministic"
    );
    dynamic = first;
  } else if (id === "official-flutter-rapid-pointer") {
    dynamic = {
      status: "unsupported",
      reason:
        "The #38 causal observation path playStateMachine does not accept backend-neutral pointer steps; Issue #39 has not integrated the raw .riv pointer execution path yet.",
      unsupportedObservationMechanisms: [
        "pointer scenario delivery",
        "ViewModel boolean checkpoint observation for hasReached",
      ],
    };
  } else {
    dynamic = {
      status: "unsupported",
      reason:
        "The #38 causal observation path does not execute backend-neutral ViewModel data writes, and Runtime Property Observation explicitly does not checkpoint ViewModel runtime values.",
      unsupportedObservationMechanisms: [
        "ViewModel data scenario delivery",
        "ViewModel runtime property checkpoint observation",
      ],
    };
  }

  runs.push({
    fixture: {
      id,
      artifactSha256: fixture.artifact.sha256,
      bytes: fixture.artifact.bytes,
      expectedBehaviorStatus: fixture.expectedBehaviorStatus,
      sourceDefinedExpectations: fixture.expectedAssertions,
    },
    scenario: {
      ref: scenarioRef,
      id: scenario.id,
      steps: scenario.steps,
    },
    staticProvenance: staticInfo,
    dynamic,
  });
}

const result = {
  schemaVersion: "rive-mcp.real-causal-calibration/v1",
  basis: {
    integrationHead: "69ea152db6cd1192fab36a4437ac266bc755b0ef",
    riveMcpVersion: packageJson.version,
    runtime: "@rive-app/canvas-advanced",
    runtimeVersion: runtimePackage.version,
    evidenceRule:
      "Static possible writers, observed states/inputs/properties, structurally supported writers, competing writers, and unattributed changes remain distinct. No exclusive-cause claim is made.",
  },
  fixtures: runs,
};
writeFileSync(join(outDir, "baseline.json"), JSON.stringify(result, null, 2) + "\n");

console.log(JSON.stringify({
  ok: true,
  runtimeVersion: runtimePackage.version,
  fixtures: runs.map((run) => ({
    id: run.fixture.id,
    artifactSha256: run.fixture.artifactSha256,
    static: {
      properties: run.staticProvenance.propertyCount,
      modeledProperties: run.staticProvenance.modeledPropertyCount,
      multiWriterProperties: run.staticProvenance.multiWriterPropertyCount,
      warnings: run.staticProvenance.warnings.length,
    },
    dynamic:
      run.dynamic.status === "executed"
        ? {
            status: run.dynamic.status,
            watches: run.dynamic.watchCandidates.length,
            observedChanges: run.dynamic.metrics.observedPropertyChanges.length,
            modeled: run.dynamic.metrics.modeledStaticWriterForObservedChange,
            observedSupported: run.dynamic.metrics.observedSupportedWriter,
            competing: run.dynamic.metrics.competingModeledWriter,
            unattributed: run.dynamic.metrics.unattributedPropertyChange,
            ambiguous: run.dynamic.metrics.ambiguousPropertyIdentity,
            runtimeWarnings: run.dynamic.metrics.runtimePropertyWarnings,
          }
        : run.dynamic,
  })),
}, null, 2));
