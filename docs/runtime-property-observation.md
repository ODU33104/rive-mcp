# Runtime Property Observation

This layer upgrades causal debugging from structural possibility to direct runtime observation for a deliberately small, verified property surface.

## Supported checkpoint watches

The current canvas-advanced runtime exposes named Artboard accessors for Nodes, TransformComponents, and TextValueRuns. The instrumentation therefore supports:

- Node: `x`, `y`
- TransformComponent: `rotation`, `scaleX`, `scaleY`
- TextValueRun: `text`

A play request can include:

```ts
watchProperties: [
  { target: "button", property: "x" },
  { target: "title", property: "text" },
]
```

The existing `playStateMachine` report then records `properties` and `propertyWarnings` for the initial checkpoint and every scenario step.

## Evidence levels

The causal stack now distinguishes three levels.

### 1. Static possibility

```text
State -> Animation -> Property
```

The authored graph says the animation can write the property.

### 2. Observed state only

```text
runtime observed state change
+
static writer path
```

Relation:

`observed-state-supports-potential-writer`

This does not prove the property changed.

### 3. Observed state + observed property change

```text
runtime observed state change
+
runtime observed Target.property before -> after
+
matching static writer path
```

Relation:

`observed-state-and-property-change-support-writer`

This is stronger evidence, but still does not claim exclusive causality: another writer may have contributed during the same checkpoint interval.

## Why the watcher is explicit

The runtime is not asked to dump every object/property on every frame. Callers select the properties relevant to the failure.

This keeps:
- trace volume bounded;
- evidence easy to inspect;
- runtime overhead predictable;
- causal claims tied to explicitly observed values.

## Deliberate limitations

- ViewModel runtime values are not yet checkpoint-observed in this layer.
- opacity/fill/stroke and arbitrary Core properties are not read through undocumented internals.
- nested-artboard path lookup is not yet exposed.
- a checkpoint observes the value after that step's advance; it is not a continuous per-frame trace.
- simultaneous state/property changes strengthen a causal hypothesis but do not prove exclusive causation.

Unsupported watches return explicit warnings rather than guessed values.

## Validation

The integration test creates a real `.riv`, drives its State Machine with the official canvas-advanced runtime, observes `box.x` before/after a transition, converts that report into Observed Trace events, and confirms that the actual property change strengthens the matching static writer path.
