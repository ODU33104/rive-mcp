import type { BackendIdentity } from "../execution/types.js";

export type ObservationCheckpointKind =
  | "verify"
  | "inspect"
  | "step"
  | "capture"
  | "result";

export type ObservationCheckpointStatus =
  | "pass"
  | "fail"
  | "unsupported"
  | "missing";

export interface NormalizedCheckpoint {
  id: string;
  kind: ObservationCheckpointKind;
  status: ObservationCheckpointStatus;
  valueHash?: string;
  summary?: unknown;
  diagnosticCodes: string[];
}

export interface BackendObservationV1 {
  schemaVersion: "rive-mcp.differential-observation/v1";
  artifactHash: string;
  executionArtifactHash?: string;
  scenarioHash: string;
  backend: {
    id: string;
    name: string;
    backendVersion: string;
    runtimeVersion: string | null;
  };
  checkpoints: NormalizedCheckpoint[];
  unsupported: string[];
  deterministicKey: string;
}

export type DifferentialClassification =
  | "equivalent"
  | "divergent"
  | "unsupported"
  | "inconclusive";

export interface CheckpointDifference {
  checkpointId: string;
  kind: "status" | "value" | "unsupported" | "missing";
  leftStatus?: ObservationCheckpointStatus;
  rightStatus?: ObservationCheckpointStatus;
  leftValueHash?: string;
  rightValueHash?: string;
  detail: string;
}

export interface DifferentialResultV1 {
  schemaVersion: "rive-mcp.differential-result/v1";
  artifactHash: string;
  scenarioHash: string;
  leftBackend: BackendObservationV1["backend"];
  rightBackend: BackendObservationV1["backend"];
  classification: DifferentialClassification;
  firstDivergentCheckpoint?: CheckpointDifference;
  differences: CheckpointDifference[];
  deterministicKey: string;
}

export interface DifferentialCorpusEntryV1 {
  schemaVersion: "rive-mcp.differential-corpus/v1";
  observedAt: string;
  result: DifferentialResultV1;
}

export function normalizeBackendIdentity(identity: BackendIdentity): BackendObservationV1["backend"] {
  return {
    id: identity.id,
    name: identity.name,
    backendVersion: identity.version,
    runtimeVersion: identity.runtimeVersion ?? null,
  };
}
