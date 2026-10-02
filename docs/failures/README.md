# Explorer failure corpus

This directory is reserved for durable, reproducible failures discovered by the adversarial explorer.

A corpus record is not merely a failing test. It binds a failure to the artifact identity, tool/runtime versions, exploration scenario, original input sequence, a locally minimized reproduction, an explicit invariant, the observed result, optional screenshot/data/event evidence, and affected/fixed versions.

The production schema is `FailureRecord` in `src/explorer/failureCorpus.ts`.

## Provenance rule

Every record has an `origin`:

- `real`: observed against a real Rive artifact/runtime or official CLI backend.
- `synthetic-regression`: intentionally constructed to exercise the explorer itself.
- `imported`: migrated from an external bug/reproduction with provenance retained.

Synthetic explorer fixtures must **not** be counted as real Rive failures. Real failures should be committed here only after deterministic replay succeeds and the reproduction has been minimized as far as the local minimizer can establish.

## Reachability wording

Dynamic exploration may report a state as **not reached within exploration budget**. It must not call that state unreachable. `staticallyUnreachable` is emitted only when an adapter supplies a graph explicitly marked complete and graph reachability proves the state has no path from any entry state.

## Observation rule

A state signature is observational equivalence only. It is constructed from observables the backend actually provides (active state labels, selected ViewModel values, emitted events, frame/data hashes, and adapter metadata). The explorer does not invent hidden runtime state to make signatures look complete.
