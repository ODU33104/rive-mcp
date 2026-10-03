export const CORPUS_REGISTRY_SCHEMA = "rive-mcp.corpus-registry/v1" as const;
export const CORPUS_CASE_SCHEMA = "rive-mcp.corpus-case/v1" as const;
export const CORPUS_EVIDENCE_SCHEMA = "rive-mcp.corpus-evidence/v1" as const;
export const CORPUS_HISTORY_SCHEMA = "rive-mcp.corpus-history/v1" as const;
export const CORPUS_LINK_SCHEMA = "rive-mcp.corpus-link/v1" as const;

export type CorpusCaseKind =
  | "failure"
  | "differential"
  | "contract-observation"
  | "causal-observation";

export type FixtureOriginKind =
  | "synthetic-regression"
  | "synthetic-mechanism-proof"
  | "official-sample"
  | "qualified-real-fixture"
  | "user-provided"
  | "unknown";

export type OriginReality = "synthetic" | "real" | "unknown";

export type DefectQualification =
  | "synthetic-fixture"
  | "qualified-real-defect"
  | "observation-only"
  | "unqualified";

export interface CorpusOrigin {
  kind: FixtureOriginKind;
  reality: OriginReality;
  defectQualification: DefectQualification;
  sourceRef?: string;
}

export interface CorpusSubjectIdentity {
  artifactHash?: string;
  sourceHash?: string;
  scenarioHash?: string;
  executionArtifactHash?: string;
  scopeKey?: string;
}

export interface CorpusExecutionParticipant {
  role?: string;
  backendName?: string;
  backendVersion?: string;
  runtimeName?: string;
  runtimeVersion?: string;
}

export type CorpusEvidenceSourceKind =
  | "failure-record"
  | "differential-corpus"
  | "evidence-manifest"
  | "runtime-contract"
  | "static-provenance"
  | "observed-trace"
  | "causal-ambiguity"
  | "external";

export interface CorpusEvidenceLocator {
  path?: string;
  uri?: string;
  ref?: string;
}

export interface CorpusEvidenceInput {
  sourceKind: CorpusEvidenceSourceKind;
  sourceSchemaVersion: string;
  reproducibilityKey: string;
  contentHash?: string;
  upstreamEvidenceId?: string;
  locator?: CorpusEvidenceLocator;
}

export interface CorpusEvidenceRecordV1 {
  schemaVersion: typeof CORPUS_EVIDENCE_SCHEMA;
  evidenceId: string;
  sourceKind: CorpusEvidenceSourceKind;
  sourceSchemaVersion: string;
  reproducibilityKey: string;
  contentHash?: string;
  upstreamEvidenceId?: string;
  locator?: CorpusEvidenceLocator;
  registeredAt: string;
}

export type CorpusHistoryStatus =
  | "observed"
  | "reproduced"
  | "not-reproduced"
  | "fixed"
  | "unsupported"
  | "inconclusive";

export interface CorpusHistoryInput {
  observedAt: string;
  status: CorpusHistoryStatus;
  participants?: CorpusExecutionParticipant[];
  scenarioHash?: string;
  executionArtifactHash?: string;
  fixedVersion?: string;
  note?: string;
}

export interface CorpusHistoryEntryV1 {
  schemaVersion: typeof CORPUS_HISTORY_SCHEMA;
  historyId: string;
  caseId: string;
  observedAt: string;
  status: CorpusHistoryStatus;
  participants: CorpusExecutionParticipant[];
  evidenceIds: string[];
  scenarioHash?: string;
  executionArtifactHash?: string;
  fixedVersion?: string;
  note?: string;
}

export interface CorpusCaseRecordV1 {
  schemaVersion: typeof CORPUS_CASE_SCHEMA;
  caseId: string;
  caseKind: CorpusCaseKind;
  logicalIdentityHash: string;
  logicalIdentity: Record<string, unknown>;
  subject: CorpusSubjectIdentity;
  origin: CorpusOrigin;
  upstreamCaseIds: string[];
  evidenceIds: string[];
  historyIds: string[];
  relatedCaseIds: string[];
  firstSeen: string;
  lastReproduced?: string;
  fixedVersion?: string;
}

export interface CorpusLinkRecordV1 {
  schemaVersion: typeof CORPUS_LINK_SCHEMA;
  linkId: string;
  relation: string;
  caseIds: [string, string];
  createdAt: string;
}

export interface CorpusRegistryMetaV1 {
  schemaVersion: typeof CORPUS_REGISTRY_SCHEMA;
  createdAt: string;
}

export interface CorpusRegistration {
  caseKind: CorpusCaseKind;
  logicalIdentity: Record<string, unknown>;
  subject: CorpusSubjectIdentity;
  origin: CorpusOrigin;
  upstreamCaseIds?: string[];
  evidence: CorpusEvidenceInput[];
  history: CorpusHistoryInput;
}

export interface CorpusRegistrationResult {
  caseId: string;
  evidenceIds: string[];
  historyId: string;
  caseCreated: boolean;
  evidenceCreated: number;
  historyCreated: boolean;
}

export interface CorpusRegistryMetrics {
  logicalCases: number;
  physicalEvidenceRecords: number;
  duplicateLogicalCases: number;
  historyEntries: number;
  ambiguousOrigins: number;
  unresolvedReferences: number;
}
