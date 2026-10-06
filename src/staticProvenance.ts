import { decodeDataBinding } from "./dataBinding.js";
import { analyzeDataBindSourcePath } from "./causal/sourcePathResolution.js";
import {
  isLayerStateType,
  propInfo,
  readRiv,
  type RivDump,
  type RivObject,
} from "./rivBinary.js";

export type ProvenanceNodeKind =
  | "property"
  | "animation"
  | "state"
  | "binding"
  | "bindingSource"
  | "converter";

export type ProvenanceEdgeKind = "writes" | "feeds" | "activates";

export interface StaticProvenanceNode {
  id: string;
  kind: ProvenanceNodeKind;
  label: string;
  artboard?: string;
  metadata: Record<string, unknown>;
}

export interface StaticProvenanceEdge {
  from: string;
  to: string;
  kind: ProvenanceEdgeKind;
}

export interface StaticProvenanceGraph {
  schemaVersion: 1;
  nodes: StaticProvenanceNode[];
  edges: StaticProvenanceEdge[];
  warnings: string[];
}

export interface PropertyQuery {
  artboard?: string;
  targetName?: string;
  targetType?: string;
  propertyName?: string;
  propertyKey?: number;
}

export interface PotentialWriterPath {
  propertyNodeId: string;
  nodeIds: string[];
  edgeKinds: ProvenanceEdgeKind[];
}

interface ArtboardRange {
  ordinal: number;
  name: string;
  start: number;
  end: number;
}

const enc = (value: string): string => encodeURIComponent(value);

function addNode(
  nodes: Map<string, StaticProvenanceNode>,
  node: StaticProvenanceNode
): void {
  if (!nodes.has(node.id)) nodes.set(node.id, node);
}

function addEdge(
  edges: Map<string, StaticProvenanceEdge>,
  edge: StaticProvenanceEdge
): void {
  const key = `${edge.from}\u0000${edge.kind}\u0000${edge.to}`;
  if (!edges.has(key)) edges.set(key, edge);
}

function artboardRanges(objects: RivObject[]): ArtboardRange[] {
  const starts: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    if (objects[i].typeName === "Artboard") starts.push(i);
  }

  return starts.map((start, ordinal) => ({
    ordinal,
    start,
    end: starts[ordinal + 1] ?? objects.length,
    name:
      typeof objects[start].properties.name === "string"
        ? (objects[start].properties.name as string)
        : `Artboard${ordinal}`,
  }));
}

function rangeForPosition(ranges: ArtboardRange[], position: number): ArtboardRange | undefined {
  return ranges.find((range) => position >= range.start && position < range.end);
}

function targetLabel(target: RivObject, localIndex?: number): string {
  const name = typeof target.properties.name === "string" ? target.properties.name : undefined;
  return name ? `${target.typeName} "${name}"` : `${target.typeName}#${localIndex ?? target.index}`;
}

function propertyNode(
  nodes: Map<string, StaticProvenanceNode>,
  warnings: string[],
  target: RivObject,
  propertyKey: number,
  range?: ArtboardRange,
  localIndex?: number
): StaticProvenanceNode {
  const info = propInfo(propertyKey);
  const propertyName = info?.name ?? `property#${propertyKey}`;
  const id = range
    ? `property:a${range.ordinal}:o${localIndex ?? target.index}:p${propertyKey}`
    : `property:global:o${target.index}:p${propertyKey}`;
  const name = typeof target.properties.name === "string" ? target.properties.name : undefined;

  if (!name) {
    warnings.push(
      `${range ? `artboard/${range.name}` : "global"}: ${target.typeName}#${localIndex ?? target.index} uses index fallback in provenance because it has no name`
    );
  }
  if (!info) {
    warnings.push(
      `${targetLabel(target, localIndex)}: property key ${propertyKey} is unknown to current defs`
    );
  }

  const node: StaticProvenanceNode = {
    id,
    kind: "property",
    label: `${targetLabel(target, localIndex)}.${propertyName}`,
    artboard: range?.name,
    metadata: {
      targetType: target.typeName,
      targetName: name,
      targetObjectIndex: target.index,
      targetLocalIndex: localIndex,
      propertyKey,
      propertyName,
      propertyOwner: info?.owner,
    },
  };
  addNode(nodes, node);
  return node;
}

