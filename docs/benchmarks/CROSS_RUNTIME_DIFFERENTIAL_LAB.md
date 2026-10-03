# Cross-Runtime Differential Lab

Date: 2026-10-03  
Branch: `integration/clean-cross-runtime-differential`  
Extraction source: PR #25 / `feat/cross-runtime-differential-lab`  
Base: clean Evidence extraction / `integration/clean-official-cli-evidence`

## Goal

Detect and preserve evidence for cases where the same Rive source, compiled projection, Scenario, and inputs produce different observable results across execution backends.

This work deliberately reuses PR #19:

- `Scenario`
- `RiveExecutionBackend`
- `NativeBackend`
- `RiveCliBackend`
- `identifyEvidenceSubject`

It does **not** add another Official CLI wrapper, replace Evidence Manifest, implement State Explorer/minimization, add Runtime Contract logic, or add public MCP tools.

## Boundary

```text
PR #19 Scenario + backend adapters
        |
        +--> backend A verify / inspect / execute
        |        |
        |        v
        |    Observation
        |
        +--> backend B verify / inspect / execute
                 |
                 v
             Observation
                 |
                 v
              compare
                 |
       +---------+----------+
       |         |          |
 equivalent  unsupported  divergent
                         / inconclusive
                 |
                 v
        first divergent checkpoint
                 |
                 v
         Differential Corpus
```

Backend-specific CLI flags remain inside PR #19's `RiveCliBackend`.

## Fixed corpus

Permanent fixture:

- `test/fixtures/differential-basic/rive.yaml`
- `test/fixtures/differential-basic/scene.rml`
- `test/fixtures/differential-basic/scenario.json`

The fixture is compiled once with Official Rive CLI `--once`. The source tree hash and the exact compiled `.riv` hash are both retained.

Measured stable identities:

- source artifact: `sha256:f93bb9bd6b63dc23304ddeed2cbe6ba31a61c15871a67bf87b6f9779fa4cb97d`
- compiled projection: `sha256:b65ae8e0ab837d0c59247683464cdbcaa4f6c50a771598b301994fc00adf5ac9`
- Scenario: `sha256:57318082da96516f5acc1176f00bf18fbfdd6967b60c743f21f4f082d0773517`

The Official CLI backend executes the source project because PR #19 truthfully supports RML directories, not standalone compiled `.riv`. The native backend executes the exact compiled projection. The test asserts that CLI execution does not mutate that compiled projection.

## Observation model

`rive-mcp.differential-observation/v1` records:

- source artifact hash
- exact execution projection hash when available
- Scenario hash
- backend id/name/version
- runtime version when exposed
- ordered checkpoints
- unsupported capabilities
- deterministic observation key

Current ordered checkpoints are:

1. verify
2. inspect
3. Scenario step outcomes
4. screenshot/data capture
5. final execution result

`rive-mcp.differential-result/v1` classifies the pair as:

- `equivalent`
- `divergent`
- `unsupported`
- `inconclusive`

It retains all differences and the first divergent checkpoint.

## Runtime pair measured

- Official Rive CLI backend: CLI `1.3.0`; PR #19 currently exposes no separate embedded runtime version, so `runtimeVersion` is explicitly `null`.
- Native backend: rive-mcp `0.6.1`, `@rive-app/canvas-advanced` `2.38.5`.

Unknown version fields remain unknown; the differential layer does not invent them.

## Self-improvement loop

### Iteration 1

Hypothesis:  
A simple normalized checkpoint sequence plus exact screenshot artifact hashes is enough to expose the first backend difference.

Corpus:  
`differential-basic`, fixed source/project and one 250 ms `advance` Scenario.

Backends:  
PR #19 `RiveCliBackend` vs PR #19 `NativeBackend`.

Runtime versions:  
Rive CLI 1.3.0; rive-mcp 0.6.1; canvas-advanced 2.38.5.

Baseline:  
No cross-runtime observation model existed. Initial normalization compared full inspect summaries and raw screenshot artifact hashes.

Change:  
Added backend-neutral observations, ordered checkpoints, pair comparison, four-way classification, first divergent checkpoint, deterministic differential key, permanent fixture, and CI.

Result:  
CI passed, but the first reported divergence was `inspect`, before runtime behavior. CLI inspect exposed warning `artboard-without-style` and did not expose animation/state-machine counts through PR #19's current summary, while NativeBackend reported both counts as 1.

False positives:  
Yes. Backend-specific inspect information density was being mistaken for runtime behavior divergence.

Unsupported cases:  
Direct standalone-`.riv` execution through the CLI adapter is unsupported by PR #19; native data/pointer/key are also unsupported and were not exercised.

Decision: **KEEP** the differential skeleton; fix inspect comparison.

Lesson:  
Observation presence is not semantic equality. Backend-specific evidence must be retained without automatically becoming a comparison dimension.

### Iteration 2

Hypothesis:  
Comparing only inspect semantics observed by both adapters will remove the false positive without hiding later behavior differences.

Corpus:  
Unchanged `differential-basic`.

Backends:  
Unchanged CLI vs native pair.

Runtime versions:  
Unchanged: CLI 1.3.0; rive-mcp 0.6.1; canvas-advanced 2.38.5.

Baseline:  
First divergence incorrectly occurred at `inspect`.

Change:  
Inspect comparison now uses only common semantics: success, artboard count, and artboard names. Backend-specific warning codes and richer counts remain in the evidence summary but do not affect inspect equality.

Result:  
First divergence moved to `capture:screenshot`. Build, core classification, tool-surface guard, and live cross-runtime fixture all passed.

False positives:  
The inspect false positive was removed. Screenshot comparison still used PNG file bytes, so encoder differences remained ambiguous.

