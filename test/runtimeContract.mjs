import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RiveHost } from "../dist/riveHost.js";
import { PAGE_SCRIPT } from "../dist/pageScript.js";
import {
  buildRuntimeContract,
  diffRuntimeContracts,
  runtimeContractFromRiv,
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
        instances: [
          {
            name: "Default",
            values: [{ name: "enabled", kind: "boolean", value: true }],
          },
        ],
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
    bindings: [
      {
        name: "Node:submitButton:opacity",
        targetType: "Node",
        targetName: "submitButton",
        targetProperty: "opacity",
        direction: "toTarget",
        twoWay: false,
        once: false,
        sourceToTargetRunsFirst: false,
        nameBased: true,
        converterName: "opacityConverter",
        converterType: "DataConverterToNumber",
        sourcePathIds: [0],
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
  const before = contract();
  const after = contract({
    viewModels: [
      {
        name: "App",
        viewModelType: 0,
        instances: [
          {
            name: "Default",
            values: [{ name: "enabled", kind: "boolean", value: false }],
          },
        ],
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
    bindings: [
      {
        name: "Node:submitButton:opacity",
        targetType: "Node",
        targetName: "submitButton",
        targetProperty: "opacity",
        direction: "toSource",
        twoWay: true,
        once: false,
        sourceToTargetRunsFirst: false,
        nameBased: true,
        converterName: "opacityConverter",
        converterType: "DataConverterToNumber",
        sourcePathIds: [1],
      },
    ],
  });

  const diff = diffRuntimeContracts(before, after);
  const kinds = new Set(diff.behavior.map((change) => change.kind));
  assert.ok(kinds.has("instanceDefaultChanged"), "authored instance default changes are behavioral");
  assert.ok(kinds.has("bindingChanged"), "binding flag/converter changes are behavioral");
  assert.equal(diff.breaking.length, 0);
}

{
  const before = contract();
  const after = contract({
    bindings: [
      {
        ...contract().bindings[0],
        sourcePathIds: [99, 4],
      },
    ],
  });
  const diff = diffRuntimeContracts(before, after);
  assert.equal(
    diff.summary.total,
    0,
    "opaque numeric source path changes are not treated as semantic behavior changes"
  );
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
        values: [
          {
            localPropertyIndex: 0,
            propertyName: "enabled",
            kind: "boolean",
            typeName: "ViewModelInstanceBoolean",
            objectIndex: 7,
            value: true,
          },
        ],
      },
    ],
    enums: [],
    systemEnums: [],
    converters: [
      {
        index: 0,
        objectIndex: 8,
        name: "toNumber",
        kind: "toNumber",
        typeName: "DataConverterToNumber",
        properties: {},
      },
    ],
    converterGroupItems: [],
    dataBinds: [
      {
        objectIndex: 9,
        typeName: "DataBindContext",
        target: { objectIndex: 10, typeName: "Node", name: "submitButton" },
        propertyKey: 18,
        propertyName: "opacity",
        flags: {
          raw: 16,
          direction: "toTarget",
          twoWay: false,
          once: false,
          sourceToTargetRunsFirst: false,
          nameBased: true,
        },
        converterIndex: 0,
        converterName: "toNumber",
        sourcePathIds: [0],
      },
    ],
    dataBindPaths: [],
  };

  const built = buildRuntimeContract(inspect, dump, dataBinding);
  assert.equal(built.artboards[0].events[0].name, "submitted");
  assert.equal(built.viewModels[0].name, "App");
  assert.equal(
    built.viewModels[0].properties.find((property) => property.name === "child")?.referencedViewModel,
    "Child"
  );
  assert.deepEqual(built.viewModels[0].instances, [
    {
      name: "Default",
      values: [{ name: "enabled", kind: "boolean", value: true }],
    },
  ]);
  assert.equal(built.bindings.length, 1);
  assert.ok(
    built.warnings.some((warning) => warning.includes("sourcePathIds")),
    "opaque binding source paths are disclosed as a limitation"
  );
  assert.deepEqual(built.bindings[0], {
    name: "Node:submitButton:opacity",
    targetType: "Node",
    targetName: "submitButton",
    targetProperty: "opacity",
    direction: "toTarget",
    twoWay: false,
    once: false,
    sourceToTargetRunsFirst: false,
    nameBased: true,
    converterName: "toNumber",
    converterType: "DataConverterToNumber",
    sourcePathIds: [0],
  });
}

{
  const bytes = readFileSync("samples/showcase.riv");
  const host = new RiveHost(PAGE_SCRIPT);
  try {
    const inspect = await host.inspect(bytes);
    const realContract = runtimeContractFromRiv(bytes, inspect);
    assert.ok(realContract.artboards.length > 0, "real fixture exposes at least one artboard");
    const selfDiff = diffRuntimeContracts(realContract, realContract);
    assert.deepEqual(selfDiff.summary, { breaking: 0, behavior: 0, nonBreaking: 0, total: 0 });
    assert.deepEqual(
      runtimeContractFromRiv(bytes, inspect),
      realContract,
      "contract extraction is deterministic for the same real fixture"
    );
  } finally {
    await host.close();
  }
}

console.log("runtimeContract: all tests passed");
