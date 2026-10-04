import type { Action, JsonValue, StateObservation } from "../explorer/types.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      const child = input[key];
      if (child !== undefined) out[key] = canonicalize(child);
    }
    return out;
  }
  if (typeof value === "number" && Object.is(value, -0)) return 0;
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * An observational identity, not a claim that hidden Rive runtime state is identical.
 * Array order is preserved because event order/layer order can be semantically meaningful.
 */
export function stateSignature(observation: StateObservation): string {
  const observable: Record<string, JsonValue | string[] | undefined> = {
    activeStates: observation.activeStates,
    viewModel: observation.viewModel,
    events: observation.events as unknown as JsonValue,
    frameHash: observation.frameHash,
    dataHash: observation.dataHash,
    metadata: observation.metadata,
  };
  return stableJson(observable);
}

export function actionSignature(action: Action): string {
  return stableJson(action);
}
