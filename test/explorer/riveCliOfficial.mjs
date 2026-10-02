import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exploreBoundedBfs } from "../../dist/explorer/explore.js";
import { RiveCliBackend } from "../../dist/explorer/backends/riveCli.js";
import { checkSequenceDeterminism } from "../../dist/explorer/determinism.js";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(here, "../fixtures/explorer/rive-cli-samples.json"), "utf8"));
const riveCli = process.env.RIVE_CLI;
const samplesRoot = process.env.RIVE_CLI_SAMPLES_PATH;
if (!riveCli) throw new Error("RIVE_CLI must point to the official Rive CLI executable");
if (!samplesRoot) throw new Error("RIVE_CLI_SAMPLES_PATH must point to `rive samples --path`");

const results = [];
let nondeterministicSequences = 0;
let responsiveSamples = 0;
for (const sample of corpus.samples) {
  const projectDir = resolve(samplesRoot, sample.name);
  assert.ok(existsSync(projectDir), `official Rive CLI sample missing: ${projectDir}`);
  const makeBackend = () => new RiveCliBackend({
    projectDir,
    command: { executable: riveCli },
    viewport: corpus.viewport,
    timeoutMs: 90_000,
  });

  const exploration = await exploreBoundedBfs(makeBackend(), {
    actions: sample.actions,
    maxDepth: corpus.maxDepth,
    maxSequences: corpus.maxSequences,
  });
  const determinism = await checkSequenceDeterminism(
    makeBackend,
    sample.determinismSequence,
    corpus.determinismAttempts
  );
  if (!determinism.deterministic) nondeterministicSequences++;
  if (exploration.coverage.observedStateSignatures.length > 1) responsiveSamples++;

  const probe = await makeBackend().execute(sample.determinismSequence);
  results.push({
    sample: sample.name,
    backendVersion: probe.backend?.version,
    observedStateSignatures: exploration.coverage.observedStateSignatures.length,
    observedTransitions: exploration.coverage.observedTransitions.length,
    explorerFailures: exploration.failures.length,
    backendCost: exploration.metrics.backendCost,
    responsive: exploration.coverage.observedStateSignatures.length > 1,
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
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  corpus: "official-rive-cli-bundled-samples-v1",
  source: "official-rive-cli-samples",
  samples: results,
  totals: {
    samples: results.length,
    responsiveSamples,
    nondeterministicSequences,
    explorerFailures: results.reduce((sum, result) => sum + result.explorerFailures, 0),
    backendCost: results.reduce((sum, result) => sum + result.backendCost, 0),
  },
};

const outPath = resolve(process.env.EXPLORER_CLI_REPORT ?? join(here, "../tmp/explorer-rive-cli-report.json"));
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
assert.equal(nondeterministicSequences, 0, "same official CLI action sequence produced divergent observable traces");
