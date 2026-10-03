import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { exploreActionSequences, exploreBoundedBfs } from "../../dist/explorer/explore.js";
import { extractNumericBoundaryHints, prioritizeBoundaryActions } from "../../dist/fuzz/boundaries.js";
import { boundaryGuidedSequences } from "../../dist/fuzz/boundaryPlan.js";
import { minimizeFailingSequence } from "../../dist/minimize/ddmin.js";
import { reproducesInvariantFailure, reproductionSuccessRate } from "../../dist/explorer/reproduce.js";
import { JsonFailureCorpus, makeFailureRecord } from "../../dist/explorer/failureCorpus.js";
import { proveStaticallyUnreachable } from "../../dist/stateSpace/coverage.js";
import { stateSignature } from "../../dist/stateSpace/signature.js";
import { FixtureBackend } from "./fixtureBackend.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "../fixtures/explorer/threshold-submit.json"), "utf8"));
const invariant = fixture.invariants[0];

const baselineBackend = new FixtureBackend(fixture);
const common = {
  maxDepth: 2,
  maxSequences: 80,
  invariants: fixture.invariants,
  expectedStateLabels: fixture.expectedStateLabels,
  staticGraph: fixture.staticGraph,
};
const baseline = await exploreBoundedBfs(baselineBackend, { ...common, actions: fixture.baseActions });

const hints = fixture.boundaryExpressions.flatMap((expression) => extractNumericBoundaryHints(expression));
const guidedActions = prioritizeBoundaryActions(fixture.baseActions, hints);
const guidedBackend = new FixtureBackend(fixture);
const guided = await exploreBoundedBfs(guidedBackend, { ...common, actions: guidedActions });

const targetedPlan = boundaryGuidedSequences(fixture.baseActions, hints, common.maxDepth);
const targetedBackend = new FixtureBackend(fixture);
const targeted = await exploreActionSequences(targetedBackend, { ...common, actions: fixture.baseActions }, targetedPlan);

assert.equal(baseline.failures.length, 0, "baseline should miss the threshold-only failure");
assert.ok(!baseline.coverage.observedStateLabels.includes("boundary"));
assert.ok(guided.coverage.observedStateLabels.includes("boundary"));
assert.equal(guided.failures.length, 1, "boundary-guided run should expose one invariant violation");
assert.deepEqual(guided.coverage.staticallyUnreachable, ["dead"]);
assert.equal(targeted.failures.length, 1, "targeted boundary plan should preserve the discovered failure");
assert.deepEqual(targeted.coverage.observedStateLabels, guided.coverage.observedStateLabels);
assert.ok(targeted.metrics.backendCost < guided.metrics.backendCost, "targeted plan should cost less than Cartesian boundary expansion");
assert.ok(baseline.coverage.notReachedWithinExplorationBudget.includes("boundary"));
assert.ok(!guided.coverage.notReachedWithinExplorationBudget.includes("boundary"));

const found = targeted.failures[0];
assert.equal(found.kind, "invariant-violation");
const noisySequence = [
  { kind: "advance-time", seconds: 0.1 },
  { kind: "data-write", path: "score", value: 0 },
  { kind: "advance-time", seconds: 0.2 },
  { kind: "data-write", path: "score", value: 50 },
  { kind: "advance-time", seconds: 0.01 },
  { kind: "pointer", phase: "click", x: 120, y: 60 },
  { kind: "advance-time", seconds: 0.3 }
];
const minimized = await minimizeFailingSequence(noisySequence, (candidate) =>
  reproducesInvariantFailure(new FixtureBackend(fixture), invariant, candidate)
);
assert.equal(minimized.minimality, "locally-minimized");
assert.deepEqual(minimized.sequence, [
  { kind: "data-write", path: "score", value: 50 },
  { kind: "pointer", phase: "click", x: 120, y: 60 }
]);

const reproduction = await reproductionSuccessRate(new FixtureBackend(fixture), invariant, minimized.sequence, 5);
assert.equal(reproduction.rate, 1);

