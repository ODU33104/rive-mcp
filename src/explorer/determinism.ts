import type { Action, ExecutionTrace, ExplorationBackend } from "./types.js";
import { stateSignature, stableJson } from "../stateSpace/signature.js";

export interface DeterminismResult {
  attempts: number;
  uniqueTraceSignatures: string[];
  deterministic: boolean;
  firstDivergentAttempt?: number;
}

function traceSignature(trace: ExecutionTrace): string {
  return stableJson({
    initial: stateSignature(trace.initial),
    steps: trace.steps.map((step) => ({
      action: step.action,
      observation: step.observation ? stateSignature(step.observation) : undefined,
      error: step.error,
    })),
  });
}

export async function checkSequenceDeterminism(
  backendFactory: () => ExplorationBackend,
  sequence: readonly Action[],
  attempts = 3
): Promise<DeterminismResult> {
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error("attempts must be a positive integer");
  const signatures: string[] = [];
  for (let attempt = 0; attempt < attempts; attempt++) {
    const trace = await backendFactory().execute(sequence);
    signatures.push(traceSignature(trace));
  }
  const uniqueTraceSignatures = [...new Set(signatures)];
  const first = signatures[0];
  const firstDivergentAttempt = signatures.findIndex((signature) => signature !== first);
  return {
    attempts,
    uniqueTraceSignatures,
    deterministic: uniqueTraceSignatures.length === 1,
    firstDivergentAttempt: firstDivergentAttempt >= 0 ? firstDivergentAttempt : undefined,
  };
}
