# Causal Ambiguity / Competing Writer Analysis

A causal debugger should not stop after finding one plausible writer.

A Rive property can have multiple modeled writers, for example:

```text
Animation A ────────┐
                    ├─> Button.x
Data Binding ───────┘
```

If the runtime observes a state change for Animation A and also observes `Button.x` changing, that is useful evidence for the animation path — but the Data Binding path still exists and could have contributed.

## Output statuses

### `observed-support-single-modeled-writer`

The observed state + property change supports a static writer path and there are no other modeled writer paths.

This is strong evidence within the current model, but not absolute proof: script/listener/unsupported writers may still exist and are disclosed separately by Static Provenance warnings.

### `observed-support-with-competing-writers`

At least one writer path is supported by observation, but other modeled writer paths remain.

This is the most important anti-overclaim case.

### `single-modeled-writer-not-observed`

Exactly one static writer exists, but the current trace did not observe evidence tying it to the property change.

### `competing-modeled-writers-unattributed`

Multiple static writers exist and none is supported by the current observations.

### `unattributed-property-change`

The runtime directly observed a property change, but Static Provenance has no modeled writer for it.

This is useful: it points directly at a provenance blind spot or an unsupported writer mechanism.

### `ambiguous-property-identity`

The runtime name/property observation maps to multiple static property nodes. No forced match is made.

## Why this matters

The intended debugger progression is:

```text
property changed
  ↓
find all possible writers
  ↓
intersect with runtime observations
  ↓
retain competing writers
  ↓
state the strongest evidence-supported claim
```

not:

```text
find first plausible explanation
  ↓
declare it the cause
```

## API

`analyzeCausalAmbiguity(trace, graph, correlation?)`

Returns per-property-change writer paths, which paths are supported by observation, which remain competitors, explicit status, and aggregate counts.

The optional correlation argument lets callers reuse an already-produced Observed Trace correlation rather than recomputing it.
