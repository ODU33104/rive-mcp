# MOTION GOLD SCENE — SOLSTICE / Editorial Chronograph

## Scope and status

One original layered 720 × 460 Rive animation, authored by
**scripts/build-motion-atlas-gold.mjs** using the repository's
existing dist/rivWriter.js. The scene has one artboard, one native
linear animation (Reveal, 270 frames × 60 fps = **4.5 s**) and one
state machine (Showcase). Edit palette, copy and dimensions in
**samples/motion-atlas-gold/scene.json**; change illustration and
motion tracks in the build script.

This is a new original **scene source**, not a verified professional-quality
release. No independent human quality assessment has yet happened.

## Exact prompt

> Create a cinematic, editorial launch reveal for an original premium mechanical wristwatch called SOLSTICE. Use a deep midnight backdrop, warm champagne metal, exquisite restrained typography, watchmaking details, a gliding optical orbit and a deliberately staged 4.5-second entrance. Make it a single editable Rive scene, not a slideshow.

The exact string appears as the prompt field in scene.json. This
generator instantiates this specific art-directed scene; it does not
claim to generate arbitrary product illustrations from arbitrary prompts.

## Aesthetic decisions

- **Reading order:** SOLSTICE brand and series number; oversized
  TIME, / REDEFINED. two-line headline; description and specifications;
  mechanically detailed watch; quiet small-print footer. Text remains
  in the left column and watch is placed at right.
- **Palette:** deep ink #07121B / #050C14; petrol #152F3B; restrained
  teal #407A7C; champagne #DBB77B; pale gold #F8E5BD; porcelain
  #FAF4E7; secondary text #9BADA9. The dark background gives large
  text contrast and gold remains the limited focal accent.
- **Visual hierarchy and layers:** 1. gradient sky and horizontal
  architecture; 2. atmosphere bloom and optical orbit; 3. shadow
  interacting with the floor; 4. hand-illustrated physical watch and
  its intricate dial; 5. typography, glint and footer.
- **Original vector illustration:** upper/lower strap geometry and
  seams; graduated body and chamfer; knurled crown; 60 precisely
  spaced minute ticks; concentric dial and subdial; two lance hands,
  their facets, engraved dial marks and center pins.
- **Native technique:** gradients, parent-child mechanics, parallax
  movement, capped 2.8% scale overshoot, native stroke trimEnd and
  trimOffset for the optical line/glint, delayed hand motion and
  independently staged text. Not scattered independent pop-ins.
- **Typography:** bundled Inter, subset by the existing font pipeline.
  The writer does not expose arbitrary OpenType features or true
  letter-spacing: the brand's spacing is represented explicitly with
  characters, and further production typography review is necessary.

## Shot-by-shot timeline

| Time / frames at 60 fps | Intent | Action |
| --- | --- | --- |
| 0.00–0.55 s / 0–33 | Establish | Dark atmosphere, quiet receding rules and slight parallax |
| 0.33–1.75 s / 20–105 | Anticipate and arrive | Trimmed orbit wakes up; watch moves from lower right, −12° to small positive overshoot, scale 0.83 to 1.028 |
| 1.38–2.70 s / 83–162 | Reveal headline | TIME, and then REDEFINED. rise in succession while case settles |
| 1.77–3.23 s / 106–194 | Reveal craftsmanship | Dial indices emerge; hand rotations decelerate; engraved signature appears |
| 2.75–3.63 s / 165–218 | Support | Tiny gold rule grows and secondary caption/specifications/footer appear |
| 2.80–4.03 s / 168–242 | Light reaction | Bezel glint sweeps while outer orbit completes a trim-path lap |
| 4.03–4.50 s / 242–270 | Hold | Stable full composition, no unnecessary loop movement |

Motion deliberately overlaps across layers. The animation uses native
emphasized-decel, ease-out-back, ease-in-out and linear curves. The scene
is **one-shot**, not a seamless ambient loop.

## Reproduce binary and tests

On a checkout of this feature branch, using Node 20+:

    npm ci
    npm run build
    node scripts/build-motion-atlas-gold.mjs test/tmp/motion-atlas-gold/solstice.riv
    node test/motionAtlasGold.mjs

The generator requires no network: it reads only the local JSON,
assets/inter.ttf and existing compiled Rive writer. Initial npm ci may
need the npm registry, which is a **setup-time** network dependency, not
a generation-time one. Generated .riv files are intentionally not
vendored. Font subsetting is handled by the existing writer.

Changing copy/palette in scene.json changes the output. Keyframes and
mechanical geometry are authored in the builder, so changing
durationFrames alone does not retime the whole animation.

