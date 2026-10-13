# WORKER C — Causal Motif Distillation & Massive Discovery (parallel lane)
Repo ODU33104/rive-mcp; branch `feat/motion-causal-distillation`. PR target `feat/motion-recipe-atlas`. Read V5/R3 in review PR #59, current 60 recipes, 34 reference rights ledger and retrieval code.

Goal: user explicitly wants the maximum number of useful, intelligible Rive motion recipes, but quality and permission matter. Build a system that understands **why a motion works**, and distinguishes component motion and decorative purpose.

Own only `scripts/motif-distill-*.mjs`, `data/motion-motifs/*`, `test/motifDistill*.mjs`, `docs/MOTIF_DISTILLATION.md`, `.github/workflows/motif-distillation-ci.yml`. Do not edit original catalog/retrieval ranker (worker D may evaluate collisions) or other workers' paths.

What to implement:
1. Automatically map **all existing 60 recipes** to structured causal motif analyses: target component roles, primitive geometry assumptions, relative timing, dependency links, visual function, motion energy, aesthetic hazards, prohibitions, and transfer-eligible domains. Record unsupported/unknown rather than inventing shape geometry. Real source-level provenance and maturity.
2. Expand original idea/discovery-only catalog generously across stylistic, cultural and animation domains. Original descriptions and metadata; link only to independently permission-checked inspirations with work-level license evidence. Discovery entries must NEVER automatically count as runnable.
3. Create runnable **causal ablation** demonstration for >=3 motifs in >=2 different domains with actual editable Rive outputs, and variants with specific motion/decoration removed. Use a concrete measurable difference and record blind human rating as NOT_EVALUATED unless it really happens. Demonstrate an effect beyond retagging.
4. Introduce dedup clusters, dependency edges and a promotion gate from discovery→buildable→rendered→cross-domain-tested; unit tests prove unsupported/unlicensed cannot promote.
5. Runtime rendering via pinned Rive, PNGs/GIFs, artifact evidence. Preserve source and embedded asset license distinctions.

Deliver a defensible reusable motif grammar and genuinely many discovery entries, **without gaming a number**. Never falsely assert a mathematical causal benefit from a PNG diff alone. Commit GitHub files, open PR to feature branch, don't auto-merge.