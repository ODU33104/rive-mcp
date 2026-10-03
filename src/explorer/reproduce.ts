import type { Action, ExplorationBackend } from "./types.js";
import type { Invariant } from "./invariants.js";
import { evaluateInvariant } from "./invariants.js";

export async function reproducesInvariantFailure(
  backend: ExplorationBackend,
  invariant: Invariant,
  sequence: readonly Action[]
): Promise<boolean> {
  const trace = await backend.execute(sequence);
  if (evaluateInvariant(invariant, trace.initial)) return sequence.length === 0;
  for (const step of trace.steps) {
    if (!step.observation || step.error) return false;
    if (evaluateInvariant(invariant, step.observation)) return true;
  }
  return false;
}

export async function reproductionSuccessRate(
  backend: ExplorationBackend,
  invariant: Invariant,
  sequence: readonly Action[],
  attempts = 3
): Promise<{ attempts: number; successes: number; rate: number }> {
  let successes = 0;
  for (let i = 0; i < attempts; i++) {
    if (await reproducesInvariantFailure(backend, invariant, sequence)) successes++;
  }
  return { attempts, successes, rate: attempts === 0 ? 0 : successes / attempts };
}
