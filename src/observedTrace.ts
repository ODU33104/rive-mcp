import type {
  StaticProvenanceGraph,
  StaticProvenanceNode,
} from "./staticProvenance.js";

export interface ObservedInputValue {
  name: string;
  type: string;
  value: boolean | number | null;
}

export interface ObservedPropertyValue {
  target: string;
  property: string;
  value: number | string;
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

export interface ObservedPropertySnapshotEvent {
  id: string;
  type: "propertySnapshot";
  sequence: number;
  step: string | number;
  properties: ObservedPropertyValue[];
  advancedSeconds?: number;
}

export interface ObservedPropertyValueChangeEvent {
  id: string;
  type: "propertyValueChanged";
  sequence: number;
  step: string | number;
  target: string;
  property: string;
  before: number | string;
  after: number | string;
  advancedSeconds?: number;
}

export type ObservedTraceEvent =
  | ObservedStateChangeEvent
  | ObservedInputSnapshotEvent
  | ObservedInputValueChangeEvent
  | ObservedPropertySnapshotEvent
  | ObservedPropertyValueChangeEvent;

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
  relation:
    | "observed-state-supports-potential-writer"
    | "observed-state-and-property-change-support-writer";
  propertyObservationId?: string;
  propertyBefore?: number | string;
  propertyAfter?: number | string;
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

function normalizeProperties(
  value: unknown,
  warnings: string[],
  step: string | number
): ObservedPropertyValue[] {
  if (!Array.isArray(value)) return [];
  const out: ObservedPropertyValue[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      warnings.push(`step ${String(step)}: ignored malformed property snapshot entry`);
      continue;
    }
    const record = item as Record<string, unknown>;
    if (
      typeof record.target !== "string" ||
      typeof record.property !== "string" ||
      (typeof record.value !== "number" && typeof record.value !== "string")
    ) {
      warnings.push(
        `step ${String(step)}: ignored property snapshot entry without target/property/value`
      );
      continue;
    }
    if (typeof record.value === "number" && !Number.isFinite(record.value)) {
      warnings.push(
        `step ${String(step)} property "${record.target}.${record.property}": non-finite number omitted`
      );
      continue;
    }
    out.push({
      target: record.target,
      property: record.property,
      value: record.value,
    });
  }
  return out.sort(
    (a, b) =>
      a.target.localeCompare(b.target) ||
      a.property.localeCompare(b.property)
  );
}

function sameObservedValue(
  a: boolean | number | string | null | undefined,
  b: boolean | number | string | null
): boolean {
  return Object.is(a, b);
}

function propertyKey(value: ObservedPropertyValue): string {
  return `${value.target}\u0000${value.property}`;
}

export function observedTraceFromPlayResult(
  result: PlayReportLike,
  context: ObservedTraceContext = {}
): ObservedTrace {
  const events: ObservedTraceEvent[] = [];
  const warnings: string[] = [];
  let sequence = 0;
  let previousInputs = new Map<string, ObservedInputValue>();
  let previousProperties = new Map<string, ObservedPropertyValue>();

  for (let index = 0; index < result.report.length; index++) {
    const entry = result.report[index] ?? {};
    const step = normalizeStep(entry.step, index);
    const advancedSeconds = normalizeAdvancedSeconds(entry.advancedSeconds);
    const states = normalizeStates(entry.statesChanged);
    const inputs = normalizeInputs(entry.inputs, warnings, step);
    const properties = normalizeProperties(entry.properties, warnings, step);
    if (Array.isArray(entry.propertyWarnings)) {
      for (const warning of entry.propertyWarnings) {
        if (typeof warning === "string") {
          warnings.push(`step ${String(step)} property observation: ${warning}`);
        }
      }
    }

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

    events.push({
      id: `obs:${sequence}`,
      type: "propertySnapshot",
      sequence: sequence++,
      step,
      properties,
      advancedSeconds,
    });

    const currentProperties = new Map(
      properties.map((property) => [propertyKey(property), property])
    );
    for (const property of properties) {
      const previous = previousProperties.get(propertyKey(property));
      if (!previous) continue;
      if (!sameObservedValue(previous.value, property.value)) {
        events.push({
          id: `obs:${sequence}`,
          type: "propertyValueChanged",
          sequence: sequence++,
          step,
          target: property.target,
          property: property.property,
          before: previous.value,
          after: property.value,
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
    previousProperties = currentProperties;
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
  const propertyChangesByStep = new Map<string, ObservedPropertyValueChangeEvent[]>();
  for (const event of trace.events) {
    if (event.type !== "propertyValueChanged") continue;
    const key = typeof event.step === "number" ? `n:${event.step}` : `s:${event.step}`;
    const list = propertyChangesByStep.get(key) ?? [];
    list.push(event);
    propertyChangesByStep.set(key, list);
  }

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
        const stepKey =
          typeof event.step === "number" ? `n:${event.step}` : `s:${event.step}`;
        const matchingPropertyChange = (propertyChangesByStep.get(stepKey) ?? []).find(
          (change) =>
            property.metadata.targetName === change.target &&
            property.metadata.propertyName === change.property
        );

        support.push({
          observationId: event.id,
          observationType: "stateChange",
          observationLabel: event.stateName,
          staticStateNodeId: state.id,
          animationNodeId: animation.id,
          propertyNodeId: property.id,
          relation: matchingPropertyChange
            ? "observed-state-and-property-change-support-writer"
            : "observed-state-supports-potential-writer",
          propertyObservationId: matchingPropertyChange?.id,
          propertyBefore: matchingPropertyChange?.before,
          propertyAfter: matchingPropertyChange?.after,
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

  const strongerSupport = support.filter(
    (item) => item.relation === "observed-state-and-property-change-support-writer"
  );
  const weakerSupport = support.filter(
    (item) => item.relation === "observed-state-supports-potential-writer"
  );
  if (strongerSupport.length > 0) {
    warnings.push(
      "Observed state and property changes at the same checkpoint strengthen the static writer path, but temporal co-observation alone is not proof that no other writer contributed"
    );
  }
  if (weakerSupport.length > 0) {
    warnings.push(
      "Some correlations only prove an observed state-change is structurally compatible with a potential static writer path; the downstream property change was not observed at that checkpoint"
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