function buildAnimationAndStateEdges(
  dump: RivDump,
  ranges: ArtboardRange[],
  nodes: Map<string, StaticProvenanceNode>,
  edges: Map<string, StaticProvenanceEdge>,
  warnings: string[]
): void {
  const objects = dump.objects;

  for (const range of ranges) {
    const animations: Array<{ id: string; name: string; ordinal: number }> = [];
    let currentAnimation: { id: string; name: string; ordinal: number } | null = null;
    let currentTargetLocal = -1;

    for (let position = range.start + 1; position < range.end; position++) {
      const object = objects[position];
      if (object.typeName === "LinearAnimation") {
        const ordinal = animations.length;
        const name =
          typeof object.properties.name === "string"
            ? (object.properties.name as string)
            : `animation${ordinal}`;
        const animation = {
          id: `animation:a${range.ordinal}:n${ordinal}`,
          name,
          ordinal,
        };
        animations.push(animation);
        currentAnimation = animation;
        currentTargetLocal = -1;
        addNode(nodes, {
          id: animation.id,
          kind: "animation",
          label: `Animation "${name}"`,
          artboard: range.name,
          metadata: {
            animationName: name,
            animationOrdinal: ordinal,
            objectIndex: object.index,
          },
        });
        continue;
      }

      if (object.typeName === "KeyedObject") {
        currentTargetLocal =
          typeof object.properties.objectId === "number"
            ? (object.properties.objectId as number)
            : -1;
        continue;
      }

      if (object.typeName === "KeyedProperty" && currentAnimation) {
        const propertyKey =
          typeof object.properties.propertyKey === "number"
            ? (object.properties.propertyKey as number)
            : undefined;
        if (currentTargetLocal < 0 || propertyKey == null) {
          warnings.push(
            `artboard/${range.name}/animation/${currentAnimation.name}: incomplete KeyedObject/KeyedProperty target`
          );
          continue;
        }
        const targetPosition = range.start + currentTargetLocal;
        const target = objects[targetPosition];
        if (!target || targetPosition >= range.end) {
          warnings.push(
            `artboard/${range.name}/animation/${currentAnimation.name}: objectId ${currentTargetLocal} is outside the artboard`
          );
          continue;
        }
        const property = propertyNode(
          nodes,
          warnings,
          target,
          propertyKey,
          range,
          currentTargetLocal
        );
        addEdge(edges, {
          from: currentAnimation.id,
          to: property.id,
          kind: "writes",
        });
      }
    }

    let smOrdinal = -1;
    let layerOrdinal = -1;
    let stateOrdinal = -1;
    let currentSmName = "";
    let currentLayerName = "";

    for (let position = range.start + 1; position < range.end; position++) {
      const object = objects[position];

      if (object.typeName === "StateMachine") {
        smOrdinal++;
        layerOrdinal = -1;
        stateOrdinal = -1;
        currentSmName =
          typeof object.properties.name === "string"
            ? (object.properties.name as string)
            : `StateMachine${smOrdinal}`;
        currentLayerName = "";
        continue;
      }

      if (object.typeName === "StateMachineLayer" && smOrdinal >= 0) {
        layerOrdinal++;
        stateOrdinal = -1;
        currentLayerName =
          typeof object.properties.name === "string"
            ? (object.properties.name as string)
            : `Layer${layerOrdinal}`;
        continue;
      }

      if (!isLayerStateType(object.typeName) || smOrdinal < 0 || layerOrdinal < 0) continue;

      stateOrdinal++;
      const stateId = `state:a${range.ordinal}:sm${smOrdinal}:l${layerOrdinal}:s${stateOrdinal}`;
      let stateLabel = object.typeName.replace(/State$/, "") || object.typeName;
      let animationName: string | undefined;

      if (
        object.typeName === "AnimationState" &&
        typeof object.properties.animationId === "number"
      ) {
        const animationId = object.properties.animationId as number;
        const animation = animations[animationId];
        animationName = animation?.name;
        stateLabel = animation
          ? `Animation state "${animation.name}"`
          : `Animation state #${animationId}`;

        if (animation) {
          addEdge(edges, {
            from: stateId,
            to: animation.id,
            kind: "activates",
          });
        } else {
          warnings.push(
            `artboard/${range.name}/stateMachine/${currentSmName}/${currentLayerName}: AnimationState references missing animationId ${animationId}`
          );
        }
      } else if (object.typeName.startsWith("BlendState")) {
        warnings.push(
          `artboard/${range.name}/stateMachine/${currentSmName}/${currentLayerName}/state#${stateOrdinal}: ${object.typeName} activation provenance is not expanded yet`
        );
      }

      addNode(nodes, {
        id: stateId,
        kind: "state",
        label: stateLabel,
        artboard: range.name,
        metadata: {
          stateMachine: currentSmName,
          stateMachineOrdinal: smOrdinal,
          layer: currentLayerName,
          layerOrdinal,
          stateOrdinal,
          stateType: object.typeName,
          animationName,
          objectIndex: object.index,
        },
      });
    }
  }
}

