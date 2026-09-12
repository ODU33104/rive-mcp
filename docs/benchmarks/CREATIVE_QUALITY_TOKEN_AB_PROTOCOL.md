# Creative Quality and Token A/B Protocol

Status: planned / evidence gate before public creative-quality claims.

## Objective

Compare the pre-change rive-mcp snapshot and the completed implementation using the same AI model and the same natural-language authoring tasks.

This is deliberately different from the deterministic SceneSpec benchmark. The deterministic benchmark proves compatibility and architecture costs. This benchmark tests whether the **agent actually makes better work** and whether it uses fewer **real model tokens**.

## Fixed versions

- A / baseline: `d44adbbe224e38aacf2caad43c32dc482fc23bf8`
- B / current: `dec889c9df42009930da9c6cadd6bbfe525caea2`

Do not move these refs during the benchmark.

## Benchmark briefs

Use a mix that forces different capabilities rather than ten variants of the same card animation.

1. **Fintech status card** — polished dark-mode account/status card with hierarchy, restrained motion and a success-state transition.
2. **Music player control** — album/control composition with play/pause interaction and a tactile state change.
3. **Weather micro-interaction** — icon-led weather card with an ambient loop that must not distract from information hierarchy.
4. **Onboarding progress** — three-step progress component with state transitions and clear completed/current/upcoming states.
5. **Game reward reveal** — reward/chest reveal with anticipation, impact and settle; avoid excessive bounce.
6. **Upload state machine** — idle → uploading → success/error states with readable status feedback.
7. **Data visualization tile** — compact metric/chart tile with entrance animation and emphasis without decorative noise.
8. **Character/icon reaction** — imported vector artwork with a short expressive reaction; tests asset ingestion instead of primitive-only drawing.
9. **Existing-file refinement** — provide the same starter .riv and request three bounded visual/motion corrections without redesigning unrelated areas.
10. **Human Studio handoff** — current version only has the explicit handoff architecture; for fair quality scoring both versions receive the same edited .riv + same textual instruction, while handoff integrity is scored separately.

Each brief must be stored verbatim before the run. Do not rewrite the brief differently for A and B.

## Run design

For tasks 1–9:

- 3 independent runs per version per brief.
- 9 common briefs × 2 versions × 3 repeats = **54 agent runs**.
- Fresh session/workspace for every run.
- Same model, thinking level, system prompt and tool permissions.
- No memory or artifacts from another run.
- Same time/tool-call ceiling.
- No human correction during a run.

Task 10 is an architecture/handoff probe and should not be mixed into the main creative-quality mean unless an equivalent baseline procedure is defined.

## Telemetry

For every run capture:

- model identifier/configuration;
- input tokens;
- output tokens;
- cached input/context tokens when available;
- total tokens;
- MCP/tool calls;
- tool failures/retries;
- wall-clock duration;
- number of `riv_create` calls;
- number of `riv_edit` calls;
- number of lint/critique cycles;
- final lint errors/warnings;
- whether a deliverable was produced;
- whether finalization/review gate succeeded where supported;
- final .riv bytes/hash;
- standardized preview/filmstrip.

If the host does not expose real token telemetry, mark token measurement **unavailable**. Do not substitute character count and call it tokens.

## Blind quality evaluation

Randomize outputs and hide version/run identifiers from evaluators.

Score each dimension 1–5:

1. Brief adherence
2. Composition / hierarchy
3. Visual polish
4. Motion quality / easing
5. Readability / clarity
6. Coherence / restraint
7. Technical correctness

Primary quality score = mean of the seven dimensions.

Also record:

- obvious artifact/broken state: yes/no
- would ship without manual visual correction: yes/no
- evaluator preference in A/B pair when paired comparison is possible

Use at least two evaluators if practical. Record individual scores before discussing disagreements.

## Analysis

Report per-version:

- mean and median quality score;
- per-dimension quality score;
- completion rate;
- ship-without-correction rate;
- median total tokens;
- median input/output tokens separately;
- median tool calls;
- median wall-clock time;
- median revision/review cycles.

Also report per-brief results. A global average can hide regressions in refinement or state-machine tasks.

Do not claim a percentage quality improvement from a 1–5 score without explaining the calculation. Prefer statements such as “mean blind score increased from 3.4/5 to 4.0/5.”

## Promotion threshold

A reasonable release-evidence threshold:

- no meaningful drop in completion rate;
- current version wins the mean blind quality score on at least 6 of the 9 common briefs;
- no critical technical-correctness regression;
- token claim only if real telemetry is available for all compared runs;
- report regressions as well as wins.

This threshold is an experiment rule, not a guaranteed outcome.
