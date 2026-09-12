---
name: rive-refine
description: Use when modifying, polishing or fixing an existing .riv file or immutable assetRef. Favors inspection, bounded edits, before/after evidence and revision-safe review.
---

# Rive refine workflow

Use this for an existing .riv: targeted fixes, motion polish, text changes, state-machine repairs, visual cleanup or quality upgrades.

## Workflow

1. Inspect before editing with the smallest useful combination of `riv_inspect`, `riv_dump`, render tools and `riv_critique`.
2. Identify the exact defect and the smallest affected objects/tracks. Do not redesign unrelated parts.
3. If starting from a path, preserve the source and establish a revision before destructive iteration when possible. If starting from an `assetRef`, edit from that immutable parent.
4. Apply the smallest viable `riv_edit`. Use object indices from `riv_dump` when names are ambiguous or absent.
5. Compare before/after renders or `riv_visual_diff` when the change is visual.
6. Run `riv_lint({assetRef})` and `riv_critique({assetRef})` on the new child revision.
7. If another edit is needed, treat that result as a new revision and review it again.
8. Finalize only the exact reviewed child revision with `riv_finalize`.

## Guardrails

- Preserve unrelated geometry, timings, state-machine wiring and assets.
- Never assume SceneSpec ids survive as binary object names; inspect the actual .riv structure.
- Parent review receipts do not authorize child revisions.
- Prefer a small reversible edit over a broad regenerate unless the structure is fundamentally wrong.
- Read `rive-design-guidelines` when the requested change concerns visual or motion craft.
