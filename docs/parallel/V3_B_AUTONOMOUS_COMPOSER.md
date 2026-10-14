# V3 parallel engineering contract — 2026-10-14

Repository: `ODU33104/rive-mcp`. Work on the **existing branch named below**, commit real code and tests, open a PR to the stated **feature base**, never merge to main. Do not merge your own PR. This is a genuine implementation assignment, not a reviewer memo.

The user rejected prior work as visually weak. Do not call a file count, prompt router, compiled .riv, green CI, or cosmetic FX sufficient. Every claimed visual success requires actual official-runtime Rive PNG/GIF plus inspectable editable .riv and a candid quality assessment. The original authored or licensed geometry, hierarchy, rig data, motion tracks and fonts must be preserved. No downloaded copyrighted media on the assumption that a link is a license; keep author attribution, work-level vs embedded-asset rights, and permission gates. Fail rather than fake unsupported effects. Keep your changes within OWNED PATHS below; use your PR body to coordinate needed shared changes.

Read current source and source-branch material before implementation. Baselines: PR #53 (motion recipes), #61 (12 Studio scenes, art direction and effects), #62 (three-domain generator, currently conflicts), #63 (motifs), #64 (tournament), #65 (rigs). The latter four are **older draft/conflicting branches**, so adapt and test source selectively; DO NOT pretend they were merged or blindly merge them.

Required result: actual .riv programs, runnable automated tests, official runtime PNG/GIF artifacts, source/rights provenance and a concise defect report. CI on the **latest commit** must be green before claiming implementation verified. Blinded human aesthetics evaluation must be marked NOT_EVALUATED unless actually collected. Every PR must explicitly distinguish proved from not yet proved.

Branch: `parallel/prompt-constructor-v3-20261014`
PR base: `feat/motion-recipe-atlas`

# B — Actual one-prompt native Rive composer with semantics

## Goal
Take existing PR #62's three-domain constructive agent and advance beyond keyword category switching and canned arrangements. Build a **real typed scene plan + component selection + meaningful geometry and timing construction** using physical role contracts. Work across earbuds, precision instrument, typography, and at least one truly new fourth domain (e.g. premium handbag, urban transit diagram, organic creature) that is NOT a recolor of an existing scene.

## Owned paths
`scripts/v3-construct-*.mjs`, `test/v3Construct*.mjs`, `samples/v3-construct/*`, `docs/V3_AUTONOMOUS_COMPOSER.md`, `.github/workflows/v3-construct.yml`.

## Hard acceptance
1. Show exactly how subject-specific asset classes/rig slots are composed: geometry templates with typed units, anchor/pivot, parent transforms, material+FX compatibility, source IDs, editorial typography and timeline constraints. No implicit base x/y=0 from previous grammar failure.
2. 12+ frozen meaningful JP/EN prompts incl novel layout, no-spin, no-bounce, case-only, multiple animated elements, long text; output .riv or explicit ABSTAIN without pretending unsupported prompts succeeded.
3. At least 8 real editable outputs spanning four domains with varying scene shape topology AND staging, and real PNG/GIF at concept-specific camera sizes. Confirm different outputs are structurally different beyond text/colors.
4. Baseline comparison for 6 matched requests: completed-scene adaptation vs constructive route vs direct official RML where possible; include failures/time and truly matched constraints. If direct RML is unavailable, mark unsupported, never invent rendered RML.
5. Strict original/rights-aware asset sources; no assumed arbitrary third-party .riv decode/merge. Run tests and recorded Rive runtime builds.

PR target `feat/motion-recipe-atlas`. Don't alter shared writer/compiler without documented review.
