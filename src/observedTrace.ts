import type {
  StaticProvenanceGraph,
  StaticProvenanceNode,
} from "./staticProvenance.js";

export interface ObservedInputValue {
  name: string;
  type: string;
  value: boolean | number | null;
}

export interface ObservedTraceContext {
  artboard?: string;
  stateMachine?: string;
  backend?: string;
  backendVersion?: string;
}

export interface ObservedStateChangeEvent {
  id: string;
  type: "stateChange";
  sequence: number;
  step: string | number;
  stateName: string;
  advancedSeconds?: number;
}

export interface ObservedInputSnapshotEvent {
  id: string;
  type: "inputSnapshot";
  sequence: number;
  step: string | number;
  inputs: ObservedInputValue[];
  advancedSeconds?: number;
}

export interface ObservedInputValueChangeEvent {
  id: string;
  type: "inputValueChanged";
  sequence: number;
  step: string | number;
  inputName: string;
  inputType: string;
  before: boolean | number | null | undefined;
  after: boolean | number | null;
  advancedSeconds?: number;
}

export type ObservedTraceEvent =
  | ObservedStateChangeEvent
  | ObservedInputSnapshotEvent
  | ObservedInputValueChangeEvent;

export interface ObservedTrace {
  schemaVersion: 1;
  context: ObservedTraceContext;
  events: ObservedTraceEvent[];
  warnings: string[];
}

export interface PlayReportLike {
  report: Array<Record<string, unknown>>;
}

export interface StaticSupportPath {
  observationId: string;
  observationType: "stateChange";
  observationLabel: string;
  staticStateNodeId: string;
  animationNodeId: string;
  propertyNodeId: string;
  relation: "observed-state-supports-potential-writer";
}

export interface TraceCorrelation {
  schemaVersion: 1;
  support: StaticSupportPath[];
  unmatchedObservations: string[];
  ambiguousObservations: Array<{
    observationId: string;
    stateName: string;
    candidateStateNodeIds: string[];
  }>;
  warnings: string[];
}

function normalizeStep(value: unknown, index: number): string | number {
  if (typeof value === "string" || typeof value === "number") return value;
  return index;
}

function normalizeAdvancedSeconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeStates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeInputs(
  value: unknown,
  warnings: string[],
  step: string | number
): ObservedInputValue[] {
  if (!Array.isArray(value)) return [];
  const out: ObservedInputValue[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      warnings.push(`step ${String(step)}: ignored malformed input snapshot entry`);
      continue;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string" || typeof record.type !== "string") {
      warnings.push(`step ${String(step)}: ignored input snapshot entry without name/type`);
      continue;
    }
    const rawValue = record.value;
    if (
      rawValue !== null &&
      typeof rawValue !== "boolean" &&
      typeof rawValue !== "number"
    ) {
      warnings.push(
        `step ${String(step)} input "${record.name}": unsupported snapshot value omitted`
      );
      continue;
    }
    out.push({
      name: record.name,
      type: record.type,
      value: rawValue as boolean | number | null,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
}

function sameObservedValue(
  a: boolean | number | null | undefined,
  b: boolean | number | null
): boolean {
  return Object.is(a, b);
}

export function observedTraceFromPlayResult(
  result: PlayReportLike,
  context: ObservedTraceContext = {}
): ObservedTrace {
  const events: ObservedTraceEvent[] = [];
  const warnings: string[] = [];
  let sequence = 0;
  let previousInputs = new Map<string, ObservedInputValue>();

  for (let index = 0; index < result.report.length; index++) {
    const entry = result.report[index] ?? {};
    const step = normalizeStep(entry.step, index);
    const advancedSeconds = normalizeAdvancedSeconds(entry.advancedSeconds);
    const states = normalizeStates(entry.statesChanged);
    const inputs = normalizeInputs(entry.inputs, warnings, step);

    events.push({
      id: `obs:${sequence}`,
      type: "inputSnapshot",
      sequence: sequence++,
      step,
      inputs,
      advancedSeconds,
    });

    const currentInputs = new Map(inputs.map((input) => [input.name, input]));
    for (const input of inputs) {
      const previous = previousInputs.get(input.name);
      if (!previous) continue;
      if (
        previous.type !== input.type ||
        !sameObservedValue(previous.value, input.value)
      ) {
        events.push({
          id: `obs:${sequence}`,
          type: "inputValueChanged",
          sequence: sequence++,
          step,
          inputName: input.name,
          inputType: input.type,
          before: previous.value,
          after: input.value,
          advancedSeconds,
        });
      }
    }

    for (const stateName of states) {
      events.push({
        id: `obs:${sequence}`,
        type: "stateChange",
        sequence: sequence++,
        step,
        stateName,
        advancedSeconds,
      });
    }

    previousInputs = currentInputs;
  }

  return {
    schemaVersion: 1,
    context: { ...context },
    events,
    warnings: [...new Set(warnings)].sort(),
  };
}

function nodeMatchesContext(
  node: StaticProvenanceNode,
  context: ObservedTraceContext
): boolean {
  if (context.artboard !== undefined && node.artboard !== context.artboard) return false;
  if (
    context.stateMachine !== undefined &&
    node.metadata.stateMachine !== context.stateMachine
  ) {
    return false;
  }
  return true;
}

function stateNameMatches(node: StaticProvenanceNode, stateName: string): boolean {
  if (node.kind !== "state") return false;
  if (node.metadata.animationName === stateName) return true;
  if (node.label === stateName) return true;

  const type = node.metadata.stateType;
  if (typeof type === "string") {
    const normalized = type.replace(/State$/, "");
    if (normalized === stateName) return true;
  }
  return false;
}

export function correlateObservedTrace(
  trace: ObservedTrace,
  graph: StaticProvenanceGraph
): TraceCorrelation {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, typeof graph.edges>();
  for (const edge of graph.edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }

  const support: StaticSupportPath[] = [];
  const unmatchedObservations: string[] = [];
  const ambiguousObservations: TraceCorrelation["ambiguousObservations"] = [];
  const warnings: string[] = [];

  for (const event of trace.events) {
    if (event.type !== "stateChange") continue;

    const candidates = graph.nodes.filter(
      (node) =>
        node.kind === "state" &&
        nodeMatchesContext(node, trace.context) &&
        stateNameMatches(node, event.stateName)
    );

    if (candidates.length === 0) {
      unmatchedObservations.push(event.id);
      continue;
    }

    if (candidates.length > 1) {
      ambiguousObservations.push({
        observationId: event.id,
        stateName: event.stateName,
        candidateStateNodeIds: candidates.map((node) => node.id).sort(),
      });
      continue;
    }

    const state = candidates[0];
    const animationEdges = (outgoing.get(state.id) ?? []).filter(
      (edge) => edge.kind === "activates"
    );

    if (animationEdges.length === 0) {
      warnings.push(
        `${event.id}: matched static state "${event.stateName}" has no modeled animation activation`
      );
      continue;
    }

    for (const animationEdge of animationEdges) {
      const animation = nodeById.get(animationEdge.to);
      if (!animation || animation.kind !== "animation") continue;
      const propertyEdges = (outgoing.get(animation.id) ?? []).filter(
        (edge) => edge.kind === "writes"
      );
      for (const propertyEdge of propertyEdges) {
        const property = nodeById.get(propertyEdge.to);
        if (!property || property.kind !== "property") continue;
        support.push({
          observationId: event.id,
          observationType: "stateChange",
          observationLabel: event.stateName,
          staticStateNodeId: state.id,
          animationNodeId: animation.id,
          propertyNodeId: property.id,
          relation: "observed-state-supports-potential-writer",
        });
      }
    }
  }

  support.sort(
    (a, b) =>
      a.observationId.localeCompare(b.observationId) ||
      a.propertyNodeId.localeCompare(b.propertyNodeId)
  );
  unmatchedObservations.sort();
  ambiguousObservations.sort((a, b) =>
    a.observationId.localeCompare(b.observationId)
  );

  if (support.length > 0) {
    warnings.push(
      "Correlation proves an observed state-change is structurally compatible with a potential static writer path; it does not prove that the downstream property value actually changed"
    );
  }

  return {
    schemaVersion: 1,
    support,
    unmatchedObservations,
    ambiguousObservations,
    warnings: [...new Set(warnings)].sort(),
  };
}
