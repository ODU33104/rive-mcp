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
3. **`riv_create`** — express motion with `presets` (`pop-in`, `rise-in` + `stagger`, `float`, `breathing`, …) instead of hand-authored keyframes wherever a preset fits. Hand-keyframe only what presets can't express.
4. **`riv_critique`** — look at the sampled frames, score the 6-axis checklist, fix anything below 4 (riv_edit or regenerate), re-run. Iterate at least twice.

## Craft rules for hand-authored parts

- **Color**: no saturated primaries (`#FF0000`-style). Use `fill.gradient` on hero shapes far more often than flat `fill.color`.
- **Organic curves**: `shapes[].points[].cubic: { rotation, distance }` turns a vertex into a bezier handle. 4-point circle: points at 0/90/180/270°, `cubic.rotation` along the tangent, `distance ≈ radius * 0.5523`. Use for blobs and organic forms — never chains of straight segments.
- **Easing semantics**: a keyframe's `easing` describes the motion *arriving at* that keyframe — put it on the later keyframe (first-keyframe easing has no effect). Enters decelerate (`emphasized-decel` / `ease-out`), exits accelerate (`emphasized-accel` / `ease-in`), back-and-forth is `ease-in-out`, springy pop-ins are `elastic-out` (optional `amplitude`/`period`). Never leave transform tracks all-linear — `riv_lint` flags this as `motion-robotic`.
- **Physics bake**: prefer `bake: { type: "pendulum" | "wind" | "spring" | "gravity", ... }` for anything that sways, drops, or bounces.
- **Rigging**: chain `bones`/`RootBone` with `mesh.bones` skinning for anything that bends (limbs, tails, hair); add `constraints: [{ type: "ik" }]` for reaching/pointing motions instead of animating raw bone rotations by hand.
- **Known limitation**: `fill.feather` / `stroke.feather` writes correctly to the `.riv` but is **not rendered** by this server's Canvas2D preview pipeline — only Rive's GPU renderer shows it.
