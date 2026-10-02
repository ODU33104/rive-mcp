# Official Rive CLI backend / evidence pilot

Date: 2026-10-03
Branch: `feat/official-cli-evidence-backend`
PR: #19
Base: #17 (`test/creative-quality-ab`)

## Goal

Treat Official Rive CLI as an execution backend while moving rive-mcp's differentiation away from authoring breadth and toward independent verification of an exact Rive artifact.

Principle:

> AI proposes. rive-mcp proves.

No public MCP tools are added by this work.

## Current official Rive capability check

The current Rive CLI documentation exposes project scaffolding/RML authoring, verify, inspect, screenshots, tests, benchmarks, data/pointer/key/time driving, data dumps, push/pull, and an agent workflow through generated `AGENTS.md`.

The current Official MCP documentation is Editor/desktop oriented, so an Official MCP execution backend is deliberately deferred.

Observed in CI on 2026-10-03:

- Official installer resolved `rive 1.3.0`.
- On Ubuntu 24.04, the installed binary required `libEGL.so.1` even for `rive --version`.
- Installing `libegl1 libgles2 libx11-6` made the CLI executable in CI.

This Linux loader dependency is treated as an environment requirement, not hidden by the adapter.

## Implemented boundary

```text
Scenario
  -> RiveExecutionBackend
      -> NativeBackend
      -> RiveCliBackend
  -> ExecutionResult
  -> EvidenceManifest
```

CLI flags exist only inside `RiveCliBackend`.

The initial Scenario model contains only:

- data(path, value)
- pointer(action, x, y)
- key(key)
- advance(ms)

No gamepad, semantics, script-event, runtime-adapter, State Explorer, or Quality Engine work is included.

## Capability truthfulness

The native backend currently advertises:

- standalone `.riv`: supported
- verify/inspect/screenshot: supported
- advance: supported
- data/pointer/key: unsupported through this adapter
- data snapshot: unsupported

The CLI backend currently advertises:

- RML project directory: supported
- verify/inspect/screenshot: supported
- data/pointer/key/advance: supported
- data snapshot: supported

A backend must reject unsupported project/step capabilities explicitly rather than silently approximating them.

## Evidence Manifest

Evidence is bound to:

- exact standalone `.riv` byte hash, or canonical project-tree hash
- backend identity/version
- runtime version when known
- Scenario definition/hash
- normalized input/event outcomes
- verify/inspect diagnostics
- screenshot/data artifact hashes
- data snapshots
- performance timings
- assertions and final pass/fail

The reproducibility key intentionally excludes timestamp, elapsed time, and output paths.

For project trees, generated/noisy directories are excluded:

- `.git`
- `build`
- `node_modules`
- `.rive-mcp`

Regular files and symlink targets are both fingerprinted.

## Real fixture evidence

The existing repository fixture `samples/vehicles.riv` is used for the native backend test.

Observed successful run before the final PR head:

- rive-mcp: 0.6.1
- @rive-app/canvas-advanced: 2.38.5
- artifact SHA-256: `46bb250cde0b0223a15faddac33d08fa00d4b6acebc2e4e827391ae0113768a3`
- deterministic screenshot SHA-256: `76fd630c19ac05ff3d8064097f1db21452bbccb226e30fb028536b46f08c3610`
- repeated evidence reproducibility key: `b8e8a5bd302e918251e0adbf9d2bb006c12b8ba28ecc3065578629dc9a436902`

## Reality pilot

Fixed cases:

1. visual authoring
2. State Machine / Data Binding behavior
3. existing-file refinement

This deterministic pilot does **not** fabricate model token counts or claim creative-quality improvement. The #17 live model A/B remains a separate benchmark and was previously blocked when the Actions `OPENAI_API_KEY` secret was unavailable.

The behavior case is currently a negative Data Binding precondition/failure case. It is useful for backend failure parity, but it is **not** yet a positive State Machine transition / bound-data correctness benchmark.

### Iteration 1

Hypothesis:
Official CLI may silently accept an unapplied `--data` input, so rive-mcp should parse selected stderr text and fail closed.

Baseline:
A generated CLI project without a bound View Model was driven with a missing data path.

Measurement:
Rive CLI 1.3.0 returned exit code 1 and explained that no View Model was bound.

Result:
The CLI itself already failed this case.

Decision: **REVERT**

The message-specific stderr heuristic added no demonstrated value and was more brittle than relying on CLI process/structured failure semantics.

Next hypothesis:
Keep the adapter thin and preserve Official CLI failures without coupling the domain model to CLI diagnostic wording.

### Iteration 2

Hypothesis:
A thin adapter using CLI exit status plus structured problems is enough to preserve the measured failure.

Change:
Removed the message-specific stderr heuristic.

Expected measurement:
Raw CLI failure and backend ExecutionResult failure must agree.

Decision:
KEEP only if the fixed pilot confirms parity.

Next hypothesis:
Repeated unchanged execution should produce the same reproducibility key.

### Iteration 3

Hypothesis:
Evidence identity should remain stable across repeated execution despite timestamp, elapsed-time, and output-path changes.

Change:
Compute a dedicated reproducibility key from exact source hash, backend/version, Scenario hash, deterministic result summaries, diagnostics, assertions, and artifact hashes only.

Expected measurement:
Two repeated executions of the same unchanged project/Scenario yield the same screenshot hash and reproducibility key.

Decision:
KEEP only if the fixed pilot confirms equality.

## Benchmark fields recorded

The pilot JSON records, where observable:

- completion
- actual model tokens (explicitly unavailable in this deterministic pilot)
- tool calls
- failures/retries
- elapsed time
- visual evidence hashes
- behavior correctness
- compile/inspect errors
- defects/failures found after authoring
- human correction required
- Quality / 1k tokens (null when model tokens are unavailable)
- reproducibility evidence

## Known limitations

- A real positive View Model + State Machine fixture is still needed.
- Native backend Scenario support is intentionally narrower than the underlying runtime; data/pointer/key are explicit unsupported capabilities for now.
- CLI backend presently targets RML project directories. Standalone compiled `.riv` CLI execution is not claimed.
- CLI JSON schemas are normalized conservatively; raw results are retained for future adapter hardening.
- Official MCP backend is not implemented.
- No State Explorer algorithm is included.

## Next highest-value task

Add one small, checked-in positive fixture with:

- a bound View Model property
- a State Machine transition driven by that property
- a deterministic screenshot/data assertion before and after input

Then run the **same Scenario** through every backend that truthfully supports the capability. Do not add more Scenario step types before this proof exists.
