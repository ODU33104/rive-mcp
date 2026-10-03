# Raw .riv Execution Compatibility

Issue #34 asks one narrow question: can a real, already-built `.riv` be driven by the same Scenario through truthful execution paths without turning it into RML or recompiling a projection?

The fixture is the pinned #32 real-world corpus asset `official-flutter-rapid-pointer`.

## Artifact identity

- Source: `rive-app/rive-flutter` at commit `58fcac2171f655757907356a4bead2ebd008e4f7`
- Upstream path: `test/assets/rapid_pointer_events.riv`
- Bytes: **528**
- SHA-256: `e0584ba73df9bf8a7ac1a4ff1c3e381212967b10025d936e49ddab3d30a13079`
- Conversion/decompile/recompile: **none**

The exact bytes acquired and hash-checked by the #32 corpus are passed directly to every probe in this experiment.

## Scenario

The existing #32 scenario is reused unchanged:

```json
{
  "id": "rapid-pointer-down-up",
  "name": "down/up within one frame then advance",
  "steps": [
    { "type": "pointer", "action": "down", "x": 250, "y": 250 },
    { "type": "pointer", "action": "up", "x": 250, "y": 250 },
    { "type": "advance", "ms": 16 }
  ],
  "capture": {
    "screenshot": true,
    "dataSnapshot": true
  }
}
```

Measured scenario hash:

`020b7ca8ea60ed285d503271263671b8e96100f291e4a396d68ffe0655d35e56`

No new generic Scenario vocabulary was added.

## Source-defined oracle vs observed baseline

These are deliberately separate.

### Source-defined upstream expectation

Pinned upstream test:

`rive-app/rive-flutter/test/rapid_pointer_events_test.dart` at
`58fcac2171f655757907356a4bead2ebd008e4f7`.

The upstream test establishes:

1. the default ViewModel exposes boolean `hasReached`;
2. initial `hasReached == false`;
3. pointer down then pointer up at `(250, 250)`, without an intervening frame;
4. then `advance(0.016)`;
5. expected `hasReached == true`.

That data behavior is an upstream oracle for this fixture. It is **not** a pixel oracle and does not define the exact state-change reporting sequence used by this bridge.

### Current observed baseline

The raw-runtime bridge observed:

- initial ViewModel: `ViewModel1`
- initial data: `hasReached=false`, `isDown=false`
- initial state change: `isUp`
- pointer-down delivery: state change `toDown`
- pointer-up delivery: no reported state change
- 16 ms advance: no additional reported state change
- final data: `hasReached=true`, `isDown=false`
- final PNG: 500x500, 6941 bytes
- final PNG SHA-256: `2c27fad945da1299da7dfb53d45fcb53030f367e51e322dac1a69d1aa15e8b44`

The data observation matches the source-defined upstream expectation. The state-change sequence and PNG are observation-only baselines.

## Iteration 1 — capability proof

**Hypothesis:** current Official Rive CLI may accept an already-built raw `.riv` for Scenario-driving flags even though the documented primary input is a project directory.

**Probe:** current installer CLI, measured as **rive 1.3.0**, was given the exact 528-byte artifact directly.

Individual raw-`.riv` probes:

- `--pointer=down@250,250`
- `--data=hasReached=true`
- `--key=enter`
- `--advance=16ms`

All four reach the same CLI boundary and exit 1:

```text
<file>.riv is a built .riv; rive previews projects, not .riv files

  rive <project-dir>  preview the project that built it
```

The complete rapid-pointer sequence with screenshot/data-dump is rejected at the same boundary.

`rive inspect <raw.riv> --json` also rejects the path because it is not a project containing `rive.yaml`.

**Result:** Official CLI 1.3.0 does **not** execute the tested pointer/data/key/advance actions against an existing standalone `.riv`.

**Decision:** **KEEP** the negative capability proof. Do not add a decompile/recompile workaround.

## Iteration 2 — smallest truthful bridge

**Hypothesis:** the existing official `@rive-app/canvas-advanced` runtime host can execute the exact raw bytes with only the Scenario subset the fixture actually needs.

