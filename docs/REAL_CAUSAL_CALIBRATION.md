# Real-fixture Causal Calibration

Issue: #35  
Basis: PR #38 head `69ea152db6cd1192fab36a4437ac266bc755b0ef`  
Date: 2026-10-03

## Purpose

This is QA/calibration for the existing causal stack:

- #21 Static Provenance
- #22 Observed Trace
- #23 Runtime Property Observation
- #24 Causal Ambiguity
- #32 Qualified Real-world Fixture Corpus

No new causal algorithm is introduced.

The evidence classes remain separate:

1. **static possible writer** — authored graph says a mechanism can write the property;
2. **observed state/input/property** — official runtime reported a fact at a checkpoint;
3. **structurally supported writer** — an observed state and observed property change line up with a static state → animation → property path;
4. **competing writer remains** — another modeled writer path still exists;
5. **unattributed** — a runtime-observed property change has no adequate modeled/supported explanation.

None of these is rewritten as “the writer caused the value”.

## Fixed fixtures and scenarios

| Fixture | Artifact SHA-256 | Scenario |
| --- | --- | --- |
| `official-flutter-controller-basic` | `adf0dd0ab7dff250ba939403cba5b0bf6004a09c735b183fbc623213eb28249a` | `controller-basic-advance` |
| `official-flutter-rapid-pointer` | `e0584ba73df9bf8a7ac1a4ff1c3e381212967b10025d936e49ddab3d30a13079` | `rapid-pointer-down-up` |
| `official-flutter-rewards-data-binding` | `9f2fe2408433754350c808c82772fc58fc67228cae02fc0b1d5123a6b80745e3` | `rewards-data-binding` |

All identities and scenarios come from #32. The acquisition script verifies the exact pinned bytes before calibration.

## Baseline result

Runtime: `@rive-app/canvas-advanced 2.38.5`.

| Fixture | Static properties | With modeled writer | Multi-writer | Dynamic observation | Observed property changes | Observed-supported | Competing | Unattributed | Ambiguous |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| controller-basic | 2 | 2 | 0 | executed | 0 | 0 | 0 | 0 | 0 |
| rapid-pointer | 5 | 2 | 1 | unsupported | — | — | — | — | — |
| rewards-data-binding | 118 | 116 | 62 | unsupported | — | — | — | — | — |

### controller-basic

The fixed default-artboard scenario executes and deterministically reports the initial state change `Timeline 1`.

However, the only static property writers in the selected artifact are Data Binding paths to unnamed `SolidColor.colorValue` properties:

- `ViewModel source [0,1] → Binding → SolidColor#3.colorValue` on `Artboard1`;
- `ViewModel source [1,0] → Binding → SolidColor#1.colorValue` on `Artboard2`.

The current #23 watcher is deliberately limited to named `x/y/rotation/scaleX/scaleY/text` targets. Therefore the fixed `Artboard1` scenario has **zero watch candidates** and zero observed property changes.

This does **not** prove there are no runtime property changes. It means the current observation surface cannot observe the two statically modeled target properties.

Static warnings:

- 1 opaque numeric Data Binding source-path warning;
- 2 unnamed-target/index-fallback warnings.

### rapid-pointer

Static Provenance finds:

- 5 property identities;
- 2 properties with modeled writers;
- 1 multi-writer property;
- the `SolidColor#3.colorValue` property has two animation/state writer paths (`isUp` and `toDown`);
- warnings disclose 5 script/listener objects without inventing them as writers.

The pinned upstream Flutter test provides a source-defined behavior oracle:

`hasReached: false → true` after pointer down/up at `(250,250)` and a 16 ms advance.

That oracle is **not observed by this calibration** because the #38 causal observation path does not deliver the backend-neutral pointer scenario and #23 does not checkpoint ViewModel booleans. Dynamic attribution is therefore `unsupported`, not failed and not divergent.

### rewards-data-binding

Static Provenance finds a large real graph:

- 118 property identities;
- 116 with at least one modeled writer;
- 62 with multiple modeled writer paths;
- 52 bindings and 4 converters;
- 96 warnings.

Warning categories:

- 1 explicit script/listener incompleteness warning;
- 1 opaque Data Binding source-path warning;
- 89 unnamed/index-fallback warnings;
- 5 unexpanded BlendState activation warnings.

The #32 scenario writes ViewModel paths such as `Energy_Bar/Energy_Bar` and `Button/State_1`. The pinned upstream example proves these are runtime ViewModel properties, but it does not provide a cross-runtime causal/pixel oracle for the resulting scene property changes.

