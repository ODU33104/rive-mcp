---
name: rive-design-guidelines
description: Use before building a non-trivial scene with rive-mcp's riv_create tool — covers color/gradients, organic bezier curves, easing semantics, physics bake, rigging, and a known feather/blur limitation. Prevents flat, "AI placeholder"-looking .riv output.
---

# Rive design guidelines

This skill packages the same guidance rive-mcp also exposes as an MCP prompt (`rive-design-guidelines`, via `server.registerPrompt`). If your client already surfaces MCP prompts, you don't need this file — read that instead. This copy exists for clients/agents that only support the Skills convention.

When building a scene with `riv_create`, aim for the quality of a modern SaaS product or game UI, not flat placeholder shapes.

## Color

Avoid saturated primaries (`#FF0000`-style). Prefer restrained, modern tones — muted pastels, deep darks, earthy accents. Use `fill.gradient` (linear/radial) on primary shapes far more often than a flat `fill.color`; a subtle angled gradient reads as "designed" instead of "placeholder".

## Organic curves

`shapes[].points[]` support an optional `cubic: { rotation, distance }` (degrees + handle length) to turn a straight-line vertex into a bezier-handled one (`CubicMirroredVertex`/`CubicAsymmetricVertex`). Classic 4-point circle approximation: place points at 0/90/180/270°, each with `cubic.rotation` matching that tangent direction and `distance ≈ radius * 0.5523`. Use this for blobs, rounded organic shapes, and speech-bubble-like forms instead of chains of straight segments.

## Easing semantics (important, easy to misuse)

A keyframe's `easing` describes the motion *arriving at that keyframe* — the transition from the previous keyframe to this one — not what happens after it. Never leave every track on implicit `linear`; that reads as robotic. Match the easing to the physical intent:

- `ease-out` / `ease-out-back` — something settling or overshooting into place
- `ease-in` — something building up speed (e.g. a drop)
- `ease-in-out` — a smooth back-and-forth
- `elastic-out` / `elastic-in` / `elastic-in-out` (with optional `amplitude` / `period` on that keyframe) — a springy, bouncy pop-in, genuinely more lively than `ease-out-back` for UI elements appearing

Setting `easing` on a track's *first* keyframe has no visible effect (there is no incoming segment to apply it to) — put the easing on the keyframe(s) that follow instead.

## Physics bake

Prefer `bake: { type: "pendulum" | "wind" | "spring" | "gravity", ... }` over hand-authored keyframes for anything that should sway, drop, or bounce — it carries proper per-segment easing automatically.

## Rigging

Chain `bones` / `RootBone` with `mesh.bones` skinning for anything that bends (limbs, tails, hair); add `constraints: [{ type: "ik" }]` for reaching/pointing motions instead of animating raw bone rotations by hand.

## Known limitation: feather/blur

`fill.feather` / `stroke.feather` writes correctly to the `.riv` file but is **not rendered** by rive-mcp's preview pipeline (a Canvas2D-based runtime) — only Rive's GPU renderer supports vector feathering. Don't rely on it for anything you need to see in `riv_render_frame`/`gif`/`apng`/Studio previews; the data is still correct for consumers that do render it (e.g. the Rive editor or a Rive Renderer-based player).
