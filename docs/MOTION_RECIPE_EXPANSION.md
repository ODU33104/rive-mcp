# Motion Recipe Atlas — 60-recipe expansion + official Rive GIF evidence

**Status:** Experimental generator building blocks, not a trained model or universal one-prompt motion agent.

## What's new

The catalog grows from **18 to 60 original structured choreography recipes** (42 new). Added deliberately different motion grammars, not 42 renamed copies:

- **Editorial and brand (20):** kinetic split headline, staggered captions, quote, numerical focus, cinematic product reveal, reflective glints, magazine covers, gallery transitions, feature spotlight.
- **Interactive UI (16):** dialog entrance/exit, dropdown, accordion, tab underline, search focus, tooltip, swipe card, dock snap, chips, scroll-like waterfalls, button ripple.
- **Feedback, loading, characters, atmosphere (6):** progress-complete, confetti, reward glint, checklist, character hop/blink, weather card and ambient lantern. Categories overlap; numbers in this breakdown do not serve as an exhaustive taxonomy.

Each new recipe contains semantic intent, mood, required scene roles, actual millisecond keyframe segments, named easing, loop mode, relevant source links and explicit limitations. The source links **are inspiration pointers only**: timings, paths and choreography are original design choices, not extracted copies.

## Important limitations

- The recipes do **not** automatically create their required artwork or choose the correct font/layout/rig. They require a role-binding scene plan.
- The accompanying 720x460 SOLSTICE watch showpiece is a separately authored original composition, not a newly inferred visual scene from all 60 recipes.
- This is deliberate breadth coverage to test retrieval/composition. **Quantity alone is not evidence of improvement**: keep the 106-question bilingual retrieval benchmark passing when extending this catalog, and run blind visual trials later.
- Browser-based Rive previews and GIFs are made by the existing official runtime. Do not synthesize a GIF from non-rendered thumbnails and call it a playback result.
- External references and embedded works have different licenses; no third-party video, source file, or artwork has been redistributed here.
- Not every loading effect loops seamlessly. For example, skeleton shimmer is a one-shot sweep whose snap-back must be handled by runtime controller to avoid visual reverse travel.

## Reproducible commands

```sh
npm ci
npm run build
node scripts/motion-recipe.mjs validate
node test/motionRecipe.mjs
node test/motionRetrieval.mjs
node test/motionStoryboard.mjs
node scripts/motion-recipe.mjs search "洗練された雑誌の表紙を見せたい"
```

For a contiguous high-frame-count (82 at 18 FPS) **actual official Rive render** of SOLSTICE:

```sh
node node_modules/playwright-core/cli.js install chromium
RIVE_MCP_CHROME=/absolute/path/to/pinned/playwright-chromium node scripts/render-motion-atlas-sequence.mjs test/tmp/motion-atlas-showcase
ffmpeg -framerate 18 -i test/tmp/motion-atlas-showcase/frame-%03d.png -filter_complex "[0:v]scale=640:-1:flags=lanczos,split[p][g];[p]palettegen[pal];[g][pal]paletteuse" -loop 0 test/tmp/motion-atlas-showcase/SOLSTICE.gif
```

GitHub Actions `.github/workflows/motion-atlas-showcase.yml` runs all tests, installs a matching Chromium, renders the official Rive frames, encodes the GIF and publishes `SOLSTICE.gif`, `SOLSTICE-poster.png`, `solstice.riv`, and `frame-info.json`. It **does not assert subjective quality**.

## Next quality leap

1. Commission/build **three additional striking editable scenes**, using distinct visual genres and actual rights-cleared art assets (type-led, rewarding microinteraction, richly illustrated character), rather than expanding into hundreds of similar micro-presets.
2. Add a **role-to-scene auto layout/asset binder**: prompt -> theme -> visually coherent scene -> role targets -> recipe(s) -> Rive binary; compare first-prompt video outputs in a blinded test.
3. Track real user prompt acceptance and aesthetic quality, not just valid keyframes or heuristic rank score.
4. Only ingest external downloadable originals after recording work-level license/attribution, file hashes and explicit use permissions.

This phase prioritizes executable, prompt-discoverable choreography and **real visual evidence** without pretending the general scene-generating capability is solved.
