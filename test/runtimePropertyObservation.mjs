import assert from "node:assert/strict";
import { createRiv } from "../dist/rivWriter.js";
import { RiveHost } from "../dist/riveHost.js";
import { PAGE_SCRIPT } from "../dist/pageScript.js";
import {
  correlateObservedTrace,
  observedTraceFromPlayResult,
} from "../dist/observedTrace.js";
import { staticProvenanceFromRiv } from "../dist/staticProvenance.js";

const spec = {
  name: "Main",
  width: 200,
  height: 120,
  groups: [{ id: "box", x: 0, y: 40 }],
  shapes: [
    {
      id: "rect",
      parent: "box",
      type: "rect",
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      fill: { color: "#3366ff" },
    },
  ],
  animations: [
    {
      name: "idle",
      duration: 30,
      loop: "loop",
      tracks: [
        {
          target: "box",
          property: "x",
          keyframes: [
            { frame: 0, value: 0 },
            { frame: 30, value: 0 },
          ],
        },
      ],
    },
    {
      name: "moved",
      duration: 30,
      loop: "oneShot",
      tracks: [
        {
          target: "box",
          property: "x",
          keyframes: [
            { frame: 0, value: 0 },
            { frame: 30, value: 100 },
          ],
        },
      ],
    },
  ],
  stateMachine: {
    name: "Logic",
    inputs: [{ name: "go", type: "trigger" }],
    states: [
      { name: "idleState", animation: "idle" },
      { name: "movedState", animation: "moved" },
    ],
    transitions: [
      { from: "entry", to: "idleState" },
      { from: "idleState", to: "movedState", condition: { input: "go" } },
    ],
  },
};

const { bytes } = createRiv(spec);
const host = new RiveHost(PAGE_SCRIPT);

try {
  const play = await host.playStateMachine(Buffer.from(bytes), {
    artboard: "Main",
    stateMachine: "Logic",
    watchProperties: [{ target: "box", property: "x" }],
    steps: [
      { advance: 0.1 },
      { input: "go", advance: 0.25 },
    ],
  });

  assert.equal(play.report.length, 3);
  for (const entry of play.report) {
    assert.ok(Array.isArray(entry.properties));
    assert.deepEqual(entry.propertyWarnings, []);
  }

  const initial = play.report[0].properties[0];
  const afterIdle = play.report[1].properties[0];
  const afterMove = play.report[2].properties[0];

  assert.equal(initial.target, "box");
  assert.equal(initial.property, "x");
  assert.equal(typeof initial.value, "number");
  assert.equal(typeof afterIdle.value, "number");
  assert.equal(typeof afterMove.value, "number");
  assert.notEqual(
    afterMove.value,
    afterIdle.value,
    "official runtime observation must record the animated property change"
  );

  const trace = observedTraceFromPlayResult(play, {
    artboard: "Main",
    stateMachine: "Logic",
    backend: "RiveHost/canvas-advanced",
  });

  const propertyChanges = trace.events.filter(
    (event) =>
      event.type === "propertyValueChanged" &&
      event.target === "box" &&
      event.property === "x"
  );
  assert.ok(propertyChanges.length >= 1);

  const graph = staticProvenanceFromRiv(bytes);
  const correlation = correlateObservedTrace(trace, graph);
  const strong = correlation.support.filter(
    (item) =>
      item.relation === "observed-state-and-property-change-support-writer"
  );

  assert.ok(
    strong.some((item) => {
      const property = graph.nodes.find((node) => node.id === item.propertyNodeId);
      return (
        property?.metadata.targetName === "box" &&
        property?.metadata.propertyName === "x"
      );
    }),
    "runtime-observed box.x change should strengthen a matching static writer path"
  );

  const unsupported = await host.playStateMachine(Buffer.from(bytes), {
    artboard: "Main",
    stateMachine: "Logic",
    watchProperties: [{ target: "box", property: "opacity" }],
    steps: [],
  });
  assert.ok(
    unsupported.report[0].propertyWarnings.some((warning) =>
      warning.includes("Unsupported watched property")
    )
  );
} finally {
  await host.close();
}

console.log("runtimePropertyObservation: all tests passed");
