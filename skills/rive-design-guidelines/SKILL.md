---
name: rive-design-guidelines
description: Use before building a non-trivial scene with rive-mcp's riv_create tool — the tokens→presets→critique workflow plus color/bezier/easing/rigging craft rules. Prevents flat, "AI placeholder"-looking .riv output.
---

# Rive design guidelines

This skill packages the same guidance rive-mcp also exposes as an MCP prompt (`rive-design-guidelines`). If your client already surfaces MCP prompts, read that instead.

Aim for the quality of a modern SaaS product or game UI, not flat placeholder shapes.

## Mandatory workflow (non-trivial scenes)

1. **`riv_design_tokens`** (seed/mood/scheme) → use ONLY the returned palette/gradients/durations/easings/spacing. Never invent raw hex colors or ad-hoc durations.
2. **Ingest professional artwork — do NOT free-draw illustrative art.** Anything illustrative (characters, objects, icons, mascots) must come from a pro-made source:
   - `riv_asset_search` — ~200k Iconify icons by name (needs network to api.iconify.design)
   - `riv_import_svg` — any SVG file: Figma/Illustrator exports, or **professional SVG sets fetched via npm** when direct network is limited: `npm pack @twemoji/svg` (3,700+ color illustrations, CC-BY 4.0 — credit "Twemoji"), `@mdi/svg` (Material Design Icons, Apache-2.0), `@tabler/icons` (MIT). Extract the tarball and import the `.svg` files directly.
   - `riv_decompile` — remix professionally-made `.riv` files (e.g. Rive's official examples, CC-BY marketplace files): extract their hand-drawn bezier art AND their hand-tuned animation tracks into your scene (see `samples/night-delivery/`).
   Reserve hand-drawn primitives for backgrounds, roads, panels, particles — simple geometry only.

   **Respect the asset's viewpoint.** Before animating anything imported, LOOK at it and state its facing direction and perspective (side view / isometric / three-quarter / front). Then: (a) movers travel toward their own visual front — a vehicle/character/rocket must never slide sideways or backwards relative to how it's drawn; (b) the whole scene keeps ONE perspective — isometric artwork must not sit on a flat side-view road or horizon; (c) speed lines / ground scroll run along the same axis the artwork faces.
3. **`riv_create`** — express motion with `presets` (`pop-in`, `rise-in` + `stagger`, `float`, `breathing`, `stagger-in`, `pop-cascade`, `shimmer`, `attention`, …) instead of hand-authored keyframes wherever a preset fits. Hand-keyframe only what presets can't express. See "Preset catalog" below for the full list with parameters.
4. **`riv_critique`** — it returns a **filmstrip** (time flows left→right), an **onion skin** (motion trails), and a **motion report** (net displacement vector per object). Read all three: check every trail/vector against the artwork's facing (checklist axis 7), then score the 7-axis checklist and fix anything below 4 (riv_edit or regenerate), re-run. Iterate at least twice.

## Asset-source registry — pick by request type

| Request looks like… | Source → tool | License notes |
|---|---|---|
| UI icon / loader / micro-interaction | Iconify search (`riv_asset_search`) | mostly open (check per-set) |
| Emoji-style / friendly illustration | Twemoji, OpenMoji, Noto — via Iconify prefixes or `npm pack @twemoji/svg` → `riv_import_svg` | CC-BY 4.0 / OFL — credit the set |
| Scene / business illustration | unDraw, Openclipart (CC0), SVG Repo — download the SVG → `riv_import_svg` | check per item; Openclipart is CC0 |
| Finished professional ANIMATION (motion included) | LottieFiles free assets (.json) → `riv_lottie_import`; `.riv` files (Rive community CC-BY, official rive-app GitHub example repos) → `riv_decompile` | LottieFiles per-asset license; Rive community files CC-BY 4.0 |
| User's own design | Figma/Illustrator SVG export → `riv_import_svg` | user-owned |

No bulk API exists for the Rive Marketplace — the user downloads files manually; anything placed in the project converts via `riv_decompile`.

## Recipe: animated icons (loaders, button feedback, status)

For any "animate an icon" request, this is the default path — no drawing at all:

1. `riv_asset_search` with a keyword (`"search"`, `"bell"`, `"cart"`, …) → import the icon (or import an SVG from an npm icon set offline).
2. Apply presets by intent: loader → `spin`; success → `pop-in` or `tada`; error → `shake`; notification → `glow-pulse` or `heartbeat`; attention → `pulse`; draw-on reveal → stroke `trim` from 0→1 (`trimEnd` track).
3. Wire triggers as state-machine inputs (`hover`/`click` listeners) when it's for UI.

Icons are stroke-heavy: keep `stroke.cap: "round"`, scale motion amplitudes down (icons read at 16-48px), and prefer 200-400ms durations from the motion tokens.

## Why AI output reads as "kindergarten level" — and the fix

Three symptoms account for almost all of it, in order of impact:

1. **Nothing anticipates, nothing overshoots, nothing settles.** Real motion has three phases (anticipation → action → follow-through/settle); AI-authored motion usually has one (action only), so it reads as a sprite being teleported rather than something with mass.
2. **Everything moves in lockstep.** All elements start at frame 0, all reach their target at the same frame, all use the same easing. Real compositions are staggered by tens of milliseconds and layered (background/midground/foreground move at different speeds).
3. **Linear or single-speed motion.** No acceleration curve reads as robotic; humans (and physical objects) always ease.

The fastest fix: **use the presets below instead of hand-authoring keyframes.** Every preset already bakes in anticipation/overshoot/follow-through with numbers tuned to look intentional. Reach for hand-authored tracks only when no preset covers the case, and when you do, copy the timing ratios in this document rather than inventing new ones.

## 12 principles → concrete recipes (rivWriter JSON)

These are Disney's 12 principles of animation translated into exact `easing`/`amplitude`/`period`/keyframe placement for this server's `AnimationSpec.tracks[]`. All frame numbers below assume you convert seconds via `frame = seconds * fps` (fps defaults to 60) — the presets in `src/motionPresets.ts` already do this for you; read this section to understand *why* the presets are shaped the way they are, and to hand-author correctly when a preset doesn't fit.

### Anticipation
Before the main action, move 10-15% of the main motion's amplitude **in the opposite direction**, over roughly 15-20% of the total duration, then reverse into the main action. Example — a card that will rise by `dy` pixels over 0.45s should first dip down by `dy * 0.12` over the first ~0.08s:
```json
{ "target": "card", "property": "y", "keyframes": [
  { "frame": 0,  "value": "y+dy",          "easing": "hold" },
  { "frame": 5,  "value": "y+dy+dy*0.12",  "easing": "ease-out" },
  { "frame": 27, "value": "y",             "easing": "emphasized-decel" }
]}
```
This is exactly what the `stagger-in` and `pop-cascade` presets do (a squash/dip before the rise or pop) — prefer them over reinventing this by hand.

### Overshoot / slow-in-slow-out
Don't ease straight to the resting value — pass it by 5-15% and settle back. Two ways to express this in rivWriter:
- **`elastic-out` easing** with `amplitude` (0.8-1.2, how far past the target it swings) and `period` (0.3-0.5s, how fast it oscillates). This is a spring, not a single overshoot — good for pops, bounces, playful UI.
- **`ease-out-back`** (`[0.34, 1.56, 0.64, 1]`) — a single overshoot-then-settle in one bezier, no visible second bounce. Good for drops/arrivals that should feel snappy but not springy.
Never use plain `ease-out`/`smooth` for something that's supposed to feel alive; reserve those for UI chrome (panels, tooltips) where overshoot would look sloppy.

### Follow-through & secondary motion (per-element delay, not per-property delay)
When a parent moves, a child (hair, cape, antenna, held object, drop shadow) should lag 2-4 frames behind and take slightly longer to settle. In rivWriter this means: same shape of keyframes as the parent's track, but shifted later:
```
parent.y keyframes at frames [0, 27]
child.y  keyframes at frames [3, 33]   // +3 frame lag, +6 frame settle tail
```
For a single object with no separate child, fake secondary motion by animating a *second property* out of phase — this is what `float-idle` does: `y` peaks at 50% of the cycle, `rotation` peaks at 30%, `scaleY` peaks at 70%. Never let two tracks on the same object peak at the exact same frame; it reads as one rigid unit instead of something with give.

### Stagger (multiple elements entering/leaving together)
Offset each element's start by 40-80ms (`stagger` in `PresetSpec`, in frames: `fps * 0.04` to `fps * 0.08` ≈ 2-5 frames at 60fps). The built-in default is `fps * 0.05` (~50ms) — good for 3-6 items; drop to 30-40ms for 8+ items so the whole group doesn't take too long to resolve, and go up to 80-100ms for hero moments with only 2-3 elements where each one deserves attention. Pass `targets: [...]` + `stagger` to any entrance/exit/attention preset — it's not a separate preset, it's a parameter every preset already accepts.

### Squash & stretch (volume preservation)
When something compresses on one axis, expand the other so area/volume looks conserved: `scaleY: 0.82` pairs with `scaleX: 1.16` (not 1.0). See `pop-cascade`'s anticipation squash and `bounce-in`'s landing squash for the exact ratios already tuned in code.

### Arcs, not straight lines
Objects rarely move in perfectly straight lines — living things and thrown objects travel in arcs. When hand-authoring an `x`+`y` move, don't ease both axes identically to the same endpoint timing; offset the peak of the secondary axis mid-flight so the composite path bows (see `swoop-in`: `x` eases directly to target over 0.5s, `y` first swings *away* from the target at 28% through, then arrives with `ease-out-back`). Straight-line moves are acceptable only for mechanical/UI elements (sliders, panels) — never for characters or organic objects.

### Timing & spacing
Vary the spacing between keyframes rather than distributing them evenly — dense keyframes near a rest position (slow), sparse keyframes over the fast middle of a move. This is what named easings encode already (`emphasized-decel` clusters the motion near the end), so prefer them over manual keyframe spam.

## Timing tokens (don't invent new durations)

| Use case | Duration | Notes |
|---|---|---|
| UI micro-interaction (hover, toggle, tap feedback) | 100-150ms | `fps*0.1`-`fps*0.15`. Use `ease-out` or `smooth`. |
| Standard UI transition (panel, menu, tooltip) | 150-300ms | Matches Material M3 "short"/"medium" tokens. |
| Emphasis / attention (notification, success, error) | 400-600ms | Matches this codebase's `pop-in` (600ms), `attention` (460ms), `tada` (800ms — deliberately longer, it's comedic). |
| Scene entrance (hero element, modal) | 450-650ms | `rise-in`/`drop-in`/`stagger-in`/`swoop-in` all land in this band. |
| Ambient/idle loop | 2-6s | Faster reads as nervous/glitchy, slower reads as sluggish. `breathing` 3.6s, `float`/`float-idle` 3-4s, `shimmer` 2.2s, `parallax-drift` 6s (background should barely seem to move). |

