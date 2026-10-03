# Real-world Causal Debugger Calibration

Issue #35 calibrates the existing causal-debugger stack on the qualified real-world corpus. This is a QA/calibration result, not a new causal algorithm.

Baseline: PR #38 integration head `69ea152db6cd1192fab36a4437ac266bc755b0ef`.

Causal components exercised unchanged:

- #21 Static Provenance
- #22 Observed Trace
- #23 Runtime Property Observation
- #24 Causal Ambiguity
- #32 Qualified Real-world Fixture Corpus

Synthetic regressions are still run, but they are not counted as real validation.

## Evidence vocabulary

The calibration keeps these statements distinct:

- **static possible writer**: an authored path in the static provenance graph can write a property.
- **observed state/input/property**: a runtime checkpoint actually reported that value/event.
- **structurally supported writer**: an observed state and observed property change support a matching static State -> Animation -> Property path.
- **competing writer remains**: another modeled static writer path remains after observed support.
- **unattributed**: a runtime-observed property change has no adequately attributable modeled writer under the existing ambiguity analysis.

No writer is described as the exclusive cause.

## Fixed real corpus

### official-flutter-controller-basic

Artifact:

`sha256:adf0dd0ab7dff250ba939403cba5b0bf6004a09c735b183fbc623213eb28249a`

Scenario:

`controller-basic-advance` — advance the default controller by 1/60 second.

Runtime selection is source-defined and confirmed by #32:

- artboard: `Artboard1`
- state machine: `State Machine 1`

Observed runtime evidence:

- initial state notification: `Timeline 1`
- input changes: 0
- observed property snapshots: 0
- observed property changes: 0

Static provenance on the full artifact contains 2 property nodes / 2 writer paths. On the executed default artboard, the relevant modeled property is:

```text
property:a0:o3:p37
SolidColor#3.colorValue
target type: SolidColor
target name: <none>
writer:
  binding-source:o20
    -> binding:o20
    -> SolidColor#3.colorValue
```

This is a **static possible Data Binding writer** only. The observed `Timeline 1` state does not provide observed support for that binding writer.

The current #23 watcher cannot observe this property. Its supported runtime surface is named `x`, `y`, `rotation`, `scaleX`, `scaleY`, and `text`. The real property is unnamed and only has an index-fallback static identity.

Current Official canvas-advanced low-level typings were also checked for a semantically safe extension. The exposed Artboard API provides named Node / TransformComponent / TextValueRun access, but does not expose `SolidColor`, `colorValue`, or a generic stable core-object-by-index read suitable for this static identity.

Therefore adding a color watcher here would require undocumented Core access or guessed object identity. No such observer was added.

Static warnings: 3:

- Data Binding source paths remain opaque numeric IDs.
- `Artboard1/SolidColor#3` uses index fallback because it has no name.
- `Artboard2/SolidColor#1` uses index fallback because it has no name.

Causal metrics:

| Metric | Value |
| --- | ---: |
| observed property changes | 0 |
| changes with modeled static writer | 0 |
| changes with observed-supported writer | 0 |
| changes with competing modeled writer | 0 |
| unattributed property changes | 0 |
| ambiguous property identities | 0 |

The zero unattributed count is **not** evidence that every runtime change is explained. No runtime property value was observable for this scenario, so there was no property-change event to classify.

### official-flutter-rapid-pointer

Artifact:

`sha256:e0584ba73df9bf8a7ac1a4ff1c3e381212967b10025d936e49ddab3d30a13079`

Scenario:

`rapid-pointer-down-up`.

Static provenance is available and deterministic:

- property nodes: 5
- writer paths: 3
- provenance warnings: 7

Dynamic causal calibration status: **unsupported** on the #38 causal path.

Reason: #22-#24 `playStateMachine` does not accept pointer Scenario actions. #37 demonstrates a raw-`.riv` pointer execution path, but #39 has not yet qualified that path on the full stack used by this calibration. This session does not reimplement execution architecture.

No pointer-derived property or ViewModel value is inferred.

### official-flutter-rewards-data-binding

