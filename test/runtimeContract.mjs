import assert from "node:assert/strict";
import {
  buildRuntimeContract,
  diffRuntimeContracts,
} from "../dist/runtimeContract.js";

function contract(overrides = {}) {
  return {
    schemaVersion: 1,
    warnings: [],
    artboards: [
      {
        name: "Main",
        width: 400,
        height: 300,
        animations: [
          { name: "Idle", durationFrames: 60, fps: 60, speed: 1, loop: "loop" },
        ],
        stateMachines: [
          {
            name: "Logic",
            inputs: [
              { name: "count", type: "Number", defaultValue: 0 },
              { name: "enabled", type: "Boolean", defaultValue: true },
            ],
          },
        ],
        events: [{ name: "submitted", kind: "Event" }],
      },
    ],
    viewModels: [
      {
        name: "App",
        viewModelType: 0,
        instances: ["Default"],
        properties: [
          {
            name: "mode",
            kind: "enumCustom",
            typeName: "ViewModelPropertyEnumCustom",
            enumValues: [
              { key: "a", value: "A" },
              { key: "b", value: "B" },
            ],
          },
          {
            name: "enabled",
            kind: "boolean",
            typeName: "ViewModelPropertyBoolean",
          },
        ],
      },
    ],
    ...overrides,
  };
}

{
  const before = contract();
  const after = contract({
    artboards: [
      {
        name: "Main",
        width: 420,
        height: 300,
        animations: [],
        stateMachines: [
          {
            name: "Logic",
            inputs: [
              { name: "count", type: "Boolean", defaultValue: false },
              { name: "extra", type: "Boolean", defaultValue: false },
            ],
          },
        ],
        events: [],
      },
    ],
    viewModels: [
      {
        name: "App",
        viewModelType: 0,
        instances: [],
        properties: [
          {
            name: "mode",
            kind: "enumCustom",
            typeName: "ViewModelPropertyEnumCustom",
            enumValues: [{ key: "a", value: "A" }],
          },
          {
            name: "label",
            kind: "string",
            typeName: "ViewModelPropertyString",
          },
        ],
      },
    ],
  });

  const diff = diffRuntimeContracts(before, after);
  const byPath = new Map(diff.changes.map((change) => [change.path + ":" + change.kind, change]));

  assert.equal(byPath.get("/artboards/Main:dimensionChanged")?.severity, "behavior");
  assert.equal(byPath.get("/artboards/Main/animations/Idle:removed")?.severity, "breaking");
  assert.equal(byPath.get("/artboards/Main/events/submitted:removed")?.severity, "breaking");
  assert.equal(byPath.get("/artboards/Main/stateMachines/Logic/inputs/enabled:removed")?.severity, "breaking");
  assert.equal(byPath.get("/artboards/Main/stateMachines/Logic/inputs/count:typeChanged")?.severity, "breaking");
  assert.equal(byPath.get("/artboards/Main/stateMachines/Logic/inputs/count:defaultChanged")?.severity, "behavior");
  assert.equal(byPath.get("/artboards/Main/stateMachines/Logic/inputs/extra:added")?.severity, "nonBreaking");
  assert.equal(byPath.get("/viewModels/App/properties/enabled:removed")?.severity, "breaking");
  assert.equal(byPath.get("/viewModels/App/properties/label:added")?.severity, "nonBreaking");
  assert.equal(byPath.get("/viewModels/App/properties/mode/enum/b:enumValueRemoved")?.severity, "breaking");
  assert.equal(byPath.get("/viewModels/App/instances/Default:removed")?.severity, "breaking");
  assert.ok(diff.summary.breaking >= 7);
  assert.ok(diff.summary.behavior >= 2);
}

{
  const inspect = {
    artboardCount: 1,
    artboards: [
      {
        name: "Main",
        width: 640,
        height: 480,
        animations: [
          {
            name: "Idle",
            durationFrames: 60,
            durationSeconds: 1,
            fps: 60,
            speed: 1,
            loop: "loop",
          },
        ],
        stateMachines: [
          {
            name: "Logic",
            inputs: [{ name: "enabled", type: "Boolean", value: true }],
          },
        ],
      },
    ],
  };

  const dump = {
    major: 7,
    minor: 0,
    fileId: 1,
    toc: [],
    objects: [
      {
        index: 0,
        typeKey: 1,
        typeName: "Artboard",
        properties: { name: "Main" },
        unknownProps: [],
        raw: [],
      },
      {
        index: 1,
        typeKey: 2,
        typeName: "Event",
        properties: { name: "submitted" },
        unknownProps: [],
        raw: [],
      },
    ],
  };

  const dataBinding = {
    viewModels: [
      {
        index: 0,
        objectIndex: 2,
        name: "App",
        viewModelType: 0,
        instanceCount: 1,
        properties: [
          {
            localIndex: 0,
            objectIndex: 3,
            name: "enabled",
            kind: "boolean",
            typeName: "ViewModelPropertyBoolean",
          },
          {
            localIndex: 1,
            objectIndex: 4,
            name: "child",
            kind: "viewModel",
            typeName: "ViewModelPropertyViewModel",
            viewModelReferenceIndex: 1,
          },
        ],
      },
      {
        index: 1,
        objectIndex: 5,
        name: "Child",
        viewModelType: 0,
        instanceCount: 0,
        properties: [],
      },
    ],
    viewModelInstances: [
      {
        index: 0,
        objectIndex: 6,
        localIndex: 0,
        name: "Default",
        viewModelIndex: 0,
        viewModelName: "App",
        values: [],
      },
    ],
    enums: [],
    systemEnums: [],
    converters: [],
    converterGroupItems: [],
    dataBinds: [],
    dataBindPaths: [],
  };

  const built = buildRuntimeContract(inspect, dump, dataBinding);
  assert.equal(built.artboards[0].events[0].name, "submitted");
  assert.equal(built.viewModels[0].name, "App");
  assert.equal(
    built.viewModels[0].properties.find((property) => property.name === "child")?.referencedViewModel,
    "Child"
  );
  assert.deepEqual(built.viewModels[0].instances, ["Default"]);
}

console.log("runtimeContract: all tests passed");
