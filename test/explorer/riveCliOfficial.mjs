import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exploreBoundedBfs } from "../../dist/explorer/explore.js";
import { RiveCliBackend } from "../../dist/explorer/backends/riveCli.js";
import { checkSequenceDeterminism } from "../../dist/explorer/determinism.js";
import { actionSignature } from "../../dist/stateSpace/signature.js";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(here, "../fixtures/explorer/rive-cli-samples.json"), "utf8"));
const riveCli = process.env.RIVE_CLI;
const samplesRoot = process.env.RIVE_CLI_SAMPLES_PATH;
if (!riveCli) throw new Error("RIVE_CLI must point to the official Rive CLI executable");
if (!samplesRoot) throw new Error("RIVE_CLI_SAMPLES_PATH must point to `rive samples --path`");

function stateSet(result) {
  return [...result.coverage.observedStateSignatures].sort();
}

function transitionSet(result) {
  return result.coverage.observedTransitions
    .map((transition) =>
      [transition.fromSignature, actionSignature(transition.action), transition.toSignature].join("\u0000")
    )
    .sort();
}

const results = [];
let nondeterministicSequences = 0;
let responsiveSamples = 0;
for (const sample of corpus.samples) {
  const projectDir = resolve(samplesRoot, sample.name);
  assert.ok(existsSync(projectDir), `official Rive CLI sample missing: ${projectDir}`);
  const backendOptions = {
    projectDir,
    command: { executable: riveCli },
    viewport: corpus.viewport,
    timeoutMs: 90_000,
  };
  const exploreOptions = {
    actions: sample.actions,
    maxDepth: corpus.maxDepth,
    maxSequences: corpus.maxSequences,
  };

  // Same runner, same project, same action corpus: compare the algorithmic change directly.
  const uncached = await exploreBoundedBfs(
    new RiveCliBackend({ ...backendOptions, cachePrefixes: false }),
    exploreOptions
  );
  const cached = await exploreBoundedBfs(
    new RiveCliBackend({ ...backendOptions, cachePrefixes: true }),
    exploreOptions
  );
  assert.deepEqual(stateSet(cached), stateSet(uncached), `${sample.name}: prefix cache changed observed states`);
  assert.deepEqual(transitionSet(cached), transitionSet(uncached), `${sample.name}: prefix cache changed observed transitions`);
  assert.equal(cached.failures.length, uncached.failures.length, `${sample.name}: prefix cache changed failure count`);

  const makeFreshBackend = () => new RiveCliBackend({ ...backendOptions, cachePrefixes: true });
  const determinism = await checkSequenceDeterminism(
    makeFreshBackend,
    sample.determinismSequence,
    corpus.determinismAttempts
  );
  if (!determinism.deterministic) nondeterministicSequences++;
  if (cached.coverage.observedStateSignatures.length > 1) responsiveSamples++;

  const probe = await makeFreshBackend().execute(sample.determinismSequence);
  results.push({
    sample: sample.name,
    backendVersion: probe.backend?.version,
    observedStateSignatures: cached.coverage.observedStateSignatures.length,
    observedTransitions: cached.coverage.observedTransitions.length,
    explorerFailures: cached.failures.length,
    responsive: cached.coverage.observedStateSignatures.length > 1,
    costComparison: {
      uncachedBackendCost: uncached.metrics.backendCost,
      cachedBackendCost: cached.metrics.backendCost,
      savedBackendCommands: uncached.metrics.backendCost - cached.metrics.backendCost,
      reductionRate:
        uncached.metrics.backendCost === 0
          ? 0
          : (uncached.metrics.backendCost - cached.metrics.backendCost) / uncached.metrics.backendCost,
    },
    determinism: {
      attempts: determinism.attempts,
      deterministic: determinism.deterministic,
      uniqueTraceSignatures: determinism.uniqueTraceSignatures.length,
      firstDivergentAttempt: determinism.firstDivergentAttempt,
    },
    diagnostics: probe.steps.map((step) => step.diagnostics ?? []),
  });
}

const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  corpus: "official-rive-cli-bundled-samples-v1",
  source: "official-rive-cli-samples",
  samples: results,
  totals: {
    samples: results.length,
    responsiveSamples,
    nondeterministicSequences,
    explorerFailures: results.reduce((sum, result) => sum + result.explorerFailures, 0),
    uncachedBackendCost: results.reduce((sum, result) => sum + result.costComparison.uncachedBackendCost, 0),
    cachedBackendCost: results.reduce((sum, result) => sum + result.costComparison.cachedBackendCost, 0),
    savedBackendCommands: results.reduce((sum, result) => sum + result.costComparison.savedBackendCommands, 0),
  },
};

const outPath = resolve(process.env.EXPLORER_CLI_REPORT ?? join(here, "../tmp/explorer-rive-cli-report.json"));
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
assert.equal(nondeterministicSequences, 0, "same official CLI action sequence produced divergent observable traces");