The #38 causal observation path neither delivers these ViewModel data writes nor checkpoints ViewModel runtime values. Dynamic attribution is therefore `unsupported`.

## Why unattributed = 0 is not a success claim

The primary metric requested by #35 is an observed property change that Static Provenance cannot explain.

The baseline has **zero unattributed property changes**, but also only **zero observed property changes** on the one dynamically executable fixture. The other two fixed scenarios cannot currently enter the causal observation path.

Therefore:

> `unattributed = 0` means “no observed counterexample in the supported observation surface”, not “the provenance model explains all real runtime changes”.

The permanent calibration file stores the unsupported mechanisms next to the numeric counters so future CI cannot silently convert this into false causal certainty.

## Self-improvement loop

### Iteration 1 — fixed real corpus

Candidate: controller-basic, rapid-pointer, rewards-data-binding.

Baseline:
- static graph deterministic for all three;
- controller runtime trace deterministic across two fresh RiveHost executions;
- rapid-pointer/rewards dynamic paths unsupported as described above.

Decision: **KEEP baseline harness**.

### Iteration 2 — largest blind spot

Largest concrete blind spot: the strongest source-defined real behavior oracle is `rapid-pointer.hasReached`, but the #38 causal path lacks both pointer delivery and ViewModel boolean checkpoint observation.

Narrow hypothesis: observing ViewModel values would improve causal calibration once the exact real pointer scenario can be delivered.

Change attempted: **none**.

Reason: adding ViewModel observation alone cannot be validated on the same fixed real scenario while pointer delivery remains unavailable in the #38 stack. Implementing pointer execution here would cross the #37/#39 execution boundary. Adding either mechanism without a same-scenario proof would violate the calibration rule.

Decision: **INCONCLUSIVE — do not change the causal algorithm or observation surface in this session**.

### Iteration 3 — permanent drift fixture

Change: store a compact, machine-readable real-fixture calibration projection in `test/fixtures/causal/real-calibration-v1.json`.

It fixes:
- exact artifact identities;
- fixed scenario IDs;
- static node/edge/property counts;
- warning categories;
- controller observed state/property metrics;
- explicit unsupported mechanisms for rapid-pointer/rewards.

The file is marked `oracle: false`. CI compares the same real fixtures against it and requires an intentional review if the runtime version or measured projection changes.

Decision: **KEEP**.

## Permanent calibration

Run:

```bash
npm ci
npm run build
node scripts/fetch-real-world-fixtures.mjs
node test/causal/realFixtures.mjs
```

The test also runs two independent controller executions and requires deep equality.

The complete diagnostic output is written to:

`test/tmp/real-causal-calibration/baseline.json`

The permanent compact drift projection is:

`test/fixtures/causal/real-calibration-v1.json`

Neither is an exclusive-causality oracle.

## Remaining blind spot

The highest-information gap is not another static writer heuristic.

It is:

> deliver the exact qualified `rapid-pointer` scenario through the integrated raw-.riv execution path, then checkpoint the already source-defined `hasReached` ViewModel boolean in the causal trace.

Only after that exists can the same real execution establish whether a runtime ViewModel change is structurally attributable, competing, or genuinely unattributed.

Until then, adding script/listener/BlendState writers or stronger causal wording would increase apparent coverage without evidence.


## Issue #43 — qualified raw ViewModel observation

The baseline above intentionally records the pre-#39 causal path: `playStateMachine` could not deliver the rapid-pointer Scenario, so that path remains documented as unsupported.

Issue #43 adds a separate observation bridge over the already-qualified #40 `NativeBackend.execute` result. It does not rewrite `ObservedTrace` or `CausalAmbiguity` semantics.

For the exact same `official-flutter-rapid-pointer` bytes and `rapid-pointer-down-up` Scenario, the runtime directly reports:

- initial `hasReached=false`;
- after pointer-down checkpoint, `hasReached=true`;
- pointer-up and 16 ms advance remain `true`;
- fresh-run observation, screenshot, and data snapshot are deterministic.

The source-defined expected transition and the runtime-observed transition are stored separately. Matching values do not create a causal writer attribution.

Static Provenance exposes four Data Binding source nodes for this artifact, but all retain opaque numeric `sourcePathIds` with `normalized:false`. No semantic ViewModel path can therefore be joined to `hasReached` without guessing. The connection is recorded as **unresolved**, with:

- resolved static paths for `hasReached`: 0;
- observed-supported paths: 0;
- competing matched paths: 0;
- opaque binding-source evidence retained explicitly.

Permanent drift evidence is `test/fixtures/causal/rapid-pointer-viewmodel-v1.json`, marked `oracle:false`.
