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
3. **`riv_create`** — express motion with `presets` (`pop-in`, `rise-in` + `stagger`, `float`, `breathing`, …) instead of hand-authored keyframes wherever a preset fits. Hand-keyframe only what presets can't express.
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

## Craft rules for hand-authored parts

- **Color**: no saturated primaries (`#FF0000`-style). Use `fill.gradient` on hero shapes far more often than flat `fill.color`.
- **Organic curves**: `shapes[].points[].cubic: { rotation, distance }` turns a vertex into a bezier handle. 4-point circle: points at 0/90/180/270°, `cubic.rotation` along the tangent, `distance ≈ radius * 0.5523`. Use for blobs and organic forms — never chains of straight segments.
- **Easing semantics**: a keyframe's `easing` describes the motion *arriving at* that keyframe — put it on the later keyframe (first-keyframe easing has no effect). Enters decelerate (`emphasized-decel` / `ease-out`), exits accelerate (`emphasized-accel` / `ease-in`), back-and-forth is `ease-in-out`, springy pop-ins are `elastic-out` (optional `amplitude`/`period`). Never leave transform tracks all-linear — `riv_lint` flags this as `motion-robotic`.
- **Physics bake**: prefer `bake: { type: "pendulum" | "wind" | "spring" | "gravity", ... }` for anything that sways, drops, or bounces.
- **Rigging**: chain `bones`/`RootBone` with `mesh.bones` skinning for anything that bends (limbs, tails, hair); add `constraints: [{ type: "ik" }]` for reaching/pointing motions instead of animating raw bone rotations by hand.
- **Known limitation**: `fill.feather` / `stroke.feather` writes correctly to the `.riv` but is **not rendered** by this server's Canvas2D preview pipeline — only Rive's GPU renderer shows it.
