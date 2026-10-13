# V3 Director: a restricted source-to-source native Rive compositing line

**The user demands genuinely better Rive art rather than more claims of success.** This is a limited, falsifiable component-assembly step, not a general high-end visual agent or a replacement for the five concurrent art/FX/rig/quality sessions.

Four real final Rive studies are composed from two independent previously authored sources already in this repo:

| Brief | V2 edited native scene | Existing semantic FX component source |
|---|---|---|
| Cinematic camera with spectral refraction | SPECTRA: 960x540 optical studio | PRISM refraction/beam polygons and original keyframes |
| Square crystal with highlights | PRISM: 600x600 art board | BOTANICA original droplets as refractive glints |
| Celestial navigation with calibration ticks | ORBITAL: 600x600 square spatial art | ATLAS original compass tick geometry |
| Semiconductor with telemetry signal | QUANTUM: 960x540 wide machine detail | MERIDIAN original status beacon |

Implementation `scripts/v3-director-composition.mjs` reads actual `createArtDirectedScene` (V2), actual `extractExistingEffect` (source effect capsule), and creates a new semantic child group in target hero-local coordinates. It copies source vector shapes (including fill, z and original shape IDs under namespace) and source original animated property lanes without repeating source IDs or guessing base transforms. The new native file is compiled through the same `createRiv` as the authored source.

## Automated fail/abstain behavior

Rejects a prompt if its domain is unknown or ambiguous, if it demands unsupported photorealism/physics, if a forbidden spin/no-bounce/only-object restriction cannot be satisfied, or if the named FX is unrecognized for that domain. A 'no FX' request without a conflicting positive FX keyword is supported as an unmodified V2 composition. This is intentionally a small closed taxonomy and not a free-form AI art planner.

## Evidence and actual quality gate

The four CI jobs run in parallel and each compiles an editable native Rive, inspects the artboard in the actual official Rive Canvas runtime, renders 46 real PNG frames and a GIF, and compares native before/after Rive at five timeline positions. An effect invisible or affecting below 0.05% of the actual rendered pixels **fails that job**. This is a *technical visibility threshold* and not proof of a visually attractive result; giant noisy FX may pass pixel coverage while harming art quality. All human aesthetics remain NOT_EVALUATED. A camera/semiconductor source art style may still feel crude and must be manually reviewed before production promotion.

## Reproduce

    npm ci && npm run build
    node test/v3DirectorComposition.mjs
    RIVE_MCP_CHROME=/path/to/pinned/Chromium node scripts/v3-director-composition.mjs optics test/tmp/v3-director/optics --render

This line owns only `scripts/v3-director-composition.mjs`, `test/v3DirectorComposition.mjs`, `docs/V3_DIRECTOR_COMPOSITION.md`, `.github/workflows/v3-director-composition.yml`; it does not modify other workers' scenes, underlying effect data, or a shared animation compiler. Its changes are carried in a PR to `feat/motion-showcase-multigenre` and are not applied to main.
