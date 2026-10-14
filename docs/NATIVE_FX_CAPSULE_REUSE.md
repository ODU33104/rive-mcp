# Native Rive FX Capsule Reuse — not invented from scratch

## What is actually copied

12 FX capsule source families are extracted from already authored real editable Studio Foundry scenes, not invented from metadata or redrawn from screenshots. They retain the source shape geometry, fill/strokes, original authored keyframe tracks, original source identity/geometry SHA-256, namespaced IDs and local hero-space attachment.

The FX source families are spectral beams, orbital trace, celebratory sparkles, circuit/data pulse, botanical dew, camera lens specular highlight, audio meters, editorial rays, compass tick calibration ring, telemetry beacon, device LED, book emboss rings. Each has a semantic-domain allowlist; arbitrary watch-hand-to-earbud behavior is not allowed.

The adapter does not download copyrighted external content. External-effect acquisition proceeds independently in feat/effect-provenance-harvest, where 42 creator-attributed Rive Marketplace listings are reference-only pending editable source access, asset permission and renderer verification.

## Eight actual transfer test scenes

| Output variant | Target | Copied source |
|---|---|---|
| fx-spectra | Camera | Spectral beam geometry/opacity from Prism |
| fx-atlas | Compass | Original planetary orbit arcs and animation |
| fx-meridian | Dashboard | Quantum electronic traces |
| fx-zenith | Kinetic type | Luma celebration sparkles (deliberately expressive) |
| fx-prism | Crystal | Botanical droplets, treated as optical highlights |
| fx-vesper | Earbuds | Camera specular glint |
| fx-bassline | Vinyl music scene | Existing animated VU meter components |
| fx-quantum | Processor | Existing dashboard event beacon |

Each produces two real official-runtime sequences from exactly the same host artboard: original and source-effect-enhanced. 31 PNG frames at 10fps each, two posters, and an after GIF. Differences in rendered PNG hashes confirm the effect was visibly applied in at least one sampled frame; this is **not** an aesthetics score.

## Repro commands

    npm ci && npm run build
    node test/effectCapsuleReuse.mjs
    RIVE_MCP_CHROME=/path/to/chromium node scripts/effect-capsule-reuse.mjs fx-spectra test/tmp/effect-capsules/fx-spectra --render

## Strict limitations

- Source extraction works only for the project-original 12 Studio Foundry sources, not Marketplace .riv assets.
- A pasted effect may be technically valid but **visually inappropriate**; observe before/after and reject ugly variants. Tests do not claim the source capsule guarantees beauty.
- No arbitrary nested artboard, shader, vector feather, data-input/script imports. Unsupported source dependency must remain unavailable, not approximated with made-up clip art.
- The parent Studio art directions still need radically different composition and higher-level artistry. FX is a *complement*, not replacement for originality or professional construction.
- No human blind rating or general image-based AI quality model has been run.

## CI

The effect-capsule-reuse workflow runs eight independent target variants as a parallel Actions matrix. Every variant compiles actual .riv, uses the official Canvas runtime to inspect and render before/after, and emits native edit-ready Rive binary plus comparison images/GIF. Missing visible changes or unsupported source geometry FAIL CI.
