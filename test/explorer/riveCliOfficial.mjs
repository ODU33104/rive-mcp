import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exploreBoundedBfs } from "../../dist/explorer/explore.js";
import { RiveCliBackend } from "../../dist/explorer/backends/riveCli.js";
import { runCommand } from "../../dist/explorer/backends/riveCliProcess.js";
import { checkSequenceDeterminism } from "../../dist/explorer/determinism.js";
import { extractRiveRmlNumericBoundaryHints } from "../../dist/fuzz/riveRmlBoundaries.js";
import { prioritizeBoundaryActions } from "../../dist/fuzz/boundaries.js";
import { actionSignature } from "../../dist/stateSpace/signature.js";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(here, "../fixtures/explorer/rive-cli-samples.json"), "utf8"));
const riveCli = process.env.RIVE_CLI;
const samplesRoot = process.env.RIVE_CLI_SAMPLES_PATH;
if (!riveCli) throw new Error("RIVE_CLI must point to the official Rive CLI executable");
if (!samplesRoot) throw new Error("RIVE_CLI_SAMPLES_PATH must point to `rive samples --path`");

const cliEnv = { ...process.env, RIVE_NO_TUI: "1", TERM: "dumb", RIVE_ANALYTICS: "off" };

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

function filesWithExtension(root, extension) {
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) out.push(...filesWithExtension(full, extension));
    else if (entry.isFile() && entry.name.endsWith(extension)) out.push(full);
  }
  return out;
}

function count(text, expression) {
  return [...text.matchAll(expression)].length;
}

function dedupeHints(hints) {
  const seen = new Set();
  return hints.filter((hint) => {
    const key = JSON.stringify([hint.path, hint.operator, hint.threshold, hint.source]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadSchema(type) {
  const result = await runCommand(riveCli, ["schema", type, "--json"], {
    cwd: samplesRoot,
    timeoutMs: 30_000,
    env: cliEnv,
  });
  assert.equal(result.code, 0, `rive schema ${type} failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

function schemaProperty(schema, name) {
  return schema.properties?.find((property) => property.name === name);
}

async function verifyBoundarySchemaContract() {
  const [condition, numberComparator, bindableNumber, dataBindContext] = await Promise.all([
    loadSchema("TransitionViewModelCondition"),
    loadSchema("TransitionValueNumberComparator"),
    loadSchema("BindablePropertyNumber"),
    loadSchema("DataBindContext"),
  ]);

  const op = schemaProperty(condition, "opValue");
  assert.equal(op?.default, "equal");
  assert.deepEqual(
    [...(op?.accepts ?? [])].sort(),
    ["equal", "greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual", "notEqual"].sort()
  );
  const value = schemaProperty(numberComparator, "value");
  assert.equal(value?.type, "double");
  const propertyValue = schemaProperty(bindableNumber, "propertyValue");
  assert.equal(propertyValue?.type, "double");
  assert.equal(propertyValue?.key, 636);
  const sourcePathIds = schemaProperty(dataBindContext, "sourcePathIds");
  assert.equal(sourcePathIds?.type, "List<Id>");

  return {
    transitionViewModelConditionTypeKey: condition.typeKey,
    transitionValueNumberComparatorTypeKey: numberComparator.typeKey,
    bindablePropertyNumberTypeKey: bindableNumber.typeKey,
    bindablePropertyNumberValueKey: propertyValue.key,
    dataBindContextTypeKey: dataBindContext.typeKey,
    sourcePathIdsType: sourcePathIds.type,
  };
}

async function scanStaticBoundaries() {
  const entries = [];
  const sampleNames = readdirSync(samplesRoot)
    .filter((name) => statSync(join(samplesRoot, name)).isDirectory())
    .sort();

  for (const sampleName of sampleNames) {
    const projectDir = resolve(samplesRoot, sampleName);
    const inspectResult = await runCommand(riveCli, ["inspect", projectDir, "--json"], {
      cwd: projectDir,
      timeoutMs: 90_000,
      env: cliEnv,
    });
    assert.equal(
      inspectResult.code,
      0,
      `rive inspect failed for official sample ${sampleName}: ${inspectResult.stderr || inspectResult.stdout}`
    );
    const inspect = JSON.parse(inspectResult.stdout);

    const hints = [];
    let viewModelConditions = 0;
    let numberComparators = 0;
    let booleanComparators = 0;
    for (const file of filesWithExtension(projectDir, ".rml")) {
      const rml = readFileSync(file, "utf8");
      const source = relative(projectDir, file);
      hints.push(...extractRiveRmlNumericBoundaryHints(rml, inspect, { source }));
      viewModelConditions += count(rml, /<TransitionViewModelCondition\b/g);
      numberComparators += count(rml, /<TransitionValueNumberComparator\b/g);
      booleanComparators += count(rml, /<TransitionValueBooleanComparator\b/g);
    }

    entries.push({
      sample: sampleName,
      hints: dedupeHints(hints),
      conditionEvidence: { viewModelConditions, numberComparators, booleanComparators },
    });
  }

  return {
    samplesScanned: entries.length,
    samplesWithNumericBoundaryHints: entries.filter((entry) => entry.hints.length > 0).length,
    totalNumericBoundaryHints: entries.reduce((sum, entry) => sum + entry.hints.length, 0),
    totalViewModelConditions: entries.reduce((sum, entry) => sum + entry.conditionEvidence.viewModelConditions, 0),
    totalNumberComparators: entries.reduce((sum, entry) => sum + entry.conditionEvidence.numberComparators, 0),
    totalBooleanComparators: entries.reduce((sum, entry) => sum + entry.conditionEvidence.booleanComparators, 0),
    entries,
  };
}

const schemaContract = await verifyBoundarySchemaContract();
const staticBoundaries = await scanStaticBoundaries();
const staticBySample = new Map(staticBoundaries.entries.map((entry) => [entry.sample, entry]));

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

  const provenHints = staticBySample.get(sample.name)?.hints ?? [];
  const guidedActions = prioritizeBoundaryActions(sample.actions, provenHints);
  const actionCorpusChanged =
    guidedActions.map(actionSignature).join("\n") !== sample.actions.map(actionSignature).join("\n");
  let guided = cached;
  let guidedRunExecuted = false;
  if (actionCorpusChanged) {
    guidedRunExecuted = true;
    guided = await exploreBoundedBfs(
      new RiveCliBackend({ ...backendOptions, cachePrefixes: true }),
      { ...exploreOptions, actions: guidedActions }
    );
  }

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
    boundaryExperiment: {
      provenHints,
      actionCorpusChanged,
      guidedRunExecuted,
      baselineStateSignatures: cached.coverage.observedStateSignatures.length,
      guidedStateSignatures: guided.coverage.observedStateSignatures.length,
      baselineTransitions: cached.coverage.observedTransitions.length,
      guidedTransitions: guided.coverage.observedTransitions.length,
      baselineFailures: cached.failures.length,
      guidedFailures: guided.failures.length,
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
  schemaVersion: 4,
  generatedAt: new Date().toISOString(),
  corpus: "official-rive-cli-bundled-samples-v1",
  source: "official-rive-cli-samples",
  schemaContract,
  staticBoundaries,
  samples: results,
  totals: {
    samples: results.length,
    responsiveSamples,
    nondeterministicSequences,
    explorerFailures: results.reduce((sum, result) => sum + result.explorerFailures, 0),
    boundaryGuidedFailures: results.reduce((sum, result) => sum + result.boundaryExperiment.guidedFailures, 0),
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
