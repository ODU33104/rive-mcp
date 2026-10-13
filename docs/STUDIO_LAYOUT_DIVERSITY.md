# Studio Layout Diversity — a real visual production iteration

**Not another effect catalog.** Existing Studio source shapes, independent animated parts, and text were re-laid-out into portrait editorial pages, wide cinematic headers, and square art posters. The authored geometry is retained as genuinely editable vectors; animation tracks for relocated parent groups are translated consistently.

Eight new Rive variants (in parallel with effect source discovery and effect capsules):

- 540×720 portrait: ARCHIVE book editorial, BOTANICA botanical cover, LUMA character vignette.
- 960×540 cinematic: SPECTRA camera optics, BASSLINE vinyl studio, QUANTUM electronics.
- 600×600 square: PRISM refraction study, ORBITAL astronomical illustration.

Works deliberately differ from the parent 720×460 left-copy/right-hero template. Hero, accent rig, atmosphere bloom, staggered typography, footer and trim/shape keyframes are reattached/reframed without faking screenshots. No new downloaded illustration is claimed.

## Design evidence and remaining defects

The transformation changes actual native Rive artboard dimensions, scale of typography and visual hierarchy and relocates hero and copy to new semantic spatial regions. Tests check unique nodes, parent transforms, deterministic binary, correct track targets, copy regions, and 3 output formats. Eight CI jobs use the official Rive Canvas runtime to render 37 frames and produce PNG poster, GIF and editable `.riv`.

These are **three genuine layout languages, not eight independent creative masterworks**. It does not solve real 3D product realism, rich film-grade materials, glyph shaping in Japanese, bespoke animation curves per new concept, high-end music/character direction, or independent human preference. Review all eight captured outputs; reject awkward cropping, bad empty space, headline/hero collisions. A name/viewport change alone is not a valid quality win. Human aesthetic quality stays NOT_EVALUATED.

## Run

    npm ci && npm run build
    node test/studioDirection.mjs
    RIVE_MCP_CHROME=/absolute/path/chromium node scripts/studio-direction-experiments.mjs portrait-archive test/tmp/studio-direction/portrait-archive --render

## Scope

The new layout builder is additive and isolated to scripts/studio-direction-experiments.mjs, test/studioDirection.mjs and its own GitHub Actions workflow, stacked on feat/motion-showcase-multigenre. All earlier original native-Rive source scenes, effects source adapters and independent evaluation lanes remain intact.
