# Verification Corpus Registry

The corpus registry is a small filesystem index for verification history. It links existing engine outputs without redefining their payload schemas.

It is intentionally **not** a common verification IR.

## Inputs

The adapter boundary recognizes the identity-bearing parts of:

- #19 `rive-mcp.evidence/v1` Evidence Manifest
- #20 `FailureRecord` schema version 1
- #18 Runtime Contract `api` / `behavior` fingerprints
- #21 Static Provenance graph
- #22/#23 Observed Trace / Trace Correlation
- #24 Causal Ambiguity report
- #25 `rive-mcp.differential-corpus/v1`

Engine payloads remain external. The registry stores deterministic evidence identity, optional locators, case linkage, origin classification, and version history.

## Filesystem layout

```text
<root>/
  registry.json
  cases/
    case_fail_....json
    case_diff_....json
    case_contract_....json
    case_causal_....json
  evidence/
    evidence_....json
  history/
    history_....json
  links/
    link_....json
```

Evidence records are immutable once written. Case files are index metadata: history/evidence/link IDs are append-oriented, while `firstSeen`, `lastReproduced`, origin refinement, and `fixedVersion` are derived summary fields that may be updated without modifying prior evidence/history files.

## Case kinds are not interchangeable

The registry keeps four logical case kinds:

- `failure`
- `differential`
- `contract-observation`
- `causal-observation`

Adapters create a small kind-specific logical identity. The registry does not coerce FailureRecord fields into DifferentialResult fields or causal paths into contract changes.

#19 Evidence Manifest is treated as physical evidence, not as a fifth semantic case type. `evidenceManifestReference()` can index its existing `reproducibilityKey` / `manifestHash` without copying the manifest.

## Identity rules

Case IDs are SHA-256-derived from `caseKind + kind-specific logicalIdentity`.

Runtime/backend **versions are deliberately excluded from logical case IDs**. They belong in history.

Current projections:

- Failure: upstream deterministic failure ID + artifact hash.
- Differential: source artifact hash + Scenario hash + unordered backend identity pair, excluding versions.
- Contract observation: artifact/source hash + contract scope.
- Causal observation: artifact/source hash + Scenario hash when known + observation scope + causal evidence kind.

Evidence IDs are derived from:

```text
source kind
+ source schema version
+ upstream/deterministic reproducibility key
+ stable content hash when supplied
```

History IDs are derived from:

```text
case ID
+ status
+ normalized backend/runtime participants including versions
+ evidence IDs
+ Scenario hash
+ exact execution projection hash
+ fixed version
```

The following never participate in case/evidence reproducibility identity:

- timestamps
- temporary paths
- wall-clock durations
- machine-specific paths
- Evidence Manifest output paths
- FailureRecord screenshot paths

A repeated run may update `lastReproduced`, but does not create another physical evidence record or version-history entry when its reproducibility identity is unchanged.

## Origin safety

Registry origin is stricter than #20's existing `origin`.

Supported fixture origins:

- `synthetic-regression`
- `synthetic-mechanism-proof`
- `official-sample`
- `qualified-real-fixture`
- `user-provided`
- `unknown`

The registry separately records defect qualification.

A synthetic origin is permanently constrained to `synthetic-fixture`. It cannot be registered or later refined as a real defect.

#20 `origin: real` is **not** automatically mapped to `qualified-real-fixture`: that upstream field proves execution against a real artifact/runtime, but does not distinguish official sample, user-provided input, or a separately qualified real defect. Without explicit provenance it is indexed as `unknown / unqualified`.

Only `qualified-real-fixture` may carry `qualified-real-defect`.

An `unknown` case may be explicitly refined to a concrete origin. Crossing synthetic/real reality classes is rejected.

## History rules

Version history is append-oriented and evidence-addressed.

Example:

```text
case_diff_...
  runtime/backend 1.2.0 -> reproduced
  runtime/backend 1.3.0 -> reproduced
  runtime/backend 1.4.0 -> not-reproduced, fixedVersion=1.4.0
```

Each distinct version/result/evidence combination gets a new immutable history file. Registering the same combination again deduplicates that history entry.

Past evidence and history files are never rewritten to make a newer version look fixed.

A conflicting `fixedVersion` for the same logical case is rejected rather than silently replaced.

## Linkage

`linkCases()` creates a deterministic link record and adds each case to the other's `relatedCaseIds`. The relation label stays explicit, for example:

- `failure-has-differential-evidence`
- `contract-context`
- `causal-context`
- `regression-of`

The registry never changes either case kind as a result of linking.

## Versioning and migration policy

Current registry documents use:

- `rive-mcp.corpus-registry/v1`
- `rive-mcp.corpus-case/v1`
- `rive-mcp.corpus-evidence/v1`
- `rive-mcp.corpus-history/v1`
- `rive-mcp.corpus-link/v1`

