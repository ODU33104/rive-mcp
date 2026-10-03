# Observed Causal Trace Boundary

This layer deliberately separates **observation** from **causal inference**.

## What is observed today

The existing `RiveHost.playStateMachine` report exposes, per step:

- State Machine state-change names reported by the official runtime;
- current State Machine input snapshots;
- elapsed/advanced time for authored steps.

`observedTraceFromPlayResult()` normalizes those facts into deterministic trace events.

It also derives `inputValueChanged` from adjacent input snapshots. That derived event means only that two observations differed; it does not claim which actor wrote the input.

## Static + observed correlation

When an observed state-change name matches exactly one static State Machine state, and that state activates an animation which statically writes a property, the correlator emits:

```text
observed state change
      ↓ structurally supports
static State → Animation → Property potential-writer path
```

The relation is named:

`observed-state-supports-potential-writer`

This is intentionally weaker than:

> this state caused this property value

because the current runtime report does not observe the property value itself.

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

The next step is not more inference. It is better observation:

1. capture selected property values at scenario checkpoints;
2. record ViewModel property snapshots where the runtime exposes them;
3. preserve exact scenario step/time identity;
4. only then promote structural support into stronger observed causal evidence.

No claim should become stronger merely because the heuristic became more complicated.
