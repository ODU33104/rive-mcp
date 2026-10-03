import { corpusHash } from "./identity.js";
import { makeCorpusOrigin } from "./origin.js";
import type {
  CorpusEvidenceInput,
  CorpusExecutionParticipant,
  CorpusHistoryStatus,
  CorpusRegistration,
  DefectQualification,
  FixtureOriginKind,
} from "./types.js";

type AnyRecord = Record<string, any>;

export interface AdapterOptions {
  fixtureOrigin?: FixtureOriginKind;
  defectQualification?: DefectQualification;
  sourceRef?: string;
  evidenceLocator?: { path?: string; uri?: string; ref?: string };
  observedAt?: string;
  status?: CorpusHistoryStatus;
  fixedVersion?: string;
  sourceHash?: string;
  scenarioHash?: string;
}

function timestamp(value: unknown, fallback?: string): string {
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return value;
  if (fallback && Number.isFinite(Date.parse(fallback))) return fallback;
  throw new Error("Adapter input needs an explicit observed/discovered timestamp.");
}

function versionString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function participant(input: {
  role?: string;
  backendName?: unknown;
  backendVersion?: unknown;
  runtimeName?: unknown;
  runtimeVersion?: unknown;
}): CorpusExecutionParticipant {
  return {
    role: input.role,
    backendName: versionString(input.backendName),
    backendVersion: versionString(input.backendVersion),
    runtimeName: versionString(input.runtimeName),
    runtimeVersion: versionString(input.runtimeVersion),
  };
}

function failureFixtureOrigin(record: AnyRecord, options: AdapterOptions): FixtureOriginKind {
  const upstreamOrigin = record.origin;
  if (upstreamOrigin === "synthetic-regression") {
    if (
      options.fixtureOrigin !== undefined &&
      options.fixtureOrigin !== "synthetic-regression"
    ) {
      throw new Error(
        "A #20 synthetic-regression failure cannot be relabeled as non-synthetic."
      );
    }
    return "synthetic-regression";
  }

  if (
    upstreamOrigin === "real" &&
    (options.fixtureOrigin === "synthetic-regression" ||
      options.fixtureOrigin === "synthetic-mechanism-proof")
  ) {
    throw new Error("A #20 real failure cannot be relabeled as synthetic.");
  }

  // #20 "real" means executed against a real artifact/runtime; it does not prove
  // qualified-real-fixture vs official-sample vs user-provided.
  return options.fixtureOrigin ?? "unknown";
}

function failureReproducibilityKey(record: AnyRecord): string {
  return corpusHash({
    failureId: record.failureId,
    artifactHash: record.artifactHash,
    tool: record.tool,
    runtime: record.runtime,
    minimalSequence: record.minimalReproduction?.sequence,
    expectedInvariant: record.expectedInvariant,
    observedResult: record.observedResult,
    evidence: {
      data: record.evidence?.data,
      events: record.evidence?.events,
    },
  });
}

export function adaptFailureRecord(
  record: AnyRecord,
  options: AdapterOptions = {}
): CorpusRegistration {
  if (record.schemaVersion !== 1) {
    throw new Error("Unsupported FailureRecord schemaVersion.");
  }
  if (typeof record.artifactHash !== "string") {
    throw new Error("FailureRecord.artifactHash is required.");
  }
  const upstreamFailureId =
    typeof record.failureId === "string"
      ? record.failureId
      : corpusHash({
          artifactHash: record.artifactHash,
          invariantId: record.expectedInvariant?.id,
          minimalSequence: record.minimalReproduction?.sequence,
        });

  const originKind = failureFixtureOrigin(record, options);
  const origin = makeCorpusOrigin(originKind, {
    defectQualification:
      originKind === "qualified-real-fixture"
        ? options.defectQualification ?? "qualified-real-defect"
        : options.defectQualification,
    sourceRef: options.sourceRef,
  });

  const participants = [
    participant({
      role: "explorer",
      backendName: record.tool?.name,
      backendVersion: record.tool?.version,
      runtimeName: record.runtime?.name,
      runtimeVersion: record.runtime?.version,
    }),
  ];

  const scenarioHash =
    options.scenarioHash ??
    corpusHash({
      scenario: record.scenario,
      inputSequence: record.minimalReproduction?.sequence,
    });

  const evidence: CorpusEvidenceInput = {
    sourceKind: "failure-record",
    sourceSchemaVersion: "FailureRecord/v1",
    reproducibilityKey: failureReproducibilityKey(record),
    upstreamEvidenceId:
      typeof record.failureId === "string" ? record.failureId : undefined,
    locator: options.evidenceLocator,
  };

  return {
    caseKind: "failure",
    logicalIdentity: {
      upstreamFailureId,
      artifactHash: record.artifactHash,
    },
    subject: {
      artifactHash: record.artifactHash,
      sourceHash: options.sourceHash,
      scenarioHash,
    },
    origin,
    upstreamCaseIds: [upstreamFailureId],
    evidence: [evidence],
    history: {
      observedAt: timestamp(record.discoveredAt, options.observedAt),
      status: options.status ?? "reproduced",
      participants,
      scenarioHash,
      fixedVersion: options.fixedVersion ?? versionString(record.fixedVersion),
    },
  };
}

