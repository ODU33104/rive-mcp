# Raw .riv Execution Compatibility

Issue: #34  
Branch: `feat/raw-riv-execution-compat`  
Base: #30 / `integration/clean-cross-runtime-differential`  
Fixture: `official-flutter-rapid-pointer`

## Question

Can the exact same existing compiled `.riv` bytes be driven by the same backend-neutral Scenario through Official Rive CLI and the existing native/runtime backend?

The answer for Official Rive CLI 1.3.0 is **no**. That boundary is retained as evidence rather than bypassed through decompile/recompile or another projection.

## Exact artifact and Scenario

Pinned upstream artifact:

- repository: `rive-app/rive-flutter`
- commit: `58fcac2171f655757907356a4bead2ebd008e4f7`
- path: `test/assets/rapid_pointer_events.riv`
- SHA-256: `e0584ba73df9bf8a7ac1a4ff1c3e381212967b10025d936e49ddab3d30a13079`
- bytes: 528

Scenario hash:

`sha256:020b7ca8ea60ed285d503271263671b8e96100f291e4a396d68ffe0655d35e56`

Steps:

1. pointer down at (250, 250)
2. pointer up at (250, 250)
3. advance 16 ms

No Scenario vocabulary was added.

## Expected vs observed

### Source-defined expected behavior

The pinned upstream Flutter regression test states:

- the bound ViewModel exposes boolean `hasReached`;
- after initialization, `hasReached == false`;
- down then up at (250,250), followed by a 16 ms advance, results in `hasReached == true`.

The upstream controller also explicitly performs `advanceAndApply(0)` after pointer down/up/cancel so an intermediate down state is processed even when down and up happen within the same frame.

These are source-defined expectations.

### Observed baseline

The local runtime observations below are **not** promoted into an oracle:

- initial data: `{ hasReached: false, isDown: false }`
- final data: `{ hasReached: true, isDown: false }`
- state trace:
  - pointer down: `isUp`, `toDown`
  - pointer up: `toDown`
  - advance 16 ms: no additional state-change name
- screenshot SHA-256: `sha256:2c27fad945da1299da7dfb53d45fcb53030f367e51e322dac1a69d1aa15e8b44`
- data snapshot SHA-256: `sha256:ac48a255a442baaf25072fa3371f6a4b9a9f3dbd68dcefaed36cd66611cd1a43`

Only the `hasReached false -> true` assertion is backed by the upstream behavioral oracle. The state trace and screenshot are observed-only.

## Iteration 1 — capability proof

Candidate:
Official Rive CLI directly executing the pinned raw `.riv`.

Measurement:
The current installer resolved `rive 1.3.0`. The CLI advertises pointer/data/key/advance flags for `<project-dir>`, but raw `.riv` execution was rejected.

Direct probes for advance, pointer, data, and a valid key all returned:

```text
<path>.riv is a built .riv; rive previews projects, not .riv files

  rive <project-dir>  preview the project that built it
```

`rive inspect <raw.riv> --json` likewise rejected the path because it contains no `rive.yaml`.

Decision: **KEEP** this negative capability proof.

No decompile/recompile path was attempted. Such a path would be a distinct projection and cannot satisfy exact-byte comparison.

## Iteration 2 — smallest bridge

Candidate:
Extend the existing `NativeBackend` rather than creating another backend.

Change:
- feed the exact raw bytes directly into the existing official `canvas-advanced` runtime harness;
- support only the pointer actions required by this fixture: `down` and `up`;
- retain existing `advance`;
- capture the bound default ViewModel's top-level scalar values when `dataSnapshot` is requested;
- keep `data` writes and `key` unsupported;
- keep other pointer actions unsupported in this minimal bridge.

First result:
The initial bridge delivered down/up but did not perform the host's immediate zero-time advance after each pointer boundary. The observed final value remained `hasReached=false`.

Decision: **REVERT** that delivery behavior.

Reason:
The pinned upstream Flutter controller explicitly calls `advanceAndApply(0)` after pointer down/up/cancel. Omitting that call loses the exact intermediate state that the upstream regression test exists to protect.

## Iteration 3 — same fixture rerun

Change:
Match the source-defined host delivery semantics: after each pointer down/up, advance/apply the State Machine at zero time before accepting the next pointer boundary.

Measured result:
- exact artifact SHA before execution: unchanged
- exact artifact SHA after execution: unchanged
- Native backend: rive-mcp 0.6.1
- runtime: `@rive-app/canvas-advanced 2.38.5`
- observed initial `hasReached=false`
- observed final `hasReached=true`
- repeated fresh runtime runs produced identical final data, state trace, and screenshot hash
- Official CLI backend remained unsupported for raw `.riv`
- existing Differential classified the pair as `unsupported` at `verify`, not `divergent`

Decision: **KEEP**.

This is Success B, not Success A.

## Exact-byte statement

The same pinned bytes and the same Scenario were offered to both backend adapters.

They were **not executed by both backends**:

- NativeBackend consumed and executed the exact pinned bytes.
- Official CLI rejected the raw `.riv` before execution.

Therefore no cross-backend behavioral equivalence/divergence claim is available. Reporting a visual or data divergence between CLI and Native here would be false.

## Supported / unsupported boundary

For this bridge:

- Native raw `.riv`: pointer down, pointer up, advance; screenshot and bound scalar data snapshot.
- Native raw `.riv` unsupported: data write, key, pointer move/exit/click.
- Official CLI raw `.riv`: pointer/data/key/advance all unsupported because the CLI does not execute built `.riv` files directly.

The Official CLI still supports those interaction flags for project-directory preview. That does not make them raw-`.riv` capabilities.

## Validation

Measured bridge proof:

- run `37100460107`: PASS
- head `77c9bde21805d756ba161f167d61414b911f42a9`
- evidence artifact `11265559487`
- ZIP digest `sha256:e3b6a26cb986cdc336ef39e54f6e690247e5b20a20c1deb29f969975478b0d05`

Measured regression gate before final action-surface narrowing:

- run `37100491403`: PASS
- job `111138891425`
- build: PASS
- Official CLI raw capability probe: PASS
- exact raw Scenario bridge: PASS
- existing NativeBackend test: PASS
- Differential core: PASS
- existing cross-runtime Differential: PASS
- evidence artifact `11266335372`
- ZIP digest `sha256:24ed438b3a21642cddab38de9d0a6b97f8b69e1e4aaf6c59a61e1f437cbec853`

## Architectural conclusion

Do not make raw `.riv` look like an Official CLI project. Keep artifact identity first-class.

The truthful split is:

```text
raw .riv bytes
  |
  +--> official runtime backend: execute exact bytes
  |
  +--> Official CLI backend: unsupported for direct execution
```

Project-directory CLI execution remains a different source/projection class. If a future official CLI version gains direct built-`.riv` execution, it can become the second exact-byte backend without changing Scenario semantics or Differential classification rules.

## Next highest-information path

Do not add another interaction language or a new backend.

The next execution experiment should be one of:

1. monitor Official CLI for direct built-`.riv` execution support and rerun this exact fixture/Scenario unchanged when it appears; or
2. add a second already-existing official runtime implementation only if it can consume these exact bytes and expose the same down/up + data observation without adapter-specific semantic substitution.

Until then, the durable result is the explicit unsupported CLI boundary plus a deterministic exact-byte native bridge.
