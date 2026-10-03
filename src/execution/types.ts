export type ProjectRef =
  | { kind: "riv"; path: string }
  | { kind: "directory"; path: string };

export type ScenarioStep =
  | { type: "data"; path: string; value: unknown }
  | { type: "pointer"; action: string; x: number; y: number }
  | { type: "key"; key: string }
  | { type: "advance"; ms: number };

export interface ScenarioTarget {
  artboard?: string;
  animation?: string;
  stateMachine?: string;
}

export interface Scenario {
  id?: string;
  name?: string;
  target?: ScenarioTarget;
  viewport?: { width: number; height: number };
  steps: ScenarioStep[];
  capture?: {
    screenshot?: boolean;
    dataSnapshot?: boolean;
  };
}

export interface Diagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  source?: string;
  details?: unknown;
}

export interface BackendCapabilities {
  projectKinds: ProjectRef["kind"][];
  scenarioSteps: Record<ScenarioStep["type"], boolean>;
  verify: boolean;
  inspect: boolean;
  screenshot: boolean;
  dataSnapshot: boolean;
}

export interface BackendIdentity {
  id: string;
  name: string;
  version: string;
  runtimeVersion?: string;
  capabilities: BackendCapabilities;
}

export interface VerifyResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  elapsedMs: number;
  raw?: unknown;
}

export interface InspectResult {
  ok: boolean;
  summary: {
    artboardCount?: number;
    artboards?: Array<{
      name?: string;
      animationCount?: number;
      stateMachineCount?: number;
    }>;
    objectCounts?: Record<string, number>;
    problems?: unknown[];
  };
  diagnostics: Diagnostic[];
  elapsedMs: number;
  raw?: unknown;
}

export interface ScenarioStepOutcome {
  index: number;
  step: ScenarioStep;
  status: "applied" | "unsupported" | "failed";
  detail?: string;
}

export interface ExecutionArtifact {
  kind: "screenshot" | "data-snapshot" | "other";
  path: string;
  sha256: string;
  bytes: number;
  mediaType?: string;
}

export interface DataSnapshot {
  path?: string;
  sha256: string;
  value: unknown;
}

export interface ExecutionResult {
  ok: boolean;
  backend: BackendIdentity;
  eventSequence: ScenarioStepOutcome[];
  unsupported: string[];
  diagnostics: Diagnostic[];
  artifacts: ExecutionArtifact[];
  dataSnapshots: DataSnapshot[];
  performance: {
    elapsedMs: number;
    backendReported?: Record<string, number>;
  };
  raw?: unknown;
}
