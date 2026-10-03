import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  adaptCausalObservation,
  adaptContractFingerprintObservation,
  adaptDifferentialCorpus,
  adaptFailureRecord,
} from "../dist/corpus/adapters.js";
import { JsonCorpusRegistry } from "../dist/corpus/registry.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureDir = join(root, "test", "fixtures", "corpus");
const load = (name) =>
  JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));

const syntheticFailure = load("failure-synthetic-v1.json");
const realFailure = load("failure-real-unqualified-v1.json");
const differential = load("differential-v1.json");
const contract = load("contract-observation-v1.json");
const causal = load("causal-observation-v1.json");

const workspace = mkdtempSync(join(tmpdir(), "rive-corpus-registry-"));
const registry = new JsonCorpusRegistry(
  workspace,
  "2026-10-03T00:00:00.000Z"
);

function snapshot(label) {
  const metrics = registry.metrics();
  console.log(JSON.stringify({
    iteration: label,
    "Logical cases": metrics.logicalCases,
    "Physical evidence records": metrics.physicalEvidenceRecords,
    "Duplicate logical cases": metrics.duplicateLogicalCases,
    "History entries": metrics.historyEntries,
    "Ambiguous origins": metrics.ambiguousOrigins,
    "Unresolved references": metrics.unresolvedReferences,
  }));
  return metrics;
}

// Iteration 1: fixed corpus shapes from #20/#25/#18 plus a #24-style causal observation.
const synthetic = registry.register(adaptFailureRecord(syntheticFailure, {
  evidenceLocator: { path: "/tmp/run-a/failure.json" },
}));
const unqualifiedReal = registry.register(adaptFailureRecord(realFailure));
const diff = registry.register(adaptDifferentialCorpus(differential, {
  fixtureOrigin: "synthetic-mechanism-proof",
  evidenceLocator: { path: "/tmp/run-a/differential.json" },
  status: "reproduced",
}));
const contractResult = registry.register(adaptContractFingerprintObservation(contract, {
  fixtureOrigin: "official-sample",
}));
const causalResult = registry.register(adaptCausalObservation(causal, {
  fixtureOrigin: "user-provided",
  defectQualification: "observation-only",
}));

let metrics = snapshot("1-baseline-index");
assert.deepEqual(metrics, {
  logicalCases: 5,
  physicalEvidenceRecords: 5,
  duplicateLogicalCases: 0,
  historyEntries: 5,
  ambiguousOrigins: 1,
  unresolvedReferences: 0,
});

// Synthetic safety: the #20 source origin cannot be upgraded into a real defect.
assert.throws(
  () => registry.register(adaptFailureRecord(syntheticFailure, {
    fixtureOrigin: "qualified-real-fixture",
    defectQualification: "qualified-real-defect",
  })),
  /synthetic-regression/
);

// Iteration 2: explicitly qualify the ambiguous #20 "real" source.
// This refines metadata on the same logical case; it does not create evidence/history duplicates.
const qualifiedReal = registry.register(adaptFailureRecord(realFailure, {
  fixtureOrigin: "qualified-real-fixture",
  defectQualification: "qualified-real-defect",
  sourceRef: "qualification:test-fixture",
}));
assert.equal(qualifiedReal.caseId, unqualifiedReal.caseId);
assert.equal(qualifiedReal.caseCreated, false);
assert.equal(qualifiedReal.evidenceCreated, 0);
assert.equal(qualifiedReal.historyCreated, false);

metrics = snapshot("2-origin-qualified");
assert.equal(metrics.logicalCases, 5);
assert.equal(metrics.physicalEvidenceRecords, 5);
assert.equal(metrics.historyEntries, 5);
assert.equal(metrics.ambiguousOrigins, 0);
assert.equal(
  registry.getCase(qualifiedReal.caseId)?.origin.defectQualification,
  "qualified-real-defect"
);

// Iteration 3: same logical differential across a new runtime/backend version.
// Version is history, not logical case identity.
const differentialNext = structuredClone(differential);
differentialNext.observedAt = "2026-10-03T00:10:00.000Z";
differentialNext.result.leftBackend.backendVersion = "1.4.0";
differentialNext.result.classification = "equivalent";
differentialNext.result.firstDivergentCheckpoint = undefined;
differentialNext.result.deterministicKey =
  "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
const diffNext = registry.register(adaptDifferentialCorpus(differentialNext, {
  fixtureOrigin: "synthetic-mechanism-proof",
  status: "not-reproduced",
  fixedVersion: "1.4.0",
}));
assert.equal(diffNext.caseId, diff.caseId);
assert.equal(diffNext.caseCreated, false);
assert.equal(diffNext.evidenceCreated, 1);
assert.equal(diffNext.historyCreated, true);

metrics = snapshot("3-version-history");
assert.equal(metrics.logicalCases, 5);
assert.equal(metrics.physicalEvidenceRecords, 6);
assert.equal(metrics.historyEntries, 6);
assert.equal(metrics.duplicateLogicalCases, 0);
assert.equal(registry.getHistory(diff.caseId).length, 2);
assert.equal(registry.getCase(diff.caseId)?.fixedVersion, "1.4.0");

// Iteration 4: a later rerun of identical evidence changes neither reproducibility
// identity nor version history. Temp paths and wall-clock timestamps stay outside IDs.
const syntheticLater = structuredClone(syntheticFailure);
syntheticLater.discoveredAt = "2026-10-03T00:20:00.000Z";
syntheticLater.artifact.path = "/different/machine/tmp/fixture.json";
syntheticLater.evidence.screenshots = ["/different/machine/tmp/frame.png"];
const duplicate = registry.register(adaptFailureRecord(syntheticLater, {
  evidenceLocator: { path: "/different/machine/evidence.json" },
}));
assert.equal(duplicate.caseId, synthetic.caseId);
assert.deepEqual(duplicate.evidenceIds, synthetic.evidenceIds);
assert.equal(duplicate.historyId, synthetic.historyId);
assert.equal(duplicate.caseCreated, false);
assert.equal(duplicate.evidenceCreated, 0);
assert.equal(duplicate.historyCreated, false);
assert.equal(
  registry.getCase(synthetic.caseId)?.lastReproduced,
  "2026-10-03T00:20:00.000Z"
);

const link = registry.linkCases(
  synthetic.caseId,
  diff.caseId,
  "failure-has-differential-evidence",
  "2026-10-03T00:21:00.000Z"
);
assert.ok(link.linkId.startsWith("link_"));
assert.ok(
  registry.getCase(synthetic.caseId)?.relatedCaseIds.includes(diff.caseId)
);
assert.ok(
  registry.getCase(diff.caseId)?.relatedCaseIds.includes(synthetic.caseId)
);

metrics = snapshot("4-dedup-and-linkage");
assert.deepEqual(metrics, {
  logicalCases: 5,
  physicalEvidenceRecords: 6,
  duplicateLogicalCases: 0,
  historyEntries: 6,
  ambiguousOrigins: 0,
  unresolvedReferences: 0,
});

assert.ok(contractResult.caseId.startsWith("case_contract_"));
assert.ok(causalResult.caseId.startsWith("case_causal_"));

console.log(JSON.stringify({
  ok: true,
  cases: {
    syntheticFailure: synthetic.caseId,
    qualifiedRealFailure: qualifiedReal.caseId,
    differential: diff.caseId,
    contract: contractResult.caseId,
    causal: causalResult.caseId,
  },
  finalMetrics: metrics,
}, null, 2));
