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

## Current status and stricter next artistic iteration (added after first 12-render proof)
The lead session already delivered 12 genuine vector scenes and GitHub Actions matrix in PR #61. All 12 initial sources passed first real-runtime GIF builds. The first visual contact sheet revealed a serious art-direction deficiency: many scenes reused left headline / right hero / shared stripe background. The script has been refined for text isolation/size and each scene now has additional scene-specific animated parts.

**DO NOT stop or claim the task finished merely because it generated 12 GIFs.** Continue on this existing branch and **existing PR #61** with a *visual art-direction breakthrough*: 
- For at least 8 scenes, meaningfully change global composition, scale/negative space, focus and typography rather than changing colors and icon bodies. Use at least 5 distinctly recognizable layout languages (full-bleed, typographic poster, asymmetric object/detail, editorial portrait, restrained product studio, information architecture, expressive character, etc.). 
- Replace the generic shared 'STUDIO FOUNDRY / 2026' strip when appropriate with intentional scene-specific copy and detail. Preserve editability. Make each scene feel individually art-directed.
- Inspect actual PNGs/GIF motion phases and fix collisions/cropping. Verify typography not obscured by guide lines. Provide side-by-side **before / after** contact sheet and actual .riv deliverables, annotate which scenes truly improved.
- Do not invent aesthetic rankings or claim awards without independent blind study. Call out any designs that remain generic and provide honest reasons.
- Real official-runtime Actions must pass **after your latest commit**, not just an earlier commit. PR base stays feat/motion-recipe-atlas and worker must not auto-merge.

The next iteration should surprise with composition and intentional motion, not be a mere catalog count.
