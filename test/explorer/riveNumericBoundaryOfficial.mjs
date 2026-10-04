import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exploreBoundedBfs } from "../../dist/explorer/explore.js";
import { RiveCliBackend } from "../../dist/explorer/backends/riveCli.js";
import { runCommand } from "../../dist/explorer/backends/riveCliProcess.js";
import { checkSequenceDeterminism } from "../../dist/explorer/determinism.js";
import { prioritizeBoundaryActions } from "../../dist/fuzz/boundaries.js";
import { extractRiveRmlNumericBoundaryHints } from "../../dist/fuzz/riveRmlBoundaries.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const projectDir = join(repoRoot, "test/fixtures/explorer/rive-numeric-boundary");
const scenePath = join(projectDir, "scene.rml");
const riveCli = process.env.RIVE_CLI;
if (!riveCli) throw new Error("RIVE_CLI must point to the official Rive CLI executable");

const cliEnv = { ...process.env, RIVE_NO_TUI: "1", TERM: "dumb", RIVE_ANALYTICS: "off" };

async function command(args) {
  return runCommand(riveCli, args, { cwd: projectDir, timeoutMs: 90_000, env: cliEnv });
}

const verify = await command([projectDir, "--verify"]);
assert.equal(verify.code, 0, `fixture verify failed: ${verify.stderr || verify.stdout}`);

const inspected = await command(["inspect", projectDir, "--json"]);
assert.equal(inspected.code, 0, `fixture inspect failed: ${inspected.stderr || inspected.stdout}`);
const inspect = JSON.parse(inspected.stdout);
assert.deepEqual(inspect.problems ?? [], [], "fixture inspect reported problems");

const rml = readFileSync(scenePath, "utf8");
const hints = extractRiveRmlNumericBoundaryHints(rml, inspect, { source: "scene.rml" });
assert.deepEqual(
  hints.map(({ path, operator, threshold }) => ({ path, operator, threshold })),
  [{ path: "score", operator: ">", threshold: 50 }]
);

const baselineActions = [
  { kind: "data-write", path: "score", value: 0 },
  { kind: "data-write", path: "score", value: 25 },
  { kind: "advance-time", seconds: 0.016 },
];
const guidedActions = prioritizeBoundaryActions(baselineActions, hints);

class RecordingBackend {
  name = "recording-rive-cli";
  frameHashes = new Set();
  constructor(inner) {
    this.inner = inner;
  }
  async execute(sequence) {
    const trace = await this.inner.execute(sequence);
    if (trace.initial.frameHash) this.frameHashes.add(trace.initial.frameHash);
    for (const step of trace.steps) {
      if (step.observation?.frameHash) this.frameHashes.add(step.observation.frameHash);
    }
    return trace;
  }
}

function backend() {
  return new RiveCliBackend({
    projectDir,
    command: { executable: riveCli },
    viewport: { width: 240, height: 160 },
    timeoutMs: 90_000,
    cachePrefixes: true,
  });
}

const baselineBackend = new RecordingBackend(backend());
const guidedBackend = new RecordingBackend(backend());
const baseline = await exploreBoundedBfs(baselineBackend, {
  actions: baselineActions,
  maxDepth: 2,
  maxSequences: 64,
});
const guided = await exploreBoundedBfs(guidedBackend, {
  actions: guidedActions,
  maxDepth: 2,
  maxSequences: 64,
});

const advance = { kind: "advance-time", seconds: 0.016 };
async function finalObservation(score) {
  const trace = await backend().execute([
    { kind: "data-write", path: "score", value: score },
    advance,
  ]);
  const observation = trace.steps.at(-1)?.observation;
  assert.ok(observation?.frameHash, `missing final frame hash for score=${score}`);
  return observation;
}

const below = await finalObservation(49.999);
const exact = await finalObservation(50);
const above = await finalObservation(50.001);
assert.equal(exact.frameHash, below.frameHash, "score == 50 must remain on the <= 50 visual state");
assert.notEqual(above.frameHash, exact.frameHash, "score > 50 must reach a distinct visual state");

const determinism = await checkSequenceDeterminism(
  backend,
  [{ kind: "data-write", path: "score", value: 50.001 }, advance],
  5
);
assert.equal(determinism.deterministic, true, "numeric-boundary transition must reproduce deterministically");
assert.equal(determinism.uniqueTraceSignatures.length, 1);

assert.equal(baseline.failures.length, 0);
assert.equal(guided.failures.length, 0);
assert.ok(
  guidedBackend.frameHashes.size > baselineBackend.frameHashes.size,
  `boundary guidance did not add visual coverage: baseline=${baselineBackend.frameHashes.size}, guided=${guidedBackend.frameHashes.size}`
);

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  fixture: "rive-numeric-boundary",
  backendVersion: (await backend().execute([])).backend?.version,
  verified: true,
  inspectProblems: inspect.problems ?? [],
  hints,
  baseline: {
    actions: baselineActions,
    stateSignatures: baseline.coverage.observedStateSignatures.length,
    transitions: baseline.coverage.observedTransitions.length,
    frameHashes: baselineBackend.frameHashes.size,
    failures: baseline.failures.length,
    backendCost: baseline.metrics.backendCost,
  },
  guided: {
    actions: guidedActions,
    stateSignatures: guided.coverage.observedStateSignatures.length,
    transitions: guided.coverage.observedTransitions.length,
    frameHashes: guidedBackend.frameHashes.size,
    failures: guided.failures.length,
    backendCost: guided.metrics.backendCost,
  },
  boundarySemantics: {
    belowFrameHash: below.frameHash,
    exactFrameHash: exact.frameHash,
    aboveFrameHash: above.frameHash,
    exactEqualsBelow: exact.frameHash === below.frameHash,
    aboveDiffersFromExact: above.frameHash !== exact.frameHash,
  },
  determinism: {
    attempts: determinism.attempts,
    deterministic: determinism.deterministic,
    uniqueTraceSignatures: determinism.uniqueTraceSignatures.length,
    firstDivergentAttempt: determinism.firstDivergentAttempt,
  },
};

const outPath = resolve(
  process.env.EXPLORER_NUMERIC_BOUNDARY_REPORT ??
    join(repoRoot, "test/tmp/explorer-numeric-boundary-report.json")
);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
