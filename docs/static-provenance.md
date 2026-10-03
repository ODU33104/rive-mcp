# Static Property Provenance

Static Provenance answers a deliberately narrow question:

> What authored mechanisms **could write** this property?

It does **not** claim to know what actually caused a value in one runtime execution. Dynamic/observed causality belongs to a later trace layer.

## v1 modeled paths

Animation-driven property:

```text
State Machine AnimationState
        ↓ activates
LinearAnimation
        ↓ writes
Target.property
```

Data Binding-driven property:

```text
ViewModel source (opaque IDs for now)
        ↓ feeds
Converter (optional)
        ↓ feeds
Data Binding
        ↓ writes
Target.property
```

Two-way and to-source bindings preserve direction. A to-source-only binding is not reported as a potential writer of the scene target property.

## Why this is separate from Explorer

The State-space Explorer answers:

> Which states/transitions did this scenario reach?

Static Provenance answers:

> Which authored mechanisms can influence this property at all?

Later a dynamic trace can intersect the two and answer a stronger question:

> Which potential writer was actually observed in this execution?

## API

`staticProvenanceFromRiv(bytes)`

Builds a deterministic node/edge graph from a `.riv`.

`findPropertyNodes(graph, query)`

Finds property nodes by artboard, target name/type, property name/key.

`explainPotentialWriters(graph, propertyNodeId)`

Returns potential writer paths leading to the property.

## Deliberate limitations

- Data Binding source paths remain numeric/opaque because the current decoder does not yet prove a stable semantic ViewModel path mapping.
- Blend state activation provenance is not expanded in v1.
- Arbitrary script/listener writes are not modeled in v1.
- Index fallback is used for unnamed authored targets and disclosed in warnings.
- The graph is bound to an exact artifact. Node IDs are deterministic for that artifact but are not a cross-version semantic identity system.

Unsupported/unknown relationships are exposed as warnings rather than silently presented as complete causality.
