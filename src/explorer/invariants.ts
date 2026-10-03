import type { JsonValue, StateObservation } from "./types.js";

export type ComparisonOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "truthy" | "falsy";

export interface ViewModelCondition {
  source: "viewModel";
  path: string;
  op: ComparisonOperator;
  value?: JsonValue;
}

export interface ImplicationInvariant {
  id: string;
  description: string;
  kind: "implies";
  when: ViewModelCondition;
  then: ViewModelCondition;
}

export interface MutuallyExclusiveInvariant {
  id: string;
  description: string;
  kind: "mutually-exclusive";
  conditions: ViewModelCondition[];
}

export type Invariant = ImplicationInvariant | MutuallyExclusiveInvariant;

export interface InvariantViolation {
  invariantId: string;
  description: string;
  expected: string;
  observed: Record<string, JsonValue | undefined>;
}

function getPath(root: Record<string, JsonValue> | undefined, path: string): JsonValue | undefined {
  if (!root) return undefined;
  if (Object.prototype.hasOwnProperty.call(root, path)) return root[path];
  const parts = path.split(/[/.]/).filter(Boolean);
  let current: JsonValue | undefined = root as unknown as JsonValue;
  for (const part of parts) {
    if (!current || Array.isArray(current) || typeof current !== "object") return undefined;
    current = (current as Record<string, JsonValue>)[part];
  }
  return current;
}

function compare(actual: JsonValue | undefined, condition: ViewModelCondition): boolean {
  switch (condition.op) {
    case "truthy": return Boolean(actual);
    case "falsy": return !actual;
    case "eq": return actual === condition.value;
    case "ne": return actual !== condition.value;
    case "gt": return typeof actual === "number" && typeof condition.value === "number" && actual > condition.value;
    case "gte": return typeof actual === "number" && typeof condition.value === "number" && actual >= condition.value;
    case "lt": return typeof actual === "number" && typeof condition.value === "number" && actual < condition.value;
    case "lte": return typeof actual === "number" && typeof condition.value === "number" && actual <= condition.value;
  }
}

function conditionText(condition: ViewModelCondition): string {
  const rhs = condition.value === undefined ? "" : ` ${JSON.stringify(condition.value)}`;
  return `${condition.path} ${condition.op}${rhs}`;
}

export function evaluateInvariant(invariant: Invariant, observation: StateObservation): InvariantViolation | null {
  if (invariant.kind === "implies") {
    const whenValue = getPath(observation.viewModel, invariant.when.path);
    if (!compare(whenValue, invariant.when)) return null;
    const thenValue = getPath(observation.viewModel, invariant.then.path);
    if (compare(thenValue, invariant.then)) return null;
    return {
      invariantId: invariant.id,
      description: invariant.description,
      expected: `${conditionText(invariant.when)} => ${conditionText(invariant.then)}`,
      observed: {
        [invariant.when.path]: whenValue,
        [invariant.then.path]: thenValue,
      },
    };
  }

  const matched = invariant.conditions
    .map((condition) => ({ condition, value: getPath(observation.viewModel, condition.path) }))
    .filter(({ condition, value }) => compare(value, condition));
  if (matched.length <= 1) return null;
  return {
    invariantId: invariant.id,
    description: invariant.description,
    expected: `at most one of: ${invariant.conditions.map(conditionText).join(", ")}`,
    observed: Object.fromEntries(matched.map(({ condition, value }) => [condition.path, value])),
  };
}

export function evaluateInvariants(invariants: readonly Invariant[], observation: StateObservation): InvariantViolation[] {
  return invariants.map((invariant) => evaluateInvariant(invariant, observation)).filter((v): v is InvariantViolation => v !== null);
}
