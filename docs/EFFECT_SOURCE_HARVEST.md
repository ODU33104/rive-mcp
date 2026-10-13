# FX Source Harvest v1 — Existing Rive Effects First

**42 verified Marketplace work-page leads, 0 actually downloaded third-party effects.** This repository stores original creator names, work URLs, reported source-page CC BY license labels, technical mechanism hypotheses and a strict permission gate. Source links are not reusable component files.

## Admission into a production Rive scene

1. Confirm source page and creator; preserve source URL and exact work-level license text. A CC BY label alone does not clear embedded images, logos, typefaces and scripts.
2. Legally acquire actual editable .rev/RML source, preserve checksums and attribution. A GIF, .png or opaque .riv is not a verified movable component.
3. Inspect nested components/artboards, animation targets, renderer requirements, interaction and embedded dependencies.
4. Port the actual component/rig with correct transforms, known domain, and compatible backend; no generic blind .riv byte concatenation.
5. Capture native editable .riv and genuine official runtime PNG frames in *both* standalone and target scenes. Refuse if effect is silently invisible.
6. Only then evaluate quality, performance, semantic placement and visual harmony; an operator may promote for production after all rights and visual reviews.

Every discovered source is reference-only. Current code cannot claim a single external effect imported; staged artifact promotion is denied without work/adaptation permission, embedded-asset permissions, hashes, native editable source, component IDs, runtime evidence and valid attribution.

## High-priority real sources

- Particle Librar — TeamRive: https://www.rive.app/marketplace/28062-53012-particle-librar/
- Circular glow loading — aslamcreates: https://rive.app/marketplace/24913-46518-circular-glow-loading/
- Dynamic Particle Follow Path — dev-M3GH8: https://rive.app/marketplace/22854-42724-dynamic-particle-follow-path/
- Liquid Download — guidorosso: https://rive.app/marketplace/1030-2020-liquid-download/
- Ultra-Lightweight Vector Iridescence — stavrospante.sp: https://rive.app/marketplace/27227-51418-ultra-lightweight-vector-iridescence-no-shaders/
- Procedural lines and dots — blender_dac: https://rive.app/marketplace/26348-49298-procedural-lines-and-dots-generator/

## Renderer safety

The existing project headless renderer is Canvas-based. Native Rive Vector Feathering can require the WebGL2 Rive Renderer; feature support must be confirmed per effect. A missing glow is not a PASS. Public Rive component copy/paste in the Editor does not mean arbitrary compiled .riv bytes can simply be concatenated.

## Repro

    npm ci
    npm run build
    node test/effectScoutGate.mjs
    node scripts/effect-scout-gate.mjs

This discovery lane runs in parallel with the separate existing-artwork adapter in feat/effect-capsule-reuse: twelve concrete FX capsules are extracted from original editable Studio Foundry scene sources. It proves cross-scene source reuse, not third-party rights or quality superiority.
