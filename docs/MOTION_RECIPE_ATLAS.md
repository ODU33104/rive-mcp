# Motion Recipe Atlas v1 — Japanese/English prompt to choreography

This work deliberately prioritizes generation capability over another verification engine. Scope: original, composable choreography ideas selected from a short natural-language request, then transformed into the existing Rive writer animation specification.

## Status (2026-10-12)

- 18 **original generalized** choreography recipes with semantic goals, styles, energy, Japanese/English keywords, bound scene roles, timing offsets, easing and duration. These are not copied keyframes extracted from third-party scenes.
- 18 source **pointers** to community Rive works, component sites, CSS libraries, AI showcases and license references. Each external source is marked `reference-only`. No third-party animations, images, source code or user prompts have been imported.
- A dependency-free natural-language matcher and recipe compiler.
- Three original **small executable scene compositions** (success, editorial typography, product entrance) compile to real Rive binaries through the existing writer after a build. This is not a generic visual scene generator, and there is no claim of professional one-shot quality or exact recreation of referenced artworks.

## Correct intermediate representation: meaning -> choreography -> Rive

User prompt -> **purpose** (success, product, loading, onboarding, feedback, character...) -> **art direction** (premium, minimal, playful, cinematic, technical...) -> **timing** (duration, overlaps, stagger, return/settle) -> **roles** (hero, halo, caption, etc.) -> artboard element bindings -> tracks -> existing Rive writer.

This is why semantic categorization is necessary: not to create a huge thesaurus, but to keep the language model from guessing independent keyframes for every object.

The index should grow on independent axes:

| Axis | Examples | Why retrieval needs it |
| --- | --- | --- |
| communication | success / loading / explanation / reward / error | what the animation is meant to say |
| visual grammar | typographic / icon / illustration / UI / character | what assets and rigging are required |
| mood | premium / playful / restrained / cinematic | style filter |
| choreography | lead, response, stagger, overlap, hold, settle | how motions work together |
| dynamics | duration, easing, energy, loop, interruptibility | timing and physical constraints |
| implementation | Rive native, SVG, Lottie, web CSS, shaders | feasibility, not assumed compatibility |
| provenance | URL, creator, date, license, import permission, content hash | safe acquisition / proper attribution |
| maturity | reference-only / structurally described / compile-ready / visual-quality-assessed | avoid false quality claims |

### Retrieval architecture

1. A **rights gate** determines whether an item is only a reference, can be inspected locally, can be bundled, or must be excluded. Public URL alone does not permit dataset scraping.
2. A **semantic filter** maps a user's purpose/style to a small candidate set. The first implementation uses transparent Japanese/English rules; embeddings can be added if measured queries warrant them.
3. A **choreography ranker** uses required roles, duration, animation complexity, and platform compatibility. Version 1 ranks by purposes/styles/terms and shows matched reasons.
4. A **composer** maps roles to scene elements and creates tracks. Version 1 requires explicit role mappings and produces valid shape of AnimationSpec; it does **not** create layouts or visuals.
5. A **visual generation stage** must supply high-quality typography, art, masks, character rigging and scene design. This is currently the largest missing capability; adding more metadata cannot substitute for it.
6. Evaluate end-user results using identical prompts and available artwork with/without atlas suggestions, including first-output quality and manual corrections.

### Commands

```sh
node scripts/motion-recipe.mjs validate
node scripts/motion-recipe.mjs search "上品で洗練された商品紹介をゆっくり"
node scripts/motion-recipe.mjs search "かわいい読み込みアニメ"
node test/motionRecipe.mjs
```

To compile the success-burst recipe, write a file called bindings.json containing the following. Every mapped target must exist as an object ID in the artboard:

```json
{
  "hero": {"target": "checkmark", "base": {"scaleX": 1, "scaleY": 1, "opacity": 1}},
  "halo": {"target": "ring", "base": {"scaleX": 1, "scaleY": 1, "opacity": 1}},
  "caption": {"target": "message", "base": {"y": 200, "opacity": 1}}
}
```

```sh
node scripts/motion-recipe.mjs compile success-burst bindings.json > animation.json
```

Insert the produced AnimationSpec into the artboard animations array of an existing SceneSpec and compile with the current project writer. x/y/rotation values are offsets added to bound base properties, scaleX/Y values multiply bound base scales, and opacity uses absolute values. Easing is written to the departing keyframe, matching the local writer. The output does not create assets or state-machine transitions.

## Three runnable .riv demonstrations

After npm ci and npm run build, the following single Japanese requests select a supported prebuilt original visual composition, add catalog choreography, and emit a real Rive file:

```sh
node scripts/build-motion-atlas-demo.mjs "成功を祝う演出" test/tmp/motion-atlas/success.riv
node scripts/build-motion-atlas-demo.mjs "洗練されたタイトルの登場演出" test/tmp/motion-atlas/editorial.riv
node scripts/build-motion-atlas-demo.mjs "高級な商品紹介を上品に" test/tmp/motion-atlas/product.riv
node test/motionAtlasDemo.mjs
```

The CI workflow also uploads these three generated .riv files as a GitHub Actions artifact. The three demo visuals are **original lightweight illustrations**, not reproductions of works in the referenced galleries. This code is a proof that the new schema can drive the existing writer; it does not evaluate perceived quality.

## Curated initial source types

**Native Rive:** Interactive UI Motion Showcase (2026), Friendly Floating Bot (2026), Fully Interactive Learning App (2026), Interactive Particle Globe (2026), plus Rive loader and button examples. Marketplace pages label the listed entries CC BY; preserve actual creator credit when a specific reusable work is imported.

**Web motion:** official Motion examples and core library, React Bits, Animista, Lucide Animated, Animate UI, public CodePen works. These have different rights: e.g. core Motion MIT, React Bits MIT + Commons Clause, Animista generated CSS FreeBSD, public CodePen code MIT. Example-specific code, third-party illustrations and videos need separate checks.

**New AI showcases:** Claude Video describes a large community index and public prompts; an Opus 5.5 GitHub showcase also links out to experiments. These are **discovery** leads, not owned training data or verified source code. The websites' self-reported counts and model labels are not independent evidence.

**Restrictions:** LottieFiles explicitly prohibits compiling downloaded animations into a competing service; do not scrape its catalog. The original MOTION MOVEMENT REFERENCE site was not directly retrievable from the review environment, so the atlas does not invent labels or per-piece data from it.

## Scaling to thousands without losing quality

Use an append-only acquisition manifest with: source URL, creator, timestamp, license evidence URL, permitted operations, format, hash for obtained files, extraction method, and reviewer. Dedupe by semantic choreography AND exact content hash (where legally obtained), not title alone. Quarantine unknown-rights or machine-guessed entries. Keep inspiration references separate from derivative/source material.

Promote a card through maturity stages:
1. link discovered;
2. evidence and legal review;
3. choreography structurally decomposed;
4. executable scene-roles and constraints defined;
5. full art direction/assets provided;
6. human-blind-reviewed final scene with quality evaluation.

Do not bulk-promote internet examples directly to 'production-ready'.

## Next decisive milestone: three real finished scenes

A: polished premium **typographic/product entrance**. B: polished **reward/success choreography**. C: expressive **interactive character or interface**.

Produce original or appropriately licensed visual assets and pinned example provenance. Let one prompt retrieve a recipe, choose/instantiate a scene, bind roles and generate .riv using the official Rive CLI or existing writer. Judge output against a no-recipe baseline with the **same** assets and generation model. The atlas is valuable only if it improves what the user sees at first request.
