# V3 parallel engineering contract — 2026-10-14

Repository: `ODU33104/rive-mcp`. Work on the **existing branch named below**, commit real code and tests, open a PR to the stated **feature base**, never merge to main. Do not merge your own PR. This is a genuine implementation assignment, not a reviewer memo.

The user rejected prior work as visually weak. Do not call a file count, prompt router, compiled .riv, green CI, or cosmetic FX sufficient. Every claimed visual success requires actual official-runtime Rive PNG/GIF plus inspectable editable .riv and a candid quality assessment. The original authored or licensed geometry, hierarchy, rig data, motion tracks and fonts must be preserved. No downloaded copyrighted media on the assumption that a link is a license; keep author attribution, work-level vs embedded-asset rights, and permission gates. Fail rather than fake unsupported effects. Keep your changes within OWNED PATHS below; use your PR body to coordinate needed shared changes.

Read current source and source-branch material before implementation. Baselines: PR #53 (motion recipes), #61 (12 Studio scenes, art direction and effects), #62 (three-domain generator, currently conflicts), #63 (motifs), #64 (tournament), #65 (rigs). The latter four are **older draft/conflicting branches**, so adapt and test source selectively; DO NOT pretend they were merged or blindly merge them.

Required result: actual .riv programs, runnable automated tests, official runtime PNG/GIF artifacts, source/rights provenance and a concise defect report. CI on the **latest commit** must be green before claiming implementation verified. Blinded human aesthetics evaluation must be marked NOT_EVALUATED unless actually collected. Every PR must explicitly distinguish proved from not yet proved.

Branch: `parallel/third-party-effects-v3-20261014`
PR base: `feat/motion-showcase-multigenre`

# C — Scaled collection and real external Rive FX re-use

## Goal
Research and acquire **real** high-quality Rive FX/components first; do NOT restart by drawing a giant synthetic glow/particle library. Existing PR #66 contains 42 SOURCE LINKS (not imported art), PR #72 proved one actual third-party CC BY sparkle vector+keyframe source reused in LUMA/ZENITH, PR #70 measured only 6/8 studio effects visually present.

## Owned paths
`scripts/v3-sourcefx-*.mjs`, `test/v3SourceFx*.mjs`, `data/v3-sourcefx/*`, `docs/V3_REAL_FX_REUSE.md`, `.github/workflows/v3-sourcefx.yml`.

## Hard acceptance
1. Survey 100+ **real unique** linked works across Rive Marketplace, permissively licensed code/asset repos and official showcases; dedup by source and actual technique; capture author/license provenance and associated rig/motion, not tags only. Rights unknown => reference-only. Never count links as reusable assets.
2. Acquire editable source code/RML/.rev or legal equivalent **from at least 3 rights-cleared distinct source families**; preferably genuinely different creators. Pin hashes/license/version and list embedded asset/font/script dependencies. If impossible, report SOURCE_ACQUISITION_BLOCKED and prioritize authentic fewer sources instead of recreating the effects.
3. Produce at least 6 genuinely new cross-scene source-component ports with correct pivots/geometry+original keyframes (trail, bloom/feather-compatible, liquid, particle, path trim, optical or similar), not six placements of Kabi sparkles.
4. Verify actual renderer support: if feather/shader unavailable on repo Canvas Rive host, explicitly use compatible backend or refuse; never flatten to still PNG and call native Rive FX.
5. For each import make native edit-ready .riv, original and destination visual outputs, FX visible impact at >=5 frames, performance evidence, attribution receipt, semantic fit and rights gates. Beauty review still separate. 
6. Take actual latest Studio materials; isolate path namespace to avoid conflict with Art Direction and Composer.

Avoid automatic rights claims from a marketplace badge. PR target `feat/motion-showcase-multigenre`.
