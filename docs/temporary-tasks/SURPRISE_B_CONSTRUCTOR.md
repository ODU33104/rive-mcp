# WORKER B — One-Prompt Constructive Scene Agent (parallel lane)
Repo ODU33104/rive-mcp; branch `feat/motion-constructor-next` from feature branch `feat/motion-recipe-atlas`. PR target `feat/motion-recipe-atlas`. Read V5 in review PR #59, GOLD builder, `scripts/scene-assembly-lab.mjs`, current `scripts/prompt-solstice.mjs`, `scripts/motion-recipe.mjs`.

## Mission
Demonstrate a *real* dynamic prompt→declarative plan→editable Rive result that works across at least **3 genuinely unrelated product/scene domains**, not a string switch between two watch files. Candidate domains: premium earbuds/case, instrumentation/orbital UI, typographic poster, command dashboard, reward/mascot. Generate geometry and coherent visual style from composable scene functions and constrained slots. Model/API integrations optional; do not embed paid secrets. Prefer deterministic replay and explained intermediate representation. Distinguish original static scene editing baseline from dynamic construction.

Own only `scripts/constructive-scene-*.mjs`, `test/constructiveScene*.mjs`, `samples/constructive-scene/*`, `docs/CONSTRUCTIVE_SCENE_AGENT.md`, `.github/workflows/constructive-scene-ci.yml`.
Do not alter catalog/search/compiler/writer, worker A scenes or gold.

Required:
- Prompt parser/planner accepts Japanese/English, subject, layout, visual language, motion energy, hard-negative constraints; explicitly reject unknowns; internal design plan is machine-readable, not tags alone.
- Genuine generated shape topology for each of 3+ domains and individual rig components/pivots. Provide original vector details, careful material/glow/shadow hierarchy, fully editable .riv + actual official-runtime PNG/GIF for at least 6 qualitatively different prompts.
- Typed slot binding validated from *actual scene's* local transforms, not implicit x/y=0. Never substitute watch hand for earbud stem.
- Same prompt gives reproducible output, distinct prompts vary actual scene geometry or motion, not only titles/colors. For every failing request, truthful abstention not invented success.
- Antagonistic fixtures (no bounce, don't spin object, only seconds/earbud case, long Japanese text) and explicit capability checks.
- CI artifacts, exact build commands, evidence, limitations. Ship code+working outputs, not only schema or discussion.

Do not overclaim universal authoring or aesthetic superiority without blinded evaluation. Open PR to `feat/motion-recipe-atlas`, never to main, don't auto-merge.