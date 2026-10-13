# Scene Tournament — independent adversarial evidence, not automatic beauty scores

## Status and scope

Worker D (2026-10-13). Source branch `feat/motion-quality-tournament`, PR target `feat/motion-recipe-atlas`. This is a **verification and review harness**, not a generation backend, automatic editor, beauty classifier, or evidence of A/B victory. Derived from [V5](https://github.com/ODU33104/rive-mcp/pull/59) and existing SOLSTICE runtime/gold source. Its independent structural checks consume an *authored SceneSpec witness*, and its image captures consume an actual `.riv` using the **official @rive-app/canvas-advanced runtime hosted in Chromium**. A SceneSpec witness is not silently treated as a decompilation of the `.riv`; the link must be proven separately.

The core test and frozen dataset do **not** establish independent generalization: one project worker authored these holdout prompts and the harness. This is an *unseen by existing evaluation code* split, with no overlap by exact prompt string against the existing 106 development prompts. No blinded human scores, new route B/C products, license clearance, official Editor click-through, or statistical superiority are claimed.

## Commands

```sh
npm ci
npm run build
node test/sceneTournamentCore.mjs
# RIVE_MCP_CHROME must point to an executable Chromium for real rendering:
RIVE_MCP_CHROME=/usr/bin/chromium node test/sceneTournamentRuntime.mjs
RIVE_MCP_CHROME=/usr/bin/chromium node scripts/scene-tournament-run.mjs --gold --out test/tmp/scene-tournament
node scripts/scene-tournament-pack.mjs --audit test/tmp/scene-tournament/audit.json
```

The `--gold` reference is **not a holdout success**. It deliberately asks for a forbidden stationary minute hand even though the SOLSTICE authored `Reveal` track rotates `minuteHand`. The resulting explicit FAIL demonstrates an adversarial checker, not poor renderer health. The gold asset font and resale rights are not presumed cleared. The core checks run without an installed browser. The CI workflow **does not skip** actual rendering when Chromium is absent: that is a broken evidence pipeline.

For external supplied scenes, commit or otherwise provide the input `.riv` paths in the checkout and invoke:

```sh
RIVE_MCP_CHROME=/usr/bin/chromium node scripts/scene-tournament-run.mjs --input data/motion-eval/my-attempts.json --out test/tmp/scene-tournament
node scripts/scene-tournament-pack.mjs --audit test/tmp/scene-tournament/audit.json
```

`my-attempts.json` is input data to be supplied by each experiment, not a fabricated cohort. The `workflow_dispatch` input `manifest` can designate its checked-in path; with no input the workflow renders the gold reference. In CI the runtime artifacts are uploaded separately from the anonymous review pack; **do not send the audit or sealed key to a blind reviewer**.

Minimal input skeleton (replace values with observed evidence, not claims):

```json
{
  "schema": "scene-tournament-input/v1",
  "attempts": [{
    "id": "run-001",
    "promptId": "hard-negative-001",
    "route": "B",
    "fallbackFrom": null,
    "riv": "path/to/generated.riv",
    "source": "path/to/original.rml",
    "sourceKind": "riv",
    "sceneSpec": "path/to/actual-scene-witness.json",
    "animation": "Reveal",
    "captureSeconds": [0, 1.5, 3],
    "budget": {"model": "pinned-model", "tokenCap": 4000, "candidates": 2, "repairs": 1, "wallTimeCapMs": 120000},
    "assets": [],
    "rights": {
      "sourceEvidence": "path/to/permissions.txt",
      "assetsDeclaredComplete": false,
      "operations": {"inspect": "allow", "render": "allow", "adapt": "UNKNOWN", "embed": "UNKNOWN", "redistribute": "UNKNOWN"}
    },
    "constraints": {
      "requiredNodes": ["watch", "minuteHand"],
      "pivots": [{"nodePath": "minuteHand", "referencePath": "watch", "frames": [0, 270], "tolerancePx": 0.5}],
      "motion": [{"kind": "forbid-rotation", "target": "minuteHand"}],
      "visual": [{"kind": "text-overflow", "target": "headline"}]
    }
  }]
}
```

The sample has unknown rights and no reviewer verification by design, so it is *not* eligible for promotion. For intentionally human-reviewed candidates, the optional `semanticReview` and `editorReview` must each include `{status:"PASS", reviewer, evidencePath, reviewedSourceSha256}`; matching source hash and an existing evidence file are checked. Reviewer independence and actual interaction inside Editor are **not** authenticated by software. Absence remains UNKNOWN.

## Frozen prompts and distribution

`data/motion-eval/frozen-prompts.v1.json`: exactly **100** original authored cases: existing intent 40, new intent 20, hard negative 20, outside of scope 20. Each freezes an intent, positive semantic requirements, explicit prohibitions and abstention expectation. Paired hard negatives share a prohibition with different deliverable wording, so the count of 20 is not 20 independent failure mechanisms. These are test *demands*; they do not certify semantic content merely because text is in JSON. Copy this file without changing it when comparing generations.

Before production, separately collect blinded user prompts from independent authors; prohibit contamination from development prompts and publish the freeze digest, time and annotator protocol. A project-authored split is useful for regression but cannot underpin a statistically independent generalization claim.

## Evidence semantics and adversarial gates

| Evidence | PASS basis | FAIL example | UNKNOWN (no promotion) |
|---|---|---|---|
| World pivot | finite composed local/world matrices on specified frames, within pixel tolerance | move `minuteHand` local X by 8 px | undocumented easing at an intermediate frame, parent cycle, complex IK |
| Forbidden hand rotation / only-X | complete authored property tracks with no forbidden changes | add changing rotation/Y track | hidden runtime script, absent SceneSpec, unknown track types |
| No bounce | monotonic linear keyframes or certified bounded continuous trajectory | overshoot/reversal keyframe or sampled trace | non-linear easing may hide extrema between samples |
| Text overflow | actual Rive rendered glyph bounds and actual clip metrics supplied | glyphs outside visible bounds | screenshots without glyph boxes, font substitution, incomplete text metrics |
| Clip/visible region | measured actual rendered pixels and expected visible region | observed visible escape | clip system or nested artboard unmeasured |
| Semantic / editability | source-hash-pinned reviewer and Editor evidence, with explicit scope | known forbidden object or explicit restriction | no trustworthy semantic inference from names or PNG alone |
| Rights | source permission and assets/operations each declared, with evidence | explicit prohibition | pending, unclear third-party embedded font or reuse rights |
| Real render | actual inspect + PNGs from Rive in Chromium | invalid .riv, headless failure | no render |
| A/B cost comparison | same prompt, assets/hashes, model and predeclared budget | mismatched repair limits, assets or fallback | missing metadata or insufficient cohorts |

The transform implementation composes planar TRS matrices; it does **not** claim correctness for skeletal animation, arbitrary reparenting, nested state machines, scripts, complex clips or IK. Current code uses writer degrees, samples exact specified frame values and only interpolates when the preceding easing is explicitly `linear`. Unsupported capabilities are marked UNKNOWN; tests do not infer a visual/semantic PASS from a node name or screenshot.

The art-object tamper regression changes the physical `caseMetal` ellipse X by +8 px, recompiles `.riv`, captures official Rive PNGs for the baseline and tamper, and asserts that visible runtime output differs. This is a detectability check, **not** an aesthetic judgement or a full semantic proof.

## Audit / fairness / reviewer workflow

- The machine audit records route and fallback, original and generated hashes, actual nodes/tracks when available, font/asset rights claims, time, runtime version inputs, RIV/PNG paths, explicit restrictions, and a conservative candidate gate. A missing field is not a PASS. `NOT_EVALUATED` human aesthetics stays separate.
- `scene-tournament-pack.mjs` emits an offline HTML contact sheet with embedded real PNGs, a CSV containing **empty** human scores, and anonymous pair comparability labels. The alias mapping is written as `sealed-blind-key.json` outside the reviewer directory. This is **blind-ready**, not a completed randomized double-blind trial.
- Cross-route comparison marks `NOT_COMPARABLE` for different prompts, unpinned/mismatched material identity, unaligned model/budget, a missing real frame, or fallback contamination. `COMPARABLE_ON_DECLARED_CONTROLS` means only that the declared controls match; it is not a high-quality result and does not authenticate true costs.
- To claim preference, recruit blinded raters, log complete costs including asset acquisition, record preference and disagreement, compare only candidates passing all hard gates, and publish denominator/failures/UNKNOWN along with winning votes.
- Do **not** auto-promote a candidate when aesthetics, provenance, rights, editability or an unsupported negative remain UNKNOWN. Keep rejected RIV/PNG plus failing trace as a reproducible failure corpus. Actual independent A/B/C sample sizes are presently **zero** in this Worker D implementation.

## Observed limitations / decisions

The V5 **CONDITIONAL GO** remains conditional: this lane delivers evidence plumbing, not an independent proof that an AI-generated first attempt is visually excellent. Existing SOLSTICE is intentionally a hard-negative counterexample (hands rotate, motion overshoots). V5 R3 notes remaining licenses/fonts/motifs, and this harness has no grounds to clear bundled Inter or unknown reference assets by inspection alone.

No changes to the recipe ranker, catalog, official writer, or other workers' files are part of this lane. Nothing here should be described as a statistical beauty benchmark or proof that direct RML, scene editing and hybrid generation are equally implemented.