Readers fail closed on an unsupported registry/case/evidence major schema.

Rules:

1. Additive metadata that does not change identity semantics may be optional inside v1.
2. A change to case identity, evidence identity, origin safety, or history semantics requires a new schema major.
3. Migrations are copy-forward: read the old registry, write a new versioned registry root, and preserve old evidence IDs/locators as provenance.
4. Never rewrite engine-native evidence to conform to a new registry schema.
5. Never mutate historical evidence/history files in place during migration.
6. Adapter changes must document whether old logical IDs remain stable. If not, migration must retain an explicit old-ID -> new-ID linkage.

## Fixed corpus proof

`test/corpusRegistry.mjs` exercises:

- a #20 FailureRecord-shaped synthetic regression
- a #19 Evidence Manifest reference attached to that Failure case
- a #20 `origin: real` record that starts ambiguous and is explicitly qualified
- a #25 Differential Corpus-shaped record
- a #18 Runtime Contract fingerprint observation
- a #24-style causal ambiguity identity
- version-history append
- duplicate evidence/history suppression
- temp-path/timestamp independence
- related-case linkage
- synthetic-to-real relabel rejection

No public MCP tool is added.


## Self-improvement loop

The fixed corpus is held constant across the four measured iterations: one #20 synthetic FailureRecord, one #19 Evidence Manifest linked to it, one #20 `origin: real` FailureRecord, one #25 Differential Corpus record, one #18 contract fingerprint observation, and one #24-style causal observation.

### Iteration 1

Hypothesis:  
A common registry can index all engine families without merging their payloads.

Corpus:  
The fixed corpus above.

Baseline:  
No shared registry existed.

Change:  
Added separate case/evidence/history/link records and structural adapters.

Result:  
- Logical cases: **5**
- Physical evidence records: **6**
- Duplicate logical cases: **0**
- History entries: **5**
- Ambiguous origins: **1**
- Unresolved references: **0**

The one ambiguity is deliberate: #20 `origin: real` cannot prove whether the fixture is an official sample, user-provided artifact, or separately qualified real defect.

Decision: **KEEP**

Lesson:  
Engine-native "real" execution provenance is not enough to grant a real-defect classification.

### Iteration 2

Hypothesis:  
Explicit provenance refinement can remove the ambiguity without creating a second case or rewriting evidence.

Corpus:  
Unchanged.

Baseline:  
5 logical / 6 physical / 0 duplicates / 5 history / 1 ambiguous / 0 unresolved.

Change:  
Re-register the same #20 logical failure with explicit `qualified-real-fixture / qualified-real-defect`. Unknown origin may refine monotonically; synthetic/real crossings are rejected.

Result:  
- Logical cases: **5**
- Physical evidence records: **6**
- Duplicate logical cases: **0**
- History entries: **5**
- Ambiguous origins: **0**
- Unresolved references: **0**

Decision: **KEEP**

Lesson:  
Origin qualification belongs to registry metadata and can be tightened without changing the engine evidence identity.

### Iteration 3

Hypothesis:  
A runtime/backend version change must append compatibility history rather than create another logical Differential case.

Corpus:  
Unchanged; the same Differential case is observed again with the CLI/backend version changed from 1.3.0 to 1.4.0 and status changed to `not-reproduced`.

Baseline:  
5 logical / 6 physical / 0 duplicates / 5 history / 0 ambiguous / 0 unresolved.

Change:  
Keep backend/runtime versions out of logical case identity and include them in immutable history identity.

Result:  
- Logical cases: **5**
- Physical evidence records: **7**
- Duplicate logical cases: **0**
- History entries: **6**
- Ambiguous origins: **0**
- Unresolved references: **0**
- Differential `fixedVersion`: **1.4.0**

Decision: **KEEP**

Lesson:  
Compatibility history is versioned evidence attached to one logical case, not a new case per runtime release.

### Iteration 4

Hypothesis:  
Re-registering identical evidence from another machine/time must deduplicate, while cross-engine relationships remain explicit.

Corpus:  
Unchanged.

Baseline:  
5 logical / 7 physical / 0 duplicates / 6 history / 0 ambiguous / 0 unresolved.

Change:  
Re-register the synthetic failure with different temp paths and timestamp, then add an explicit `failure-has-differential-evidence` link. Add positive guards for dangling links and unsupported registry major versions.

Result:  
- Logical cases: **5**
- Physical evidence records: **7**
- Duplicate logical cases: **0**
- History entries: **6**
- Ambiguous origins: **0**
- Unresolved references: **0**

The main registry remains clean. A separate negative-control registry proves dangling links increment `unresolvedReferences`, and a v2 registry header is rejected by the v1 reader.

Decision: **KEEP**

Lesson:  
Paths/timestamps belong to observation metadata, not reproducibility identity; linkage and schema migration must fail visibly instead of silently guessing.
