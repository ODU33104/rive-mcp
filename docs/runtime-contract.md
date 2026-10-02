# Runtime Contract / Breaking Change Engine

This module intentionally does **not** provide a generic RML/text diff.

Its job is to answer a narrower engineering question:

> Did this Rive change break a public surface that host application code may depend on?

## v1 contract surface

- artboard names
- animation names
- State Machine names
- State Machine input names/types/defaults
- public Event names/kinds
- View Model names/types
- View Model property names/types
- custom enum keys/values used by properties
- referenced View Model targets
- named View Model instances and authored/default values
- Data Binding target/property, direction flags, converter identity, and binding mode

## Classification

**Breaking**
- public item removed
- input/property/event kind changed
- referenced View Model changed
- enum value removed or changed
- named View Model instance removed

**Behavior**
- artboard dimensions changed
- animation timing/playback changed
- State Machine input authored/default value changed
- named View Model authored/default value changed
- Data Binding added/removed
- Data Binding direction/two-way/once/name-based/converter configuration changed

**Non-breaking**
- public item added
- enum value added

The classifier is deliberately conservative. It does not guess renames. A rename appears as remove + add, because CI should prefer explainable false-positive conservatism over an unsafe inferred compatibility claim.

## Deliberate limitations

Data Binding `sourcePathIds` are currently numeric/opaque. They are retained in the contract as evidence but are **not** used for semantic change classification, because re-indexing could create false positives. The next step is to normalize those IDs into stable View Model/property paths before treating source-path changes as behavioral regressions.

## Not included in v1

- visual severity
- semantic rename inference
- listener/script behavior
- normalized Data Binding source-path compatibility
- accessibility semantics
- cross-runtime behavior
- dynamic state reachability

Those belong to later analysis layers and should be supported by evidence rather than guessed here.

## Fingerprints

`fingerprintRuntimeContract(contract)` returns two SHA-256 fingerprints:

- `api` — host-facing names/types: artboards, animation names, State Machines/inputs, events, View Models/properties/enums/references, and named instance identities.
- `behavior` — API projection plus dimensions, animation timing, authored/default values, and normalized binding configuration.

Warnings and opaque `sourcePathIds` are excluded from fingerprints. A behavior-only edit can therefore keep `api` stable while changing `behavior`.

## API

`buildRuntimeContract(inspect, dump, dataBinding?)`

Builds a deterministic normalized contract from official-runtime inspect output plus the existing binary/Data Binding decoder. Instance defaults are normalized to property names; enum and nested/list references are represented by semantic names where the decoder can resolve them.

`runtimeContractFromRiv(bytes, inspect)`

Convenience wrapper for a real `.riv` byte buffer.

`diffRuntimeContracts(before, after)`

Returns all changes plus `breaking`, `behavior`, and `nonBreaking` buckets.

## Test

```bash
npm run build
node test/runtimeContract.mjs
```

This feature is currently an internal primitive. Do not add another public MCP tool until the higher-level evidence/CI interface is settled.
