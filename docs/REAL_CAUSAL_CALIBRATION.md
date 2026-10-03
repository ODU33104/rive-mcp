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

## Issue #48 — clean-restacked real ViewModel observation

The baseline sections above intentionally describe the original #35/#41 calibration surface, where the rapid-pointer dynamic observation path remained unsupported. The clean release train now already contains the raw `.riv` execution semantics through #46 and the causal calibration semantics through #47. Issue #48 adds only the independent ViewModel observation layer from #45; it does not import #38/#40 rehearsal ancestry.

For the exact `official-flutter-rapid-pointer` artifact:

- artifact size: 528 bytes;
- artifact SHA-256: `e0584ba73df9bf8a7ac1a4ff1c3e381212967b10025d936e49ddab3d30a13079`;
- Scenario: `rapid-pointer-down-up`;
- Scenario SHA-256: `sha256:020b7ca8ea60ed285d503271263671b8e96100f291e4a396d68ffe0655d35e56`.

The source-defined expectation remains an initial/final statement for the complete fixed Scenario:

- initial `hasReached=false`;
- after the full Scenario, final `hasReached=true`.

The runtime-observed checkpoints are retained separately:

- initial: `false`;
- pointer down: `true`;
- pointer up: `true`;
- advance 16 ms: `true`;
- final: `true`.

The pointer-down timing is observed runtime evidence. It does not rewrite the upstream expectation into a claim that the transition should occur at pointer down.

The observation adapter in `src/causal/viewModelObservation.ts` only normalizes scalar ViewModel snapshots already present in `NativeBackend.execute` results. Runtime observation is not causal attribution.

For observed `hasReached`, Static Provenance still exposes the relevant Data Binding sources only as opaque numeric `sourcePathIds`. No numeric ID sequence is promoted to a semantic ViewModel path without explicit metadata. Therefore:

- actual runtime change observed: yes;
- semantically resolved static paths for `hasReached`: 0;
- observed-supported static paths: 0;
- competing matched paths: 0;
- classification: **unresolved**.

The permanent projection `test/fixtures/causal/rapid-pointer-viewmodel-v1.json` is marked `oracle:false`. Expected and observed values remain distinct, unsupported/unmeasured values are never rewritten as zero, static possibility is not observed support, and opaque identities remain unresolved.

