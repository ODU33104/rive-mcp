# Motion recipe retrieval — bilingual evaluation (2026-10-12)

## Scope

106 manually authored Japanese/English motion prompts have `acceptableTopIds`, `forbiddenTopIds`, and an individual rationale in `data/motion-recipes/query-benchmark.v1.json`. They cover purpose/style mixes, synonyms, negative styles and goals, ambiguity, multi-purpose requests, unknown requests, and incompatible capabilities. The final 20 examples form a deliberately difficult late-added stress slice. This is a **development benchmark, not a blinded holdout** or independent evaluation of scene aesthetics. The catalog stays at 18 recipes with the same compiler and existing roles.

## Reproducible commands

From a clone with Node >=20:

```sh
node test/motionRecipe.mjs
node test/motionRetrieval.mjs
node scripts/evaluate-motion-retrieval.mjs --explain
node scripts/evaluate-motion-retrieval.mjs --json

# Score the unchanged base-branch ranker against this branch's benchmark and catalog.
git show feat/motion-recipe-atlas:scripts/motion-recipe.mjs > /tmp/motion-recipe-before.mjs
node scripts/evaluate-motion-retrieval.mjs --module /tmp/motion-recipe-before.mjs --no-gate
```

The runner supports `--module`, `--catalog`, `--benchmark` for controlled comparisons. `--no-gate` still reports failures as numbers but does not exit nonzero for the original branch. `--explain` reports failed cases and ranked `why` score contributions, and `--json` emits machine-readable aggregate numbers.

## Measured before and after

Evaluated locally with Node 22 on the **exact retrieval-relevant metadata projection** of the feature branch's 18 recipes: IDs, goals, styles, energy, terms and durations. This projection is score-equivalent to the branch catalog; it does not validate compilation. The connector-only environment did not have a checkout to execute the original full-repository test suite locally. The test command outputs from the local metadata run were:

```text
Original: 106 prompts; Top-1 74/93 (79.6%), Top-3 85/93 (91.4%);
          abstain 5/13 (38.5%); forbidden Top-1 19/106 (17.9%);
          forbidden Top-3 43/106 (40.6%).
Updated:  106 prompts; Top-1 88/93 (94.6%), Top-3 90/93 (96.8%);
          abstain 11/13 (84.6%); forbidden Top-1 3/106 (2.8%);
          forbidden Top-3 19/106 (17.9%).
Local test/motionRetrieval.mjs (metadata shim): PASSED (106 prompts; top1 94.6%; gates 5)
```

| Metric | Original | Updated | Denominator |
| --- | ---: | ---: | --- |
| Top-1 correct | 79.6% | 94.6% | 93 answerable |
| Top-3 contains acceptable | 91.4% | 96.8% | 93 answerable |
| Correct abstention | 38.5% | 84.6% | 13 abstentions |
| Forbidden Top-1 | 17.9% | 2.8% | all 106 |
| Forbidden Top-3 | 40.6% | 17.9% | all 106 |

There are 57 Japanese cases (52 answerable; updated Top-1 49/52) and 49 English cases (41 answerable; updated Top-1 39/41). Every query has at least one specifically forbidden ID, so the conditional forbidden denominators equal the total denominators for this version. For Top-1 and Top-3, any ID listed in `acceptableTopIds` counts as correct. Other IDs are *not automatically forbidden*: this avoids pretending ambiguous multi-purpose goals have a single canonical solution.

The CI-suitable gate fails unless Top-1 >=85%, Top-3 >=90%, abstention accuracy >=75%, forbidden Top-1 <=7%, and forbidden Top-3 <=26%. These are regression alarms on one curated set, **not** quality guarantees. The evaluator rejects duplicate prompts, unknown recipe IDs, contradictory labels, and missing rationale.

## Why the ranker changed

- Retain word boundaries in English and transparent substring matching in Japanese, with NFKC normalization.
- Extract positive and **negated** features separately. English `not/no/without/avoid` and common Japanese `じゃない/ではなく/すぎない/弾ませない` are checked near the matched phrase. The same mechanism prevents negated recipe terms from becoming positive term evidence.
- Give positive goal +10, style +4, catalog term +2, forbidden goal -7, forbidden style -5, forbidden high energy -10; a low-energy recipe matching positive minimal style gets +3. Short/slow duration cues add +2. All scored terms are exposed in each candidate's `why`. A shared broad goal need not force absolute exclusion (e.g., progress bar is also tagged loading).
- Require at least one affirmative recipe goal or concrete recipe term. Pure moods or lists of prohibited adjectives should abstain. Obvious meta/instruction-only and sound-only requests also abstain. Synonyms and phrase aliases are transparent constants, not an embedding or paid service.
- Preserve `selectRecipes(catalog,prompt,options)`, result fields, `loadCatalog`, `compileRecipe`, and existing catalog data.

## Unresolved cases and caveats

- `No poppy confetti, show completion cleanly` incorrectly abstains. `通知が必要なのではなく、保存完了を控えめに伝えたい` can rank `reward-reveal` before `success-burst`; broader clause-level semantic negation remains weak.
- `An elegant page swap without the toggle control` abstains: “page swap” is not reliably interpreted as navigation. `カートに商品を追加した時、さりげなくボタンが反応` chooses generic feedback ahead of `press-release`. `背景は動かさず、タイトルだけ静かに登場させる` may rank `ambient-float` despite the prohibition.
- `3D skeletal character walking cycle with dynamic cloth` may incorrectly retrieve `character-wave`, and data-driven network/Lottie spinner changes may retrieve `loading-breathe`; **neither supports those mechanics**. Capability gating needs work.
- 19/106 queries still include a specifically forbidden candidate somewhere within Top-3. A downstream composer cannot blindly trust all suggestions and must independently respect constraints and bound roles.
- Labels were written by the implementer, vocabulary was iterated on the same benchmark, and the late challenge slice is not independent validation. A separately annotated and frozen holdout, real prompt traffic, extended catalog cases, and blinded visual outcome evaluation are required before making performance claims beyond this set.

Retrieval success is not proof that the emitted animation looks good or fulfills unavailable Rive capabilities. Third-party source entries remain reference-only.
