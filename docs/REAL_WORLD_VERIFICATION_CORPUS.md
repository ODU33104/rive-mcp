# Real-world Verification Corpus

Issue: #28  
Branch: `feat/real-world-verification-corpus`  
Date: 2026-10-03

## Purpose

This corpus is a deliberately small set of real, provenance-clear Rive inputs for existing verification layers. It is not a new engine and it is not a visual-quality benchmark.

The permanent rules are:

- keep 3-6 fixtures;
- prefer official Rive runtime/sample repositories;
- pin immutable upstream commits;
- retain the upstream Git LFS SHA-256 as the artifact identity;
- keep license evidence next to the corpus metadata;
- provide a reusable backend-neutral Scenario for every interactive fixture;
- keep source-defined expectations separate from observed baselines;
- do not convert a current runtime result into an expected oracle.

## Distribution decision

The `.riv` binaries are **not vendored**.

All five selected upstream assets are stored in Git LFS upstream. The corpus stores:

- immutable repository + commit + path;
- exact Git LFS SHA-256 and byte size;
- pinned source and license evidence;
- acquisition URL;
- acquisition script;
- scenarios and metadata.

`node scripts/fetch-real-world-fixtures.mjs` retrieves the exact bytes and rejects hash or size drift.

This avoids adding roughly 0.95 MB of binary assets while preserving deterministic acquisition and auditability.

## Qualified fixtures

| Fixture | Upstream | Size | Feature value | Expected status |
| --- | --- | ---: | --- | --- |
| `official-flutter-controller-basic` | rive-app/rive-flutter | 693 B | simple animation, State Machine | source-defined expected |
| `official-flutter-rapid-pointer` | rive-app/rive-flutter | 528 B | rapid pointer sequencing, State Machine transition, ViewModel observation | source-defined expected |
| `official-flutter-keyboard-focus` | rive-app/rive-flutter | 468,820 B | keyboard/focus traversal | source-defined expected, only partly representable by current Scenario |
| `official-flutter-rewards-data-binding` | rive-app/rive-flutter | 216,976 B | ViewModel/Data Binding with nested number/string/color/enum/trigger access | source-defined expected |
| `official-android-text-compat` | rive-app/rive-android | 259,725 B | text/layout renderer compatibility input | observed-baseline only for rendered output |

The exact URLs, license evidence, hashes, actions, limitations, scenarios, and assertions are in `test/fixtures/real-world/manifest.json`.

## Expected is not observed

Two evidence classes are intentionally stored separately.

**Expected assertions** come only from pinned upstream source/tests. Examples:

- `rapid_pointer_events_test.dart` states that down+up at (250,250), followed by a 16 ms advance, changes `hasReached` from false to true.
- `rive_widget_keyboard_focus_test.dart` states the host focus traversal around the four buttons in the `Buttons` artboard.
- `databinding.dart` documents the ViewModel property paths used by the rewards example.

**Observed baselines** are produced by this repository's current runtime/decoder. They are drift evidence only. They are explicitly marked `oracle: false`.

The Android text compatibility source identifies the asset as the `text` case and draws it at 860x540 under two Android renderers, but the cited source does not define a pixel-perfect expected image. Therefore this corpus does not invent one.

## Engine capability matrix

This matrix describes the open engine branches as of 2026-10-03. The corpus branch stays on `main` instead of merging those stacks.

| Fixture | Explorer #20 | Differential #25 | Contract #18 | Static provenance #21 | Observed/Causal #22-#24 |
| --- | --- | --- | --- | --- | --- |
| controller-basic | no: CLI explorer takes project directories, fixture is pinned `.riv` | partial: native side can consume `.riv`; current CLI adapter side is directory-only | yes | yes | partial: advance/state observation is relevant, but no dedicated property oracle |
| rapid-pointer | no: same project-dir boundary | partial: native side only for raw `.riv` | yes | yes | no: current observed trace does not drive pointer actions |
| keyboard-focus | no: same project-dir boundary | partial: native side only for raw `.riv` | yes | yes | no: current observed trace does not model host focus traversal/key driving |
| rewards-data-binding | no: same project-dir boundary | partial: native side only for raw `.riv` | yes | yes | partial: State Machine observation is possible, but PR #23 explicitly does not checkpoint ViewModel runtime values |
| android-text | no: same project-dir boundary | partial: native side only for raw `.riv` | yes | yes, likely low writer value | no: causal trace requires State Machine/property-change context |