**Cubic bezier reference** (all already registered as `EasingName`s in `rivWriter.ts` — use the name, not raw numbers, unless importing a Lottie/SVG curve verbatim):
- `smooth` `[0.4, 0, 0.2, 1]` — Material standard, safe default for anything without a strong character.
- `snap` `[0.7, 0, 0.1, 1]` — closest built-in analog to "ease-out-quint": very sharp deceleration, use for things that should feel instant-but-not-jarring (toggle switches, snapping to a grid).
- `emphasized-decel` `[0.05, 0.7, 0.1, 1]` / `emphasized-accel` `[0.3, 0, 0.8, 0.15]` — the M3 pair; put decel on entrances, accel on exits. Never swap them.
- `ease-out-back` `[0.34, 1.56, 0.64, 1]` / `ease-in-back` `[0.36, 0, 0.66, -0.56]` — single overshoot-then-settle / anticipation-dip-then-go.
- `elastic-out` (amplitude 0.8-1.2, period 0.3-0.5s) — springy, multi-oscillation. Higher amplitude or longer period = more bouncy/cartoonish; keep amplitude ≤1 and period ≤0.35 for anything meant to look "premium" rather than "playful".

## Composition & layering

- **Z-order (`z` field on shapes/images/texts/nested)**: default order is array order for shapes, then images (1000+), texts (2000+), nested (3000+). Set `z` explicitly whenever foreground elements must occlude background ones regardless of declaration order — don't rely on reordering the JSON.
- **Parallax depth ratio**: background moves slowest, midground faster, foreground fastest — roughly 1:2:4 in amplitude and inversely in speed. With `parallax-drift`, give the background layer a low `intensity` (0.4-0.6) and long `cycleSeconds` (7-9s), midground `intensity: 1` at `cycleSeconds: 5-6`, foreground `intensity: 1.5-2` at `cycleSeconds: 3-4`. Never move all layers at the same rate — that's what makes a "parallax" scene read as flat.
- **TrimPath line reveals**: set `stroke.trim: { start: 0, end: 0 }` (or an initial width) on a shape and key `trimEnd` 0→1 for a "drawing itself" reveal, or `trimOffset` continuously for a moving highlight sweep (see `shimmer`). `trim.mode: "sequential"` draws sub-paths one after another; `"synchronized"` draws them all at once — pick based on whether the shape reads as one continuous line or several parallel strokes.
- **Solo for state switching**: group children under a `solo: true` group and key `soloActive` (with `ref` pointing at the child id) instead of toggling opacity on multiple overlapping shapes — this is the correct way to do mouth shapes/visemes, icon state swaps (play↔pause), and pose switches. Toggling opacity on stacked shapes is a common AI mistake; it leaves invisible shapes still in the render tree and doesn't compose with editor tooling the way `Solo` does.
- **Clip for masking**: `clipBy` on a shape/group/image references another shape as a mask. Use for reveal wipes, progress bars, and "content inside a rounded frame" — pair with a `trimEnd`/`x`/`width` animation on the mask shape itself, not the content, when the reveal should look like a wipe rather than a shrink.
- **Pseudo-lighting via gradient**: flat fills read as cardboard cutouts. Use `fill.gradient` (linear, angled 90-135° off the light source direction) on hero shapes, and add a small, low-opacity ellipse or highlight shape with `blendMode: "screen"` or `"colorDodge"` near the implied light source to fake a specular highlight. `blendMode: "multiply"` for contact shadows underneath objects (never a flat dark ellipse at full opacity — keep shadow opacity ≤0.35 and blur the edges with rounded shapes, not hard rectangles).

