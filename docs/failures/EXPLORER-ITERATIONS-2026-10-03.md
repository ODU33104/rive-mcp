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
