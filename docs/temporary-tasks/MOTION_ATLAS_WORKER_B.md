# Worker B — Visually ambitious single-scene Rive proof

**Execute this assignment without requiring extra user input.** Read `docs/temporary-tasks/MOTION_ATLAS_README_20261012.md` in `coord/motion-atlas-parallel-20261012`; then inspect existing generation pipeline and sample code on `feat/motion-recipe-atlas` (especially `scripts/build-motion-atlas-demo.mjs`, `src/rivWriter.ts`, `src/motionPresets.ts`, `samples/launch-success/build-scene.mjs`).

**Branch:** `feat/motion-atlas-gold-20261012` from `feat/motion-recipe-atlas`. **PR base:** `feat/motion-recipe-atlas`.

## Mission

Create **one truly composed original animated Rive scene** at 480x320 or larger with a strong visual narrative and refined hierarchy. Pick one theme where the current basic examples fall short — e.g. premium product reveal with spatial depth and kinetic typography, or reward moment with environmental reactions. Make the **visual design** the focus: layers, font treatment, masking, meaningful original vector illustration, contrast, microtiming, anticipation, environmental feedback and settle. Do not merely add more scattered `pop-in` effects. Use Rive existing writer/CLI, not a new rendering engine.

## Required deliverables (own only these)

1. `scripts/build-motion-atlas-gold.mjs`: single-command generator (scene spec + assets + motion; use existing library), with deterministic output and no network requirement.
2. `samples/motion-atlas-gold/`: editable source recipe/scene configuration where useful, and **no third-party asset** without rights/provenance evidence. If files are large, use a generation script rather than vendored binaries.
3. `test/motionAtlasGold.mjs`: generate `.riv`; assert binary magic, successful official runtime inspection if runtime is available. Avoid falsely claiming render success if only compilation was run.
4. `docs/MOTION_GOLD_SCENE.md`: exact prompt, aesthetic decisions, shot-by-shot timing, expected file/preview commands, licensing evidence and a comparison to current `premium-product-intro`.

## Quality gate

- At least **three distinct visual layers**, clear visual hierarchy, cohesive palette, temporal staging, and some sophisticated technique (gradient, trim paths, controlled overshoot, depth/parallax, clipping, rigged details, or physically plausible motion).
- A visual **actual frame strip/preview** captured through the official runtime where tooling permits; if unavailable, document reason. Do not substitute diagrams for rendered evidence.
- Include complete .riv build/reproduction instructions, known limitations, and **do not claim professional quality** without external judgment.

## Isolation / handoff

Touch only `scripts/build-motion-atlas-gold.mjs`, `samples/motion-atlas-gold/**`, `test/motionAtlasGold.mjs`, `docs/MOTION_GOLD_SCENE.md`. Do not modify core recipe scorer (worker C), discovery ledger (worker A) or composition planner (lead). Open PR, share link, do not merge.
