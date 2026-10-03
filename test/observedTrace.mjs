import assert from "node:assert/strict";
import { writeRiv } from "../dist/rivWriter.js";
import {
  correlateObservedTrace,
  observedTraceFromPlayResult,
} from "../dist/observedTrace.js";
import { staticProvenanceFromRiv } from "../dist/staticProvenance.js";

{
  const trace = observedTraceFromPlayResult(
    {
      report: [
        {
          step: "init",
          statesChanged: ["Fade"],
          inputs: [
            { name: "enabled", type: "Boolean", value: false },
            { name: "score", type: "Number", value: 0 },
          ],
        },
        {
          step: 0,
          advancedSeconds: 0.2,
          statesChanged: [],
          inputs: [
            { name: "enabled", type: "Boolean", value: true },
            { name: "score", type: "Number", value: 10 },
          ],
        },
      ],
    },
    { artboard: "Main", stateMachine: "Logic", backend: "RiveHost" }
  );

  const stateEvents = trace.events.filter((event) => event.type === "stateChange");
  const inputChanges = trace.events.filter((event) => event.type === "inputValueChanged");

  assert.equal(stateEvents.length, 1);
  assert.equal(stateEvents[0].stateName, "Fade");
  assert.equal(inputChanges.length, 2);
  assert.deepEqual(
    inputChanges.map((event) => [event.inputName, event.before, event.after]),
    [
      ["enabled", false, true],
      ["score", 0, 10],
    ]
  );
}

{
  const bytes = writeRiv([
    { type: "Artboard", props: { name: "Main", width: 400, height: 300 } },
    { type: "Node", props: { name: "Button" } },
    { type: "LinearAnimation", props: { name: "Fade", duration: 60, fps: 60 } },
    { type: "KeyedObject", props: { objectId: 1 } },
    { type: "KeyedProperty", props: { propertyKey: 13 } },
    { type: "StateMachine", props: { name: "Logic" } },
    { type: "StateMachineLayer", props: { name: "Layer 1" } },
    { type: "EntryState", props: {} },
    { type: "AnimationState", props: { animationId: 0 } },
  ]);

  const graph = staticProvenanceFromRiv(bytes);
  const trace = observedTraceFromPlayResult(
    {
      report: [
        {
          step: "init",
          statesChanged: ["Fade"],
          inputs: [],
        },
      ],
    },
    { artboard: "Main", stateMachine: "Logic" }
  );

  const correlation = correlateObservedTrace(trace, graph);
  assert.equal(correlation.support.length, 1);
  assert.equal(correlation.unmatchedObservations.length, 0);
  assert.equal(correlation.ambiguousObservations.length, 0);
  assert.equal(
    correlation.support[0].relation,
    "observed-state-supports-potential-writer"
  );

  const property = graph.nodes.find(
    (node) =>
      node.kind === "property" &&
      node.metadata.targetName === "Button" &&
      node.metadata.propertyName === "x"
  );
  assert.ok(property);
  assert.equal(correlation.support[0].propertyNodeId, property.id);
  assert.ok(
    correlation.warnings.some((warning) => warning.includes("does not prove")),
    "correlation must disclose that no property value change was observed"
  );

  assert.deepEqual(
    correlateObservedTrace(trace, graph),
    correlation,
    "trace correlation is deterministic"
  );
}

{
  const graph = staticProvenanceFromRiv(
    writeRiv([
      { type: "Artboard", props: { name: "Main", width: 400, height: 300 } },
      { type: "StateMachine", props: { name: "Logic" } },
      { type: "StateMachineLayer", props: { name: "Layer 1" } },
      { type: "EntryState", props: {} },
    ])
  );

  const trace = observedTraceFromPlayResult(
    {
      report: [
        { step: "init", statesChanged: ["UnknownState"], inputs: [] },
      ],
    },
    { artboard: "Main", stateMachine: "Logic" }
  );

  const correlation = correlateObservedTrace(trace, graph);
  assert.equal(correlation.support.length, 0);
  assert.equal(correlation.unmatchedObservations.length, 1);
}

console.log("observedTrace: all tests passed");