Artifact:

`sha256:9f2fe2408433754350c808c82772fc58fc67228cae02fc0b1d5123a6b80745e3`

Scenario:

`rewards-data-binding`.

Static provenance is available and deterministic:

- property nodes: 118
- writer paths: 199
- provenance warnings: 96

Dynamic causal calibration status: **unsupported**.

Reason: the current causal observation path does not apply/checkpoint the Scenario's ViewModel data writes. The fixture has rich static Data Binding provenance, but turning those paths into observed support without runtime ViewModel checkpoints would overstate evidence.

No ViewModel value is guessed.

## Self-improvement loop

### Iteration 1 — baseline

Hypothesis: at least the small `controller-basic` fixture can provide a real property-change attribution baseline through the existing #23 watcher.

Result:

- real State Machine execution: yes
- observed state: yes
- watchable modeled property on the executed artboard: **0**
- observed property changes: **0**
- observed-supported writer paths: **0**

`rapid-pointer` and `rewards-data-binding` are explicit unsupported cases for the current causal observation path.

Decision: **KEEP** the negative baseline.

### Iteration 2 — largest concrete blind spot

Measured blind spot:

> the only modeled property on `controller-basic/Artboard1` is unnamed `SolidColor#3.colorValue`, so #23 cannot checkpoint it.

Narrow hypothesis:

> add runtime observation for that exact property only if a stable, documented runtime identity/read exists.

Investigation result:

- static identity is index fallback, not a stable target name;
- current official low-level runtime surface does not expose a `SolidColor.colorValue` lookup or generic stable object-by-index getter;
- using arbitrary Core reads would violate #23's existing evidence boundary.

Causal/observer algorithm change: **not attempted**.

Calibration-only change:

- before: `controller-basic` executed with `unsupportedObservationMechanisms=[]`, which hid the property-observation boundary;
- after: the exact unsupported property identity and reason are retained in calibration evidence.

Before attribution counts: all 0.

After attribution counts: all 0.

Decision: **KEEP** the explicit observation-gap evidence; do not add false causal reach.

### Iteration 3 — permanent calibration

Permanent expectation:

`test/fixtures/causal-calibration/real-fixtures-v1.json`

It pins:

- artifact/scenario identities;
- static property/writer counts;
- warning counts;
- execution vs unsupported status;
- controller runtime artboard/state-machine selection;
- controller observed state;
- controller unsupported property identity;
- zero observed attribution counts;
- rapid-pointer/rewards unsupported mechanisms.

The calibration corpus is executed twice in one CI run and must be byte-for-byte equal after normalization.

Decision: **KEEP**.

## Determinism and CI

Final calibration gate runs:

- build;
- existing #21 static provenance regression;
- existing #22 observed trace regression;
- existing #23 runtime property observation regression;
- existing #24 causal ambiguity regression;
- exact #32 real fixture acquisition/hash validation;
- real calibration corpus twice;
- permanent expectation comparison;
- public MCP entrypoint guard.

No public MCP tool is added.

## Largest remaining blind spot

The largest current causal-debugger gap exposed by these real fixtures is **runtime observation coverage**, not another causal-classification rule.

The stack can statically model many real writers, but the first executable real fixture's writer target is not observable with a stable runtime identity. The richer pointer/Data Binding fixtures require execution/observation capabilities that are intentionally outside #22-#24 today.

Until property/ViewModel values are observed, static possible writer paths must remain static possibilities.

## Next highest-information experiment

After #39 qualifies #37's raw-`.riv` NativeBackend on the complete stack, feed the existing `official-flutter-rapid-pointer` execution evidence into causal calibration without changing the Scenario vocabulary.

Highest-information target:

1. observe the source-defined `hasReached: false -> true` ViewModel change;
2. preserve pointer/state observations;
3. ask whether current static provenance can map that **observed property change** to a modeled writer;
4. if not, record it as the first real `unattributed property change`;
5. only then consider a narrow provenance extension justified by that concrete miss.

That experiment is more informative than adding generic SolidColor/script/listener support now.
