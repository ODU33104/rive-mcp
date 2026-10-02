export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type PointerPhase = "move" | "down" | "up" | "exit" | "click" | "drag";
export type KeyPhase = "press" | "down" | "repeat" | "up";
export type KeyModifier = "alt" | "ctrl" | "meta" | "shift";

export type Action =
  | {
      /** Backend-owned data address; adapters may namespace ViewModel, SM input, or global targets. */
      kind: "data-write";
      path: string;
      value: JsonValue;
    }
  | {
      kind: "pointer";
      phase: PointerPhase;
      x: number;
      y: number;
      toX?: number;
      toY?: number;
      steps?: number;
      pointerId?: number;
    }
  | { kind: "key"; key: string; phase?: KeyPhase; modifiers?: KeyModifier[] }
  | { kind: "advance-time"; seconds: number }
  | {
      /** Extension point for interaction surfaces the core does not know about yet. */
      kind: "runtime";
      surface: string;
      operation: string;
      payload?: JsonValue;
    };

export interface EmittedEvent {
  name: string;
  payload?: JsonValue;
}

export interface StateObservation {
  /** Observable runtime state only. Do not infer hidden state. */
  activeStates?: string[];
  /** Relevant bound values selected by the backend/fixture. */
  viewModel?: Record<string, JsonValue>;
  /** Events emitted since the previous observation. */
  events?: EmittedEvent[];
  /** Optional hashes produced by a backend (for example screenshot/frame or data hashes). */
  frameHash?: string;
  dataHash?: string;
  /** Adapter-owned observable metadata. Must not contain guessed internal state. */
  metadata?: Record<string, JsonValue>;
}

export interface TraceStep {
  action: Action;
  observation?: StateObservation;
  error?: string;
  cost?: number;
}

export interface ExecutionTrace {
  initial: StateObservation;
  steps: TraceStep[];
  backend?: { name: string; version?: string };
  runtime?: { name: string; version?: string };
  cost?: number;
}

/**
 * Adapter boundary for Rive CLI, Rive runtimes, fixtures, or future differential backends.
 * The explorer owns sequencing; the backend owns how a sequence is executed/reset.
 */
export interface ExplorationBackend {
  readonly name: string;
  execute(sequence: readonly Action[]): Promise<ExecutionTrace>;
}

export interface StaticStateGraph {
  /** Only true when the adapter can prove the supplied graph is exhaustive for this analysis. */
  complete: boolean;
  states: string[];
  entryStates: string[];
  transitions: Array<{ from: string; to: string }>;
}

export interface ExplorationCoverage {
  observedStateSignatures: string[];
  observedStateLabels: string[];
  observedTransitions: Array<{
    fromSignature: string;
    action: Action;
    toSignature: string;
  }>;
  notReachedWithinExplorationBudget: string[];
  /** Empty unless static reachability is provable from a complete graph. */
  staticallyUnreachable: string[];
}

export interface ExplorationMetrics {
  sequencesExecuted: number;
  actionsExecuted: number;
  backendCost: number;
  maxDepthExplored: number;
  budgetExhausted: boolean;
}