Here `no` means unsupported by the current engine boundary, not a corpus failure.

## Deterministic validation

Run:

```bash
npm ci
npm run build
node scripts/fetch-real-world-fixtures.mjs
node test/corpus/realWorldCorpus.mjs
```

Validation checks:

1. corpus size and required metadata;
2. pinned license evidence;
3. Scenario uses only `data`, `pointer`, `key`, `advance`;
4. interactive feature tags have a matching Scenario action;
5. downloaded bytes match the upstream Git LFS SHA-256 and size;
6. two runtime inspect passes are identical;
7. two static parser/Data Binding summaries are identical.

The validator writes `test/tmp/real-world-corpus/validation.json`. That file is observation evidence, not an expected oracle.

## Self-improvement loop

### Iteration 1

Candidate:
- `rive_file_controller_test.riv`
- `rapid_pointer_events.riv`
- `focus.riv`
- `global_view_models_test.riv`
- `rewards.riv`
- Android `text.riv`

Origin/license: official Rive runtime repositories, repository-level MIT licenses pinned to immutable commits.

Feature value: covers animation/State Machine, pointer, keyboard focus, Data Binding, text/layout.

Engines exercised: branch capability review against #18, #20-#25.

Determinism: upstream assets are Git LFS objects with explicit SHA-256 identities.

Ambiguity: `global_view_models_test.riv` is 879,591 bytes and its cited tests mainly exercise Flutter controller instance ownership/rebinding, which is less directly expressible as the shared verification Scenario.

Decision: **DROP** `global_view_models_test.riv`; keep `rewards.riv` for Data Binding.

Reason: smaller asset, documented property paths, better shared diagnostic value.

### Iteration 2

Candidate: the remaining five fixtures.

Origin/license: unchanged and clear.

Feature value: `focus.riv` is relatively large but is the only selected asset with explicit keyboard/focus expectations. `rewards.riv` is not used as a text/layout oracle; Android `text.riv` owns that coverage.

Engines exercised: capability matrix above.

Determinism: fixed hashes/scenarios/acquisition path.

Ambiguity: the keyboard expected behavior requires host focus context that the current four-step Scenario cannot express.

Decision: **KEEP** the fixture but mark its expected behavior as only partly executable; do not weaken the upstream expectation into a made-up key-only oracle.

Reason: unique behavior coverage with explicit limitation is more useful than pretending current tooling can prove the whole assertion.

### Iteration 3

Candidate: the five-fixture corpus under CI acquisition/runtime inspection/static parse.

Origin/license: unchanged.

Feature value: unchanged.

Engines exercised: current-main runtime inspect/static decoder plus branch capability review.

Determinism: pending first CI measurement in this initial commit.

Ambiguity: any runtime output from this pass remains observed-only.

Decision: pending CI result; update this section with measured outcome rather than assuming success.

## Known blind spots

- Raw `.riv` files do not currently flow through PR #20's project-directory Rive CLI explorer adapter.
- PR #25 cannot make a true CLI-vs-native pair from these raw files because its CLI backend remains directory-only.
- Current backend-neutral Scenario cannot model host focus setup/traversal around a Rive widget.
- PR #23 does not checkpoint ViewModel runtime values, limiting causal use of the Data Binding fixture.
- The corpus has no scripting/shader fixture.
- The text fixture has no source-defined pixel oracle.
- No Rive product defect is claimed by fixture qualification itself.
