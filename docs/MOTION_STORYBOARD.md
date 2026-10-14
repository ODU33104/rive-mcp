# Motion Storyboard: compose more than one recipe into a single Rive animation

**Purpose:** A single high-quality scene typically contains several temporally related motions (hero, environmental reaction, UI feedback). The first Motion Recipe Atlas implementation compiles *one* recipe. This module provides a deterministic, explicit, **multi-recipe composition contract**. It does not invent artwork.

## Input

A storyboard contains `cues` in author-specified order. Each cue binds a recipe's semantic roles to concrete artboard element IDs. Properties are numeric (positions are **offsets relative to base values**, scale uses multipliers, opacity is absolute) per the existing `compileRecipe()` convention.

```json
{
  "name": "SuccessThenResponse",
  "fps": 60,
  "cues": [
    {
      "recipeId": "success-burst",
      "atMs": 0,
      "bindings": {
        "hero": {"target": "checkmark"},
        "halo": {"target": "halo"},
        "caption": {"target": "success-copy", "base": {"y": 200}}
      }
    },
    {
      "recipeId": "error-nudge",
      "atMs": 900,
      "bindings": {
        "panel": {"target": "feedback-panel"},
        "hint": {"target": "feedback-hint"}
      }
    }
  ]
}
```

Save as `storyboard.json` and run:

```sh
npm ci && npm run build
node scripts/motion-storyboard.mjs compile storyboard.json > storyboard-animation.json
node test/motionStoryboard.mjs
```

The JSON output includes:

- `animation`: one existing Rive `AnimationSpec` with explicit one-lane-per-`target.property` keyframes;
- `timeline`: effective start/end frames, recipes and bound role IDs;
- `requiredTargets`: concrete artboard IDs that need to be present in the visual scene.

Add `animation` to the artboard's `animations` and render via existing `createRiv` / runtime. The test generates a real `RIVE` binary from a simple original vector scene.

## Composition rules

1. Cues on independent properties/targets may overlap in time (stagger, background response, title reveal).
2. Two cues writing the same target/property **may not overlap**. This is an intentional deterministic rule, not a limitation silently erased by a heuristic.
3. Adjacent cues on the same lane must have equal keyframe values at their boundary; no sudden jump is manufactured.
4. When same-lane cues are separated by a gap and the values are equal, the compiler inserts **hold easing** across the gap. Without this, the departing cubic easing could slowly tween toward the next segment before it should begin.
5. When gap values differ, the default is **error**. A cue may explicitly specify `bridgeMs` (plus `bridgeEasing`, default smooth) to interpolate into its first keyframe immediately before it starts, provided the bridge fits within the unused gap.
6. A cyclic motion cannot be treated as an independent loop inside a single non-looping Rive animation. This implementation only accepts a loop recipe when it is the sole cue. For a true concurrent ambient loop, use separate Rive animations / State Machine layers.

## Why this matters for one-prompt generation

A text-to-animation model can output a plan such as:

- Purpose: success; style: refined/playful;
- hero: success-burst at 0ms;
- caption: editorial-headline at 320ms, bound to a different text object;
- environment: ambient-float in a **separate** loop layer.

The composer rejects accidental double writers instead of producing a broken visual timeline. The result is buildable, not evidence of aesthetic quality.

## Remaining work

The major missing pieces are still **auto-layout, visual asset choice/creation, role binding, flexible easing/timing adjustments, compositing several Rive animation layers, and human visual review**. This module assumes those inputs are given. A larger library of references without these steps won't yield first-prompt professional work.

This file is owned by the lead development session (see the temporary parallel work orders on `coord/motion-atlas-parallel-20261012`). Source discovery, gold visual examples and retrieval quality have separate file owners to avoid edit conflicts.
