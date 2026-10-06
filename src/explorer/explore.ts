import type {
  Action,
  ExplorationBackend,
  ExplorationCoverage,
  ExplorationMetrics,
  ExecutionTrace,
  StateObservation,
  StaticStateGraph,
} from "./types.js";
import type { Invariant, InvariantViolation } from "./invariants.js";
import { evaluateInvariants } from "./invariants.js";
import { actionSignature, stateSignature } from "../stateSpace/signature.js";
import { proveStaticallyUnreachable } from "../stateSpace/coverage.js";

export interface ExplorationFailure {
  kind: "invariant-violation" | "runtime-error";
  sequence: Action[];
  stepIndex: number;
  observation?: StateObservation;
  violation?: InvariantViolation;
  error?: string;
}

export interface ExploreOptions {
  actions: readonly Action[];
  maxDepth: number;
  maxSequences: number;
  invariants?: readonly Invariant[];
  expectedStateLabels?: readonly string[];
  staticGraph?: StaticStateGraph;
}

export interface ExploreResult {
  coverage: ExplorationCoverage;
  failures: ExplorationFailure[];
  metrics: ExplorationMetrics;
}

function activeLabels(observation: StateObservation | undefined): string[] {
  return observation?.activeStates ?? [];
}

export function boundedBfsSequences(actions: readonly Action[], maxDepth: number): Action[][] {
  const sequences: Action[][] = [];
  let level: Action[][] = [[]];
  for (let depth = 1; depth <= maxDepth; depth++) {
    const next: Action[][] = [];
    for (const prefix of level) {
      for (const action of actions) {
        const sequence = [...prefix, action];
        sequences.push(sequence);
        next.push(sequence);
      }
    }
    level = next;
  }
  return sequences;
}

function collectTrace(
  sequence: readonly Action[],
  trace: ExecutionTrace,
  invariants: readonly Invariant[],
  stateSignatures: Map<string, StateObservation>,
  stateLabels: Set<string>,
  transitions: Map<string, { fromSignature: string; action: Action; toSignature: string }>,
  failures: Map<string, ExplorationFailure>
): number {
  let previous = trace.initial;
  let actionsExecuted = 0;
  const initialSig = stateSignature(previous);
  stateSignatures.set(initialSig, previous);
  for (const label of activeLabels(previous)) stateLabels.add(label);

  for (let stepIndex = 0; stepIndex < trace.steps.length; stepIndex++) {
    const step = trace.steps[stepIndex];
    actionsExecuted++;
    if (step.error || !step.observation) {
      const failureSequence = sequence.slice(0, stepIndex + 1);
      const key = `runtime-error:${step.error ?? "missing observation"}:${actionSignature(step.action)}`;
      if (!failures.has(key)) {
        failures.set(key, {
          kind: "runtime-error",
          sequence: [...failureSequence],
          stepIndex,
          observation: previous,
          error: step.error ?? "backend returned no observation",
        });
      }
      break;
    }

    const current = step.observation;
    const fromSignature = stateSignature(previous);
    const toSignature = stateSignature(current);
    stateSignatures.set(toSignature, current);
    for (const label of activeLabels(current)) stateLabels.add(label);
    const transition = { fromSignature, action: step.action, toSignature };
    transitions.set(`${fromSignature}\u0000${actionSignature(step.action)}\u0000${toSignature}`, transition);

    for (const violation of evaluateInvariants(invariants, current)) {
      const key = `${violation.invariantId}\u0000${toSignature}`;
      if (!failures.has(key)) {
        failures.set(key, {
          kind: "invariant-violation",
          sequence: sequence.slice(0, stepIndex + 1),
          stepIndex,
          observation: current,
          violation,
        });
      }
    }
    previous = current;
  }
  return actionsExecuted;
}

export async function exploreActionSequences(
  backend: ExplorationBackend,
  options: ExploreOptions,
  plannedSequences: readonly (readonly Action[])[]
): Promise<ExploreResult> {
  if (!Number.isInteger(options.maxDepth) || options.maxDepth < 0) throw new Error("maxDepth must be a non-negative integer");
  if (!Number.isInteger(options.maxSequences) || options.maxSequences < 0) throw new Error("maxSequences must be a non-negative integer");

  const allSequences = plannedSequences
    .filter((sequence) => sequence.length <= options.maxDepth)
    .map((sequence) => [...sequence])
    .sort((a, b) => a.length - b.length);
  const stateSignatures = new Map<string, StateObservation>();
  const stateLabels = new Set<string>();
  const transitions = new Map<string, { fromSignature: string; action: Action; toSignature: string }>();
  const failures = new Map<string, ExplorationFailure>();
  const invariants = options.invariants ?? [];

  let sequencesExecuted = 0;
  let actionsExecuted = 0;
  let backendCost = 0;
  let maxDepthExplored = 0;

  // Execute the empty sequence once so the authored/rest state is part of coverage.
  if (options.maxSequences > 0) {
    const initialTrace = await backend.execute([]);
    sequencesExecuted++;
    backendCost += initialTrace.cost ?? 0;
    collectTrace([], initialTrace, invariants, stateSignatures, stateLabels, transitions, failures);
    const initialSig = stateSignature(initialTrace.initial);
    stateSignatures.set(initialSig, initialTrace.initial);
    for (const label of activeLabels(initialTrace.initial)) stateLabels.add(label);
    for (const violation of evaluateInvariants(invariants, initialTrace.initial)) {
      const key = `${violation.invariantId}\u0000${initialSig}`;
      failures.set(key, { kind: "invariant-violation", sequence: [], stepIndex: -1, observation: initialTrace.initial, violation });
    }
  }

  for (const sequence of allSequences) {
    if (sequencesExecuted >= options.maxSequences) break;
    const trace = await backend.execute(sequence);
    sequencesExecuted++;
    backendCost += trace.cost ?? 0;
    maxDepthExplored = Math.max(maxDepthExplored, sequence.length);
    actionsExecuted += collectTrace(sequence, trace, invariants, stateSignatures, stateLabels, transitions, failures);
  }

  const expected = new Set(options.expectedStateLabels ?? []);
  const notReached = [...expected].filter((label) => !stateLabels.has(label)).sort();
  const budgetExhausted = allSequences.length + 1 > options.maxSequences;

  return {
    coverage: {
      observedStateSignatures: [...stateSignatures.keys()],
      observedStateLabels: [...stateLabels].sort(),
      observedTransitions: [...transitions.values()],
      notReachedWithinExplorationBudget: notReached,
      staticallyUnreachable: proveStaticallyUnreachable(options.staticGraph),
    },
    failures: [...failures.values()],
    metrics: {
      sequencesExecuted,
      actionsExecuted,
      backendCost,
      maxDepthExplored,
      budgetExhausted,
    },
  };
}


export function exploreBoundedBfs(backend: ExplorationBackend, options: ExploreOptions): Promise<ExploreResult> {
  return exploreActionSequences(backend, options, boundedBfsSequences(options.actions, options.maxDepth));
}
