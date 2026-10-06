# rive-mcp Handover

Date: 2026-10-06  
Repository: `ODU33104/rive-mcp`

## 1. Current authoritative state

The verification train and the semantic source-path work discussed in the previous session are merged into `main`.

Main before this handover-document commit:

- commit: `d6f42fd4c1dd84f776bae50843af1d066ecc7e36`
- tree: `833fc73d8db0bca8849d15e0228c310c2e6386f8`
- package version: `0.6.2`
- public MCP tool count: **32**

Important: after this file is committed, `main` will advance by one documentation-only commit. The code state described above remains the implementation baseline.

## 2. Product positioning

Do not compete with Official Rive on generic authoring/execution breadth.

Official Rive already provides:
- Editor
- Official MCP
- Rive CLI
- RML
- verify / inspect / screenshot / test / bench
- data / pointer / key / advance
- push / pull workflows

rive-mcp should differentiate as:

> **Independent Verification + Optimization Layer for Rive**

Working principle:

> **AI proposes. rive-mcp proves.**

Primary value:
- independent verification
- adversarial state-space exploration
- failure corpus
- minimal reproduction
- static provenance
- observed traces
- causal ambiguity handling
- cross-runtime differential evidence
- reproducible evidence identities

Do not drift back into tool-count competition or generic Editor cloning.

## 3. Core semantic rules

These rules are mandatory.

- different pixels != product bug
- unsupported != divergent/failure
- static possible writer != observed support != exclusive cause
- observed state != observed property change
- unobserved/unmeasured != zero
- observed baseline != correctness oracle
- no failure found != proven correct
- not reached within bound != unreachable
- no confidence percentages
- synthetic behavior must not be promoted to a real Rive defect
- expected behavior and observed behavior must stay separate
- opaque numeric `sourcePathIds` must never be guessed into semantic property names

Classification discipline:
- KEEP
- REVERT
- INCONCLUSIVE

## 4. Verification train merged into main

The clean release train was merged in strict order:

1. #18 Runtime Contract
2. #20 Adversarial Explorer
3. #21 Static Provenance
4. #22 Observed Trace
5. #23 Runtime Property Observation
6. #24 Causal Ambiguity
7. #29 Official CLI Backend + Evidence
8. #30 Cross-runtime Differential
9. #31 Verification Corpus Registry
10. #32 Real-world Verification Corpus
11. #46 Clean raw `.riv` NativeBackend stage
12. #47 Clean real causal calibration stage
13. #49 Real ViewModel observation restack

Do not merge superseded/rehearsal branches:
- #37
- #38
- #40
- #41 original implementation branch

#46 and #47 are the clean replacements that were merged.

## 5. Important integration history

The train branches #46/#47 used a synthetic release-history chain that diverged from the actual sequence of GitHub merge commits.

During integration:
- #31 and #32 merged normally.
- #46 initially conflicted.
- The #32 release-stage tree and actual merged-main tree were verified byte-identical:
  `5dfd980f6d53e45c1fe26e61d6de0d8c0c6802ba`
- #46 was restacked by preserving its exact validated tree and changing only the parent history.
- #47 was restacked the same way.
- #49 was then rebased/restacked onto actual main while preserving its six validated ViewModel delta trees.

This was a history repair, not a semantic code rewrite.

Final verification-train main merge:
- #49 merge commit:
  `68ea97909a2de5f77988fbd02f80c6491ef62504`
- tree:
  `ac23a074ff913a7d7a504da7bc8ccfd1bcae72b7`

## 6. Real ViewModel observation

Qualified real fixture:

- id: `official-flutter-rapid-pointer`
- artifact SHA-256:
  `e0584ba73df9bf8a7ac1a4ff1c3e381212967b10025d936e49ddab3d30a13079`
- bytes: 528
- Scenario: `rapid-pointer-down-up`
- Scenario hash:
  `sha256:020b7ca8ea60ed285d503271263671b8e96100f291e4a396d68ffe0655d35e56`

Source-defined expectation:
- `hasReached: false -> true`

Runtime observation:
- initial: false
- pointer down: true
- pointer up: true
- advance: true
- final: true

Important:
- pointer-down timing is a runtime observation
- it does not rewrite the source-defined expected assertion
- this is not exclusive causal attribution

Permanent observation fixture:
- `test/fixtures/causal/rapid-pointer-viewmodel-v1.json`
- `oracle:false`

Known deterministic evidence:
- screenshot:
  `sha256:2c27fad945da1299da7dfb53d45fcb53030f367e51e322dac1a69d1aa15e8b44`
- final data snapshot:
  `sha256:ac48a255a442baaf25072fa3371f6a4b9a9f3dbd68dcefaed36cd66611cd1a43`

Current causal classification for this case:
- actual runtime change observed: yes
- semantically resolved binding sources: 0
- observed-supported static paths: 0
- competing matched paths: 0
- classification: **unresolved**

## 7. sourcePathIds semantic-resolution work

Issue #50:
`[Causal] Resolve opaque Data Binding sourcePathIds from explicit metadata`

PR #51:
`[Causal] Adopt fail-closed semantic resolution for Data Binding source paths`

Merged:
- PR #51 merge commit:
  `bc8d05b9ae01f0d2b2e1d96907a445c1415c94db`

Issue #50 is closed/completed.

### What was adopted

A machine-readable, fail-closed semantic-resolution contract.

New internal helper:
- `src/causal/sourcePathResolution.ts`

