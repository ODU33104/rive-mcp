# Visual Rig Library — Original Editable Assemblies

## Scope and evidence

This worker owns only scripts/visual-rig-*.mjs, test/visualRig*.mjs,
data/visual-rigs/, samples/visual-rigs/, this file, and
.github/workflows/visual-rig-ci.yml. It does not edit GOLD, writer, or other workers.

**A rig validation pass is not an independently scored aesthetic success.**
Native binary compilation and official Rive runtime captures are separate
verification gates. Neither substitutes for visual review by human judges.

## Ten original mechanisms

| Rig | Actual editable geometry | Pivot and allowed intent |
| --- | --- | --- |
| precision-watch | straps, chamfer, dial, 24 indices, two hands, crown, glint | minute hand rotation |
| earbuds-case | enclosure, cavity mask/shine, buds/stems, lid, charge LED | lid turn |
| studio-camera | body, grip, prism, finder, lens, nine dial grips, LED | dial turn |
| optical-lens | three concentric surfaces, 36 grip grooves, 8 aperture blades | focus rotation |
| audio-equalizer | panel mask, nine distinct bars, spectral traces | pulse opacity |
| celestial-atlas | three orbits, planets, central sun, stars, satellite | satellite rotation |
| botanical-form | central stem, six leaf/branch/vein triples, seed, vase | stem sway |
| progress-ring | 72% trimmed ring, bezel, editable percentage text | trace rotation |
| abstract-emote | two ears, head, cheeks, eyes, mouth, highlight | eye blink |
| kinetic-wordmark | four speed stripes, editable typography, underline | mark rotation |

Original vector paths only. Text uses the existing bundled Inter font
(assets/inter.ttf, licensed under SIL Open Font License 1.1 per root LICENSE).
No third-party art or new font is imported.

## Binding contract

Call instantiateRig(id, {namespace,unit:"px",x,y,scale,rotation,pivot,domain,style,parent}).
Reject unsupported units, wrong pivots, nonfinite placement, scale outside
[0.32,2.5], incorrect semantic domain and invalid namespace. There is
**no implicit unit conversion or mirrored negative scale**.

Each manifest includes node IDs linked to actual editable geometry, parent root,
local pivot coordinates/parent, allowed track targets, shadow opacity max 0.35,
and trimmed-glint upper bound 0.12. validateRigScene checks these along with
unique node identity, clipBy source, parent closure, scene scale and animation
time ordering. The world-matrix witness checks authored parent transform TRS,
not per-frame runtime positions or arbitrary IK systems.

## Three compositions, 11 instances

Source: samples/visual-rigs/compositions.json, each 960 x 560,
180 animation frames at 60fps.

1. ATELIER / nocturne: studio camera, precision watch and optical lens.
2. SIGNAL / porcelain: earbuds, equalizer, progress ring, kinetic wordmark.
3. OBSERVATORY / aurora: celestial atlas, optical lens, botanical form, emote.

All ten distinct rig types appear. The optical lens transfers from a
photography scene to an astronomy scene while retaining its physical meaning
as a *focusing optical element*. Both its domain and compositional styling
change, but its mechanism remains an optical focusing assembly. Parent
transforms, clipped vector sources, staged entrances and local motions are
encoded as editable scene nodes with witness tests.

## Reproduction and outputs

From a checkout of feat/motion-visual-rig:

    npm ci
    npm run build
    node test/visualRigLibrary.mjs
    node scripts/visual-rig-build.mjs test/tmp/visual-rigs
    node node_modules/playwright-core/cli.js install --with-deps chromium
    RIVE_MCP_CHROME=/path/to/chromium node scripts/visual-rig-build.mjs test/tmp/visual-rigs --render

Without --render, generated .riv files are *not* evidence that the official
runtime rendered successfully. summary.json explicitly says NOT_RUN.

With --render, the build script invokes the repository RiveHost/PAGE_SCRIPT
and requires official runtime inspection and 31 genuine PNG frames per
composition (93 total). It writes PNG posters, an HTML visual index,
three native .riv files and a report. The visual-rig-ci.yml workflow
encodes three GIFs **only from these real runtime PNG frames**, validates
file sizes, and uploads binaries, PNG/GIF and index.html as an artifact.
Failure to run Chromium or to render is a hard error, not a synthetic fallback.

## Limits

Neither structural tests nor PNG signatures mean the work is stunning.
No independent, blind human aesthetic panel, Rive Editor parity audit, or
production typography review has been performed. The 72% progress label
is authored content, not bound to live business data; some mechanisms
are visually representative rather than physically simulated. A separate
perceptual review of the actual captures is required before release.