function buildBindingEdges(
  dump: RivDump,
  ranges: ArtboardRange[],
  nodes: Map<string, StaticProvenanceNode>,
  edges: Map<string, StaticProvenanceEdge>,
  warnings: string[]
): void {
  const dataBinding = decodeDataBinding(dump);
  if (!dataBinding) return;

  const positionByObjectIndex = new Map<number, number>();
  dump.objects.forEach((object, position) => positionByObjectIndex.set(object.index, position));

  for (const binding of dataBinding.dataBinds) {
    const propertyKey = binding.propertyKey;
    const target = binding.target;
    if (!target || propertyKey == null) {
      warnings.push(
        `dataBind@${binding.objectIndex}: missing target or propertyKey; provenance edge omitted`
      );
      continue;
    }

    const targetPosition = positionByObjectIndex.get(target.objectIndex);
    const targetObject =
      targetPosition == null ? undefined : dump.objects[targetPosition];
    if (!targetObject) {
      warnings.push(
        `dataBind@${binding.objectIndex}: target object ${target.objectIndex} could not be resolved`
      );
      continue;
    }

    const range =
      targetPosition == null ? undefined : rangeForPosition(ranges, targetPosition);
    const localIndex = range && targetPosition != null ? targetPosition - range.start : undefined;
    const property = propertyNode(
      nodes,
      warnings,
      targetObject,
      propertyKey,
      range,
      localIndex
    );

    const bindingId = `binding:o${binding.objectIndex}`;
    addNode(nodes, {
      id: bindingId,
      kind: "binding",
      label: `Binding → ${property.label}`,
      artboard: range?.name,
      metadata: {
        direction: binding.flags.direction,
        twoWay: binding.flags.twoWay,
        once: binding.flags.once,
        sourceToTargetRunsFirst: binding.flags.sourceToTargetRunsFirst,
        nameBased: binding.flags.nameBased,
        propertyKey,
        propertyName: binding.propertyName,
        converterName: binding.converterName,
        sourcePathIds: binding.sourcePathIds,
      },
    });

    const sourcePathResolution = analyzeDataBindSourcePath(binding, dataBinding);
    const sourceId = `binding-source:o${binding.objectIndex}`;
    addNode(nodes, {
      id: sourceId,
      kind: "bindingSource",
      label:
        sourcePathResolution.status === "resolved"
          ? `ViewModel source ${sourcePathResolution.semanticPath}`
          : binding.sourcePathIds && binding.sourcePathIds.length
            ? `ViewModel source [${binding.sourcePathIds.join(",")}]`
            : "ViewModel source <unresolved>",
      metadata: {
        sourcePathIds: binding.sourcePathIds,
        normalized: sourcePathResolution.status === "resolved",
        semanticPath:
          sourcePathResolution.status === "resolved"
            ? sourcePathResolution.semanticPath
            : undefined,
        sourcePathResolution,
        nameBased: binding.flags.nameBased,
      },
    });

    let upstreamId = sourceId;
    if (binding.converterIndex != null) {
      const converter = dataBinding.converters[binding.converterIndex];
      if (converter) {
        const converterId = `converter:n${binding.converterIndex}`;
        addNode(nodes, {
          id: converterId,
          kind: "converter",
          label: converter.name
            ? `Converter "${converter.name}"`
            : `${converter.typeName}#${binding.converterIndex}`,
          metadata: {
            converterIndex: binding.converterIndex,
            converterName: converter.name,
            converterType: converter.typeName,
            converterKind: converter.kind,
          },
        });
        addEdge(edges, { from: sourceId, to: converterId, kind: "feeds" });
        upstreamId = converterId;
      } else {
        warnings.push(
          `dataBind@${binding.objectIndex}: converterId ${binding.converterIndex} could not be resolved`
        );
      }
    }

    addEdge(edges, { from: upstreamId, to: bindingId, kind: "feeds" });

    const toTarget = binding.flags.direction === "toTarget" || binding.flags.twoWay;
    const toSource = binding.flags.direction === "toSource" || binding.flags.twoWay;

    if (toTarget) {
      addEdge(edges, { from: bindingId, to: property.id, kind: "writes" });
    }
    if (toSource) {
      addEdge(edges, { from: property.id, to: bindingId, kind: "feeds" });
      addEdge(edges, { from: bindingId, to: sourceId, kind: "writes" });
    }
  }

  if (dataBinding.dataBindPaths.length > 0) {
    warnings.push(
      `${dataBinding.dataBindPaths.length} DataBindPath object(s) are decoded but not yet normalized into semantic ViewModel property paths`
    );
  }
  if (dataBinding.dataBinds.some((binding) => (binding.sourcePathIds?.length ?? 0) > 0)) {
    warnings.push(
      "Data Binding source paths are represented by opaque numeric IDs; they are potential provenance evidence, not stable semantic property paths"
    );
  }
}

