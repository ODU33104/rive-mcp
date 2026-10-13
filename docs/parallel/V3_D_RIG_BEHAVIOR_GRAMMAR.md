# V3 parallel engineering contract — 2026-10-14

Repository: `ODU33104/rive-mcp`. Work on the **existing branch named below**, commit real code and tests, open a PR to the stated **feature base**, never merge to main. Do not merge your own PR. This is a genuine implementation assignment, not a reviewer memo.

The user rejected prior work as visually weak. Do not call a file count, prompt router, compiled .riv, green CI, or cosmetic FX sufficient. Every claimed visual success requires actual official-runtime Rive PNG/GIF plus inspectable editable .riv and a candid quality assessment. The original authored or licensed geometry, hierarchy, rig data, motion tracks and fonts must be preserved. No downloaded copyrighted media on the assumption that a link is a license; keep author attribution, work-level vs embedded-asset rights, and permission gates. Fail rather than fake unsupported effects. Keep your changes within OWNED PATHS below; use your PR body to coordinate needed shared changes.

Read current source and source-branch material before implementation. Baselines: PR #53 (motion recipes), #61 (12 Studio scenes, art direction and effects), #62 (three-domain generator, currently conflicts), #63 (motifs), #64 (tournament), #65 (rigs). The latter four are **older draft/conflicting branches**, so adapt and test source selectively; DO NOT pretend they were merged or blindly merge them.

Required result: actual .riv programs, runnable automated tests, official runtime PNG/GIF artifacts, source/rights provenance and a concise defect report. CI on the **latest commit** must be green before claiming implementation verified. Blinded human aesthetics evaluation must be marked NOT_EVALUATED unless actually collected. Every PR must explicitly distinguish proved from not yet proved.

Branch: `parallel/rig-grammar-v3-20261014`
PR base: `feat/motion-recipe-atlas`

# D — Reusable semantic physical rigs and behavior contracts

## Goal
Advance PR #65's 10 source rigs and PR #63's motion causality analyses into **actual recomposable geometry+motion**. Do not produce a pile of roles/tags with no genuine Rive geometry. Respect original SOLSTICE pivots, lighting attachments, masked bounds and negative semantic transfers.

## Owned paths
`scripts/v3-rig-*.mjs`, `test/v3Rig*.mjs`, `data/v3-rigs/*`, `docs/V3_RIG_BEHAVIOR_GRAMMAR.md`, `.github/workflows/v3-rigs.yml`.

## Hard acceptance
1. At least 15 real original or rights-cleared vector assembly rigs with declared local frame, hierarchy, pivot, clipping/material, allowed motion classes, style domains, and explicit attachment constraints; at least 3 have interactive/state-machine behavior.
2. Define schema contracts and compile to native Rive, preserving *actual* source node IDs / animated properties. Validate roundtrip geometry and frame transforms at 5+ timestamps; injected 8px pivot, illegal property lane, missing parent and incorrect mask must fail (UNKNOWN if cannot check).
3. At least 6 multi-rig compositions including 3 genuinely cross-artboard uses and 2 real semantic cross-domain transfers which make visual/physical sense. Compare to simply editing a complete scene as baseline.
4. Unit tests MUST reject absurd hand→earbud stem semantics, silent base transform 0, unsupported property tracks, broken external source licenses and duplicate child IDs.
5. Native .riv plus 30+ real PNG frames/GIF per composition, visually inspect placements, avoid superficial shared poster style. Explicit quality deficits and rights status.
6. Keep schema new and isolated; don't change core grammar search catalog or writer without distinct review. PR to feature branch.

Do not call 15 rig records a success unless the geometry and rendering actually exist.
