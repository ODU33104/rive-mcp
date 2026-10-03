import type { Action } from "../explorer/types.js";
import { actionSignature } from "../stateSpace/signature.js";

export interface NumericBoundaryHint {
  path: string;
  operator: ">" | ">=" | "<" | "<=" | "==" | "!=";
  threshold: number;
  epsilon?: number;
  source?: string;
}

const SIMPLE_NUMERIC_CONDITION = /([A-Za-z_][\w./-]*)\s*(>=|<=|==|!=|>|<)\s*(-?(?:\d+(?:\.\d+)?|\.\d+))/g;

/** Extracts only conditions we can parse without guessing semantics. */
export function extractNumericBoundaryHints(text: string, epsilon = 0.001): NumericBoundaryHint[] {
  const hints: NumericBoundaryHint[] = [];
  for (const match of text.matchAll(SIMPLE_NUMERIC_CONDITION)) {
    hints.push({
      path: match[1],
      operator: match[2] as NumericBoundaryHint["operator"],
      threshold: Number(match[3]),
      epsilon,
      source: match[0],
    });
  }
  return hints;
}

export function actionsForNumericBoundaries(hints: readonly NumericBoundaryHint[]): Action[] {
  const out: Action[] = [];
  const seen = new Set<string>();
  for (const hint of hints) {
    const epsilon = hint.epsilon ?? 0.001;
    for (const value of [hint.threshold - epsilon, hint.threshold, hint.threshold + epsilon]) {
      const action: Action = { kind: "data-write", path: hint.path, value };
      const key = actionSignature(action);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(action);
      }
    }
  }
  return out;
}

/** Boundary actions are front-loaded, but the caller's original action corpus is preserved. */
export function prioritizeBoundaryActions(base: readonly Action[], hints: readonly NumericBoundaryHint[]): Action[] {
  const out: Action[] = [];
  const seen = new Set<string>();
  for (const action of [...actionsForNumericBoundaries(hints), ...base]) {
    const key = actionSignature(action);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(action);
    }
  }
  return out;
}