### Actual official-runtime frame strip / preview

When Chrome/Chromium and the locally bundled official Rive runtime
assets are present, use:

    RIVE_MCP_CHROME=/path/to/chrome node scripts/build-motion-atlas-gold.mjs test/tmp/motion-atlas-gold/solstice.riv --preview

Then open **test/tmp/motion-atlas-gold/frame-strip.html**. It displays
six **actual** runtime PNG captures, named shot-00.png, shot-07.png,
shot-15.png, shot-23.png, shot-33.png, shot-44.png at 0.0, 0.7,
1.5, 2.3, 3.3 and 4.4 seconds. All pixels come from
RiveHost.renderFrames running the official Rive runtime in Chromium;
they are **not** generated mockups or diagram substitutes.
The command validates PNG signatures and fails with a nonzero status
if official preview cannot be captured, even if the .riv was written.

**Observed environment limitation at authoring:** connected GitHub
file editing worked, but the execution container did not have a cloned
repository, compiled writer, or working DNS for github.com, and thus
could not compile a real .riv or capture the official Rive frames.
The preview images are consequently **not yet captured**, and runtime
render success **must not** be inferred. The test prints an explicit
runtime SKIPPED message only if Chromium is missing; unexpected errors
from the official runtime fail the test.

## Comparison to premium-product-intro

| Dimension | Atlas premium-product-intro demo | SOLSTICE |
| --- | --- | --- |
| Artboard | 480 × 320 | 720 × 460 |
| Subject | Minimal product plate, screen, orb, base and halo | Watch with illustration-specific strap, bezel, crown, 60 index markers, subdial, hands, engraved type |
| Typography | Single centered BUILT TO INSPIRE line | Two-line headline, brand, edition, dial inscriptions, specifications and footer |
| Depth | Flat product, halo and simple drop shadow | Distinct atmospheric planes, architecture, trailing floor shadow, physical watch, light orbit |
| Motion | Generalized catalog recipe compiled onto demo roles | Bespoke native property tracks staged by readable visual beats; independent mechanical response, orbit draw-on and bezel glint |
| Evidence | Small structural smoke demonstration | Editable original detailed source + deterministic byte test; quality and rendering still to be verified in official runtime |

This is a **feature and design-intent** comparison, not a measured
perceptual-quality win. More vectors and tracks alone cannot establish
a superior image; require side-by-side human review of runtime captures
before any production-quality claim.

## Licensing and provenance

| Asset | Provenance | Rights evidence |
| --- | --- | --- |
| Watch drawing, geometry, wordmark layout, gradients, keyframes and motion premise | Original task-authored source in scripts/build-motion-atlas-gold.mjs and samples/motion-atlas-gold/scene.json | No external visual assets, images, animation clips, recordings, models, stock elements or reference copying |
| Inter typeface | Existing repository assets/inter.ttf, not added to this PR | Repository root **LICENSE**, section 4: Inter font licensed under **SIL Open Font License 1.1** |
| Official runtime / type definitions | Existing dependencies and scripts/vendor.mjs | Repository root **LICENSE**, section 4: Rive runtime / definitions are **MIT**, copyright Rive Inc. |

The repository's own LICENSE permits distribution of generated .riv
files; separate restrictions on distribution/modification of the
software itself remain governed by that LICENSE. This PR adds
no third-party font binaries or external derivative art.

## Known limitations / validation still needed

1. **No actual runtime quality evidence yet:** run the test and
   --preview command in an environment with Chromium. The RIVE magic
   check and two identical compilation outputs are structural only.
   Official inspection plus PNG generation is the minimum rendering
   gate, not a subjective quality score.
2. **Fixed layout 720 × 460:** not adaptive to other canvas dimensions;
   small-screen typography and watch edges may be cramped.
3. **One-shot only:** no restart trigger, inputs, data binding, reduced
   motion variant or interactive dial described or promised.
4. **Renderer differences:** font baselines, gradient appearance,
   antialiasing and subtle thin strokes need comparison between
   official runtime and Editor before release.
5. **Review outstanding:** inspect all six genuine frames for unwanted
   cropped strap edges, correct text baselines, contrast, and visual
   continuity. Do not call it production-ready without external eyes.

## Worker isolation

Modified paths only:
- scripts/build-motion-atlas-gold.mjs
- samples/motion-atlas-gold/scene.json
- test/motionAtlasGold.mjs
- docs/MOTION_GOLD_SCENE.md

No changes to workers A/C, the lead storyboard planner or library core.
