import { revisionHash } from "../revisions/hash.js";
import type {
  Diagnostic,
  ExecutionResult,
  InspectResult,
  Scenario,
  VerifyResult,
} from "../execution/types.js";
import type {
  BackendObservationV1,
  NormalizedCheckpoint,
  ObservationCheckpointStatus,
} from "./types.js";
import { normalizeBackendIdentity } from "./types.js";

export interface NormalizeObservationInput {
  artifactHash: string;
  executionArtifactHash?: string;
  scenario: Scenario;
  verify: VerifyResult;
  inspect: InspectResult;
  execution: ExecutionResult;
}

function diagnosticCodes(diagnostics: Diagnostic[]): string[] {
  return [...new Set(diagnostics.map((item) => item.code))].sort();
}

function unsupportedFromDiagnostics(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((item) => item.code.includes("UNSUPPORTED"));
}

function resultStatus(ok: boolean, diagnostics: Diagnostic[]): ObservationCheckpointStatus {
  if (unsupportedFromDiagnostics(diagnostics)) return "unsupported";
  return ok ? "pass" : "fail";
}

function comparableInspectSummary(summary: InspectResult["summary"]): unknown {
  return {
    artboardCount: summary.artboardCount ?? null,
    artboardNames: (summary.artboards ?? []).map((artboard) => artboard.name ?? null),
  };
}

function inspectEvidenceSummary(summary: InspectResult["summary"]): unknown {
  return {
    artboardCount: summary.artboardCount ?? null,
    artboards: (summary.artboards ?? []).map((artboard) => ({
      name: artboard.name ?? null,
      animationCount: artboard.animationCount ?? null,
      stateMachineCount: artboard.stateMachineCount ?? null,
    })),
  };
}

function stableCheckpoint(checkpoint: Omit<NormalizedCheckpoint, "valueHash"> & { value?: unknown }): NormalizedCheckpoint {
  const { value, ...rest } = checkpoint;
  return {
    ...rest,
    valueHash: value === undefined ? undefined : revisionHash(value),
    summary: value,
  };
}

export function normalizeObservation(input: NormalizeObservationInput): BackendObservationV1 {
  const checkpoints: NormalizedCheckpoint[] = [];

  checkpoints.push(stableCheckpoint({
    id: "verify",
    kind: "verify",
    status: resultStatus(input.verify.ok, input.verify.diagnostics),
    diagnosticCodes: diagnosticCodes(input.verify.diagnostics),
    value: {
      ok: input.verify.ok,
      diagnosticCodes: diagnosticCodes(input.verify.diagnostics),
    },
  }));

  const inspectStatus = resultStatus(input.inspect.ok, input.inspect.diagnostics);
  const inspectComparable = {
    ok: input.inspect.ok,
    summary: comparableInspectSummary(input.inspect.summary),
  };
  checkpoints.push({
    id: "inspect",
    kind: "inspect",
    status: inspectStatus,
    diagnosticCodes: diagnosticCodes(input.inspect.diagnostics),
    valueHash: revisionHash(inspectComparable),
    summary: {
      comparable: inspectComparable,
      evidence: inspectEvidenceSummary(input.inspect.summary),
      diagnosticCodes: diagnosticCodes(input.inspect.diagnostics),
    },
  });

  for (let index = 0; index < input.scenario.steps.length; index++) {
    const outcome = input.execution.eventSequence.find((item) => item.index === index);
    checkpoints.push(stableCheckpoint({
      id: `step:${index}`,
      kind: "step",
      status: outcome?.status === "unsupported"
        ? "unsupported"
        : outcome?.status === "failed"
          ? "fail"
          : outcome?.status === "applied"
            ? "pass"
            : "missing",
      diagnosticCodes: [],
      value: {
        step: input.scenario.steps[index],
        status: outcome?.status ?? "missing",
      },
    }));
  }

  if (input.scenario.capture?.screenshot !== false) {
    const screenshot = input.execution.artifacts.find((artifact) => artifact.kind === "screenshot");
    checkpoints.push(stableCheckpoint({
      id: "capture:screenshot",
      kind: "capture",
      status: screenshot
        ? "pass"
        : input.execution.unsupported.some((item) => item.includes("screenshot"))
          ? "unsupported"
          : "missing",
      diagnosticCodes: [],
      value: screenshot
        ? {
            sha256: screenshot.sha256,
            bytes: screenshot.bytes,
            mediaType: screenshot.mediaType ?? null,
          }
        : undefined,
    }));
  }

  if (input.scenario.capture?.dataSnapshot) {
    const snapshots = input.execution.dataSnapshots.map((item) => ({
      sha256: item.sha256,
      valueHash: revisionHash(item.value),
    }));
    checkpoints.push(stableCheckpoint({
      id: "capture:data",
      kind: "capture",
      status: snapshots.length > 0
        ? "pass"
        : input.execution.unsupported.some((item) => item.includes("data snapshot") || item.includes("dataSnapshot"))
          ? "unsupported"
          : "missing",
      diagnosticCodes: [],
      value: snapshots.length > 0 ? snapshots : undefined,
    }));
  }

  checkpoints.push(stableCheckpoint({
    id: "result",
    kind: "result",
    status: resultStatus(input.execution.ok, input.execution.diagnostics),
    diagnosticCodes: diagnosticCodes(input.execution.diagnostics),
    value: {
      ok: input.execution.ok,
      diagnosticCodes: diagnosticCodes(input.execution.diagnostics),
    },
  }));

  const withoutKey: Omit<BackendObservationV1, "deterministicKey"> = {
    schemaVersion: "rive-mcp.differential-observation/v1",
    artifactHash: input.artifactHash,
    executionArtifactHash: input.executionArtifactHash,
    scenarioHash: revisionHash(input.scenario),
    backend: normalizeBackendIdentity(input.execution.backend),
    checkpoints,
    unsupported: [...input.execution.unsupported].sort(),
  };

  return {
    ...withoutKey,
    deterministicKey: revisionHash(withoutKey),
  };
}
