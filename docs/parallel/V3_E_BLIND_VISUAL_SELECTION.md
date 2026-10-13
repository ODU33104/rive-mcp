# V3 parallel engineering contract — 2026-10-14

Repository: `ODU33104/rive-mcp`. Work on the **existing branch named below**, commit real code and tests, open a PR to the stated **feature base**, never merge to main. Do not merge your own PR. This is a genuine implementation assignment, not a reviewer memo.

The user rejected prior work as visually weak. Do not call a file count, prompt router, compiled .riv, green CI, or cosmetic FX sufficient. Every claimed visual success requires actual official-runtime Rive PNG/GIF plus inspectable editable .riv and a candid quality assessment. The original authored or licensed geometry, hierarchy, rig data, motion tracks and fonts must be preserved. No downloaded copyrighted media on the assumption that a link is a license; keep author attribution, work-level vs embedded-asset rights, and permission gates. Fail rather than fake unsupported effects. Keep your changes within OWNED PATHS below; use your PR body to coordinate needed shared changes.

Read current source and source-branch material before implementation. Baselines: PR #53 (motion recipes), #61 (12 Studio scenes, art direction and effects), #62 (three-domain generator, currently conflicts), #63 (motifs), #64 (tournament), #65 (rigs). The latter four are **older draft/conflicting branches**, so adapt and test source selectively; DO NOT pretend they were merged or blindly merge them.

Required result: actual .riv programs, runnable automated tests, official runtime PNG/GIF artifacts, source/rights provenance and a concise defect report. CI on the **latest commit** must be green before claiming implementation verified. Blinded human aesthetics evaluation must be marked NOT_EVALUATED unless actually collected. Every PR must explicitly distinguish proved from not yet proved.

Branch: `parallel/visual-judge-v3-20261014`
PR base: `feat/motion-recipe-atlas`

# E — Independent quality tournament and anti-fake wow benchmark

## Goal
The user observed nothing impressive and calls existing results low quality. The selector must not confuse valid runtime output, pixel-diff magnitude, novelty, or counts with professional aesthetic quality. Build genuinely adversarial comparison where mediocre outputs lose. Use prior PR #64 as partial source only; old PR may be conflicting.

## Owned paths
`scripts/v3-judge-*.mjs`, `test/v3Judge*.mjs`, `data/v3-judge/*`, `docs/V3_BLIND_VISUAL_SELECTION.md`, `.github/workflows/v3-judge.yml`.

## Hard acceptance
1. Build frozen 100+ prompt and 20+ explicit visual hazard fixtures across 5+ genres, separate dev vs unseen holdout, no beauty ground truth invented. Compare same prompt/assets/duration/effort where possible.
2. Diagnose negative-space/collision/cropping/text clipping, motion continuity/overshoot/forbidden object movement, pivot displacement, FX occlusion/redundancy, lens/material believability, editability and rights. Unknown checks do not pass.
3. Produce truly blind-ready grid and review pack from real official-runtime PNG/GIF and native .riv, with randomized anonymized candidate identities and independent human panel scoring forms (no fabricated ratings).
4. Include destructive counterexamples: corrupted overlap, swapped product silhouette, 8px wrong pivot, pointless confetti, invisible FX, wildly changing but ugly FX. CI must block fake promotion.
5. Run matched same-request baseline experiments against finished-scene edit, typed slot and new generation when branches provide artifacts. If branches not ready, output NOT_COMPARABLE rather than invented wins.
6. List objective stop gates: any critical intent violation fails; zero rights violations; unsupported interactions marked unknown. Publish reproducible CI and source-backed evidence.

Do not use word WOW in a pass flag; the project cannot objectively auto-prove human surprise.