const record = makeFailureRecord({
  origin: "synthetic-regression",
  artifactHash: fixture.artifactHash,
  artifact: { project: fixture.id },
  tool: { name: "rive-mcp-explorer", version: "dev" },
  runtime: { name: "fixture-runtime", version: "1" },
  scenario: { seed: "fixed", strategy: "bounded-bfs+boundary-guided", maxDepth: common.maxDepth, maxSequences: common.maxSequences },
  inputSequence: noisySequence,
  minimalReproduction: {
    sequence: minimized.sequence,
    minimality: minimized.minimality,
    reproductionAttempts: reproduction.attempts,
    reproductionSuccesses: reproduction.successes,
    reproductionSuccessRate: reproduction.rate,
  },
  expectedInvariant: invariant,
  observedResult: {
    stepIndex: found.stepIndex,
    observation: found.observation,
    message: found.violation.description,
  },
  evidence: { data: found.observation.viewModel },
  knownAffectedVersions: ["fixture-runtime@1"],
  discoveredAt: "2026-10-03T00:00:00.000Z",
});
assert.match(record.failureId, /^fail_[0-9a-f]{24}$/);
assert.equal(
  stateSignature({ viewModel: { b: 2, a: 1 }, activeStates: ["idle"] }),
  stateSignature({ activeStates: ["idle"], viewModel: { a: 1, b: 2 } }),
  "state signatures must canonicalize object-key order"
);
assert.deepEqual(
  proveStaticallyUnreachable({ ...fixture.staticGraph, complete: false }),
  [],
  "an incomplete graph must never produce an unreachable proof"
);

const corpusDir = mkdtempSync(join(tmpdir(), "rive-explorer-corpus-"));
try {
  const saved = new JsonFailureCorpus(corpusDir).save(record);
  const roundTrip = JSON.parse(readFileSync(saved, "utf8"));
  assert.equal(roundTrip.failureId, record.failureId);
  assert.equal(roundTrip.origin, "synthetic-regression");
  assert.equal(roundTrip.minimalReproduction.reproductionSuccessRate, 1);
} finally {
  rmSync(corpusDir, { recursive: true, force: true });
}

const metrics = {
  fixture: fixture.id,
  baseline: {
    states: baseline.coverage.observedStateLabels.length,
    transitions: baseline.coverage.observedTransitions.length,
    failures: baseline.failures.length,
    notReached: baseline.coverage.notReachedWithinExplorationBudget,
    staticallyUnreachable: baseline.coverage.staticallyUnreachable,
    sequences: baseline.metrics.sequencesExecuted,
    actions: baseline.metrics.actionsExecuted,
    cost: baseline.metrics.backendCost,
  },
  guidedCartesian: {
    states: guided.coverage.observedStateLabels.length,
    transitions: guided.coverage.observedTransitions.length,
    failures: guided.failures.length,
    notReached: guided.coverage.notReachedWithinExplorationBudget,
    staticallyUnreachable: guided.coverage.staticallyUnreachable,
    sequences: guided.metrics.sequencesExecuted,
    actions: guided.metrics.actionsExecuted,
    cost: guided.metrics.backendCost,
  },
  targetedBoundary: {
    states: targeted.coverage.observedStateLabels.length,
    transitions: targeted.coverage.observedTransitions.length,
    failures: targeted.failures.length,
    notReached: targeted.coverage.notReachedWithinExplorationBudget,
    staticallyUnreachable: targeted.coverage.staticallyUnreachable,
    sequences: targeted.metrics.sequencesExecuted,
    actions: targeted.metrics.actionsExecuted,
    cost: targeted.metrics.backendCost,
  },
  minimization: { from: noisySequence.length, to: minimized.sequence.length, attempts: minimized.attempts },
  reproduction,
  failureId: record.failureId,
};
console.log(JSON.stringify(metrics, null, 2));