## Preset catalog (src/motionPresets.ts) — pick by intent

| Intent | Preset | Notes |
|---|---|---|
| Simple fade | `fade-in` / `fade-out` | Cheapest entrance/exit; use for low-emphasis elements only. |
| Element rises into place | `rise-in` | Decelerated rise, no overshoot — for calm UI. |
| Falls from above | `drop-in` | Overshoot landing (`ease-out-back`). |
| Enters from a screen edge | `slide-in` / `slide-out` | Set `direction`. |
| Springy scale-up entrance | `pop-in` | Single elastic pop, no anticipation squash. |
| Bouncing landing (character/mascot) | `bounce-in` | Multi-bounce with squash&stretch. |
| **List/card group entrance** | `stagger-in` | Anticipation dip + overshoot + slight rotation flourish; designed to be called per-item with `targets`+`stagger` 40-80ms. |
| **Arc-path entrance** | `swoop-in` | Curved (non-linear) trajectory with banking rotation — use instead of `slide-in` whenever the mover should feel alive rather than mechanical. |
| **Chained pop entrance** | `pop-cascade` | Richer than `pop-in`: crouch anticipation → bigger elastic overshoot → secondary settle bounce. Pair with `targets`+`stagger`. |
| Exit fade/slide/pop | `fade-out` / `sink-out` / `slide-out` / `pop-out` | Exits should accelerate (`emphasized-accel`), never decelerate. |
| Generic emphasis pulse | `pulse` | Symmetric scale bump. |
| Heartbeat / double-thump | `heartbeat` | Two beats, second weaker. |
| Comedic wiggle+scale | `tada` | Slower (800ms), deliberately theatrical. |
| Error/negative shake | `shake` | X-axis only, decaying amplitude. |
| Denial/no rotation wobble | `wobble` | Rotation-axis version of `shake`. |
| **Notification/badge punch** | `attention` | Faster and punchier than `tada`, shorter than `shake`; crouch→elastic pop→settling rotation wiggle. Use for "new item appeared" micro-moments. |
| Idle scale breathing | `breathing` | Subtle, symmetric. |
| Idle vertical bob | `float` | Single-axis loop. |
| Idle rotation sway | `sway` | Single-axis loop. |
| Continuous rotation | `spin` | Loaders. |
| Opacity pulse (glow) | `glow-pulse` | Pair with `blendMode: "screen"` shapes for real glow. |
| Eyelid blink cycle | `blink` | Double-blink pattern baked in. |
| **Multi-layer background loop** | `parallax-drift` | Give each layer a different `intensity`/`cycleSeconds` (see Composition & layering above) — never call it identically on every layer. |
| **Richer idle loop (character/mascot)** | `float-idle` | `y`/`rotation`/`scaleY` all looping but phase-offset — reads as "alive" instead of a single mechanical bob. Prefer over stacking `float`+`sway`+`breathing` manually (their peaks would sync and look robotic; this preset deliberately staggers them). |
| **Moving highlight sweep** | `shimmer` | Requires the target shape to already have `stroke.trim` configured; animates `trimOffset` in a loop. Use for skeleton-loading states or "premium" light-sweep accents on badges/cards. |