Static Provenance now attaches a structured `sourcePathResolution` record to Data Binding source nodes.

Resolution semantics:
- `status: "resolved"` is reserved for a proven explicit artifact-contained semantic join
- `status: "unresolved"` means the proof is absent
- numeric `sourcePathIds` are retained as evidence
- numeric equality with `DataBindPath.path` is candidate evidence only
- repeated numeric patterns do not prove semantic identity
- runtime value/timing correlation cannot validate a static identity guess
- `normalized:true` is allowed only when semantic resolution is actually proven

For the current rapid-pointer fixture:
- `[0,1]`, `[0,0]`, etc. remain unresolved
- do not map them to `hasReached` by inference

Documentation:
- `docs/source-path-resolution.md`

### Why this matters

This does not change visual output.

It strengthens verification when AI-generated or externally acquired `.riv` files are inspected.

The intended future pipeline is:

`.riv` load
-> Data Binding decode
-> source-path semantic resolution
-> Static Provenance graph
-> runtime observation
-> causal classification

The resolver is an internal verification primitive, not a public MCP tool.

## 8. CI / evidence for #51

PR #51 passed all relevant workflows.

Full Real Causal Calibration:
- run: `37283689996`
- conclusion: PASS
- artifact: `real-causal-calibration`
- artifact id: `11332494852`
- digest:
  `sha256:4992a7553fb3db4525bb62414d85fd2b202fd506d94be913b8fbe60021057697`

Full gate included:
- Build
- public MCP tool count = 32
- Runtime Contract
- Explorer core
- Static Provenance
- Observed Trace
- Runtime Property Observation
- Causal Ambiguity
- Corpus Registry
- qualified fixture acquisition
- Real-world Corpus
- current Official Rive CLI install
- Official CLI corpus
- backend evidence
- cross-runtime differential
- raw `.riv` capability/oracle
- Real Causal Calibration
- Rapid-pointer ViewModel observation

Rive CLI observed in the verification train:
- `rive 1.3.0`

## 9. Release preparation

PR #52:
`Release 0.6.2`

Merged:
- merge commit:
  `d6f42fd4c1dd84f776bae50843af1d066ecc7e36`

Changes:
- `package.json`: 0.6.1 -> 0.6.2
- `package-lock.json`: root package version -> 0.6.2

No public MCP tool was added.
Public tool count remains **32**.

## 10. npm publication status

Repository-side release preparation is complete for version **0.6.2**.

However, npm publication requires credentials/2FA that are not available through the repository connector.

The user must perform the publish from a local authenticated environment.

Recommended local steps:

```bash
git checkout main
git pull

npm ci
npm run build
npm pack --dry-run

npm login
npm publish

npm view rive-mcp-server version
```

Expected final published version:
- `0.6.2`

If npm 2FA is enabled, OTP entry may be required during `npm publish`.

Do not claim npm 0.6.2 is published until `npm view rive-mcp-server version` confirms it.

## 11. Current strategic next step

Do not immediately expand into more generic authoring.

Highest-information next research candidates:

1. **True semantic resolution**
   - obtain explicit, authoritative Rive runtime/defs/import semantics for `sourcePathIds`
   - implement a resolved branch only if the exact artifact exposes a reconstructable join
   - ambiguous/missing/out-of-range must remain unresolved

2. **Independent second runtime host**
   - same exact raw `.riv` bytes
   - same logical Scenario
   - compare behavior on a second official runtime host, likely Flutter
   - do not decompile/recompile and call it the same artifact

3. **Post-release certification**
   - after npm 0.6.2 publication, verify install from registry in a fresh environment
   - confirm tool count 32
   - run a small smoke set against the published package

Priority recommendation:
- first finish npm 0.6.2 publication + fresh-install certification
- then resume semantic-resolution research

## 12. Important code-quality note

`normalizeViewModelExecutionObservation(execution: ExecutionResult)` currently emits:

`source: "NativeBackend.execute"`

The current caller is NativeBackend, so present evidence is correct.

Before broad reuse across other backends:
- add a backend identity guard, or
- derive the source label from execution.backend

This is not a blocker for the current merged evidence.

## 13. Things not to do

Do not:
- guess semantic names from opaque numeric IDs
- treat runtime correlation as static identity proof
- treat pixel differences as correctness failures by default
- treat unsupported capability as divergence
- promote observed baselines to correctness oracles
- add confidence percentages
- merge superseded rehearsal branches
- increase MCP tool count just to compete with Official Rive
- call raw `.riv` CLI execution supported when Official CLI 1.3.0 cannot directly execute the same raw bytes for the Scenario

## 14. GitHub status summary

Merged and closed:
- #18
- #20
- #21
- #22
- #23
- #24
- #29
- #30
- #31
- #32
- #46
- #47
- #49
- #51
- #52

Closed issue:
- #48 completed
- #50 completed

Current implementation/release version in repo:
- **0.6.2**

Public MCP tool count:
- **32**

## 15. Handoff instruction for the next session

Before changing code:

1. Read this file.
2. Fetch current `main` live from GitHub.
3. Do not trust this handover over newer repository state.
4. Check whether npm 0.6.2 has actually been published.
5. If published, perform fresh-install certification first.
6. Preserve all semantic claim-discipline rules above.
7. For `sourcePathIds`, a resolver may return `resolved` only with an explicit, deterministic, artifact-reconstructable proof chain.
