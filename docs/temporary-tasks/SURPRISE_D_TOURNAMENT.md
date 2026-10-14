# WORKER D — Aesthetic Tournament, Independent Adversarial Verification (parallel lane)
Repo ODU33104/rive-mcp, branch `feat/motion-quality-tournament`, PR base `feat/motion-recipe-atlas`. Read V5/R3 from PR #59, source ledger and GOLD runtime evidence.

Goal: Stop calling "CI green" stunning. Create a reproducible **visual, semantic, motion and authoring/editability evidence suite** so competing generation routes and scene variants can be meaningfully ranked, without false automated claims of subjective beauty.

Own only `scripts/scene-tournament-*.mjs`, `test/sceneTournament*.mjs`, `data/motion-eval/*`, `docs/SCENE_TOURNAMENT.md`, `.github/workflows/scene-tournament-ci.yml`. Do not change catalog/recipe ranker, official writer, other workers' paths.

Implement:
1. Frozen **unseen-by-existing-code** 80+ prompt evaluation set split existing intents/new intents/hard negatives/OOS, with expected semantic constraints; keep separate from the old 106 development prompts; don't claim it is statistically independent if you author it yourself.
2. An audit manifest per attempt recording route, fallback, creative assets/fonts rights, budget, source hash, run version, .riv/PNG/GIF paths, actual properties/tracks, editable structure, time and failed restrictions. Missing means UNKNOWN/FAIL, not PASS.
3. Real adversarial tests: static transform world pivot mismatch +8px, forbidden minute hand rotation, no-bounce/only-X behavior, text overflow, clip/visible regions where supported. Explicit unsupported tests UNKNOWN with no promotion.
4. CI that ingests provided scenes and produces a contact sheet / side-by-side blind-ready review pack and scoring forms. Human aesthetic ratings are separate; no fabricated blind scores. Cross-scene A/B comparison uses same prompt/assets/budget; if missing, mark NOT_COMPARABLE.
5. Real Rive render in CI and at least one art-object tamper regression test. Interpret route comparisons fairly and note violations/failures in PR.

Deliver tested verification and evaluation code, not only PDFs. PR to `feat/motion-recipe-atlas`, don't merge.