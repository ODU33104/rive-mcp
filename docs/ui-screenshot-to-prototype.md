# Screenshot → animated prototype

Two calls turn a UI screenshot into a working `.riv`:

```
riv_ui_detect     imagePath, overlayPath   → element tree + numbered overlay
riv_ui_prototype  imagePath, outPath, roles → .riv
```

`riv_ui_detect` returns geometry and nothing else — it finds rectangles, text runs
and pictures, and has no idea which of them is a button. Look at the overlay,
decide what each numbered element is, and send the ids back as roles.
`riv_ui_prototype` re-runs the same detection, so pass it the same `minArea` and
`maxElements`, or the ids will not line up; it says so in its warnings when they
do not.

Each element becomes either a vector rectangle or a slice of the original image.
Roles pick the entrance, and cards and buttons get hover and press states.

**A screenshot is the entrance for when the source is gone.** If you have the
design as an SVG, pass `svgPath` instead and skip every estimate on this page —
see [If you still have the vector source](#if-you-still-have-the-vector-source).

## What each field means

`renderMode` is how an element will be rebuilt — `vector-panel` for a flat
rectangle with a fill and a corner radius, `raster` for a crop of the screenshot.
`semanticHint` is what it looks like: `panel`, `text`, `image` or `line`. The two
are separate on purpose. Getting the rendering wrong changes what the prototype
looks like; getting the label wrong only changes which entrance it gets.

`matteEligible` says whether a text run could be cut away from its background with
real transparency. `matteConfidence` grades how well that worked.

`renderRisk` is measured, not inferred: the elements are composited in draw
order, and for each flat fill it is the share of the pixels where that fill is
what you would see that differ from the screenshot by more than one
quantisation step, ignoring a 2px rim. A label covered by its own text run
contributes nothing; an icon or a line that no element covers does. When the
risk exceeds 0.02 the offending pixels are clustered: if they form at most
eight small patches covering no more than a quarter of the fill, each patch is
cut out as a child element (`renderPatch: true`) with a matte against the
panel's own colour, and the panel stays a vector — an accent bar or a dashed
line lands on top of the rectangle it crosses. Otherwise, as for a photograph,
the whole element becomes a crop. The value stays on the element either way
so you can see why.

Clusters within 8px of each other are merged into one patch, but only when they
overlap on the other axis — a dashed line is one patch because its dashes share
their rows, while two icons offset diagonally stay two. Merging on distance
alone chained a toolbar into a single crop, which is the wrong unit to move.
Both tools report how many fills the check moved: `demoted` for the ones that
became crops, `patched` for the ones that kept their fill and got cut-outs on
top. `riv_ui_prototype` also says it in its warnings.

## Rectangles are estimates, not measurements

Detection runs on a downscaled copy — anything above 1280px on its long side is
reduced, analysed, and the results scaled back. Coordinates come back in the
original resolution but they are recovered, not measured. Expect a pixel or two.

Corner radii are read by probing three ways into each corner — along the
corner's row, along its column, and diagonally — and taking the median of the
twelve numbers. Along the row the arc starts at the radius itself, so the
quantisation grid costs a pixel; on the diagonal the same pixel is multiplied by
3.4, which is where the old estimate's 10–17% relative error came from. On a
clean rounded rectangle the radius now comes back exactly for every radius from
4 to 20; the single diagonal probe was a pixel out on six of those seven. Over
the synthetic scenes the mean error on matched panels is 0.5px where it was
0.9px, and over the tuning screenshots 0.3px where it was 0.5px. Small radii are
still the hard case — one pixel on a 6px corner is 17%.

## Known limitations

**Small changes to the image change the result a lot.** Colour is quantised into
5-bit buckets with no hysteresis, so 127 and 129 fall on opposite sides of a
boundary. Re-encoding a PNG losslessly changes nothing at all, but perturbing
every pixel by ±2 — less than a JPEG round trip, less than the gap between two
renderers — reclassifies about six vector panels in seven and can nearly triple
the element count. Measured across six real pages:

| change | classifications unchanged | element count |
|---|---|---|
| PNG re-encode | 100% | 1.00x |
| 1px pad / crop | 69% / 63% | 1.04x |
| JPEG q95 | 42% | up to 1.86x |
| 0.75x / 1.25x resize | 39% / 54% | 1.05x / 1.08x |
| RGB ±2 | 14% | up to 2.45x |

Feed it the original file rather than a screenshot of a screenshot, and expect a
different element tree if you re-export at another size.

Three ways of fixing that were built and measured, and none of them shipped. The
measurements are worth more than the attempts:

*Merging the fragments back together.* The instability really is a shattering
effect — the flat part of a panel that loses its classification still has a
colour range of 4 after the noise, and 85% of them stay under 8, so joining
neighbouring regions whose combined range stays narrow does put them back. It
works: agreement rises from 18% to 69%, and the element count stops nearly
tripling. It also vectorises things it should not. Any limit from 3 upward takes
the worst-region leak from 0.032 to 0.137, and a limit of 8 takes it to 0.266.
The merged range does not separate the two cases — real panels and gradients both
sit at the limit, because a panel's own anti-aliasing spans as much as a
gradient's step. And on a clean screenshot nothing is shattered, so the merge can
only cost; the benefit exists only for an input that has been perturbed.

*Painting each candidate and measuring what breaks.* Rather than guessing whether
a shape is a photo, render it flat and count the pixels where it is still visible
in the final image and no longer matches. Text on a button is covered by the text
element, contributes nothing, and the button becomes editable. This is the right
question to ask, and it does not work inside the detector: the detector cannot
see the final image. Every stand-in for it — draw order by area, the element
cap, the corner radius, the alpha of a matte — leaves a gap where a candidate
scores zero and the finished prototype is wrong anyway. Closing the element cap
alone moved tuning recall from 7 to 4 while adding p99 error on three held-back
pages that had none. It now runs after the tree is built, on the elements that
will actually be drawn, in their actual order — see `renderRisk` above — and
that version shipped. It is what took the reconstruction p99 to zero on every
page, and the harmful leak — vector fill over a picture region *where the fill
is wrong* — to 0.007 at worst. The older proxy (any vector fill over a picture
region, right or wrong) still reads 0.40 on one held-back page, because two flat
rounded rectangles inside an illustration are now painted flat with their
dashed line cut out on top; both numbers are reported. It costs some stability:
because the decision is made on pixels, a JPEG round trip or a resize changes it
more often than before (agreement 44% → 39% and 46% → 33%), while a lossless
re-encode still changes nothing.

*Deciding rectangularity from the outline or the holes.* How much of its bounding
box a shape fills, how much of the box's border it touches, and how big its
largest interior hole is are three summaries of the same binary mask. Requiring
three sides to be filled lifts panel recall from 7 of 20 to 19 of 20 and admits a
650,000-pixel photograph whose four borders are full. Adding a hole limit trims
that but sets a third threshold on twenty examples. The orderings overlap: the
lowest fill among real panels is 0.628 and there are photographs at 0.715.

**A panel with a label in it used to be classified as a picture.** Whether
something can be rebuilt as a vector rectangle is decided by how much of its
bounding box the shape fills, and text punches holes: a button with a caption
dropped under the threshold and came back as a crop. Holes are now allowed when
a text run that lies entirely inside the panel covers them — the run is drawn on
top, so painting the panel flat exposes nothing — and the panel is marked
`coveredByText`. That took labelled panels on the tuning pages from 7 of 20 to
15 of 20 and on the held-back pages from 4 of 8 to 5 of 8, without any panel
losing its label (the render check below found two whose contents nothing
covered — a "W3C" cell whose label was never detected, a row with an accent bar
no element owned — and cut those contents out on top rather than giving the
panel up): a panel that owes its vector status to its runs is kept only
together with them, and is dropped back to a crop when the element cap has no
room for both. Holes covered by runs that spill outside the panel are still
holes; such a run may be drawn underneath, and the label would vanish.

What had hidden this was a runaway in the text grouping. A run's tolerance is
proportional to its height, and its height was allowed to grow without limit, so
one tall fragment — the anti-aliased edge of a button is a 1x31 sliver, and in
left-to-right order it is the first fragment of the row — made a run that then
swallowed everything at that height. Real pages produced "text runs" of
1440x513 and 1222x393 covering 50–140% of the screen. Those were pasted back as
crops, so every fidelity number was flattered: error under them was invisible,
vector fills under them did not count as leaks, and the button labels inside
them were never independent elements. Runs are now capped at the height
allowed for one glyph, thin tall fragments are attached to a row only after it
exists, and the box grows outward only while ink stays contiguous. The numbers
below are the ones measured after that fix; they are worse than the ones it
replaced, and they are the real ones. The worst leak on the held-back pages,
0.46 of one 156x87 region, is two flat rounded rectangles inside an
illustration, vectorised in the old build as well and previously hidden under
such a run; the dashed line crossing them is lost.

**Touching areas of the same colour cannot be separated.** Two cards of identical
fill with no gap between them are one connected region, and there is no boundary
in the picture to find. The same is true of a panel whose colour is within one
quantisation bucket of what surrounds it.

**Text lines are coarse.** Runs are grouped by proximity, and a gap left by a
letter that the quantiser swallowed looks exactly like the space between two
words. It errs toward joining: a label and its value can end up as one run rather
than a word being split down the middle. The pixels are identical either way —
what differs is what moves independently.

**Text that cannot be cut out only fades.** A rectangular crop carries its
background, and the bottom layer of the prototype is the original screenshot, so
moving such a crop shows the same pixels in two places. Elements without a matte
therefore fade in place, lose their looping idle, and get no hover or press. The
warnings say how many were restricted. 80% of the text runs found on the sixteen
real pages get a matte; the rest stay legible and static.

**Some flat parts of photographs get matted anyway.** Of six picture regions that
qualified across twelve pages, four turned out to be text sitting on top of an
image — a caption and two glyphs — and two were genuinely photographic: flat
patches of open water, which really are two-tone. So roughly 5% of picture regions
fit the model as well as text does. Neither confidence nor shape separates them:
those two scored 0.93 and 0.96, above every real text line measured, and their
crops are 55x11 and 77x10, exactly the shape of a line of text. Being flat to
begin with, matting them reproduces them accurately where they sit.

What does separate them is where the ink sits, not how much of it there is. The
alpha map is thresholded at 0.5 and eroded by a quarter of the line height,
which is wider than any stem: a letter is a set of thin strokes and disappears,
a flat patch is a slab and survives. The share that survives has to stay under
0.2. Two runs with identical alpha histograms can differ here, which is what the
fit and the mid-alpha share cannot do. Measured: ordinary text 0.000, a synthetic
two-tone patch shaped like a line of text 0.35–0.40 — it fits the colour model
perfectly, at 1.00, and is refused anyway. It costs something: an ultra-bold slab
heading reads 0.26–0.30 and loses its matte, which is 2 runs in 853 across the
sixteen pages. That is the cheap direction to be wrong in — a run without a matte
is still drawn, it just fades instead of moving.

**Text rectangles are grown to reach the ink.** A line's box starts as the union
of surviving glyph fragments, and quantisation swallows round letters whole, so a
word can begin or end outside its own box — "Analytics" was detected from the "n"
onward and cropped to "nalvtics". The box is therefore extended outward, up to
1.6x the line height, for as long as pixels closer to the foreground than the
background keep appearing. That took text ink covered by an opaque fill from
16% down to 1%.

The height that sets that limit is measured after the box has been extended
vertically, not before. Where only the ascenders survive quantisation, a line
looks half as tall as it is, and 1.6x of the wrong number falls short of the last
letter: "Active" was cropped to "Activ" while "Errors", the same six characters
one card over, came through whole. Growing the box vertically first and taking
the limit from the result fixed it. Growing it by advancing the edge instead of
measuring from the original one does not — the box then runs past its own limit
into the next word, and overdraw rose from 1.8x to 10.8x when it did. The scan
also stops at the first row without ink, and sideways at a gap wider than about
a third of the line height: picking up any inked row within reach let a box jump
across a blank line into the row above it.

**Gradients become one picture, not thirty.** A band is detected as many flat
strips, and adjacent strips whose colour steps slowly are folded back into a
single raster. What stops this from swallowing a row of cards is the colour in the
gaps: a gradient's gap holds the shade that was dropped, a card's margin holds the
page behind it.

## If you still have the vector source, use it

Everything above is the price of working from pixels. When the design exists as
an SVG — Figma's right-click → Copy as SVG, or any Illustrator export — pass
`svgPath` instead of `imagePath` to the same two tools and none of that price is
paid: the rectangles, fills, corner radii and the parent/child tree are read out
of the file, not recovered from it.

```
riv_ui_detect     svgPath, overlayPath   → element tree + numbered overlay
riv_ui_prototype  svgPath, outPath, roles → .riv
```

The overlay is drawn on a rasterisation of the SVG, so it looks like the
screenshot version. What differs in the element tree:

- The tree is the SVG's own `<g>` nesting. Nothing is inferred from bounding
  boxes, so a group that wraps a single rectangle stays in the tree as a group.
- `renderMode` gains **`vector-shape`**: artwork that is not an axis-aligned
  rectangle keeps its real bezier vertices, gradients and strokes. It animates
  as a whole through a wrapper group, the same way `riv_import_svg` fragments
  do. `vector-panel` is used only where the shape really is a rectangle — a
  `<rect>`, or a closed path whose four straight edges are axis-aligned — and
  its numbers are the attribute values with the group transform applied, not an
  estimate.
- `renderMode` also gains **`vector-text`**: a `<text>` line that became a real
  Rive text object, re-typable at runtime. `raster` appears only for an embedded
  bitmap or for a line of text the font could not spell — see below.
- A rectangle whose fill is a gradient, or which carries its own `opacity`,
  comes through as `vector-shape` rather than `vector-panel`: an element's
  `fill` can only hold one colour, and a bezier copy keeps the gradient exact.
- A rotated rectangle is not reported as a rectangle. Corner radii under a
  non-uniform scale would be elliptical, so those stay beziers too.
- Figma layer names (`id`, `data-name`, `aria-label`) arrive as `roleHint` —
  "Primary Button" becomes `button`. A shape with no name of its own inherits
  the nearest named ancestor's hint, because Figma names the frame, not the
  rectangle inside it. Auto-generated names ("Frame 427320", "Vector") produce
  no hint. `riv_ui_prototype` uses the hint for any id you do not give a role.
- `renderRisk`, `demoted` and `patched` do not appear. They are the output of
  guessing, and there is nothing to guess.
- **No screenshot is embedded.** The screenshot path keeps the original image as
  the bottom layer so undetected pixels are not lost; here there are none, and
  keeping it would mean every element left a copy of itself behind when it moved.

- `<image>` whose data is embedded (`href="data:image/png;base64,…"`) becomes an
  image asset with those exact bytes; a relative `href` is read from next to the
  SVG. An `http(s)` one is **not fetched** — the URL goes into `warnings` and the
  element is left out. Nothing here reaches the network.

`maxElements` caps the number of drawables (default 300); the groups that
contain them are kept on top of that count.

### Text, and why it cannot be exact

The design's font file is not in the SVG. Something has to give, and what gives
is stated rather than hidden — every substitution and every demotion produces a
warning.

`riv_ui_prototype` and `riv_ui_detect` take `fonts: [{ family?, path }]`. A run's
`font-family` is matched against `family` (an entry without one is used for
every run); pass the same list to both tools so the element ids line up. Then,
in order:

1. **A font you passed** is used as-is.
2. **Otherwise the bundled Inter** (OFL) is substituted, and a warning names the
   family that was asked for. Letterforms and widths will not match the design.
3. **If the chosen font has no glyph for some character** — Japanese text against
   Inter, say — that run is *not* embedded. It is rendered on its own,
   transparent background and behind, and goes in as a picture. A warning lists
   the characters that were missing. Tofu is never baked into a `.riv`: the run
   looks right and only loses the ability to be re-typed at runtime.

The same demotion catches rotated and skewed runs, for the same reason — placing
them unrotated would quietly change the picture.

Placement is computed from the font's own tables, never by measuring on a
canvas, so the same SVG always produces the same `.riv`:

- `y` in SVG is the **baseline**; a Rive text box is positioned by its top. The
  top is `y − ascent × fontSize / unitsPerEm`, with `ascent` read from `hhea`.
- `text-anchor` is applied by shifting `x` by the sum of the `hmtx` advances,
  rather than by giving the box a width and letting Rive align inside it.
- Every `<tspan>` on its own line becomes its **own** text object. Rive's own
  wrapping is not used: with a substituted font the line breaks would land
  somewhere other than where the designer put them.
- `letter-spacing` has no equivalent in a Rive text run and is dropped, with a
  warning. `font-weight` is not synthesised — pass that weight's file in `fonts`.

Each run carries the layer's name, so the text can be swapped at runtime from
any Rive runtime.

### What is still approximate

`objectBoundingBox` gradients — the kind Figma writes — are defined on a unit
square and stretched onto the shape. A Rive gradient's bands are always
perpendicular to its direction, so on a shape that is not square, a **diagonal**
linear gradient or **any** radial one cannot be matched exactly; the importer
says so in `warnings`. Measured on a 240×160 rectangle: diagonal MAE 0.023,
radial 0.037, and axis-aligned **0.000000**. `gradientUnits="userSpaceOnUse"` is
exact in every direction.

### Measured

Six SVGs written for this repository (`test/fixtures/vectorSvg.mjs`) cover
rounded rectangles, linear and radial gradients, an icon path, a stroke-only
open path, a rotated rounded rectangle, a translucent ellipse, nested
`translate`/`scale` transforms, a rectangle written as a path, four levels of
grouping, `<text>` with all three `text-anchor` values and multi-line `<tspan>`,
Japanese text against a Latin font, and an embedded PNG.
`node test/vectorScene.mjs` builds the `.riv`, renders it, and compares it with
the browser's rasterisation of the same SVG; it writes
`test/fixtures/vector-baseline.json`, which `test/releaseGate.mjs` then checks
for regressions.

| | MAE | editable | text kept as text | ink IoU |
|---|---|---|---|---|
| dashboard 640×420 | 0.000022 | 8/8 | — | — |
| icons 240×120 | 0.00053 | 4/4 | — | — |
| hero 400×300 | 0.00036 | 6/6 | 1/1 | 0.95 |
| text-card 360×240 | 0.022 | 7/8 | 5/5 | 0.88 |
| cjk 300×120 | 0.0062 | 2/3 | 1/2 | 0.98 |
| nested 320×320 | 0.012 | 6/6 | — | — |
| mean, pixel-exact fixtures only | **0.00027** | | | |

Only the first two are expected to match pixel for pixel; the others carry a
substituted font or an `objectBoundingBox` gradient, and their MAE is a
regression tripwire rather than a score. For the ones with text, what is checked
instead is where the ink lands: the bounding box of the rendered glyphs against
the bounding box of the browser's, which agrees to an IoU of 0.88–1.00. The
baseline conversion is what that number is really testing, and it holds to
within a pixel.

The screenshot path's own reconstruction error over sixteen real pages averages
0.0004, so the vector path is under it — but the two numbers are not measuring
the same thing. The screenshot figure comes from a simulation that starts from
the original image, so anything undetected is exact by construction; this one is
an actual `.riv` rendered by Rive and compared against an independent
rasteriser. Inside a rectangle, away from its edges, the worst channel
difference is **0**: fills and corner radii are not merely close, they are the
attribute values. What remains is antialiasing along curves and diagonals, where
two rasterisers simply disagree.

Everything is editable except the two things that cannot be: the embedded
bitmap, and the Japanese heading that no bundled font can spell. The screenshot
path manages 15 of 20 known panels on its tuning set and 2.5% on a dark-mode
page.

### Straight from Figma, if you opt in

Everything above works on a file you already have. `figmaUrl` skips the export
step by asking Figma's REST API for the frame as SVG — and it is **off unless
`FIGMA_TOKEN` is set** in the environment that runs the server. Without the
variable the argument errors and no request is made; with it, this is the only
place in the whole server that touches the network.

```
FIGMA_TOKEN=figd_…   riv_ui_detect     figmaUrl, overlayPath   → element tree + overlay
                     riv_ui_prototype  figmaUrl, outPath, roles → .riv
```

Pass a link to **one frame** — in Figma, select it and use *Copy link to
selection*, which puts the `node-id` in the URL. Both the old `/file/<key>/` and
the current `/design/<key>/` forms are understood. The token needs no more than
read access to the file; it is sent as the `X-Figma-Token` header and never
appears in a URL, a log line, or an error message.

Two hosts are contacted, in this order: `api.figma.com`, which is the only URL
this server composes, and then the one Figma's own response names as the place it
rendered the SVG (an S3 bucket). Nothing else. The export asks for
`svg_outline_text=false` so text arrives as `<text>` rather than as paths —
otherwise the editable-text path above would have nothing to work with — and
`svg_include_id=true` so layer names survive as role hints.

The frame is fetched again for the second call, which is the one way this differs
from `svgPath`: a design edited between the two calls can shift the element ids,
and the prototype's warnings say so. If that matters, export once to a file and
use `svgPath`.

The offline default is unchanged. There is no fallback that quietly turns the
network on, and no other tool in this server reads `FIGMA_TOKEN`.

### Rive already opens SVGs — what this adds

Pasting Figma's "Copy as SVG" into the Rive editor has worked since 2023, and
for a designer sitting in the editor that is the better route. Two things are
different here:

1. **No editor, and no person.** `riv_ui_detect` → `riv_ui_prototype` is two
   tool calls with no GUI anywhere in the loop, so a build step or an agent can
   regenerate the `.riv` from the current design on every commit.
2. **Motion arrives with the roles.** The paste gives you static artwork. Here
   each element's role — read from the Figma layer name where there is one —
   selects an entrance, an ambient loop, and hover/press states, and the state
   machine comes out wired. Nothing is keyframed by hand.

## What the numbers are measured against

Nine screenshots tune the thresholds; seven more are held back and opened only at
the release gate. The held-back set was replaced in full once a page in it had
informed a decision — a picture that has set a threshold cannot also test one.

That replacement is worth reading before trusting any number here. With the
detector untouched, the fresh pages missed the absolute targets that the previous
set had met: worst-region leak 0.069 against a target of 0.02, and geometry
recall 0.875 against 0.9. Nothing about the detector changed; the earlier pass
was a property of those three pages. The targets are still printed, still unmet,
and the gate now checks that a change does not make the measurement worse rather
than pretending the bar is cleared. The recorded baseline was replaced once more
when the runaway text runs were fixed, since the numbers it held — leak 0 on the
tuning pages, 0.069 on the held-back ones — had been measured under crops that
covered most of the screen. The current record is leak 0.14 and 0.46 by the same
definition, on the same pages, with the reasons for each written into the file.
With the render check in place, and leak counted only where the fill is
actually wrong, the record is 0 and 0.007, under the target for the first time;
the invariance record was lowered at the same time, for the reason given above.

## Demo

![screenshot to prototype](media/ui-prototype-demo.gif)

A dashboard drawn for this repository, detected and turned into a prototype with
no hand-authored geometry: 26 elements, 14 of them rebuilt as vector rectangles,
the rest as image slices. Three elements had no usable matte and fade in place
rather than moving, which the tool reports.

## Checking it yourself

```
node test/uiDetect.mjs        # detection, the boundary gate, stripe merging, mattes, SVG parsing
node test/uiPrototype.mjs     # roles, motion restrictions, vector-shape assembly
node test/detectorMetrics.mjs # the measurement harness itself
node test/releaseGate.mjs     # real pages + transformation stability
node test/vectorScene.mjs     # the vector path, rendered and compared with the SVG
```

`test/vectorScene.mjs` writes `test/fixtures/vector-baseline.json` (or wherever
`--out` points); the release gate reads it back and fails on a regression.

`test/fixtures/gateSweep.mjs` and `test/fixtures/stripeSweep.mjs` re-derive the
thresholds. Every number in this file came out of one of these.

Real screenshots are not in this repository — redistributing other people's pixels
is not something a fixture needs to do. `test/fixtures/captureReal.mjs` rebuilds
them, and `RIVE_UI_FIXTURES` points the whole pipeline at your own directory.
