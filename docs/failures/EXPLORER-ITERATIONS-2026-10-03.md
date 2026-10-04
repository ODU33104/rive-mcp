# Explorer self-improvement log — 2026-10-03

The fixed corpus for these iterations is `test/fixtures/explorer/threshold-submit.json`. It is deliberately tagged `synthetic-regression`: it validates the explorer algorithm and must not be reported as a real Rive product failure.

## Iteration 1 — boundary values vs coarse bounded BFS

Hypothesis: replacing coarse numeric samples with values immediately below, exactly at, and immediately above a statically visible threshold will expose behavior that bounded BFS over coarse values misses.

Corpus: `threshold-submit-v1`, depth 2, max 80 sequences, invariant `loading == true => submitEnabled == false`.

Baseline coverage: 3 observed state labels, 8 observed transitions. `boundary` and `dead` were not reached within exploration budget. The complete fixture graph independently proved only `dead` statically unreachable.

Baseline failures: 0.

Change: extract `score > 50` and prioritize `49.999`, `50`, `50.001` as DataWrite actions before the coarse action set.

New coverage: 4 observed state labels, 35 observed transitions. Only `dead` remained not reached, matching the independent static proof.

New failures: 1 synthetic invariant violation, triggered by `score = 50` followed by the submit click.

False positives: 0 in five deterministic replay attempts.

Cost: backend action cost 36 -> 105; sequences 21 -> 57.

Decision: KEEP. It adds a distinct boundary state and a reproducible failure that coarse BFS misses, but the Cartesian action expansion is expensive.

Lesson: interesting-value generation works, but blindly adding every boundary value to the global action alphabet grows the cross-product too quickly.

## Iteration 2 — targeted boundary mutation

Hypothesis: mutate DataWrite positions already present in bounded BFS sequences instead of putting every boundary action into the global Cartesian alphabet. This should preserve the boundary failure while reducing execution cost.

Corpus: exactly the same `threshold-submit-v1`, depth 2, max 80 sequences.

Baseline coverage for this iteration: the Iteration 1 Cartesian boundary run — 4 states, 35 transitions, 1 failure, cost 105.

Change: generate the original bounded BFS corpus, then replace only matching `score` DataWrite positions with `49.999`, `50`, `50.001`.

New coverage: 4 states, 26 transitions, 1 failure.

New failures: no additional failures; the threshold failure is retained.

False positives: 0 in five deterministic replay attempts.

Cost: 105 -> 87 backend action units; sequences 57 -> 48.

Decision: INCONCLUSIVE as a default strategy. It saves 17% of backend cost but drops 9 observed transitions. The planner remains available as an explicit low-cost strategy; it does not replace exhaustive Cartesian boundary expansion.

Lesson: cost reduction must be judged against transition coverage, not just whether the already-known failure still reproduces.

## Reproduction minimization check

A seven-action noisy reproducer was reduced by delta debugging plus a one-deletion sweep to two actions: `score = 50`, then submit click. Five of five replays reproduced the invariant violation. The result is labelled `locally-minimized`; no global mathematical minimum is claimed.


## Iteration 3 — official Rive CLI as the execution backend

Hypothesis: the official Rive CLI can act as a privileged execution backend while the explorer remains an independent verifier, using only CLI-observable data dumps and rendered-frame hashes to define state identity.

Corpus: official Rive CLI 1.3.0 bundled projects `pointer_reactive` and `keyboard_menu`; depth 2, max 8 sequences per project, viewport 320x240. The action corpus uses pointer moves for `pointer_reactive` and key presses for `keyboard_menu`.

Baseline coverage: no prior real official-CLI backend measurement existed. The synthetic fixture measurements above are not treated as a substitute for real backend coverage.

Baseline failures: 0 known real failures in this corpus.

Change: add a thin `RiveCliBackend` that maps generic explorer actions to official `--data`, `--pointer`, `--key`, and `--advance` flags. Each step is observed by independently replaying the sequence prefix and reading official `--data-dump` output plus a PNG visual-payload hash. Diagnostics are retained as evidence but excluded from state identity. Determinism checks construct a fresh backend for every attempt.

New coverage: `pointer_reactive` produced 7 observed state signatures and 6 observed transitions; `keyboard_menu` produced 4 state signatures and 4 transitions. Both samples were responsive to the chosen action corpus.

