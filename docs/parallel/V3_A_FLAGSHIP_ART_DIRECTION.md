# V3 parallel engineering contract — 2026-10-14

Repository: `ODU33104/rive-mcp`. Work on the **existing branch named below**, commit real code and tests, open a PR to the stated **feature base**, never merge to main. Do not merge your own PR. This is a genuine implementation assignment, not a reviewer memo.

The user rejected prior work as visually weak. Do not call a file count, prompt router, compiled .riv, green CI, or cosmetic FX sufficient. Every claimed visual success requires actual official-runtime Rive PNG/GIF plus inspectable editable .riv and a candid quality assessment. The original authored or licensed geometry, hierarchy, rig data, motion tracks and fonts must be preserved. No downloaded copyrighted media on the assumption that a link is a license; keep author attribution, work-level vs embedded-asset rights, and permission gates. Fail rather than fake unsupported effects. Keep your changes within OWNED PATHS below; use your PR body to coordinate needed shared changes.

Read current source and source-branch material before implementation. Baselines: PR #53 (motion recipes), #61 (12 Studio scenes, art direction and effects), #62 (three-domain generator, currently conflicts), #63 (motifs), #64 (tournament), #65 (rigs). The latter four are **older draft/conflicting branches**, so adapt and test source selectively; DO NOT pretend they were merged or blindly merge them.

Required result: actual .riv programs, runnable automated tests, official runtime PNG/GIF artifacts, source/rights provenance and a concise defect report. CI on the **latest commit** must be green before claiming implementation verified. Blinded human aesthetics evaluation must be marked NOT_EVALUATED unless actually collected. Every PR must explicitly distinguish proved from not yet proved.

Branch: `parallel/flagship-scenes-v3-20261014`
PR base: `feat/motion-showcase-multigenre`

# A — Flagship art direction and bespoke motion

## Goal
Turn 3 strongly DIFFERENT premium first-impression visual works into real edit-ready Rive. Source Studio #61 is useful machinery, not visual-quality inspiration: 12 split-layout vector posters are insufficient. Deliver three pieces with original sophisticated geometry/art direction, not simply recolor, scale, or attach sparkle: (1) a sculpted physical product with believable lighting/refraction layers, (2) expressive kinetic typography with layout transitions, and (3) a non-product spatial/data/character piece. Author carefully.

## Owned paths
`scripts/v3-flagship-*.mjs`, `test/v3Flagship*.mjs`, `samples/v3-flagship/*`, `docs/V3_FLAGSHIP_ART_DIRECTION.md`, `.github/workflows/v3-flagship.yml`.

## Hard acceptance
1. Three visually distinct artboards with 3 distinct choreographies (not one generic hero slide); scenes have purposeful dramatic hierarchy, negative space, 4+ interacting animated families, at least one reveal/mask/path behavior per scene that matches the concept and is known to render.
2. Make real native Rive (.riv), 60+ PNG frames per scene and GIF/WebM where stable. Capture true mid-motion frames and motion-state comparison contact sheets. Produce original graphics, source manifests and frame hashes. No bitmap/video fakes.
3. For each: a mini-script (opening/midpoint/ending), material/lighting rationale, explicit positioning, editable target names, font-license evidence, and 3 substantial failure/quality criteria (not “has 30 shapes”).
4. Inspect art direction directly against prior 12 Studio scenes; improve a coherent style and avoid generic top/side layout. Public showcase should consist only of personally visually inspected pieces, with sub-par attempts rejected.
5. Retain no unverified external media. All native runtime rendering and tests must pass. Independent beauty review is NOT_EVALUATED unless actual reviewers participate.

Do not stall in architecture debate. Implement and deliver code + PR + real artifacts.
