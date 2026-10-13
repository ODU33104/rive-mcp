# WORKER A — Aesthetic Scene Foundry (parallel lane)
You are a working engineer for ODU33104/rive-mcp, NOT an idea-only reviewer.
Base branch: `feat/motion-showcase-multigenre` (created from `feat/motion-recipe-atlas`).
Deliver a PR to base `feat/motion-recipe-atlas`. Read existing `scripts/build-motion-atlas-gold.mjs`, `src/rivWriter.ts`, `scripts/render-motion-atlas-sequence.mjs`, and V5 review PR #59 first.

## Mission
Make **at least 12 demonstrably different, originally designed, professional-quality, editable Rive scenes** across distinct genres: fashion editorial, premium electronics, spatial instrument, biomorphic nature, kinetic editorial typography, command-center dashboard, playful reward, architectural lines, music/cover, glass UI, scientific data, immersive ambient. Not 12 copies of a clock or recolored circles. Favor craftsmanship, deliberate layouts, embedded legitimate typography, distinctive layered shapes and choreographed timing. More than 12 only after visual acceptance; no fake counts.

Own only `scripts/studio-foundry-*.mjs`, `test/studioFoundry*.mjs`, `samples/studio-foundry/*`, `docs/STUDIO_FOUNDRY.md`, `.github/workflows/studio-foundry-ci.yml`. If other owner paths are necessary, coordinate via PR body; avoid touching catalog, compiler, writer, scene-assembly code or files owned by others.

## Hard deliverable
1. 12+ DISTINCT scene programs as legal original vector designs, each with meaningful text, objects and original choreography. At least 3 separate objects animated per scene; no simple 1-object slide as a 'scene'.
2. Every scene builds to a real .riv through the current runtime/writer, not fabricated PNG or mockups. Real screenshots at several times and GIF/MP4 as GitHub Actions artifacts. Use pinned Playwright chromium installation, not npx latest.
3. Parallel GitHub Actions **matrix** for scenes, preferably 3-6 concurrent jobs for speed. Export a proof manifest with stage timing, draw objects, artboard, animation names, byte count, render status. Render failures FAIL CI rather than silently substituting images.
4. Inspect output visually, fix severe layout/cropping/text defects. Provide a contact sheet and direct artifacts in PR.
5. Unit tests check uniqueness of scene geometry and substantial motion, not just number of JSON labels.
6. Respect work-level/media/font permissions. No external artwork copied from inspiration sources.

Success is not "12 files exist" but genuine striking *visuals*, creative diversity and reproducible native Rive. If 12 cannot all meet the bar, explicitly report which fail and deliver strongest completed ones. Do not claim blinded aesthetic quality without panel.

Make changes directly on GitHub branch, push, open PR, do NOT merge PR yourself. Minimize questions. Include runtime evidence links and honest defects.