---
name: rive-author
description: Use for creating a new non-trivial Rive scene with rive-mcp. Orchestrates tokens, professional assets, riv_create, revision-bound critique, and finalization. Read rive-design-guidelines for craft details.
---

# Rive author workflow

Use this when starting a new .riv scene or animation from scratch.

## Workflow

1. Call `riv_design_tokens` and keep the returned palette, motion and spacing values.
2. Acquire professional artwork with `riv_asset_search`, `riv_import_svg`, `riv_lottie_import` or `riv_decompile` for illustrative content. Use primitives mainly for layout, backgrounds and particles.
3. Read `rive-design-guidelines` for viewpoint, motion, easing, preset and craft rules.
4. Build with `riv_create`. Preserve the returned `assetRef`.
5. Review that exact revision with `riv_lint({assetRef})` and `riv_critique({assetRef})`.
6. Fix defects by creating a child revision with `riv_edit({assetRef,...})` or by regenerating deliberately. Never treat a parent review as approval for the child.
7. Repeat review on the final revision. For non-trivial work, inspect at least two critique passes.
8. Deliver only through `riv_finalize({assetRef,outPath})`.

## Stop conditions

Do not finalize when:
- lint has errors,
- critique has not been run on the exact final revision,
- perspective or facing direction is inconsistent,
- an illustrative asset was improvised from weak primitives despite a suitable professional source,
- the final revision changed after review.

The final artifact and the reviewed artifact must be the same immutable revision.
