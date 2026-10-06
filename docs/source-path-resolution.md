# Data Binding Source Path Resolution

Issue: #50

## Purpose

Rive Data Binding objects can expose numeric `sourcePathIds`. rive-mcp treats those
numbers as provenance evidence, not as semantic ViewModel/property identities by
default.

The source-path resolution contract is machine-readable and deliberately
fail-closed:

- `status: "resolved"` is reserved for an explicit artifact-contained semantic join.
- `status: "unresolved"` is used when that proof does not exist.
- Numeric equality with a `DataBindPath.path` is recorded only as candidate evidence.
- Runtime value changes, timing, upstream property names, and "only property that
  changed" heuristics are never accepted as proof of static identity.

## Current result for the qualified rapid-pointer fixture

The qualified fixture remains unresolved.

Known runtime evidence still proves:

- `hasReached` changes from `false` to `true`;
- the observation is deterministic;
- source-defined expected behavior and runtime-observed behavior remain separate.

Static provenance still does **not** prove that any opaque numeric
`sourcePathIds` sequence is the semantic `hasReached` path.

This is intentional. A runtime observation is not evidence that a guessed numeric
static path is correct.

## Machine-readable evidence

Every Data Binding source node now carries `sourcePathResolution`.

For unresolved numeric paths the record includes:

- original `sourcePathIds`;
- `reason`;
- exact `DataBindPath` object indices whose numeric `path` happens to match;
- a note stating that numeric equality is not semantic proof.

The existing `normalized` flag is derived from resolution status. It remains
`false` until an explicit semantic join is implemented and proven.

## Future resolved semantics

A future resolver may return `status: "resolved"` only when all identity steps
are reconstructable from explicit metadata in the exact artifact. It must reject
ambiguous, missing, and out-of-range relationships instead of falling back to
heuristics.

This contract is internal and adds no public MCP tool.
