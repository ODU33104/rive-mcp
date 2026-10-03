# Observed Causal Trace Boundary

This layer deliberately separates **observation** from **causal inference**.

## What is observed today

The existing `RiveHost.playStateMachine` report exposes, per step:

- State Machine state-change names reported by the official runtime;
- current State Machine input snapshots;
- elapsed/advanced time for authored steps;
- optional explicitly watched Node/Transform/Text property snapshots.

`observedTraceFromPlayResult()` normalizes those facts into deterministic trace events.

It derives `inputValueChanged` and `propertyValueChanged` only from adjacent snapshots. Those derived events mean that two observations differed; they do not by themselves identify the writer.

## Static + observed correlation

When an observed state-change name matches exactly one static State Machine state, and that state activates an animation which statically writes a property, the correlator emits:

```text
observed state change
      ↓ structurally supports
static State → Animation → Property potential-writer path
```

If only the state is observed, the relation is:

`observed-state-supports-potential-writer`

If the matching property is also directly observed to change at the same checkpoint, the stronger relation is:

`observed-state-and-property-change-support-writer`

The stronger relation still does not mean:

> this state was the only cause of this property value

because another writer could have contributed in the same checkpoint interval.

## Why this boundary matters

A causal debugger becomes misleading if it turns:

- a static possible writer;
- a runtime state notification; and
- a property-value change

into one undifferentiated “cause”.

The data model keeps those evidence classes separate so later instrumentation can strengthen claims without rewriting earlier evidence.

## API

`observedTraceFromPlayResult(result, context?)`

Normalizes current RiveHost play reports into:

- `inputSnapshot`
- `inputValueChanged`
- `stateChange`

`correlateObservedTrace(trace, graph)`

Matches observed state changes against the Static Provenance graph and returns:

- structurally supported potential-writer paths;
- unmatched observations;
- ambiguous observations;
- explicit limitations.

## Next evidence upgrade

Scene property checkpoint observation is now available for the verified Node/Transform/Text surface.

The next step is still better observation rather than more inference:

1. record ViewModel property snapshots through documented runtime APIs;
2. preserve exact scenario step/time identity across backends;
3. add narrower sub-frame checkpoints only when a failure requires them;
4. identify competing observed/static writers before making stronger causal claims.

No claim should become stronger merely because the heuristic became more complicated.
