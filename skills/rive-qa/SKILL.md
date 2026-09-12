---
name: rive-qa
description: Use for validating a Rive asset before delivery. Separates structural, runtime, visual-motion and finalization evidence, all bound to the exact immutable revision.
---

# Rive QA workflow

Use this before delivery or when asked whether a .riv is actually ready.

## Evidence layers

Treat these as separate evidence; one does not replace another:

1. **Structure** — `riv_lint`, `riv_dump`, state-machine checks.
2. **Runtime** — official Rive runtime load/render validation.
3. **Visual motion** — `riv_critique` filmstrip, onion skin, motion report and metrics.
4. **Regression** — before/after render or `riv_visual_diff` when modifying an existing asset.
5. **Delivery identity** — the revision being finalized must have the same `assetRef/rivHash` as its review receipts.

## Release gate

For the final `assetRef`:

- `riv_lint({assetRef})` must have zero errors.
- `riv_critique({assetRef})` must complete and its images must be inspected.
- Fix material warnings that contradict the requested behavior or craft target.
- Verify state-machine behavior when the deliverable depends on interaction.
- Use `riv_finalize({assetRef,outPath})`; do not copy an arbitrary path as a substitute.

If finalization rejects the asset, fix the cause. Do not weaken the gate or reuse stale receipts.
