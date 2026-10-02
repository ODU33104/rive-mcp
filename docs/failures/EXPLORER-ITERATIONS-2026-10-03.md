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
