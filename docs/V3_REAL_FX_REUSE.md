# V3 C — Real third-party FX source reuse

## Implementation / proof boundary

This implements Issue #75 on the isolated branch `parallel/third-party-effects-v3-20261014`, targeting `feat/motion-showcase-multigenre`. It is a source-code implementation, not an assertion of visual beauty. A green compile alone is not a native runtime or editor proof. Only the latest commit's passed CI and accessible original/native PNG/GIF artifacts can establish runtime success.

## Survey, dedup and legal provenance

`data/v3-sourcefx/source-registry.v1.json` records **125 unique individually linked works**. URL-duplicate works are removed and each record carries a technique-category field; sibling spinner icons are explicitly **not counted as unique effect mechanisms**. They are linked works, not 125 acquired/reusable assets.

- 42 Rive Marketplace/Community works from existing PR #66 catalog: references only. Work-level license label may exist but editor source, artwork, fonts, scripts and embedded rights are unknown.
- 46 original Utkarsh Verma SMIL spinner icons, MIT source repository. Only three original editable source files are imported.
- 12 Sam Herbert SVG loader animations, MIT source repository. Only three editable sources imported.
- 25 Line MD SVG/CSS looping icon references, reference-only until work-level and embedded rights are checked.

Three independent, attributed source families: **Bryl Lim / Kabi**, original CC BY 4.0 authoring model already imported by the parent Studio branch in PR #72, with traced figure/logo excluded; **Sam Herbert / SVG-Loaders**, MIT copyright 2014, immutable upstream commit `561eacac2f46e2b02e48df547324dcea94a6a1c5`; **Utkarsh Verma / svg-spinners**, MIT, immutable upstream commit `abfa05c49acf005b8b1e0ef8eb25a67a7057eb20`. The original six SVG sources and both MIT license files are committed under `data/v3-sourcefx/upstream/`, including Git-blob-hash checks. No external image/font/script is imported; the Studio host's bundled Inter font remains a separate project dependency.

The Kabi component is already present upstream and is **not** counted among six newly ported components. The six new imports use actual third-party editable SVG+SMIL code, a rights-cleared source-code equivalent—not foreign Rive editor .rev files or binary artboard extraction. User-visible author names, source URLs, license, change notice, source Git blobs, SHA-256 and source original keyframe values are recorded.

## Six new real-source component ports

| Source | Studio host | Source-authored technique |
| --- | --- | --- |
| Sam Herbert puff.svg | ORBITAL | Two independent expanding and fading stroked rings |
| Sam Herbert three-dots.svg | LUMA | Three coupled radius/opacity breathing dots |
| Sam Herbert ball-triangle.svg | PRISM | Three moving bodies along authored triangle waypoints |
| Utkarsh Verma 3-dots-bounce.svg | BASSLINE | Staggered, chained cubic-spline bouncing dots |
| Utkarsh Verma bars-fade.svg | MERIDIAN | Repeated triple-channel fading |
| Utkarsh Verma blocks-wave.svg | QUANTUM | Nine original rectangular resize/move waves |

The script `scripts/v3-sourcefx-port.mjs` converts source shape geometry, inherited SVG strokes/transforms and authored timing keys to isolated `v3_sourcefx__*` groups in the native Studio scene. Source keyframe values, temporal spacing, SVG keyTimes and cubic keySplines are preserved where the target format supports them. Coordinates, sizing and recoloring are explicitly adapted for the new scene, and the original source remains available. No giant synthetic replacement FX catalog is drawn.

## Compatibility, render and performance gates

The parser is deliberately restricted to SVG circles and rectangles with simple group translation, plus source SMIL animations of position, radius, size and opacity. It explicitly refuses unsupported SVG path geometry, SVG filters, feather, shaders, script particles, HTML animation and dependencies. No Canvas feather or GPU shader support is claimed. The correct alternative for unsupported effects is a separate capable renderer with real evidence, not a still PNG pretending to be native Rive.

The six-way GitHub Actions matrix compiles actual editable .riv host and baseline binaries, uses the official `@rive-app/canvas-advanced` runtime for 46 frames and visual difference checks at **five distinct timestamps**, with a minimum changed-pixel threshold for all five. The CI packs original animated SVG browser captures, official Rive PNG frames, official Rive GIF, original SVG GIF, output SHA and wall-clock performance receipts. Source SVG playback is explicitly **not called native Rive playback**.

Run:

    npm ci && npm run build
    node test/v3SourceFxCore.mjs
    RIVE_MCP_CHROME=/path/to/chromium node scripts/v3-sourcefx-port.mjs sam-puff test/tmp/v3-sourcefx/sam-puff --render

Outputs are GitHub Actions artifacts (not committed binaries). Inspect impact, overlap, typographic hierarchy, semantic correctness and animation continuity before recommending inclusion in any user-facing gallery.

## Known blockers and candid defect status

- **SOURCE_ACQUISITION_BLOCKED for native Marketplace-only scripted/feather/shader FX**: the linked pages do not supply reviewed editable .rev/RML authoring sources and asset/font/script sublicenses.
- No evidence of original Rive artboard binary import; six ports originate in native editable SVG/SMIL, not a source Rive project.
- SVG source negative pre-roll and long-loop timing can differ at t=0 due to clipping to the destination time origin; visually assess original-vs-destination continuity.
- Component pixels on dark Studio scenes can overlap original heroes and may be visually intrusive. A measurable pixel difference is not creative quality.
- `independentAesthetics: NOT_EVALUATED`; `editorClickThrough: NOT_EVALUATED`; `semanticReview: MANUAL_REVIEW_REQUIRED`. Production beauty or superiority is **not proved** until independent blinded reviewers actually score outputs.
- Native runtime status is **NOT VERIFIED** until latest-commit CI actually passes, at which point specific run URLs and artifact IDs should be cited in PR and issue.
- Shared Studio art direction changes belong to the upstream scene owner, not this source-FX lane.
