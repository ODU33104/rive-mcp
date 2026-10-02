import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exploreBoundedBfs } from "../../dist/explorer/explore.js";
import { RiveCliBackend } from "../../dist/explorer/backends/riveCli.js";
import { runCommand } from "../../dist/explorer/backends/riveCliProcess.js";
import { checkSequenceDeterminism } from "../../dist/explorer/determinism.js";
import { extractNumericBoundaryHints } from "../../dist/fuzz/boundaries.js";
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

function filesWithExtension(root, extension) {
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) out.push(...filesWithExtension(full, extension));
    else if (entry.isFile() && entry.name.endsWith(extension)) out.push(full);
  }
  return out;
}

function compactHints(hints) {
  const seen = new Set();
  const out = [];
  for (const hint of hints) {
    const key = JSON.stringify([hint.path, hint.operator, hint.threshold, hint.source]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hint);
  }
  return out;
}

const STRUCTURAL_KEY = /(condition|operator|comparison|threshold|input|view.?model|property.?path|source.?path)/i;
const STRUCTURAL_TYPE = /(condition|transition|input|view.?model)/i;

function scalarTree(value, depth = 0, maxDepth = 4) {
  if (depth > maxDepth || value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((child) => scalarTree(child, depth + 1, maxDepth));
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (child == null || ["string", "number", "boolean"].includes(typeof child)) out[key] = child;
    else if (key === "children" || key === "enums") out[key] = scalarTree(child, depth + 1, maxDepth);
  }
  return out;
}

function comparatorSubtrees(value, path = "$", out = []) {
  if (value == null || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((child, index) => comparatorSubtrees(child, `${path}[${index}]`, out));
    return out;
  }
  if (value.type === "TransitionPropertyViewModelComparator") {
    out.push({ path, tree: scalarTree(value) });
  }
  for (const [key, child] of Object.entries(value)) comparatorSubtrees(child, `${path}.${key}`, out);
  return out;
}

function structuralPreview(value, path = "$", out = [], limit = 12) {
  if (out.length >= limit || value == null || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length && out.length < limit; index++) {
      structuralPreview(value[index], `${path}[${index}]`, out, limit);
    }
    return out;
  }

  const entries = Object.entries(value);
  const type = typeof value.type === "string" ? value.type : "";
  if (entries.some(([key]) => STRUCTURAL_KEY.test(key)) || STRUCTURAL_TYPE.test(type)) {
    const scalars = {};
    for (const [key, child] of entries) {
      if (child == null || ["string", "number", "boolean"].includes(typeof child)) scalars[key] = child;
    }
    out.push({ path, keys: entries.map(([key]) => key).sort(), scalars });
  }

  for (const [key, child] of entries) {
    if (out.length >= limit) break;
    structuralPreview(child, `${path}.${key}`, out, limit);
  }
  return out;
}

async function staticHintProbe() {
  const entries = [];
  const schemaTypes = [
    "TransitionViewModelCondition",
    "TransitionPropertyViewModelComparator",
    "TransitionPropertyComparator",
    "TransitionComparator",
    "TransitionValueNumberComparator",
    "ViewModelPropertyNumber",
  ];
  const schemas = {};
  for (const type of schemaTypes) {
    const schema = await runCommand(riveCli, ["schema", type, "--json"], {
      cwd: samplesRoot,
      timeoutMs: 30_000,
      env: { ...process.env, RIVE_NO_TUI: "1", TERM: "dumb", RIVE_ANALYTICS: "off" },
    });
    let parsed;
    try {
      parsed = schema.code === 0 ? JSON.parse(schema.stdout) : undefined;
    } catch {
      parsed = undefined;
    }
    schemas[type] = {
      exitCode: schema.code,
      data: parsed,
      error: schema.code === 0 ? undefined : (schema.stderr.trim() || schema.stdout.trim()).slice(0, 1000),
    };
  }
  const sampleNames = readdirSync(samplesRoot)
    .filter((name) => {
      const full = join(samplesRoot, name);
      return statSync(full).isDirectory();
    })
    .sort();

  for (const sampleName of sampleNames) {
    const projectDir = resolve(samplesRoot, sampleName);
    const rmlHints = [];
    for (const file of filesWithExtension(projectDir, ".rml")) {
      const text = readFileSync(file, "utf8");
      for (const hint of extractNumericBoundaryHints(text)) {
        rmlHints.push({
          ...hint,
          source: `rml:${relative(projectDir, file)}:${hint.source}`,
        });
      }
    }

    const inspect = await runCommand(riveCli, ["inspect", projectDir, "--json"], {
      cwd: projectDir,
      timeoutMs: 90_000,
      env: { ...process.env, RIVE_NO_TUI: "1", TERM: "dumb", RIVE_ANALYTICS: "off" },
    });
    let inspectParsed;
    try {
      inspectParsed = inspect.code === 0 ? JSON.parse(inspect.stdout) : undefined;
    } catch {
      inspectParsed = undefined;
    }
    const inspectHints = inspect.code === 0
      ? extractNumericBoundaryHints(inspect.stdout).map((hint) => ({
          ...hint,
          source: `inspect:${hint.source}`,
        }))
      : [];
    const structure = inspectParsed ? structuralPreview(inspectParsed) : [];
    const viewModelComparators = inspectParsed ? comparatorSubtrees(inspectParsed) : [];
    const topLevelKeys = inspectParsed && typeof inspectParsed === "object" && !Array.isArray(inspectParsed)
      ? Object.keys(inspectParsed).sort()
      : [];

    if (rmlHints.length || inspectHints.length || inspect.code !== 0 || structure.length) {
      entries.push({
        sample: sampleName,
        inspectExitCode: inspect.code,
        inspectError: inspect.code === 0 ? undefined : (inspect.stderr.trim() || inspect.stdout.trim()).slice(0, 1000),
        topLevelKeys,
        rmlHints: compactHints(rmlHints),
        inspectHints: compactHints(inspectHints),
        viewModelComparators,
        structure,
      });
    }
  }

  return {
    samplesScanned: sampleNames.length,
    samplesWithCandidateHints: entries.filter((entry) => entry.rmlHints.length || entry.inspectHints.length).length,
    schemas,
    entries,
  };
}

const staticProbe = await staticHintProbe();
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
  schemaVersion: 3,
  generatedAt: new Date().toISOString(),
  corpus: "official-rive-cli-bundled-samples-v1",
  source: "official-rive-cli-samples",
  staticProbe,
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
