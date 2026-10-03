import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { writeRiv } from "../dist/rivWriter.js";
import {
  explainPotentialWriters,
  findPropertyNodes,
  staticProvenanceFromRiv,
} from "../dist/staticProvenance.js";

function packVaruints(values) {
  const bytes = [];
  for (let v of values) {
    do {
      let b = v & 0x7f;
      v >>>= 7;
      if (v) b |= 0x80;
      bytes.push(b);
    } while (v);
  }
  return new Uint8Array(bytes);
}

function nodeKinds(graph, path) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  return path.nodeIds.map((id) => byId.get(id)?.kind);
}

{
  const objects = [
    { type: "ViewModel", props: { name: "App" } },
    { type: "ViewModelPropertyNumber", props: { name: "score" } },
    { type: "DataConverterToNumber", props: { name: "toNumber" } },

    { type: "Artboard", props: { name: "Main", width: 400, height: 300 } },
    { type: "Node", props: { name: "Button" } },

    { type: "LinearAnimation", props: { name: "Fade", duration: 60, fps: 60 } },
    { type: "KeyedObject", props: { objectId: 1 } },
    { type: "KeyedProperty", props: { propertyKey: 13 } },

    { type: "StateMachine", props: { name: "Logic" } },
    { type: "StateMachineLayer", props: { name: "Layer 1" } },
    { type: "EntryState", props: {} },
    { type: "AnimationState", props: { animationId: 0 } },

    { type: "Node", props: { name: "BoundTarget" } },
    {
      type: "DataBindContext",
      props: {
        propertyKey: 13,
        flags: 0,
        converterId: 0,
        sourcePathIds: packVaruints([0]),
      },
    },

    { type: "Node", props: { name: "ReverseTarget" } },
    {
      type: "DataBindContext",
      props: {
        propertyKey: 13,
        flags: 1,
        sourcePathIds: packVaruints([0]),
      },
    },
  ];

  const graph = staticProvenanceFromRiv(writeRiv(objects));

  const buttonX = findPropertyNodes(graph, {
    artboard: "Main",
    targetName: "Button",
    propertyName: "x",
  });
  assert.equal(buttonX.length, 1);

  const animationPaths = explainPotentialWriters(graph, buttonX[0].id);
  assert.equal(animationPaths.length, 1);
  assert.deepEqual(nodeKinds(graph, animationPaths[0]), ["state", "animation", "property"]);
  assert.deepEqual(animationPaths[0].edgeKinds, ["activates", "writes"]);

  const boundX = findPropertyNodes(graph, {
    artboard: "Main",
    targetName: "BoundTarget",
    propertyName: "x",
  });
  assert.equal(boundX.length, 1);

  const bindingPaths = explainPotentialWriters(graph, boundX[0].id);
  assert.equal(bindingPaths.length, 1);
  assert.deepEqual(
    nodeKinds(graph, bindingPaths[0]),
    ["bindingSource", "converter", "binding", "property"]
  );
  assert.deepEqual(bindingPaths[0].edgeKinds, ["feeds", "feeds", "writes"]);

  const reverseX = findPropertyNodes(graph, {
    artboard: "Main",
    targetName: "ReverseTarget",
    propertyName: "x",
  });
  assert.equal(reverseX.length, 1);
  assert.deepEqual(
    explainPotentialWriters(graph, reverseX[0].id),
    [],
    "toSource-only binding must not be reported as a writer of the scene property"
  );

  assert.ok(
    graph.warnings.some((warning) => warning.includes("opaque numeric IDs")),
    "unresolved binding source semantics are disclosed"
  );

  const repeated = staticProvenanceFromRiv(writeRiv(objects));
  assert.deepEqual(repeated, graph, "same bytes produce deterministic provenance graph");
}

{
  const bytes = readFileSync("samples/showcase.riv");
  const graph = staticProvenanceFromRiv(bytes);
  assert.equal(graph.schemaVersion, 1);
  assert.ok(Array.isArray(graph.nodes));
  assert.ok(Array.isArray(graph.edges));
  assert.deepEqual(
    staticProvenanceFromRiv(bytes),
    graph,
    "real fixture provenance extraction is deterministic"
  );
}

console.log("staticProvenance: all tests passed");
