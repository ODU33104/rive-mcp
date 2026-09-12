# Kiln-Inspired Improvement Record

Date: 2026-09-12

## Why this record exists

This document preserves the evidence trail for future release notes, launch posts, README claims, talks and other public communication. It separates:

1. what was observed in Kiln,
2. what idea was adapted into rive-mcp,
3. what was actually implemented,
4. what was measured,
5. what has **not** yet been proven.

Public claims should link back to reproducible repository evidence rather than rely on recollection.

## Reference studied

The design investigation used:

- Matthew Kissinger's `kiln` repository: https://github.com/matthew-kissinger/kiln
- Kiln Studio: https://kilnstudio.tools/

Kiln was treated as a design reference, not as code to copy. The useful ideas were architectural/workflow ideas around AI-assisted creative work: separating authoring intent from low-level operations, maintaining explicit state/history across iterative work, keeping human visual review in the loop, and making handoff between interactive editing and agent work explicit.

Do not publicly claim that Kiln implements rive-mcp's exact revision/review/finalize architecture unless separately verified. Those are rive-mcp adaptations developed from the broader investigation.

## Problems identified in rive-mcp before the change

The pre-change snapshot used for measurement is:

`d44adbbe224e38aacf2caad43c32dc482fc23bf8`

Observed architectural weaknesses:

- authoring/refinement/QA guidance was concentrated in one large skill/guidance surface;
- tool descriptions carried too much workflow knowledge;
- edits were primarily path/file oriented rather than immutable-revision oriented;
- a reviewed file could subsequently be edited without a cryptographic/revision-bound delivery gate;
- Studio-to-agent handoff did not establish an immutable AI work boundary;
- imported asset provenance/license information was not carried through the revision lifecycle;
- release verification did not include a full empty-workspace clean-room author → review → refine → finalize flow.

## Adaptations implemented

### Workflow separation

The former broad workflow was split into:

- `rive-author`
- `rive-refine`
- `rive-qa`
- `rive-setup`
- `rive-design-guidelines`

The goal is to load the procedure relevant to the current task instead of mixing new authoring, refinement, QA and craft knowledge.

### Immutable revision boundary

`riv_create` now produces an immutable `assetRef`. `riv_edit({assetRef})` creates a child revision rather than silently replacing the reviewed parent.

### Review-bound delivery

Lint and critique receipts are bound to the exact revision. `riv_finalize` rejects an edited child if only the parent was reviewed. Finalization re-validates and writes the reviewed revision bytes.

### Studio handoff

Studio remains free to use normal interactive undo/redo. When Studio instructions are consumed by the agent, the watched `.riv` is captured/reused as an immutable handoff revision. This avoids creating MCP revisions for every UI gesture while still creating a stable human → AI boundary.

### Provenance

SVG, Iconify, Lottie and imported/decompiled Rive sources can carry source/license/attribution information. Unknown licenses remain `unknown`; they are not guessed. Provenance follows revision edits and is returned at finalization.

### Release verification

A clean-room CI gate starts rive-mcp from an empty temporary workspace and exercises setup, authoring, review, finalization, refinement, stale-review rejection, re-review and exact-byte delivery.

## Measured results so far

The post-change snapshot used for the controlled comparison is:

`dec889c9df42009930da9c6cadd6bbfe525caea2`

Reproducible measurement source:

- `test/prePostCompare.mjs`
- `.github/workflows/pre-post-release-comparison.yml`
- `docs/benchmarks/pre-post-2026-09-12.md`

### Context / MCP surface

- Tool count: **32 → 33**
- Tool-description characters: **20,455 → 15,737 (-23.1%)**
- Largest single tool description: **5,520 → 1,373 (-75.1%)**
- Input-schema characters: **26,011 → 27,869 (+7.1%)**
- Combined description + schema characters: **46,466 → 43,606 (-6.2%)**

Important: the last number is a character-count proxy for fixed MCP surface, **not a measured model-token count**. Actual end-to-end token usage still needs a dedicated agent A/B run with usage telemetry.

### Output compatibility

On the controlled common SceneSpec:

- generated `.riv`: **536 bytes before and after**
- rendered PNG: **52,784 bytes before and after**
- generated `.riv` SHA-256: **identical**
- rendered PNG SHA-256: **identical**
- lint errors: **0 before and after**

This supports the claim that the architecture work preserved the common generation result. It does **not** prove that AI-directed creative quality improved.

### Runtime cost

Across repeated same-runner measurements, `riv_create` became consistently slower by roughly **5.5–16.2 ms** in the observed runs because revision hashing/metadata/object persistence is now performed.

Render/lint/critique timing varied between CI runs and does not currently support a strong performance claim.

### Safety / auditability

The post-change system passed probes that the old snapshot did not support:

- immutable revision identity;
- parent/child revision lineage;
- stale parent review rejection;
- exact reviewed-byte finalization;
- provenance preservation across edits;
- clean-room release flow.

### Maintenance cost

Before → after:

- 78 commits
- 31 files changed
- +1,969 / -175 lines
- compiled `dist/`: +2.4%
- npm test scripts: 4 → 13

This cost should not be hidden in public communication.

## Claims that are safe today

Examples of defensible claims, assuming the referenced benchmark remains green:

- “We reduced tool-description text by 23% while expanding the MCP from 32 to 33 tools.”
- “The largest individual tool description shrank by 75%.”
- “For our controlled comparison scene, the pre/post generated .riv and rendered PNG were byte-identical.”
- “Reviews are now bound to immutable revisions, and stale parent reviews cannot authorize an edited child.”
- “Imported asset provenance can survive editing through finalization.”
- “The release flow is exercised from an empty workspace in CI.”

## Claims that are NOT yet supported

Do not currently claim:

- “AI uses 23% fewer tokens.”
- “The new MCP makes 30% better animations.”
- “Generation quality improved by X%.”
- “Kiln uses the same revision/finalize architecture.”
- “The new version is faster overall.”

These require separate evidence.

## Next evidence gate: creative-quality + token A/B

The next experiment must answer the two remaining launch questions:

1. Does an AI agent using the new MCP produce better final Rive work from the same natural-language briefs?
2. Does the new workflow reduce actual model input/output/tool-context tokens over a complete authoring session?

The experiment should use a fixed benchmark set, fresh isolated sessions, the same model/configuration, the same starting brief and no cross-run memory. The evaluator should be blind to which version produced each artifact.

Record at minimum:

- total input tokens;
- total output tokens;
- cached/context tokens if exposed;
- number of tool calls;
- wall-clock completion time;
- number of create/edit/review cycles;
- final lint result;
- finalization success;
- human/blind quality score;
- task completion/failure;
- final `.riv` and preview artifacts.

Quality scoring should cover composition, visual polish, motion/easing, hierarchy/readability, coherence, technical correctness and brief adherence.

Until this A/B is complete, describe the current result as an improvement in **workflow discipline, context surface, review integrity and release auditability**, not as proven improvement in creative quality.
