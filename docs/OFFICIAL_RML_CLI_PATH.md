# First-party Rive CLI/RML authoring lane

**Goal:** stop treating custom binary writer as the only route. Preserve it as an independent baseline, while introducing a direct official source-to-native-Rive compiler path. Grounded in [Rive official CLI getting started](https://github.com/rive-app/rive-docs/blob/main/cli/getting-started.mdx), [examples/CI](https://github.com/rive-app/rive-docs/blob/main/cli/examples.mdx), [RML schema](https://github.com/rive-app/rive-docs/blob/main/runtimes/advanced-topic/rml.mdx), and [AI agents](https://github.com/rive-app/rive-docs/blob/main/cli/agents.mdx).

## Honest scope

- Three **source-authored original minimal motion-styleframe concepts** (`halo`, `origin`, `signal`), each implemented as an independently inspectable RML scene with four authored vector shapes and rotation tracks and a default State Machine.
- An **actual Rive first-party CLI installer** in CI from `releases.rive.app`. Rive CLI can compile and screenshot without an account; unsigned/script-free output is acceptable for local runtime tests. A script-enabled Rive file destined for the web requires `--publish` and account signing. CI never logs into user accounts.
- For each concept, first-party compiler `--verify`, `--once`, `rive inspect --summary`, and **three headless PNG screenshots with `--advance`**. A custom inspector reads the genuine PNG pixel buffers and rejects motion absent in actual captured frames. `.riv` file magic, hashes, source and version are recorded.
- CI is a three-way matrix. The existing `src/rivWriter.ts` and `@rive-app/canvas-advanced` are **unchanged**. No source binary manual patching or fake raster screenshots.
- **These are plumbing/authoring proofs, not three stunning pieces of design.** Before high-quality art claims, use working `rive schema`, `rive docs` and the sample library to construct richer scenes, split references/geometry across files, add legitimate assets, and perform styleframe selection/animation direction.

## Validated API assumptions (official docs)

`rive create project` scaffolds a project, but here the source-controlled `scene.rml` is authored directly. YAML needs only `name:`, can set `main:` and `output.dir`. The RML wrapper is `<Rive version="1" kind="fragment">`. `Artboard` holds `Shape`/`Triangle`/`Fill`/`SolidColor`, a `LinearAnimation` with `KeyedObject`, and a `StateMachine` whose `AnimationState` plays the authored track. RML colors are ARGB without `#`. Rotation is radians. Captures use `--screenshot` and `--advance`; no advance is only the authored rest pose.

## Reproduce

```bash
npm ci && npm run build
node test/rmlDirectAuthoring.mjs test/tmp/official-rml
curl -fsSL https://releases.rive.app/cli/install.sh | sh
$HOME/.rive/bin/rive test/tmp/official-rml/halo --verify
$HOME/.rive/bin/rive test/tmp/official-rml/halo --once
$HOME/.rive/bin/rive inspect test/tmp/official-rml/halo --summary
mkdir -p test/tmp/official-rml-proof/halo
$HOME/.rive/bin/rive test/tmp/official-rml/halo --screenshot=test/tmp/official-rml-proof/halo/t0.png --viewport=900x540 --advance=0.4s
```

## Limitations and no automatic promotions

1. CLI is a 2026 technical preview; record actual installed version in every artifact. If installation unavailable, fail and state the environmental blocker.
2. Native authoring from RML is different from importing a compiled `.riv`. Official `rive create --from-rev=...` can import editor `.rev`, not arbitrary compiled `.riv`.
3. CLI local unsigned .riv with scripting may be rejected in web runtime until signed by `--publish`. Never bypass required credentials or imply free watermark-free exported editor files.
4. User's desired model must eventually produce excellent original art across real domains, and editing must be proven in the Rive Editor/exported `.rev`; compilation alone proves neither.
5. WebGPU/GPU Canvas is a separate concurrent line, with WebGL2 runtime opt-in. Old Canvas screenshot cannot certify shader effects. Compare via identical image and budget where possible.
6. These RML scenes use no external copyrighted art. Licenses for external HDRI/glTF assets must be reviewed at file and embedded-asset level.

**Success criteria for this PR:** all three official CLI source-to-native renders and source-to-visual evidence in Actions; no claims of premium design or subjective preference.