function differentialBackendKey(backend: AnyRecord): string {
  return (
    versionString(backend.id) ??
    versionString(backend.name) ??
    "unknown-backend"
  );
}

export function adaptDifferentialCorpus(
  entry: AnyRecord,
  options: AdapterOptions = {}
): CorpusRegistration {
  if (entry.schemaVersion !== "rive-mcp.differential-corpus/v1") {
    throw new Error("Unsupported Differential Corpus schemaVersion.");
  }
  const result = entry.result;
  if (!result || result.schemaVersion !== "rive-mcp.differential-result/v1") {
    throw new Error("Differential Corpus result is missing or unsupported.");
  }
  if (
    typeof result.artifactHash !== "string" ||
    typeof result.scenarioHash !== "string"
  ) {
    throw new Error("Differential result artifactHash/scenarioHash are required.");
  }

  const left = result.leftBackend ?? {};
  const right = result.rightBackend ?? {};
  const backendPair = [differentialBackendKey(left), differentialBackendKey(right)].sort();
  const executionArtifactHash =
    versionString(entry.compiledArtifactHash) ??
    versionString(entry.observations?.left?.executionArtifactHash) ??
    versionString(entry.observations?.right?.executionArtifactHash);

  const participants = [
    participant({
      role: "left",
      backendName: left.name ?? left.id,
      backendVersion: left.backendVersion,
      runtimeVersion: left.runtimeVersion,
    }),
    participant({
      role: "right",
      backendName: right.name ?? right.id,
      backendVersion: right.backendVersion,
      runtimeVersion: right.runtimeVersion,
    }),
  ];

  const origin = makeCorpusOrigin(options.fixtureOrigin ?? "unknown", {
    defectQualification: options.defectQualification,
    sourceRef: options.sourceRef,
  });

  const evidence: CorpusEvidenceInput = {
    sourceKind: "differential-corpus",
    sourceSchemaVersion: "rive-mcp.differential-corpus/v1",
    reproducibilityKey:
      versionString(result.deterministicKey) ??
      corpusHash({
        result,
        executionArtifactHash,
      }),
    upstreamEvidenceId: versionString(result.deterministicKey),
    locator: options.evidenceLocator,
  };

  return {
    caseKind: "differential",
    logicalIdentity: {
      artifactHash: result.artifactHash,
      scenarioHash: result.scenarioHash,
      backendPair,
    },
    subject: {
      artifactHash: result.artifactHash,
      sourceHash: versionString(entry.sourceArtifactHash) ?? options.sourceHash,
      scenarioHash: result.scenarioHash,
      executionArtifactHash,
    },
    origin,
    evidence: [evidence],
    history: {
      observedAt: timestamp(entry.observedAt, options.observedAt),
      status: options.status ?? "observed",
      participants,
      scenarioHash: result.scenarioHash,
      executionArtifactHash,
      fixedVersion: options.fixedVersion,
      note:
        typeof result.classification === "string"
          ? `classification:${result.classification}`
          : undefined,
    },
  };
}

export interface ContractFingerprintObservationInput {
  artifactHash: string;
  sourceHash?: string;
  scopeKey?: string;
  apiFingerprint: string;
  behaviorFingerprint: string;
  observedAt: string;
  backendName?: string;
  backendVersion?: string;
  runtimeName?: string;
  runtimeVersion?: string;
  sourceSchemaVersion?: string;
}