**Change:** add an internal `RawRivScenarioBridge` using the repository's existing `RiveHost` and vendored official runtime.

The bridge:

- loads the exact input bytes directly;
- selects the fixture's existing/default State Machine;
- binds the default ViewModel instance;
- supports only `pointer:down`, `pointer:up`, and `advance`;
- marks `data`, `key`, and unproven pointer actions as unsupported;
- observes state changes;
- reads top-level boolean ViewModel values for evidence;
- captures a final PNG;
- verifies the input Buffer hash/length did not change.

Pointer delivery includes the same host behavior used by the official Web runtime: pointer down/up is followed by an immediate zero-time State Machine advance/drain. This is recorded as delivery semantics rather than invented as another Scenario step.

**Measured backend:**

- bridge: rive-mcp **0.6.1**
- runtime: `@rive-app/canvas-advanced` **2.38.5**

**Result:** execution succeeds on the exact artifact and the final `hasReached=true` matches the pinned Flutter upstream test expectation.

**Decision:** **KEEP**.

## Iteration 3 — same fixture rerun

**Hypothesis:** a truthful bridge must produce stable evidence for the same bytes and Scenario.

**Probe:** execute the same exact 528-byte artifact and unchanged Scenario in three fresh `RiveHost` runs.

**Result:** all three deterministic projections are identical across:

- artifact identity
- backend/runtime identity
- Scenario hash
- state observations
- initial/final data observations
- screenshot dimensions
- screenshot SHA-256 and byte size

Unsupported cases are also explicit rather than failures: `data`, `key`, and `pointer:move` probes return `status: unsupported` without attempting execution.

**Decision:** **KEEP**.

## Compatibility result

| Measurement | Official Rive CLI | canvas-advanced raw bridge |
| --- | --- | --- |
| Backend version | 1.3.0 | rive-mcp 0.6.1 |
| Runtime version | not separately exposed | 2.38.5 |
| Exact 528 bytes presented | yes | yes |
| Exact raw bytes executed | **no** | **yes** |
| Pointer down/up | unsupported for raw `.riv` | supported |
| Advance | unsupported for raw `.riv` | supported |
| Data write | unsupported for raw `.riv` | unsupported |
| Key | unsupported for raw `.riv` | unsupported |
| State observation | none | state-change names |
| Data observation | none | top-level booleans |
| Visual observation | none | PNG |
| Determinism | not executable | 3/3 identical |
| Upstream data oracle | not executable | matched |
| Visual oracle | none | none |

## Divergence

There is no valid cross-backend semantic or pixel divergence measurement here.

Classification: **not comparable**.

Reason: Official Rive CLI rejects the standalone built `.riv` before Scenario interactions execute. Treating that unsupported boundary as a behavioral divergence would be false evidence.

## Architectural conclusion

This is **Success B**, not Success A.

The current Official CLI cannot be the second raw-`.riv` execution backend for this use case. The project must not hide that boundary by converting:

```text
.riv -> decompile/RML -> compile -> .riv
```

Such a result is a different projection with a different artifact identity.

The truthful architecture is therefore:

```text
exact raw .riv bytes
        |
        +--> runtime-backed raw adapter A
        +--> runtime-backed raw adapter B   (future independent runtime host)
        |
        +--> same bounded Scenario subset
        |
        +--> observations / unsupported / differential evidence
```

The CLI remains the truthful backend for project/RML execution. Raw built artifacts need runtime-backed adapters.

The next raw adapter should not expand the Scenario language first. It should prove the same existing rapid-pointer subset against an independently hosted official runtime implementation.

## Next highest-information execution path

Run the same pinned raw bytes and unchanged rapid-pointer Scenario through an independent official runtime host, preferably the fixture's native **Flutter runtime harness**, and compare:

1. `hasReached: false -> true` using the upstream test's own ViewModel semantics;
2. pointer delivery ordering;
3. runtime version;
4. state observations if exposed;
5. visual output only as observed evidence unless an upstream visual oracle exists.

This is higher-information than adding more actions to the canvas bridge because it would create the first genuine same-bytes, same-Scenario cross-runtime comparison.

No public MCP tool is added.