`breathing`/`float`/`sway`/`spin`/`glow-pulse`/`blink`/`parallax-drift`/`float-idle`/`shimmer` are **ambient** — they span the whole animation and ignore `at`. Put them in their own looping animation (e.g. `"idle"`) rather than the entrance animation, and chain entrance → idle via the state machine (`exitTimeMs`).

## Anti-patterns (why AI output looks amateur — and the fix)

| Symptom | Why it looks wrong | Fix |
|---|---|---|
| Every element starts and ends motion on the same frame | Reads as one rigid unit, not a composition | Stagger by 40-80ms (`targets`+`stagger` on any preset) |
| All tracks use `linear` easing | No acceleration = robotic, weightless | Never leave a transform track `linear`; `riv_lint` flags this as `motion-robotic` — use a named easing that matches enter/exit semantics |
| Entrance has no anticipation, exit has no follow-through | Object appears "teleported" rather than moving under its own weight | Use `stagger-in`/`pop-cascade`/`bounce-in`, or hand-author a small opposite-direction dip before the main move |
| Bounce/elastic on everything, including UI chrome | Overshoot on menus/tooltips/panels reads as sloppy, not playful | Reserve `elastic-*`/`ease-out-back` for hero moments and characters; UI chrome gets `smooth`/`emphasized-decel` |
| Rotation pivots at the object's top-left (default anchor) instead of its natural pivot | A door swinging from its face, a limb bending from the wrong joint | Reposition the shape/group so `x,y` sits at the intended pivot before rotating, or parent it to a `bones`/group whose origin is the pivot |
| Straight-line moves for characters or thrown objects | Mechanical, lifeless | Use `swoop-in` or hand-author an arced path (offset the secondary axis's peak mid-flight) |
| Flat single-color fills on hero shapes | Reads as a cardboard cutout, no lighting | `fill.gradient` angled off an implied light source, plus a `blendMode: screen/colorDodge` highlight shape |
| Toggling opacity on stacked shapes to fake a state switch | Leaves invisible shapes in the tree; doesn't read cleanly in editors | Use a `solo: true` group + `soloActive` keying instead |
| Idle loop where every property peaks at the same moment | Reads as one gear turning, not something breathing | Offset peaks (`float-idle` does 30/50/70%) — never sync every ambient track |
| All background/midground/foreground layers drift at the same speed | Kills the parallax illusion, reads as a single flat plane | Vary `intensity`/`cycleSeconds` per depth layer (see `parallax-drift` guidance) |
| Overusing `tada`/`bounce-in` for every emphasis moment | Everything looks like a cartoon, nothing reads as "premium" | Reserve bouncy presets for playful contexts; use `pulse`/`attention`/`glow-pulse` for restrained emphasis |

## Craft rules for hand-authored parts

- **Color**: no saturated primaries (`#FF0000`-style). Use `fill.gradient` on hero shapes far more often than flat `fill.color`.
- **Organic curves**: `shapes[].points[].cubic: { rotation, distance }` turns a vertex into a bezier handle. 4-point circle: points at 0/90/180/270°, `cubic.rotation` along the tangent, `distance ≈ radius * 0.5523`. Use for blobs and organic forms — never chains of straight segments.
- **Easing semantics**: a keyframe's `easing` describes the motion *arriving at* that keyframe — put it on the later keyframe (first-keyframe easing has no effect). Enters decelerate (`emphasized-decel` / `ease-out`), exits accelerate (`emphasized-accel` / `ease-in`), back-and-forth is `ease-in-out`, springy pop-ins are `elastic-out` (optional `amplitude`/`period`). Never leave transform tracks all-linear — `riv_lint` flags this as `motion-robotic`.
- **Physics bake**: prefer `bake: { type: "pendulum" | "wind" | "spring" | "gravity", ... }` for anything that sways, drops, or bounces.
- **Rigging**: chain `bones`/`RootBone` with `mesh.bones` skinning for anything that bends (limbs, tails, hair); add `constraints: [{ type: "ik" }]` for reaching/pointing motions instead of animating raw bone rotations by hand.
- **Known limitation**: `fill.feather` / `stroke.feather` writes correctly to the `.riv` but is **not rendered** by this server's Canvas2D preview pipeline — only Rive's GPU renderer shows it.