New failures: 0 explorer/runtime failures. No Rive product failure is claimed.

False positives: 0 failures emitted. The fixed determinism sequence for each project produced exactly one unique trace signature across 3 attempts.

Cost: 17 official CLI observation subprocesses per sample, 34 total. This is an exact backend-command count, not a wall-clock performance claim.

Decision: KEEP. The explorer can now use the official implementation as an execution backend without duplicating its authoring/runtime surface, while retaining independent observation, coverage, replay, and failure-corpus semantics.

Lesson: official evolution increases the available interaction surface, while the independent layer can stay backend-neutral. The main immediate weakness is repeated execution of identical prefixes.

Evidence: GitHub Actions run `37076752420`, Rive CLI `1.3.0`, artifact `explorer-rive-cli-report`, artifact digest `sha256:89247399bd04ee5c14cde202feafd3613507ce7250b254facd2e59df9218673d`.

## Iteration 4 — exact prefix observation cache

Hypothesis: caching successful observations for identical action-sequence prefixes within one immutable exploration backend will reduce official CLI subprocess cost without changing observed states, transitions, failures, or independent determinism results.

Corpus: exactly the same official Rive CLI 1.3.0 bundled projects, action corpus, depth, sequence budget, and viewport as Iteration 3.

Baseline coverage: `pointer_reactive` 7 state signatures / 6 transitions; `keyboard_menu` 4 / 4. Baseline failures: 0. Baseline backend cost: 17 commands per sample, 34 total.

Change: cache successful prefix observations by canonical action-sequence identity for the lifetime of one backend instance. Cache can be disabled. Determinism testing still creates a fresh backend per attempt, so cache reuse cannot make divergent executions appear deterministic.

New coverage: exactly unchanged. In the final same-runner A/B harness, cached and uncached state-signature sets and transition sets are asserted equal for both official projects.

New failures: 0.

False positives: 0 failures emitted; both determinism probes remained 3/3 identical with one unique trace signature.

Cost: `pointer_reactive` 17 -> 7 official CLI commands; `keyboard_menu` 17 -> 7; total 34 -> 14, saving 20 commands (58.8%). This proves command-count reduction only. Wall-clock speedup is not claimed because hosted-runner timing includes unrelated build/render/environment variance.

Decision: KEEP. It removes repeated backend work while preserving the exact observed coverage on the same runner.

Lesson: cache evidence at the exact action-prefix boundary, but isolate determinism/reproduction checks with fresh backend instances. Optimization must not reuse evidence across independent replay attempts.

Evidence: GitHub Actions run `37077104994`, Rive CLI `1.3.0`, artifact `explorer-rive-cli-report`, artifact digest `sha256:a9dc94d6a144f173271da3adc424f5ab9a6eb54a4fe1706f0653a151a487aeee`.


## Follow-up experiment — schema-proven RML numeric boundaries

Question: can the official CLI/RML project structure yield real numeric transition boundaries without treating arbitrary numeric fields as state-machine conditions?

Corpus: all 22 projects bundled with official Rive CLI 1.3.0 were statically scanned. Runtime A/B reporting remains on the fixed real-project pair `pointer_reactive` and `keyboard_menu`.

Evidence contract: before extraction, CI queries official `rive schema --json` and verifies the fields the extractor depends on: `TransitionViewModelCondition.opValue`, `TransitionValueNumberComparator.value`, `BindablePropertyNumber.propertyValue` (property key 636 in CLI 1.3.0), and `DataBindContext.sourcePathIds`. The extractor then accepts a boundary only when RML contains a `TransitionViewModelCondition` with exactly one ViewModel property comparator and one number comparator, the property side is a `BindablePropertyNumber`, its `DataBindContext.sourcePathIds` resolves completely through `rive inspect` to named ViewModel properties ending in `ViewModelPropertyNumber`, and the operation is a documented symbolic enum (or the documented default `equal`). Numeric enum values are rejected rather than guessed.

Negative-control rule: numeric fields outside that exact structure are ignored. In particular, fields such as `ScrollConstraint.threshold` are not boundary hints.

