import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeCausalAmbiguity } from "../../dist/causalAmbiguity.js";
import {
  correlateObservedTrace,
  observedTraceFromPlayResult,
} from "../../dist/observedTrace.js";
import {
  explainPotentialWriters,
  staticProvenanceFromRiv,
} from "../../dist/staticProvenance.js";
import { PAGE_SCRIPT } from "../../dist/pageScript.js";
import { RiveHost } from "../../dist/riveHost.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(
  readFileSync(join(root, "test/fixtures/real-world/manifest.json"), "utf8")
);
const assetDir = join(root, "test/tmp/real-world-corpus/assets");
const outDir = join(root, "test/tmp/causal-calibration");
mkdirSync(outDir, { recursive: true });

const fixtureIds = [
  "official-flutter-controller-basic",
  "official-flutter-rapid-pointer",
  "official-flutter-rewards-data-binding",
];

const WATCHABLE_PROPERTIES = new Set([
  "x",
  "y",
  "rotation",
  "scaleX",
  "scaleY",
  "text",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function scenarioFor(fixture) {
  assert.equal(fixture.scenarioRefs.length, 1);
  return JSON.parse(readFileSync(join(root, fixture.scenarioRefs[0]), "utf8"));
}

function watchSpecsFor(graph, artboard) {
  const seen = new Set();
  const specs = [];
  for (const node of graph.nodes) {
    if (node.kind !== "property" || node.artboard !== artboard) continue;
    const target = node.metadata.targetName;
    const property = node.metadata.propertyName;
    if (typeof target !== "string" || typeof property !== "string") continue;
    if (!WATCHABLE_PROPERTIES.has(property)) continue;
    const key = target + "\u0000" + property;
    if (seen.has(key)) continue;
    seen.add(key);
    specs.push({ target, property });
  }
  specs.sort(
    (a, b) => a.target.localeCompare(b.target) || a.property.localeCompare(b.property)
  );
  return specs;
}

function propertyObservationGaps(graph, artboard, watchProperties) {
  const watched = new Set(
    watchProperties.map((item) => item.target + "\u0000" + item.property)
  );
  return graph.nodes
    .filter((node) => node.kind === "property" && node.artboard === artboard)
    .filter((node) => {
      const target = node.metadata.targetName;
      const property = node.metadata.propertyName;
      return !(
        typeof target === "string" &&
        typeof property === "string" &&
        watched.has(target + "\u0000" + property)
      );
    })
    .map((node) => ({
      propertyNodeId: node.id,
      label: node.label,
      targetType: node.metadata.targetType ?? null,
      targetName: node.metadata.targetName ?? null,
      propertyName: node.metadata.propertyName ?? null,
      reason:
        node.metadata.targetName == null
          ? "runtime watcher requires a stable named target; static provenance currently has only index-fallback identity"
          : !WATCHABLE_PROPERTIES.has(node.metadata.propertyName)
            ? "runtime watcher does not support this property kind"
            : "runtime watcher could not establish a supported target/property identity",
    }));
}

function staticSummary(graph) {
  const propertyNodes = graph.nodes.filter((node) => node.kind === "property");
  const writerPaths = propertyNodes.flatMap((node) =>
    explainPotentialWriters(graph, node.id).map((path) => ({
      propertyNodeId: node.id,
      targetName: node.metadata.targetName ?? null,
      targetType: node.metadata.targetType ?? null,
      propertyName: node.metadata.propertyName ?? null,
      nodeIds: path.nodeIds,
      edgeKinds: path.edgeKinds,
    }))
  );
  return {
    propertyNodes: propertyNodes.length,
    propertyDetails: propertyNodes.map((node) => ({
      id: node.id,
      artboard: node.artboard ?? null,
      label: node.label,
      targetType: node.metadata.targetType ?? null,
      targetName: node.metadata.targetName ?? null,
      propertyName: node.metadata.propertyName ?? null,
      propertyKey: node.metadata.propertyKey ?? null,
      writerPaths: explainPotentialWriters(graph, node.id),
    })),
    writerPaths: writerPaths.length,
    writerKinds: {
      animation: graph.nodes.filter((node) => node.kind === "animation").length,
      state: graph.nodes.filter((node) => node.kind === "state").length,
      binding: graph.nodes.filter((node) => node.kind === "binding").length,
      bindingSource: graph.nodes.filter((node) => node.kind === "bindingSource").length,
      converter: graph.nodes.filter((node) => node.kind === "converter").length,
    },
    warnings: graph.warnings,
  };
}

function unsupportedReasons(scenario) {
  const reasons = [];
  for (const step of scenario.steps ?? []) {
    if (step.type === "pointer") {
      reasons.push(
        "current #22-#24 playStateMachine observation path does not accept pointer Scenario actions"
      );
    } else if (step.type === "data") {
      reasons.push(
        "current #22-#24 observation path does not apply/checkpoint ViewModel data writes"
      );
    } else if (step.type === "key") {
      reasons.push(
        "current #22-#24 playStateMachine observation path does not accept key Scenario actions"
      );
    } else if (step.type !== "advance") {
      reasons.push("unsupported Scenario step type: " + String(step.type));
    }
  }
  return sortedUnique(reasons);
}

function playSteps(scenario) {
  return (scenario.steps ?? []).map((step) => {
    if (step.type !== "advance") {
      throw new Error("unsupported Scenario step reached playSteps: " + step.type);
    }
    return { advance: Number(step.ms) / 1000 };
  });
}

function propertyChangeRecords(trace, ambiguity) {
  const ambiguityByObservation = new Map(
    ambiguity.properties.map((item) => [item.observationId, item])
  );
  const changes = [];
  for (const event of trace.events) {
    if (event.type !== "propertyValueChanged") continue;
    const item = ambiguityByObservation.get(event.id);
    changes.push({
      observationId: event.id,
      step: event.step,
      target: event.target,
      property: event.property,
      before: event.before,
      after: event.after,
      staticPossibleWriterCount: item?.writerPaths.length ?? 0,
      structurallySupportedWriterCount: item?.supportedWriterPaths.length ?? 0,
      competingWriterCount: item?.competingWriterPaths.length ?? 0,
      status: item?.status ?? "missing-ambiguity-record",
      propertyNodeIds: item?.propertyNodeIds ?? [],
      writerPaths: item?.writerPaths ?? [],
    });
  }
  return changes;
}

function measuredMetrics(changes, correlation, ambiguity, trace, graph) {
  return {
    observedPropertyChanges: changes.length,
    withModeledStaticWriter: changes.filter(
      (item) => item.staticPossibleWriterCount > 0
    ).length,
    withObservedSupportedWriter: changes.filter(
      (item) => item.structurallySupportedWriterCount > 0
    ).length,
    withCompetingModeledWriter: changes.filter(
      (item) => item.competingWriterCount > 0
    ).length,
    unattributedPropertyChanges: changes.filter((item) =>
      [
        "unattributed-property-change",
        "single-modeled-writer-not-observed",
        "competing-modeled-writers-unattributed",
      ].includes(item.status)
    ).length,
    ambiguousPropertyIdentity: changes.filter(
      (item) => item.status === "ambiguous-property-identity"
    ).length,
    staticProvenanceWarnings: graph.warnings.length,
    observedTraceWarnings: trace.warnings.length,
    correlationWarnings: correlation.warnings.length,
    causalWarnings: ambiguity.warnings.length,
    unmatchedStateObservations: correlation.unmatchedObservations.length,
    ambiguousStateObservations: correlation.ambiguousObservations.length,
  };
}

async function measureFixture(fixture) {
  const scenario = scenarioFor(fixture);
  const bytes = readFileSync(join(assetDir, fixture.id + ".riv"));
  assert.equal(bytes.length, fixture.artifact.bytes, fixture.id + " byte drift");
  assert.equal(sha256(bytes), fixture.artifact.sha256, fixture.id + " hash drift");

  const graph = staticProvenanceFromRiv(bytes);
  const unsupported = unsupportedReasons(scenario);
  const base = {
    fixture: fixture.id,
    origin: fixture.origin,
    artifactSha256: fixture.artifact.sha256,
    scenarioId: scenario.id,
    scenarioRef: fixture.scenarioRefs[0],
    static: staticSummary(graph),
    unsupportedObservationMechanisms: unsupported,
  };

  if (unsupported.length > 0) {
    return {
      ...base,
      executionStatus: "unsupported",
      observation: null,
      metrics: {
        observedPropertyChanges: 0,
        withModeledStaticWriter: 0,
        withObservedSupportedWriter: 0,
        withCompetingModeledWriter: 0,
        unattributedPropertyChanges: 0,
        ambiguousPropertyIdentity: 0,
        staticProvenanceWarnings: graph.warnings.length,
        observedTraceWarnings: 0,
        correlationWarnings: 0,
        causalWarnings: 0,
        unmatchedStateObservations: 0,
        ambiguousStateObservations: 0,
      },
    };
  }

  const host = new RiveHost(PAGE_SCRIPT);
  try {
    const inspect = await host.inspect(bytes);
    const artboard = inspect.artboards[0];
    if (!artboard) {
      return {
        ...base,
        executionStatus: "unsupported",
        unsupportedObservationMechanisms: [
          "runtime inspect found no artboard",
        ],
        observation: null,
      };
    }
    const stateMachine = artboard.stateMachines[0];
    if (!stateMachine) {
      return {
        ...base,
        executionStatus: "unsupported",
        unsupportedObservationMechanisms: [
          "runtime inspect found no State Machine on default artboard",
        ],
        observation: null,
      };
    }

    const watchProperties = watchSpecsFor(graph, artboard.name);
    const observationGaps = propertyObservationGaps(
      graph,
      artboard.name,
      watchProperties
    );
    const observationGapMessages = observationGaps.map(
      (gap) =>
        "property observation unsupported for " +
        gap.label +
        " (" +
        gap.propertyNodeId +
        "): " +
        gap.reason
    );
    const play = await host.playStateMachine(bytes, {
      artboard: artboard.name,
      stateMachine: stateMachine.name,
      steps: playSteps(scenario),
      watchProperties,
    });
    const trace = observedTraceFromPlayResult(play, {
      artboard: artboard.name,
      stateMachine: stateMachine.name,
      backend: "RiveHost.playStateMachine",
      backendVersion: "canvas-advanced@2.38.5",
    });
    const correlation = correlateObservedTrace(trace, graph);
    const ambiguity = analyzeCausalAmbiguity(trace, graph, correlation);
    const changes = propertyChangeRecords(trace, ambiguity);

    return {
      ...base,
      unsupportedObservationMechanisms: sortedUnique([
        ...base.unsupportedObservationMechanisms,
        ...observationGapMessages,
      ]),
      executionStatus: "executed",
      runtime: {
        artboard: artboard.name,
        stateMachine: stateMachine.name,
        watchProperties,
        propertyObservationGaps: observationGaps,
        report: play.report,
      },
      observation: {
        propertyChanges: changes,
        observedStates: trace.events
          .filter((event) => event.type === "stateChange")
          .map((event) => ({
            observationId: event.id,
            step: event.step,
            stateName: event.stateName,
          })),
        observedInputs: trace.events
          .filter((event) => event.type === "inputValueChanged")
          .map((event) => ({
            observationId: event.id,
            step: event.step,
            inputName: event.inputName,
            before: event.before,
            after: event.after,
          })),
        traceWarnings: trace.warnings,
        correlation: {
          support: correlation.support,
          unmatchedObservations: correlation.unmatchedObservations,
          ambiguousObservations: correlation.ambiguousObservations,
          warnings: correlation.warnings,
        },
        ambiguity,
      },
      metrics: measuredMetrics(changes, correlation, ambiguity, trace, graph),
    };
  } finally {
    await host.close();
  }
}

const first = [];
for (const id of fixtureIds) {
  const fixture = manifest.fixtures.find((item) => item.id === id);
  assert.ok(fixture, "missing fixture " + id);
  first.push(await measureFixture(fixture));
}

const second = [];
for (const id of fixtureIds) {
  const fixture = manifest.fixtures.find((item) => item.id === id);
  second.push(await measureFixture(fixture));
}

assert.deepEqual(second, first, "real causal calibration is not deterministic");

function calibrationProjection(result) {
  return {
    schemaVersion: "rive-mcp.real-causal-calibration-expectation/v1",
    fixtures: result.fixtures.map((item) => ({
      fixture: item.fixture,
      artifactSha256: item.artifactSha256,
      scenarioId: item.scenarioId,
      static: {
        propertyNodes: item.static.propertyNodes,
        writerPaths: item.static.writerPaths,
        warningCount: item.static.warnings.length,
      },
      executionStatus: item.executionStatus,
      unsupportedObservationMechanisms: item.unsupportedObservationMechanisms,
      runtime:
        item.executionStatus === "executed"
          ? {
              artboard: item.runtime.artboard,
              stateMachine: item.runtime.stateMachine,
              watchProperties: item.runtime.watchProperties,
              propertyObservationGaps: item.runtime.propertyObservationGaps,
            }
          : null,
      observedStates:
        item.observation?.observedStates.map((event) => event.stateName) ?? [],
      metrics: item.metrics,
    })),
  };
}

const result = {
  schemaVersion: "rive-mcp.real-causal-calibration/v1",
  base: {
    integrationPr: 38,
    integrationHead: "69ea152db6cd1192fab36a4437ac266bc755b0ef",
    syntheticValidationClaimed: false,
  },
  deterministic: {
    passes: 2,
    identical: true,
  },
  fixtures: first,
};

const projection = calibrationProjection(result);
const expectationPath = join(
  root,
  "test/fixtures/causal-calibration/real-fixtures-v1.json"
);
if (process.env.CAUSAL_CALIBRATION_ACCEPT !== "1") {
  const expected = JSON.parse(readFileSync(expectationPath, "utf8"));
  assert.deepEqual(
    projection,
    expected,
    "real causal calibration drifted from the permanent real-fixture expectation"
  );
}

writeFileSync(
  join(outDir, "baseline.json"),
  JSON.stringify(result, null, 2) + "\n"
);
writeFileSync(
  join(outDir, "projection.json"),
  JSON.stringify(projection, null, 2) + "\n"
);

console.log(JSON.stringify(result, null, 2));
