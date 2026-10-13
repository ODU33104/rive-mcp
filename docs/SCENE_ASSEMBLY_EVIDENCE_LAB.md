# Scene Assembly Evidence Lab — SOLSTICE (V5 E1, partial E2)

**Status: experimental.** This tests one existing, editable Rive scene — not universal prompt-to-design or arbitrary Part Atlas synthesis.

## Genuine editable Rive candidates

- solstice-original.riv: existing SOLSTICE editorial watch scene, unchanged 30 animation tracks.
- solstice-seconds-only.riv: same layout at the original **completed end pose**. Adds a new secondsRig group attached to watch at local (0,45); reassigns the original smallSeconds line and smallSecondsPin ellipse and compensates their local coordinates so the original world-space geometry is preserved. Only the second-hand rig rotates in restrained 6-degree ticks. The watch, minute hand, hour hand, surrounding halo and text have no animated tracks.

These are intentionally **different motion tasks**, not a matched aesthetic A/B experiment. No change is claimed to make the watch inherently more beautiful. Both outputs are real Rive files, not bitmap fakeups.

## What actual decomposition/recomposition does

The new decomposeSolstice function partitions every source group, shape and text into semantic assemblies named environment, watch and copy, preserving node ordering indices and each original node object. It stores fonts and the original animation/state graph separately. recomposeSolstice assembles a fresh SceneSpec with index uniqueness, parent and animation-target checks.

The test checks structural equality and **byte-for-byte identical RIVE binaries** across original and decomposed/reassembled SceneSpec. It also compiles the variant into a genuinely different RIVE. A source-id or ordering mutation fails.

**Strict limit:** this is source-level in-memory segmentation, not a parser for arbitrary .riv files or an independently reconstructed RML source. It preserves original authoring geometry instead of inferring geometry from images. This experiment does not demonstrate cross-domain reuse.

## Typed seconds slot and failures

- Original watch parent position: (522,233). Subdial seconds pivot: local (0,45).
- Original line vertices: (0,66) and (10,34); old pin center (0,45).
- New secondsRig is a child of watch positioned at (0,45). New local stroke vertices: (0,21), (10,-11); new pin center (0,0).
- By construction the world-space pixels at the beginning match geometrically, and rotation is centered at the actual subdial pivot.
- checkSecondsPivot computes 2D nested parent transforms. An injected +8px pivot shift **must FAIL**.
- checkExclusiveSecondHandMotion rejects any unintended other property track (for example minuteHand.rotation) and responds **UNKNOWN** rather than PASS for multi-animation/multi-state cases.

The matrix witness is limited to static/group TRS and this known fixed parent. No assertion is made for IK, clip/mask, nested artboards, input-driven behavior, multiple layers or font coverage.

## Reproduction

    npm ci
    npm run build
    node test/sceneAssemblyLab.mjs
    node scripts/scene-assembly-lab.mjs test/tmp/scene-assembly-evidence
    RIVE_MCP_CHROME=/path/to/pinned/chromium node scripts/scene-assembly-lab.mjs test/tmp/scene-assembly-evidence --render

The CI workflow also renders 46 original-runtime PNG frames at 10fps per variant, makes animated GIFs, and uploads the two actual Rive binaries, sidecar, summary, PNG posters and GIFs as the scene-assembly-evidence artifact. Runtime inspection and captures are required to pass the workflow.

## What the experiment establishes, and what remains

A CI pass establishes that **one authored scene** can be segmented/reassembled without source-binary change, and that **one semantically valid typed part change** preserves pivot geometry and obeys an explicit motion prohibition. It is evidence for exploring restricted typed slots, not evidence of aesthetic superiority or universal scene generation.

Not yet delivered: direct official RML generated candidate, same-prompt/same-assets/same-budget scene-edit vs RML vs typed-slot blind comparison, independent 80-question holdout, real scene conversion into earbud or unrelated product, actual runtime world-matrix witness for arbitrary animations, and permission-cleared mass external asset reuse.

Aesthetic quality must be evaluated by humans on genuine rendered outputs, distinct from runtime and source checks. Failure rates, costs and non-applicable routes must count in any future comparison.
