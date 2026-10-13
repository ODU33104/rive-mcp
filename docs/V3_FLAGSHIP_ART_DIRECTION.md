# V3 — flagship scene art direction and proof contract

**Status:** SOURCE IMPLEMENTED, runtime proof must be checked on the latest CI. Independent blind human aesthetic rating: **NOT_EVALUATED**. Do not showcase until actual runtime PNG/GIF contact sheets have been directly inspected.

Main native source: scripts/v3-flagship-scenes.mjs. Evidence runner: scripts/v3-flagship-render.mjs. Graph tests: test/v3FlagshipScenes.mjs. Three independent 960×600 vector-only animations, with source-editable geometry and tracks.

## Comparison against Studio #61

PR #61's 12 scenes prove Rive authoring/runtime machinery, but are largely 720×460 left-copy/right-object compositions sharing entry choreography. V3 is different in scene architecture, dramatic hierarchy and movement: (a) filling light-reactive glass, (b) colliding cut typography, (c) surveying spatial contours. No recycled right-hero framing, no common arrival grammar. This is an implementation distinction, **not a certified aesthetic improvement**. Actual runtime frames may still expose serious defects.

## 01 — MORROW / The Shape of Silence (sculptural product)

**Layout.** Central translucent perfume flacon centered around (477,310) on a continuous dark cyclorama with ground falloff. Oversized two-line editorial title originates at (79,52) and overlaps spatially. Airy edges and anchored corner technical labels preserve negative space. No top/side product card.

**Material/light.** Cold smoked-glass shell, shaded inner optical well, pale translucent moving liquid, warm fluted brushed-metal cap, soft pool, sharp rim path and moving specular caustic clipped by the actual vessel silhouette. These are original 2D vector approximations, **not** physically simulated refraction, lens ray tracing or PBR.

**Opening:** flacon silhouette lifts, rim begins to draw; cap is still hovering. **Midpoint:** cap seats while liquid rises behind native clipping geometry; title unfolds and caustic traverses. **Ending:** light leaves bottle, engraving resolves, lower labels and glass rims finish. The optical reveal is intentional, not decorative sparkle.

**Edit targets:** object, glass, vesselMask, outer-wall, inner-well, liquid-volume, meniscus, fluid, cap-shell, cap-flute-*, moving-caustic, glass-left-rim, right-glisten, brand-etch, heroWord.

**Major rejection criteria:** (1) wall, fluid, highlight and meniscus fail to separate perceptually, or light escapes the clipping boundary; (2) cap intersects or floats implausibly relative to the neck during the transition; (3) headline destroys object contrast, overlaps engraving, or gradient displays flat/banded cheap-metal appearance.

## 02 — INTERSTICE / Cut Through Space (kinetic typography)

**Layout.** Warm paper, extremely large black native type in three staggered lines: CUT ~ (84,92), THROUGH ~ (67,261), SPACE ~ (144,432); one angled red cut; marginal folio. Whitespace sits between word collisions and marks, not in a right-hand advertising column.

**Light/material.** Pure typographic/offset-print design, deliberately zero faux-3D shadow. Native letterforms, registration strokes, clipped red index aperture. The red element must *cut* the reading sequence, not embellish it.

**Opening:** staggered registration marks and separately editable C/U/T arrive. **Midpoint:** THROUGH moves counter to CUT; crimson diagonal crosses the whole poster. **Ending:** SPACE rises independently, long masked register band appears, baseline and issue metadata print last.

**Edit targets:** cut-C, cut-U, cut-T, THROUGH, SPACE, wordA, wordB, wordC, red-slash, aperture-mask, red-index-reveal, gutter-rule, registration-*, issue. Real native text glyphs and mask/trim path.

**Major rejection criteria:** (1) words become unreadable during the collision or cropped at artboard bounds; (2) diagonal scar has no semantic connection to cut/recomposition, overpowers hierarchy; (3) fallback glyphs, inconsistent font metrics or disappearing native text undercuts the typographic promise.

## 03 — TIDAL / Bathymetric Field Notes (non-product spatial piece)

**Layout.** Fully immersive deep-ocean map geometry centered near (455,281). Eight phase-different irregular bathymetric contours, surveyed transect, circular sonar, buoy stations, compass and fictional research annotation in quiet corner spaces. Not a commercial poster or product.

**Material/light.** Semi-translucent cartographic ink, gold station signal lights, faint graticule and cold contour traces. All geographic coordinates and numbers are **fictional creative data**, not genuine measurement. No external images/data/maps/assets.

**Opening:** faint grid and first outside contour emerge. **Midpoint:** progressive native stroke tracing sweeps inward, transect draws and sonar arc follows. **Ending:** targets settle around crosshair, readout resolves after the geometry establishes its bearings.

**Edit targets:** terrain, sonar, markers, contour-0..7, sonar-arc, transect, cross-x, cross-y, buoy-*, depth, coordinate, north.

**Major rejection criteria:** (1) contours appear as generic smooth scaled concentric ellipses or trivially identical timing; (2) depth readout fails legibility against terrain, critical lines compete rather than organize visual rhythm; (3) survey marker, sonar and crosshair read as unrelated pulsing gadgets instead of a spatially causal survey.

## Provenance and permission gates

All authored original graphics, deterministic geometric routines, track data and composition source reside in scripts/v3-flagship-scenes.mjs. No third-party downloaded media, brand assets, audio, paid Rive components or raster images are included. Source authorship does not imply ownership of third-party references. Never use a link as a license.

The font embedded by the writer is the repository-bundled assets/inter.ttf. Repository root LICENSE declares 'Inter font: SIL Open Font License 1.1'. Its declaration is evidence of repo policy; a separately retained upstream OFL copyright/notice file was **not verified**. Check and ship full applicable upstream notices when distributing embedded-font artifacts.

Native Rive authoring depends on the current repo's licensed writer and official Rive runtime. The workflow captures source hashes, font hash, frame hashes, native .riv hash and actual Rive inspector output. Geometry and embedded assets have distinct rights.

## Tests and evidence

    npm ci
    npm run build
    node test/v3FlagshipScenes.mjs
    node scripts/v3-flagship-scenes.mjs vessel test/tmp/v3-flagship/vessel.riv
    RIVE_MCP_CHROME=/absolute/path/to/playwright-chromium node scripts/v3-flagship-render.mjs vessel test/tmp/v3-flagship/vessel

The 3-way GitHub Actions matrix compiles and validates unique scene graphs/real .riv, then uses official Rive Canvas Advanced in Chromium to render 90 sequential PNG frames at 18fps each. Frame hashes must vary meaningfully. It builds the 8-state contact sheet plus GIF from **those actual official-runtime frames** and uploads all individual frames and native Rive. The full run must be green on the **latest commit** to claim automated evidence. Contact sheets must be evaluated at 0/12/24/36/48/60/72/89 frames, including mid-motion, not merely final posters.

**Not automatically verified:** aesthetic appeal, final contact-sheet composition quality, actual editor click-through editing, optical plausibility, mobile readability, externally blind-scored preference. Independent human aesthetic review is **NOT_EVALUATED** until real independent people rate rendered artifacts. Human visual inspection is **NOT_EVALUATED** until a named person directly sees all eight frames and GIFs; do not mark this PASS from CI alone.

**Defect log / release gate:** Source rights: font notice upstream verification pending. Cap and caustic clipping: official render to inspect. Letter overflow: official render to inspect. Contour legibility: official render to inspect. Rive Editor click-through: NOT_EVALUATED. No visuals are approved for public showcase until manual review finds no material defects; reject subpar attempts rather than badge green CI as beauty.