Synthetic regression: `rive-number-conditions.rml` plus `rive-inspect-number-condition.json` proves extraction of four numeric conditions, including a nested path and reversed comparator order. It also proves fail-closed behavior for an unresolved source ID, a wrong property key, a boolean comparator, an unrelated threshold field, and a numeric operation enum.

Official scan result: 22 bundled samples, 22 `TransitionViewModelCondition` nodes, 0 `TransitionValueNumberComparator` nodes, 12 `TransitionValueBooleanComparator` nodes, 0 proven numeric boundary hints. No heuristic fallback was enabled.

Coverage result on the fixed real runtime pair: because there were no proven numeric hints, the action corpora did not change and no redundant guided execution was launched. Reported coverage therefore remains `pointer_reactive` 7 state signatures / 6 transitions and `keyboard_menu` 4 / 4. Failures remain 0. Cached backend cost remains 14 commands total versus 34 uncached.

False positives: 0 emitted failures and 0 numeric hints on the official corpus. This is corpus-specific evidence, not a general precision claim.

Decision: KEEP the conservative extractor and schema guard. Coverage gain on the current official bundled corpus is INCONCLUSIVE because that corpus contains no numeric transition comparator to exercise it. Do not widen matching merely to manufacture coverage.

Lesson: absence is useful evidence. The verifier should prefer an explicit no-op over interpreting unrelated numeric fields as transition boundaries. A future real numeric-condition artifact is needed to measure coverage gain against the official backend.

Evidence: GitHub Actions run `37079495739`, Rive CLI `1.3.0`, artifact `explorer-rive-cli-report`, artifact digest `sha256:7536880a7fac1760602ea9e2b631bbaee5e14fc8fb0d17af4ab2d7fc87055a48`.


## Follow-up experiment — real official-CLI numeric boundary A/B

Question: does a schema-proven numeric ViewModel transition increase observable runtime coverage when executed by the official Rive CLI, rather than only passing a parser regression test?

Fixture: `test/fixtures/explorer/rive-numeric-boundary/`, a minimal RML project compiled and executed by official Rive CLI 1.3.0. It contains one ViewModel number property `score`, a low visual state, a high visual state, and a `TransitionViewModelCondition` whose explicit condition is `score > 50`. The two states render different colors so the transition is observable through the same screenshot hash used by the CLI backend.

Validation gate: `rive <project> --verify` passed and `rive inspect <project> --json` returned `problems: []`. The schema-proven extractor resolved `sourcePathIds=0:40-0:41` through inspect and emitted exactly one hint: `score > 50`, epsilon `0.001`.

Baseline action corpus: `score=0`, `score=25`, and `advance 0.016s`. Guided corpus: the same actions plus `49.999`, `50`, and `50.001` generated from the proven boundary.

Baseline coverage: 3 observable state signatures, 6 transitions, 1 unique frame hash, 0 failures, backend cost 13.

Guided coverage: 7 observable state signatures, 31 transitions, 2 unique frame hashes, 0 failures, backend cost 43.

Boundary semantic check: `score=49.999` and `score=50` produced the same final frame hash; `score=50.001` produced a different final frame hash. This directly confirms the authored strict-greater-than boundary in the official runtime. The added visual coverage is therefore not inferred solely from distinct data-dump values.

Determinism: the sequence `score=50.001` followed by `advance 0.016s` produced one unique observable trace signature across 5/5 fresh-backend attempts.

False positives: 0 failures emitted. The first CI attempt failed only because inspect reported two fixture-authoring warnings (missing `LayoutComponentStyle`, overlapping editor graph positions). The fixture was corrected; those warnings were not classified as Rive failures.

Decision: KEEP. This is the first real official-CLI execution in this branch showing that schema-proven boundary guidance can add a distinct rendered runtime state that a deliberately coarse baseline corpus does not reach.

Caveat: the fixture is synthetic and intentionally constructed to exercise one numeric boundary. It proves the mechanism against the official runtime, not prevalence or effectiveness on arbitrary production Rive files. No real Rive product defect was found and no failure-corpus record was added.

Evidence: GitHub Actions run `37085192332`, Rive CLI `1.3.0`, artifact `explorer-rive-cli-report`, artifact digest `sha256:45bcf526eca6190360777120af2d40e161e7bcd00d95b934a2122746b62ae998`.
