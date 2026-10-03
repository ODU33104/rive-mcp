import assert from "node:assert/strict";
import { writeRiv } from "../dist/rivWriter.js";
import { analyzeCausalAmbiguity } from "../dist/causalAmbiguity.js";
import {
  correlateObservedTrace,
  observedTraceFromPlayResult,
} from "../dist/observedTrace.js";
import { staticProvenanceFromRiv } from "../dist/staticProvenance.js";

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

function traceFor(target = "Button", property = "x") {
  return observedTraceFromPlayResult(
    {
      report: [
        {
          step: "init",
          statesChanged: [],
          inputs: [],
          properties: [{ target, property, value: 0 }],
        },
        {
          step: 0,
          statesChanged: ["Fade"],
          inputs: [],
          properties: [{ target, property, value: 10 }],
        },
      ],
    },
    { artboard: "Main", stateMachine: "Logic" }
  );
}

function animationObjects() {
  return [
    { type: "LinearAnimation", props: { name: "Fade", duration: 60, fps: 60 } },
    { type: "KeyedObject", props: { objectId: 1 } },
    { type: "KeyedProperty", props: { propertyKey: 13 } },
    { type: "StateMachine", props: { name: "Logic" } },
    { type: "StateMachineLayer", props: { name: "Layer 1" } },
    { type: "EntryState", props: {} },
    { type: "AnimationState", props: { animationId: 0 } },
  ];
}

{
  const bytes = writeRiv([
    { type: "ViewModel", props: { name: "App" } },
    { type: "ViewModelPropertyNumber", props: { name: "score" } },
    { type: "Artboard", props: { name: "Main", width: 300, height: 200 } },
    { type: "Node", props: { name: "Button" } },
    {
      type: "DataBindContext",
      props: {
        propertyKey: 13,
        flags: 0,
        sourcePathIds: packVaruints([0]),
      },
    },
    ...animationObjects(),
  ]);

  const graph = staticProvenanceFromRiv(bytes);
  const trace = traceFor();
  const correlation = correlateObservedTrace(trace, graph);
  const report = analyzeCausalAmbiguity(trace, graph, correlation);

  assert.equal(report.properties.length, 1);
  assert.equal(
    report.properties[0].status,
    "observed-support-with-competing-writers"
  );
  assert.equal(report.properties[0].writerPaths.length, 2);
  assert.equal(report.properties[0].supportedWriterPaths.length, 1);
  assert.equal(report.properties[0].competingWriterPaths.length, 1);

  const competitorKinds = report.properties[0].competingWriterPaths[0].nodeIds
    .map((id) => graph.nodes.find((node) => node.id === id)?.kind)
    .filter(Boolean);
  assert.ok(
    competitorKinds.includes("binding"),
    "the unobserved Data Binding path remains an explicit competing writer"
  );
  assert.equal(report.summary.observedSupportWithCompetitors, 1);
  assert.ok(report.warnings.some((warning) => warning.includes("competing modeled writer")));

  assert.deepEqual(
    analyzeCausalAmbiguity(trace, graph, correlation),
    report,
    "ambiguity analysis is deterministic"
  );
}

{
  const bytes = writeRiv([
    { type: "Artboard", props: { name: "Main", width: 300, height: 200 } },
    { type: "Node", props: { name: "Button" } },
    ...animationObjects(),
  ]);

  const graph = staticProvenanceFromRiv(bytes);
  const trace = traceFor();
  const report = analyzeCausalAmbiguity(trace, graph);

  assert.equal(report.properties.length, 1);
  assert.equal(
    report.properties[0].status,
    "observed-support-single-modeled-writer"
  );
  assert.equal(report.properties[0].supportedWriterPaths.length, 1);
  assert.equal(report.properties[0].competingWriterPaths.length, 0);
  assert.equal(report.summary.observedSupportSingleWriter, 1);
}

{
  const bytes = writeRiv([
    { type: "Artboard", props: { name: "Main", width: 300, height: 200 } },
    { type: "Node", props: { name: "Button" } },
    ...animationObjects(),
  ]);
  const graph = staticProvenanceFromRiv(bytes);
  const trace = traceFor("Unknown", "x");
  const report = analyzeCausalAmbiguity(trace, graph);

  assert.equal(report.properties.length, 1);
  assert.equal(report.properties[0].status, "unattributed-property-change");
  assert.equal(report.properties[0].writerPaths.length, 0);
  assert.equal(report.summary.unattributed, 1);
}

console.log("causalAmbiguity: all tests passed");