export function buildStaticProvenanceGraph(dump: RivDump): StaticProvenanceGraph {
  const nodes = new Map<string, StaticProvenanceNode>();
  const edges = new Map<string, StaticProvenanceEdge>();
  const warnings: string[] = [];
  const ranges = artboardRanges(dump.objects);

  buildAnimationAndStateEdges(dump, ranges, nodes, edges, warnings);
  buildBindingEdges(dump, ranges, nodes, edges, warnings);

  const scriptLike = dump.objects.filter((object) =>
    /Script|Listener/.test(object.typeName)
  );
  if (scriptLike.length > 0) {
    warnings.push(
      `${scriptLike.length} script/listener object(s) exist; arbitrary script/listener writes are not modeled as static property writers in v1`
    );
  }

  return {
    schemaVersion: 1,
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort(
      (a, b) =>
        a.from.localeCompare(b.from) ||
        a.kind.localeCompare(b.kind) ||
        a.to.localeCompare(b.to)
    ),
    warnings: [...new Set(warnings)].sort(),
  };
}

export function staticProvenanceFromRiv(bytes: Uint8Array): StaticProvenanceGraph {
  const dump = readRiv(bytes, { tolerant: true });
  const graph = buildStaticProvenanceGraph(dump);
  if (dump.error) graph.warnings.push(`binary parse warning: ${dump.error}`);
  graph.warnings = [...new Set(graph.warnings)].sort();
  return graph;
}

export function findPropertyNodes(
  graph: StaticProvenanceGraph,
  query: PropertyQuery
): StaticProvenanceNode[] {
  return graph.nodes.filter((node) => {
    if (node.kind !== "property") return false;
    if (query.artboard !== undefined && node.artboard !== query.artboard) return false;
    if (
      query.targetName !== undefined &&
      node.metadata.targetName !== query.targetName
    ) return false;
    if (
      query.targetType !== undefined &&
      node.metadata.targetType !== query.targetType
    ) return false;
    if (
      query.propertyName !== undefined &&
      node.metadata.propertyName !== query.propertyName
    ) return false;
    if (
      query.propertyKey !== undefined &&
      node.metadata.propertyKey !== query.propertyKey
    ) return false;
    return true;
  });
}

function incoming(
  graph: StaticProvenanceGraph,
  nodeId: string,
  kind?: ProvenanceEdgeKind
): StaticProvenanceEdge[] {
  return graph.edges.filter(
    (edge) => edge.to === nodeId && (kind === undefined || edge.kind === kind)
  );
}

export function explainPotentialWriters(
  graph: StaticProvenanceGraph,
  propertyNodeId: string
): PotentialWriterPath[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  if (nodeById.get(propertyNodeId)?.kind !== "property") return [];

  const paths: PotentialWriterPath[] = [];
  for (const writerEdge of incoming(graph, propertyNodeId, "writes")) {
    const writer = nodeById.get(writerEdge.from);
    if (!writer) continue;

    if (writer.kind === "animation") {
      const states = incoming(graph, writer.id, "activates");
      if (states.length === 0) {
        paths.push({
          propertyNodeId,
          nodeIds: [writer.id, propertyNodeId],
          edgeKinds: ["writes"],
        });
      } else {
        for (const stateEdge of states) {
          paths.push({
            propertyNodeId,
            nodeIds: [stateEdge.from, writer.id, propertyNodeId],
            edgeKinds: ["activates", "writes"],
          });
        }
      }
      continue;
    }

    if (writer.kind === "binding") {
      const feedIntoBinding = incoming(graph, writer.id, "feeds");
      if (feedIntoBinding.length === 0) {
        paths.push({
          propertyNodeId,
          nodeIds: [writer.id, propertyNodeId],
          edgeKinds: ["writes"],
        });
        continue;
      }

      for (const feed of feedIntoBinding) {
        const upstream = nodeById.get(feed.from);
        if (upstream?.kind === "converter") {
          const converterInputs = incoming(graph, upstream.id, "feeds");
          if (converterInputs.length) {
            for (const input of converterInputs) {
              paths.push({
                propertyNodeId,
                nodeIds: [input.from, upstream.id, writer.id, propertyNodeId],
                edgeKinds: ["feeds", "feeds", "writes"],
              });
            }
            continue;
          }
        }
        paths.push({
          propertyNodeId,
          nodeIds: [feed.from, writer.id, propertyNodeId],
          edgeKinds: ["feeds", "writes"],
        });
      }
      continue;
    }

    paths.push({
      propertyNodeId,
      nodeIds: [writer.id, propertyNodeId],
      edgeKinds: ["writes"],
    });
  }

  const unique = new Map<string, PotentialWriterPath>();
  for (const path of paths) {
    unique.set(path.nodeIds.join("->"), path);
  }
  return [...unique.values()].sort((a, b) =>
    a.nodeIds.join("/").localeCompare(b.nodeIds.join("/"))
  );
}