export function adaptContractFingerprintObservation(
  input: ContractFingerprintObservationInput,
  options: AdapterOptions = {}
): CorpusRegistration {
  const origin = makeCorpusOrigin(options.fixtureOrigin ?? "unknown", {
    defectQualification: options.defectQualification,
    sourceRef: options.sourceRef,
  });
  const scopeKey = input.scopeKey ?? "runtime-contract";
  const participants = [
    participant({
      role: "contract-extractor",
      backendName: input.backendName,
      backendVersion: input.backendVersion,
      runtimeName: input.runtimeName,
      runtimeVersion: input.runtimeVersion,
    }),
  ];

  return {
    caseKind: "contract-observation",
    logicalIdentity: {
      artifactHash: input.artifactHash,
      sourceHash: input.sourceHash,
      scopeKey,
    },
    subject: {
      artifactHash: input.artifactHash,
      sourceHash: input.sourceHash,
      scopeKey,
    },
    origin,
    evidence: [{
      sourceKind: "runtime-contract",
      sourceSchemaVersion: input.sourceSchemaVersion ?? "RuntimeContract/v1",
      reproducibilityKey: corpusHash({
        artifactHash: input.artifactHash,
        sourceHash: input.sourceHash,
        scopeKey,
        apiFingerprint: input.apiFingerprint,
        behaviorFingerprint: input.behaviorFingerprint,
        participants,
      }),
      contentHash: corpusHash({
        api: input.apiFingerprint,
        behavior: input.behaviorFingerprint,
      }),
      locator: options.evidenceLocator,
    }],
    history: {
      observedAt: timestamp(input.observedAt, options.observedAt),
      status: options.status ?? "observed",
      participants,
      fixedVersion: options.fixedVersion,
      note: `api=${input.apiFingerprint}; behavior=${input.behaviorFingerprint}`,
    },
  };
}

export interface CausalObservationInput {
  artifactHash?: string;
  sourceHash?: string;
  scenarioHash?: string;
  scopeKey: string;
  observedAt: string;
  evidenceKind: "static-provenance" | "observed-trace" | "causal-ambiguity";
  sourceSchemaVersion: string;
  payloadIdentity: unknown;
  backendName?: string;
  backendVersion?: string;
  runtimeName?: string;
  runtimeVersion?: string;
}

export function adaptCausalObservation(
  input: CausalObservationInput,
  options: AdapterOptions = {}
): CorpusRegistration {
  if (!input.artifactHash && !input.sourceHash) {
    throw new Error("Causal observation requires artifactHash or sourceHash.");
  }
  const origin = makeCorpusOrigin(options.fixtureOrigin ?? "unknown", {
    defectQualification: options.defectQualification,
    sourceRef: options.sourceRef,
  });
  const participants = [
    participant({
      role: "causal-observer",
      backendName: input.backendName,
      backendVersion: input.backendVersion,
      runtimeName: input.runtimeName,
      runtimeVersion: input.runtimeVersion,
    }),
  ];

  return {
    caseKind: "causal-observation",
    logicalIdentity: {
      artifactHash: input.artifactHash,
      sourceHash: input.sourceHash,
      scenarioHash: input.scenarioHash,
      scopeKey: input.scopeKey,
      evidenceKind: input.evidenceKind,
    },
    subject: {
      artifactHash: input.artifactHash,
      sourceHash: input.sourceHash,
      scenarioHash: input.scenarioHash,
      scopeKey: input.scopeKey,
    },
    origin,
    evidence: [{
      sourceKind: input.evidenceKind,
      sourceSchemaVersion: input.sourceSchemaVersion,
      reproducibilityKey: corpusHash({
        payloadIdentity: input.payloadIdentity,
        participants,
      }),
      contentHash: corpusHash(input.payloadIdentity),
      locator: options.evidenceLocator,
    }],
    history: {
      observedAt: timestamp(input.observedAt, options.observedAt),
      status: options.status ?? "observed",
      participants,
      scenarioHash: input.scenarioHash,
      fixedVersion: options.fixedVersion,
    },
  };
}

export function evidenceManifestReference(
  manifest: AnyRecord,
  locator?: { path?: string; uri?: string; ref?: string }
): CorpusEvidenceInput {
  if (manifest.schemaVersion !== "rive-mcp.evidence/v1") {
    throw new Error("Unsupported Evidence Manifest schemaVersion.");
  }
  if (typeof manifest.reproducibilityKey !== "string") {
    throw new Error("Evidence Manifest reproducibilityKey is required.");
  }
  return {
    sourceKind: "evidence-manifest",
    sourceSchemaVersion: "rive-mcp.evidence/v1",
    reproducibilityKey: manifest.reproducibilityKey,
    contentHash:
      typeof manifest.manifestHash === "string" ? manifest.manifestHash : undefined,
    upstreamEvidenceId:
      typeof manifest.manifestHash === "string" ? manifest.manifestHash : undefined,
    locator,
  };
}
