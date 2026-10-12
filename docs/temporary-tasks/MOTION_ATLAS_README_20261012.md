# Temporary parallel work orders — Motion Atlas / 2026-10-12

**Canonical code base:** `ODU33104/rive-mcp`, PR #53, head `feat/motion-recipe-atlas`. Read `docs/MOTION_RECIPE_ATLAS.md` from that **feature branch**, not stale `main`.

**Coordination only:** These task instructions live on the temporary branch `coord/motion-atlas-parallel-20261012`; do not merge this coordination branch. Delete it after all assignment PRs have been integrated.

**User-facing objective:** An AI receives one natural-language request and delivers a truly compelling Rive scene. The knowledge base is a means, not the end; aim for high-quality visuals + choreography, not accumulating lint or empty tags.

**Worker ownership / no overlapping file writes:**

| Worker | Task | Sole-owned files |
| --- | --- | --- |
| A | Research sources, licenses, references | `data/motion-recipes/source-candidates-2026.json`, `docs/MOTION_SOURCE_LEDGER_2026.md`, optional `test/motionSourceLedger.mjs` |
| B | One genuinely polished Rive scene | `scripts/build-motion-atlas-gold.mjs`, `samples/motion-atlas-gold/**`, `test/motionAtlasGold.mjs`, `docs/MOTION_GOLD_SCENE.md` |
| C | Bilingual intent retrieval benchmark and scorer | `data/motion-recipes/query-benchmark.v1.json`, `scripts/evaluate-motion-retrieval.mjs`, `test/motionRetrieval.mjs`, `docs/MOTION_RETRIEVAL_EVAL.md`; may edit `scripts/motion-recipe.mjs` |
| Lead (this chat) | Multi-recipe composition planner | `scripts/motion-storyboard.mjs`, `test/motionStoryboard.mjs`, `docs/MOTION_STORYBOARD.md` |

## Cross-session Git contract

1. Each worker **reads its own task file** below and existing PR #53 context.
2. Create a **new** branch from `feat/motion-recipe-atlas`. Do not commit directly to `main` or `feat/motion-recipe-atlas`.
3. Touch only your ownership paths. If another path truly must change, state the precise reason in PR rather than silently editing.
4. Open PR with **base `feat/motion-recipe-atlas`**, not `main`. Do not self-merge unless explicitly authorized.
5. Include full command outputs or GitHub Actions evidence for validation. Tests that were not run must be labeled untested.
6. Prefer no new dependencies. No secrets, mass downloads, unlicensed redistributions, or unsupported claims of output quality.
7. Do not ask the user to paste further background: task documents are complete. If blocked, deliver the best partial PR with limitations.
8. PR title prefixes: `feat(motion-sources)`, `feat(motion-gold)`, `feat(motion-retrieval)`.
9. Report exact PR link, changed paths, metrics and known limitations. Read the feature branch for the latest schema before writing.

## Task files

- [A: Research and rights](./MOTION_ATLAS_WORKER_A.md)
- [B: Visual quality](./MOTION_ATLAS_WORKER_B.md)
- [C: Intent retrieval](./MOTION_ATLAS_WORKER_C.md)

## Success is not "more references"

Goal: first-prompt quality improvement with measurable evidence. Track both catalog usability and complete scene execution. `AnimationSpec` structurally valid is not proof of attractive motion. The existing three generated `.riv` demos are minimal smoke tests, not visual gold standards.
