import {
  explainPotentialWriters,
  findPropertyNodes,
  type PotentialWriterPath,
  type StaticProvenanceGraph,
} from "./staticProvenance.js";
import {
  correlateObservedTrace,
  type ObservedPropertyValueChangeEvent,
  type ObservedTrace,
  type TraceCorrelation,
} from "./observedTrace.js";

export type CausalAmbiguityStatus =
  | "observed-support-single-modeled-writer"
  | "observed-support-with-competing-writers"
  | "single-modeled-writer-not-observed"
  | "competing-modeled-writers-unattributed"
  | "unattributed-property-change"
  | "ambiguous-property-identity";

export interface WriterPathSummary {
  nodeIds: string[];
  edgeKinds: string[];
  supportedByObservation: boolean;
}

export interface PropertyCausalAmbiguity {
  observationId: string;
  step: string | number;
  target: string;
  property: string;
  before: number | string;
  after: number | string;
  propertyNodeIds: string[];
  writerPaths: WriterPathSummary[];
  supportedWriterPaths: WriterPathSummary[];
  competingWriterPaths: WriterPathSummary[];
  status: CausalAmbiguityStatus;
}

export interface CausalAmbiguityReport {
  schemaVersion: 1;
  properties: PropertyCausalAmbiguity[];
  summary: {
    observedSupportSingleWriter: number;
    observedSupportWithCompetitors: number;
    unattributed: number;
    ambiguousIdentity: number;
    totalPropertyChanges: number;
  };
  warnings: string[];
}

function pathKey(path: { nodeIds: readonly string[]; edgeKinds: readonly string[] }): string {
  return `${path.nodeIds.join("->")}|${path.edgeKinds.join("->")}`;
}

function observedSupportKeys(
  correlation: TraceCorrelation,
  propertyObservationId: string
): Set<string> {
  const keys = new Set<string>();
  for (const support of correlation.support) {
    if (
      support.propertyObservationId !== propertyObservationId ||
      support.relation !== "observed-state-and-property-change-support-writer"
    ) {
      continue;
    }
    keys.add(
      `${support.staticStateNodeId}->${support.animationNodeId}->${support.propertyNodeId}|activates->writes`
    );
  }
  return keys;
}

function summarizePaths(
  paths: PotentialWriterPath[],
  supportedKeys: Set<string>
): WriterPathSummary[] {
  return paths.map((path) => ({
    nodeIds: [...path.nodeIds],
    edgeKinds: [...path.edgeKinds],
    supportedByObservation: supportedKeys.has(pathKey(path)),
  }));
}

function classify(
  propertyNodeCount: number,
  writerPaths: WriterPathSummary[]
): CausalAmbiguityStatus {
  if (propertyNodeCount === 0) return "unattributed-property-change";
  if (propertyNodeCount > 1) return "ambiguous-property-identity";

  const supported = writerPaths.filter((path) => path.supportedByObservation);
  const competitors = writerPaths.filter((path) => !path.supportedByObservation);

  if (supported.length > 0 && competitors.length === 0) {
    return "observed-support-single-modeled-writer";
  }
  if (supported.length > 0 && competitors.length > 0) {
    return "observed-support-with-competing-writers";
  }
  if (writerPaths.length === 1) {
    return "single-modeled-writer-not-observed";
  }
  if (writerPaths.length > 1) {
    return "competing-modeled-writers-unattributed";
  }
  return "unattributed-property-change";
}

function propertyChanges(trace: ObservedTrace): ObservedPropertyValueChangeEvent[] {
  return trace.events.filter(
    (event): event is ObservedPropertyValueChangeEvent =>
      event.type === "propertyValueChanged"
  );
}

export function analyzeCausalAmbiguity(
  trace: ObservedTrace,
  graph: StaticProvenanceGraph,
  correlation: TraceCorrelation = correlateObservedTrace(trace, graph)
): CausalAmbiguityReport {
  const properties: PropertyCausalAmbiguity[] = [];
  const warnings: string[] = [];

  for (const observation of propertyChanges(trace)) {
    const propertyNodes = findPropertyNodes(graph, {
      artboard: trace.context.artboard,
      targetName: observation.target,
      propertyName: observation.property,
    });

    const supportedKeys = observedSupportKeys(correlation, observation.id);
    const allPaths: WriterPathSummary[] = [];

    for (const propertyNode of propertyNodes) {
      allPaths.push(
        ...summarizePaths(
          explainPotentialWriters(graph, propertyNode.id),
          supportedKeys
        )
      );
    }

    const uniquePaths = new Map<string, WriterPathSummary>();
    for (const path of allPaths) {
      uniquePaths.set(
        `${path.nodeIds.join("->")}|${path.edgeKinds.join("->")}`,
        path
      );
    }
    const writerPaths = [...uniquePaths.values()].sort((a, b) =>
      pathKey(a).localeCompare(pathKey(b))
    );

    const supportedWriterPaths = writerPaths.filter(
      (path) => path.supportedByObservation
    );
    const competingWriterPaths = writerPaths.filter(
      (path) => !path.supportedByObservation
    );
    const status = classify(propertyNodes.length, writerPaths);

    properties.push({
      observationId: observation.id,
      step: observation.step,
      target: observation.target,
      property: observation.property,
      before: observation.before,
      after: observation.after,
      propertyNodeIds: propertyNodes.map((node) => node.id).sort(),
      writerPaths,
      supportedWriterPaths,
      competingWriterPaths,
      status,
    });

    if (status === "observed-support-with-competing-writers") {
      warnings.push(
        `${observation.id}: observed support exists for ${observation.target}.${observation.property}, but ${competingWriterPaths.length} competing modeled writer path(s) remain`
      );
    } else if (status === "unattributed-property-change") {
      warnings.push(
        `${observation.id}: runtime observed ${observation.target}.${observation.property} changing without a modeled static writer path`
      );
    } else if (status === "ambiguous-property-identity") {
      warnings.push(
        `${observation.id}: runtime observation matches multiple static property identities for ${observation.target}.${observation.property}`
      );
    }
  }

  properties.sort((a, b) =>
    a.observationId.localeCompare(b.observationId)
  );

  return {
    schemaVersion: 1,
    properties,
    summary: {
      observedSupportSingleWriter: properties.filter(
        (item) => item.status === "observed-support-single-modeled-writer"
      ).length,
      observedSupportWithCompetitors: properties.filter(
        (item) => item.status === "observed-support-with-competing-writers"
      ).length,
      unattributed: properties.filter(
        (item) =>
          item.status === "unattributed-property-change" ||
          item.status === "single-modeled-writer-not-observed" ||
          item.status === "competing-modeled-writers-unattributed"
      ).length,
      ambiguousIdentity: properties.filter(
        (item) => item.status === "ambiguous-property-identity"
      ).length,
      totalPropertyChanges: properties.length,
    },
    warnings: [...new Set(warnings)].sort(),
  };
}