Unsupported cases:  
Same as Iteration 1.

Decision: **KEEP**.

Lesson:  
Normalize to the intersection of truthful observations; do not coerce missing backend information into a value.

### Iteration 3

Hypothesis:  
Decoding PNGs to canonical RGBA will distinguish file-encoding noise from actual rendered-pixel differences.

Corpus:  
Unchanged `differential-basic`.

Backends:  
Unchanged CLI vs native pair.

Runtime versions:  
Unchanged: CLI 1.3.0; rive-mcp 0.6.1; canvas-advanced 2.38.5.

Baseline:  
CLI PNG SHA-256 `c9d308a773322e62bc9a6fc78783558d2458c90848e7b57adca91b855d1771dd`; Native PNG SHA-256 `a5125a44db732aa850674333422fe5023b8060da2053cbee6b0acf7336d7b5d9`. Raw-file inequality alone could not prove pixel inequality.

Change:  
Added bounded PNG normalization for 8-bit, non-interlaced grayscale/RGB/indexed/grayscale-alpha/RGBA images. Comparison uses width, height, and decoded RGBA SHA-256; exact PNG hashes remain evidence only. Evidence-only screenshot bytes are excluded from observation deterministic identity.

Result:  
Both outputs were 320x320, but decoded pixels still differed:

- CLI RGBA: `sha256:6259feae6e89493d1fbe8b579230fecb0fda8e1cd9ff35ac275a38eb280415b4`
- Native RGBA: `sha256:e2cc150e21d3ff4672a22427ffa2cb45da65e5fd29ccd387ff8d5dcde2e1ce53`

The first real divergent checkpoint is therefore `capture:screenshot`, not PNG encoding.

False positives:  
PNG byte/metadata/compression differences no longer create a visual divergence by themselves. Unit coverage also verifies that different PNG evidence bytes with identical decoded pixels compare equal.

Unsupported cases:  
Unsupported PNG bit depths/interlacing/media types are classified as unsupported visual normalization instead of fabricated divergence.

Decision: **KEEP**.

Lesson:  
Cross-runtime visual comparison must operate on decoded pixels, while retaining original artifacts separately for audit.

### Iteration 4

Hypothesis:  
A hash-only corpus is insufficient evidence for long-term compatibility history; the exact backend screenshots must travel with the differential record.

Corpus:  
Unchanged `differential-basic`.

Backends:  
Unchanged CLI vs native pair.

Runtime versions:  
Unchanged: CLI 1.3.0; rive-mcp 0.6.1; canvas-advanced 2.38.5.

Baseline:  
The corpus JSON contained artifact/pixel hashes but not the source PNG evidence.

Change:  
Backend output directories now live under the CI Differential Corpus. The record indexes retained evidence paths, SHA-256, and byte sizes.

Result:  
CI artifact contains exactly three files:

- CLI screenshot: 8,209 bytes, `sha256:c9d308a773322e62bc9a6fc78783558d2458c90848e7b57adca91b855d1771dd`
- Native screenshot: 5,828 bytes, `sha256:a5125a44db732aa850674333422fe5023b8060da2053cbee6b0acf7336d7b5d9`
- `differential-basic.json`

Classification remains `divergent`, first checkpoint remains `capture:screenshot`, and the deterministic differential key remains:

`sha256:4d82a1f42028fc839a02c4003a059b59b44bec051c48277d75a1bbea2e8d9d26`

False positives:  
None introduced. Evidence retention does not participate in semantic comparison.

Unsupported cases:  
Same explicit limitations as prior iterations.

Decision: **KEEP**.

Lesson:  
Compatibility history needs reproducible identities **and** inspectable primary evidence.

## CI evidence

Final measured cross-runtime workflow run:

- workflow: `cross-runtime-differential-ci`
- run id: `37087358078`
- result: PASS
- current Official CLI installed by CI: `1.3.0`
- Differential Corpus artifact id: `11261007191`
- uploaded ZIP digest: `sha256:a6971460042b9c073c4ba1d4bf5d7e88324cad82373ea9f879a661cd01e4d9cd`
- files uploaded: 3

Original #25 ran the legacy-stack tool-surface guard and measured 33 tools because its ancestry included #7-#17. The clean restack instead guards the current main surface at 32 tools; the differential layer itself adds no public MCP tool.

## Result

The fixed corpus demonstrates a real cross-runtime visual divergence after eliminating two ambiguity classes:

1. backend-specific inspect schema/detail differences
2. PNG encoding/metadata/compression differences

The earliest remaining difference is decoded visual output at `capture:screenshot`.

This is evidence of different observable output for the measured runtime/backend pair. It is **not** by itself a claim about which renderer is correct.

## Known limitations

- The first permanent fixture exercises deterministic time advance and screenshot output, not positive Data Binding input.
- NativeBackend's PR #19 adapter intentionally does not expose data/pointer/key Scenario steps.
- RiveCliBackend currently executes the source RML project while NativeBackend executes the exact compiled projection; both source and compiled hashes are retained to make that projection explicit.
- The CLI backend exposes CLI 1.3.0 but no separate embedded renderer/runtime version.
- PNG normalization intentionally fails closed for unsupported encodings instead of approximating them.
- No tolerance-based perceptual equivalence is applied. Any decoded RGBA difference is a real observable pixel difference; future policy can layer tolerances on top without changing the raw evidence.

## Compatibility-history direction

Each future corpus entry can be keyed by:

```text
source artifact hash
+ execution projection hash
+ Scenario hash
+ backend id/version
+ runtime version
+ normalized checkpoint values
= deterministic differential history
```

That allows rive-mcp to accumulate independent compatibility evidence across runtime/backend upgrades without competing with Rive's authoring or execution tooling.
