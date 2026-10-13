# WORKER E — Real Reusable Art Assemblies and Mechanisms (parallel lane)
Repo ODU33104/rive-mcp, branch `feat/motion-visual-rig` from `feat/motion-recipe-atlas`. Target PR `feat/motion-recipe-atlas`. Read GOLD scene builder, assembly-lab, V5 and original user's example of a watch decomposed into case/dial/hands/pivot/indices/glint.

Your mission is to move from **named components** to a library of **actually useful editable vector assemblies, legal original, with correct transforms and transferable material/style rules**.

Own only `scripts/visual-rig-*.mjs`, `test/visualRig*.mjs`, `data/visual-rigs/*`, `samples/visual-rigs/*`, `docs/VISUAL_RIG_LIBRARY.md`, `.github/workflows/visual-rig-ci.yml`. Don't edit GOLD, writer, shared catalog or worker A/B output.

Requirements:
- Implement >=10 visibly and structurally distinct reusable vector rigs, NOT just metadata: precision dial/watch, earbuds/case, studio camera, lens assembly, audio equalizer, celestial atlas, botanical form, digital progress ring, abstract creature/emote, kinetic wordmark. Different genres acceptable if thoughtfully executed.
- Decompose into geometry, attachment/local pivot, allowed motion, style tokens, shadow and glint constraints. For each rig expose binding contract with actual node geometry; fail invalid scale/unit/pivot bindings.
- Run 3+ genuinely different style/layout compositions with **two or more rigs** on a single artboard; verify parent transform, temporal orchestration, clipping and hierarchy.
- Produce native .riv and **actual official runtime** image/GIF evidence, plus a visual index; avoid fake poster descriptions.
- At least one rig successfully transferred to a second artboard/scene in a different semantic domain **without violating its physical meaning**, with explicit coverage.
- Asset permissions: original paths and cleared font. No third-party art downloaded simply because it's visible.
- Unit tests and CI are mandatory. More rigs welcome only if truly rendered and checked.

PR to feature branch, do not auto-merge. Explicitly distinguish rig validation from an independently scored stunning aesthetic result.