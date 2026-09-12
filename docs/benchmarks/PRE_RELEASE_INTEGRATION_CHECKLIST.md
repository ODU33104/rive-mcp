# Pre-Release Integration Checklist

Date: 2026-09-12

This checklist records work intentionally remaining after the architecture implementation and before a release from `main`.

## Current stacked PR chain

Merge/rebase order is dependency-sensitive:

1. PR #7 — `feat/immutable-revision-core` → `main`
2. PR #8 — `feat/review-finalize-gates` → PR #7 branch
3. PR #9 — `refactor/tool-registry` → PR #8 branch
4. PR #10 — `refactor/tool-description-budget` → PR #9 branch
5. PR #11 — `refactor/skill-workflows` → PR #10 branch
6. PR #12 — `feat/studio-revision-handoff` → PR #11 branch
7. PR #13 — `feat/provenance-tracking` → PR #12 branch
8. PR #14 — `test/clean-room-release-gate` → PR #13 branch
9. PR #15 — `docs/release-architecture` → PR #14 branch
10. PR #16 — `test/pre-post-release-comparison` → PR #15 branch
11. PR #17 — `test/creative-quality-ab` → PR #16 branch

At the time this checklist was written, PRs #7–#17 were open Draft PRs and GitHub reported them mergeable. Do not assume that status remains true later; re-check immediately before integration.

## Work that must happen after / during integration

- Re-check all required CI on the latest heads.
- Merge/rebase the stack in dependency order or squash it deliberately into an equivalent integration branch.
- Resolve stacked-PR base changes without dropping later commits.
- After the product architecture (#7–#15) reaches `main`, run the clean-room release gate from the actual `main` commit.
- Re-run the deterministic pre/post comparison if the merged `main` differs materially from `dec889c9df42009930da9c6cadd6bbfe525caea2`.
- Run the Claude Code creative-quality A/B before making public “better creative output” claims.
- Update `KILN_IMPROVEMENT_EVIDENCE.md` / release communication with the A/B outcome, including regressions.
- Only then tag/publish a release candidate.

## Deliberately not done in this ChatGPT session

- No Draft PR was merged to `main`.
- No release/tag/package publication was performed.
- No API-backed creative A/B was run because API use was explicitly rejected.
- No exact AI-token reduction claim was made.
- No claim of improved creative quality was made before the blind A/B.

These are not forgotten tasks; they are boundaries requiring integration authority or the external Claude Code quality run.
