# V3 semantic rig behavior grammar — D lane

**Scope:** `scripts/v3-rig-*.mjs`, `test/v3Rig*.mjs`, `data/v3-rigs/*`, this document and `.github/workflows/v3-rigs.yml`. Base PR into `feat/motion-recipe-atlas`, never main.

## What the implementation actually does

- Real editable Rive vector node assemblies for **15 rig types**: precision watch, earbuds case, studio camera, optical lens, audio equalizer, celestial atlas, botanical form, progress ring, abstract emote, kinetic wordmark, mechanical metronome, pendant lamp, steerable satellite dish, windmill and tethered kite. Each has actual shape geometry, not a role/tag placeholder.
- The first ten are **selectively adapted from the unmerged PR #65** (`scripts/visual-rig-library.mjs`, source blob `c2d681a04a181b2b106479203e7d6875d42c08ef`). The five additional mechanisms use original programmatic vector geometry. PR #63 timing causality is treated as a warning against importing inferred motion semantics, **not a proven source of geometry**. PRs #61–65 were not merged or mechanically copied into the feature branch.
- Each instance declares a pixel-space, screen-y-down local frame, namespace-stable serialized node IDs, root and pivot coordinates, parent closure, clipping-mask attachments, material identities, typed motion lanes, semantic domains and declared source rights.
- Six 960×560 native-artboard compositions have independent scene art directions: editorial, UI dashboard, technical star chart, spotlight stage, field notebook and radar room. This is an authored direction difference; aesthetic distinctness is **NOT_EVALUATED** until actual screenshots are reviewed.
- Native trigger-click state-machine interactions attach to physical components: progress dial, character face, swinging lamp, metronome, dish and windmill. At least three distinct rig types have interactive Rive state/animation bindings; CI compiles them and asserts metadata.
- Two intended semantically physical transfers: **optical lens** photography ↔ astronomy; **parabolic receiving dish** radio astronomy ↔ telecommunications. The kite also transfers education ↔ festival. Repeated cross-artboard reuse includes lens, dish, kite and celestial atlas, with type-stable node geometry.

## Build, tests and evidence

From this branch:

```bash
npm ci
npm run build
node test/v3RigGrammar.mjs
node node_modules/playwright-core/cli.js install --with-deps chromium
RIVE_MCP_CHROME=/path/to/chromium node scripts/v3-rig-build.mjs test/tmp/v3-rigs --render
```

The compiler creates six **editable** native `.riv` programs using the repository's `createRiv`, not a stitched PNG export. The official `RiveHost` loads each binary using the project's official bundled Rive player, inspects artboard, Reveal animation and RigShowcase state machine, and renders 31 genuine PNG frames per scene (186 total). Workflow `v3-rigs.yml` additionally derives six GIF files exclusively from those PNGs and uploads binaries, frame sequences, posters, summaries and the visual index. If runtime, browser or binary inspections fail, do not substitute synthetic frames.

Do not describe any rendered artifacts as **complete or available** until the workflow actually succeeds on the latest branch SHA. The source code commits alone are not real runtime evidence.

## Adversarial gates

`test/v3RigGrammar.mjs` checks every rig has actual vector paths and declared pivot node, binary deterministic recompile, serialized node identifiers and five authored-scene timestamp transform witnesses at frames 0, 36, 72, 108, 180. Tampering by 8 px with a pivot, erasing an authored baseline translation, writing an unsupported animated property, replacing a mask with another valid source, removing a parent, duplicating child IDs or corrupting work/embedded-media rights fails closed. Hand-to-earbud-stem transfers are prohibited, not implicitly reinterpreted.

**Important precision:** the timestamp witnesses sample the authored scene graph and verify finite, non-degenerate parent matrices. Binary string checks witness names persisted in the native binary; they do **not** prove Rive's *runtime internal world matrices* at five timestamps, Rive Editor roundtrip parity, or visual physics fidelity. These stronger claims are **NOT_EVALUATED** and should be blockers for strict acceptance, not promoted to PASS.

## Source and rights ledger

`data/v3-rigs/provenance.json` records the original-project-code assertion from PR #65, new authored geometry and repository Inter font. No media was downloaded from third-party pages and no inherited source attribution is silently discarded. Permission for third-party embedded assets must be granted explicitly: missing/unknown work-level or embedded rights fail validation. Independent legal chain-of-title is **NOT_EVALUATED**; the original-project assertion is not a new legal opinion.

## Whole-scene editing comparison

The output records counts of reusable source types, compiled shapes and composition instances and labels the counterfactual whole-scene visual editing comparison **NOT_EVALUATED**. This establishes structural reuse, not that composite beauty, editorial timing or authoring time are superior. A reliable A/B requires keeping rig instances fixed, independently editing each complete target scene, comparing node preservation and assembly time, and judging blinded playback from the official Rive runtime. That experiment has **not** been run.

## Open limitations and quality deficit report

| Area | Status | Defect / missing proof |
| --- | --- | --- |
| Static editable vector geometry / ID and attachment constraints | Implemented in source; CI pending | Some mechanisms are hand-drawn stylizations rather than physically accurate engineering models |
| True per-node runtime transform roundtrip over five timestamps | **NOT_EVALUATED** | Host inspection exposes high-level artboard/animation, not every runtime global node matrix |
| Perceived physical transfer quality | **NOT_EVALUATED** | Semantic admission exists; human judgment of believable movement pending |
| Native PNG/GIF evidence | **PENDING latest green CI** | Rendering only occurs in workflow or explicit `--render`; do not infer from code |
| Actual screenshot crop/overlap, contrast, masking, shadows | **NOT_EVALUATED** | Distinct art directions do not prove final crop placement or typography |
| Rive Editor editability parity and state machine click performance | **NOT_EVALUATED** | Native authoring and metadata compilation are not Rive Editor interaction testing |
| Independent source/embedded asset license audit | **NOT_EVALUATED** | Internal original-code assertion only; any new third-party imports remain blocked |
| Blinded human aesthetic evaluation | **NOT_EVALUATED** | No blinded panel, quality score or subjective superiority claims |
| Complete-scene editing A/B | **NOT_EVALUATED** | Only structural comparison counts available |

**Release decision:** Do not claim all hard acceptance passed until latest CI is green **and** runtime/visual/rights evidence above is reviewed. Compilation alone is insufficient.
