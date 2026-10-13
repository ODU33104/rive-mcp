# MOTION SURPRISE — Independent Parallel Engineering Handoff (2026-10-13)

## North star
The user has explicitly rejected ordinary "it compiles / 60 recipes / a gold watch demo" as success. The target is **exceptional, consistently surprising first-prompt editable Rive art**, with credible subject transfer, independent render evidence, meaningful parts/motion understanding and a rights-aware discovery library.

The present parent PR is [#53](https://github.com/ODU33104/rive-mcp/pull/53), branch `feat/motion-recipe-atlas`, intentionally not yet merged to main. The V5 review is [#59](https://github.com/ODU33104/rive-mcp/pull/59), and the watch assembly proof is [#60](https://github.com/ODU33104/rive-mcp/pull/60) already merged into the feature branch.

**This coordination document does not itself start background coding agents.** Distinct ChatGPT sessions have to open the instructions below; no worker has been silently launched by creating a branch.

## Workstreams
- **A (direct work in current session):** 12 distinct visual native-Rive scenes & 6-way parallel CI. [PR #61](https://github.com/ODU33104/rive-mcp/pull/61) / [A instructions](https://github.com/ODU33104/rive-mcp/blob/feat/motion-showcase-multigenre/docs/temporary-tasks/SURPRISE_A_SCENES.md). CI results must be inspected before any merge.
- **B: prompt → dynamically generated scene**, at least three unrelated domains. [B instructions](https://github.com/ODU33104/rive-mcp/blob/feat/motion-constructor-next/docs/temporary-tasks/SURPRISE_B_CONSTRUCTOR.md).
- **C: distill all current recipes and mass reference discovery**, rigorous causal ablations, permission gating. [C instructions](https://github.com/ODU33104/rive-mcp/blob/feat/motion-causal-distillation/docs/temporary-tasks/SURPRISE_C_MOTIFS.md).
- **D: aesthetic/semantic verification & quality tournaments**, honest blind-ready outputs; no invented panel scores. [D instructions](https://github.com/ODU33104/rive-mcp/blob/feat/motion-quality-tournament/docs/temporary-tasks/SURPRISE_D_TOURNAMENT.md).
- **E: physically reusable art assemblies/rig library**, 10+ vector rigs; cross-artboard tests. [E instructions](https://github.com/ODU33104/rive-mcp/blob/feat/motion-visual-rig/docs/temporary-tasks/SURPRISE_E_RIGS.md).

## Rules
1. Each worker should read its one linked instruction, own **only** specified paths, use its already-created feature branch and open a PR targeting `feat/motion-recipe-atlas`. No main merges and no worker auto-merges.
2. Direct visual evidence from **official Rive runtime**, not invented image generation or static mockups. Provide .riv, actual PNG/GIF and artifact run IDs.
3. Art direction must be reviewed for quality. A valid .riv is a baseline, not something that will amaze people.
4. Missing evidence or aesthetics must be reported as NOT_EVALUATED. Don't assign fake numerical beauty scores.
5. Unknown rights are link/reference only. No copying external artwork or assuming bundled media licensing.
6. Integrator reviews/test-reproduces each PR, resolves collisions, then merges into feature branch. Keep blind, unseen prompt evaluation distinct from code-crafted tests.

## How to hand off with minimal user effort
Open **four independent new ChatGPT sessions** for B, C, D and E. In each send *only the corresponding instructions URL* plus:
> Read this entire GitHub task order, implement on the named existing branch, open a PR to feat/motion-recipe-atlas and return its link. Do not request pasted background.

A is already actively authored in the lead session. Writing work orders is not execution; user initiation is required to create the other distinct ChatGPT sessions.
