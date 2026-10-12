# Worker C — Bilingual intent-to-recipe retrieval, negatives and measurable ranking

**Execute this assignment without requesting more background.** Read `docs/temporary-tasks/MOTION_ATLAS_README_20261012.md` on `coord/motion-atlas-parallel-20261012`; inspect `scripts/motion-recipe.mjs`, `data/motion-recipes/catalog.v1.json`, and `test/motionRecipe.mjs` on `feat/motion-recipe-atlas`.

**Branch:** `feat/motion-atlas-retrieval-20261012` from `feat/motion-recipe-atlas`. **PR base:** `feat/motion-recipe-atlas`.

## Mission

A prompt like `控えめで高級感のある成功演出。弾ませない` should choose a restrained recipe; `派手すぎない` must not misinterpret `派手` as a positive request. Same for English negation. Build a small, **evidence-based benchmark** and improve ranking without introducing a new heavy model dependency.

## Deliverables

1. `data/motion-recipes/query-benchmark.v1.json`: at least **50 distinct Japanese/English natural prompts**, covering purpose/style combinations, synonyms, ambiguity, negated styles, opposing adjectives, unrecognized requests, and multi-purpose intents. Each with acceptableTopIds / forbiddenTopIds and rationale. Avoid designing every prompt solely for a particular lexicon term.
2. `scripts/evaluate-motion-retrieval.mjs`: compute Top-1, Top-3, abstention accuracy and forbidden-result rates. Exit nonzero on clear regression thresholds. Keep ranker explanations auditable.
3. `test/motionRetrieval.mjs`: deterministic hard-negative tests and bilingual examples.
4. `docs/MOTION_RETRIEVAL_EVAL.md`: before/after scores with reproducible commands, known unresolved cases, and design choices. Prefer shipping honest benchmarks rather than tuning to trivial easy prompts.
5. **May edit** `scripts/motion-recipe.mjs` to improve negation handling, synonyms, phrase boundaries and score ranking. Do not touch catalog recipes (lead may independently expand them).

## Constraints

- Don't solve by returning a recipe for every unknown prompt; **abstention** is correct when no match.
- Interpret semantics: `控えめに祝う` is success + restrained style; `弾ませない` is explicit prohibition.
- Honor known recipe tags and roles; do not fabricate capabilities the compiler cannot implement.
- Do not introduce a paid embedding API or extra npm dependency as a prerequisite.
- Keep exported function signatures backward compatible, tests passing, and avoid modifying Worker A/B/lead-owned files.

## Acceptance

- >=50 benchmark cases, traceable scoring, and a **measured** improvement vs original feature branch or explicit evidence if no improvement.
- Existing `test/motionRecipe.mjs` passes, plus new tests.
- Open PR against `feat/motion-recipe-atlas`; no self-merge. Document every changed path.
