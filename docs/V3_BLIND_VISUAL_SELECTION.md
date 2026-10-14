# V3 blind visual selection — fail-closed candidate quality, not an aesthetic oracle

> Assignment: [Issue #77](https://github.com/ODU33104/rive-mcp/issues/77). Source selectively adapted from the **unmerged**, conflicting [PR #64](https://github.com/ODU33104/rive-mcp/pull/64); no merge from PR #64, and no shared files modified. Base: `feat/motion-recipe-atlas`. Human aesthetic quality: **NOT_EVALUATED**.

## Current proved / not proved

- **Source provided:** a 124-case frozen prompt corpus, 24 explicitly authored negative visual hazards, runtime source/binary/rights audit, independent geometry and motion stop gates, anonymous review pack generator, and automated negative-only regression tests. These are engineering implementations, **not** 124 generated animations and **not** 24 independently graded professional designs.
- **Runtime proof requires running CI:** `scripts/v3-judge-run.mjs` builds the project-authored SOLSTICE source with real Rive writer, inspects with bundled official Rive canvas-advanced, renders PNG frames and continuous 24-frame GIF source at 8 fps, encodes GIF with ffmpeg. `test/v3JudgeRuntime.mjs` mutates a real geometric object, rebuilds native `.riv`, renders two authentic frames, and requires changed decoded pixels. See CI artifacts for actual evidence.
- **Aesthetic superiority NOT_EVALUATED.** No independent blinded human panel has been collected; no professional-quality certification exists. Numeric pixel difference is only a tamper/visibility check.
- **Finished-scene edit vs typed slot vs new generation: NOT_COMPARABLE** until each lane delivers pinned files, prompt identity, identical assets, matched declared duration and model/time/attempt budget; fallback must be disclosed. PRs #61–#65 contain work on conflicting branches, not an integrated matched experiment.
- **Editor click-through and interactive behaviors UNKNOWN** unless source-hash-pinned human evidence is independently supplied. A compilable `.riv` with editable vector elements is not automatic proof that a human can edit all constructs in the official Editor.
- **Rights UNKNOWN where the source or embedded fonts are not independently cleared**. The project-authored SOLSTICE watch is a counterexample, not a production candidate; its embedded Inter font permission is explicitly unresolved in the gold manifest. No unknown or denied rights can pass promotion.

## Corpus integrity

`data/v3-judge/frozen-prompts.v1.json` contains 100 adapted legacy development queries from PR #64 and 24 newly authored, disjoint V3 holdout prompts. Each entry has an explicit split and genre. Genres include product, editorial, interface, character, scientific and ambient (plus legacy unmatched categories). No subjective aesthetic labels have been invented. The holdout is separate from the legacy 106 recipe-search development queries, **but not independently authored by an external evaluator**, and must never be described as statistically blind/generalizable. Do not tune on its failures and then reuse it as an unseen final evaluation.

`data/v3-judge/hazards.v1.json` freezes 24 explicit negative fixtures in 9 families: overlap/collision, cropping, text clipping, 8px wrong pivot, forbidden motion, subject silhouette swap, unrequested confetti, invisible effects, and visually destructive FX. The test suite applies destructive **synthetic** objects/measurements to confirm detectors reject obvious hazards. Synthetic cases are not labeled as actual runtime visual evidence.

## Supported objective measurements and their blind spots

| Dimension | Automatic observation | Promotion rule |
| --- | --- | --- |
| Required/forbidden nodes | Source inventory and decoded binary when possible | Explicit intent mismatch FAIL |
| World pivots, overshoot, forbidden motion | Hierarchical matrix math, timeline tracks, measured traces when available | 8px drift, reversals, unwanted movement FAIL; unsampled nonlinear paths UNKNOWN |
| Cropping/collision/text clipping | Bounding boxes or measured actual glyph/clip pixels, with runtime evidence for positive declarations | Measured violations FAIL; unverifiable layout UNKNOWN |
| Negative space | Subject-region occupied fraction if measured | Severe over-occupation FAIL; comfortable area is **not** automatic beauty PASS |
| Product silhouette | Independent source-hash-pinned subject identification | Mismatch FAIL, nominal match UNKNOWN until actual subject review |
| FX impact, occlusion, redundancy | Actual pixel and segmentation evidence if provided; no inference from count of particles or color delta | Invisible/unrequested/occluding FX FAIL when demonstrated; large pixel change cannot PASS aesthetics |
| Lens, materials, editorial hierarchy | Independent designers viewing official frame sequences | UNKNOWN/NOT_EVALUATED until actual independent review |
| Editability | Native binary/source structure plus official Editor review | Binary valid does not imply all tools/editing supported |
| Rights/source | Operation-level declarations and each embedded asset | Explicit denied operation FAIL; no license, attribution, incomplete assets UNKNOWN |
| Interaction behavior | Runtime state machine and user-triggered test | Unsupported/unobserved UNKNOWN, never silently PASS |

These conservative checks are deliberately **not** a neural visual judge. A scalar A/B winner cannot be inferred from CI passing. Audit retains `PASS`, `FAIL` and `UNKNOWN` separately; `UNKNOWN` blocks promotion.

## Reproduction

```sh
npm ci
npm run build
node test/v3JudgeCore.mjs
node node_modules/playwright-core/cli.js install chromium
# ffmpeg must be installed independently
export RIVE_MCP_CHROME="$(node --input-type=module -e 'import {chromium} from "playwright-core";process.stdout.write(chromium.executablePath())')"
node test/v3JudgeRuntime.mjs
node scripts/v3-judge-run.mjs --gold --out test/tmp/v3-judge
node scripts/v3-judge-pack.mjs --audit test/tmp/v3-judge/audit.json
```

Output includes source-attributed `.riv`, timed actual-runtime `.png` frames, `.gif` made from actual 24-frame PNG capture, `audit.json`, blind-ready `review-pack/review.html`, editable native binaries with alias-only names, empty independent-panel CSV, and `comparisons.json`. Keep `sealed-blind-key.json` **outside** the anonymous pack. Every pack gets a fresh cryptographic shuffle; preserve the sealed key privately for later unblinding.

Provide additional candidates with `--input attempts.json` using the manifest shape in `scripts/v3-judge-run.mjs`. Match `promptId`, `durationSeconds`, `budget.model/tokenCap/candidates/repairs/wallTimeCapMs`, exact source and asset hashes and rights across all routes. Values are declared and should be independently verified against execution logs before treating them as matched. Compare `finished-scene-edit`, `typed-slot`, `new-generation`, not generic route letters. No route currently wins.

## Independent blind panel protocol

Recruit at least three designers who did not author candidate variants or this dataset. Separate operator holding the sealed map from reviewers; randomize candidate codes per packet, avoid revealing route metadata or filename. Give reviewers matched prompts and the same-duration anonymous GIF/frame sets; do not display binary internals before blind visual scoring. Collect independent typography, composition, subject truth, motion, material/FX and overall preference ratings on the supplied **empty** sheet with rubric anchors and notes. Record inter-rater disagreement and visually severe faults. Only then unblind to compare routes; never backfill absent human scores with model-generated ratings. Verify Editor affordances in a separate unblinded technical pass against pinned `.riv` hashes.

## Stop conditions

Any critical user-intent mismatch, forbidden object motion, independently measured wrong silhouette, demonstrated crop/collision, unauthorized source/asset reuse, or missing required native/runtime proof prevents promotion. An explicitly denied right is FAIL. Unknown rights, unsupported interactions, missing evidence, insufficient editability or missing panel results remain UNKNOWN/NOT_EVALUATED. No CI workflow is allowed to report an aesthetic winner or certify the user's surprise.

## Source and rights ledger

- Project source: SOLSTICE authored in `scripts/build-motion-atlas-gold.mjs`, scene properties in `samples/motion-atlas-gold/scene.json`. Reference-only benchmark deliberately violates the forbid-rotation adversary. The bundled font file `assets/inter.ttf` requires work-level and embedding/redistribution permission verification; the script does not claim clearance.
- Prior PR #64: independently developed evaluation logic, copied selectively into **new owned paths**, with distinct V3 data and hard gates; its conflicted branch is not merged.
- PR #61 native Studio scenes, #62 3-domain constructor, #63 causal motifs and #65 visual rigs: separate and potentially conflicting branches. Do not attribute their actual output to this branch without hash-pinned manifests and matched execution.
- No third-party geometry, embedded copyrighted source, brand art or commercial font has been imported by the V3 judge.

**Remaining defects:** No independent aesthetics, material believability, segmentation-based FX scoring, full automatic glyph extraction, verified Editor operation, independent holdout producer, or finished three-lane matched cohort. The automated runner correctly reports those gaps instead of inventing success. CI success is necessary engineering proof, never sufficient aesthetic proof.
