# Native Rive effect reuse: pixel impact before beauty claims

Eight effect transfers already generate distinct native Rive files and before/after frames. Their previous smoke test used PNG-hash inequality. That is too weak: changes smaller than a few pixels can satisfy a hash comparison while having essentially no visible design impact.

This add-on uses the project's existing official Rive Canvas host's **pixel-level `visualDiff`** (not a new imitation renderer). For every variant, it compares identical source backgrounds, animation `Reveal`, frame size 720×460, at `0.5, 1.0, 1.6, 2.4, 3.4` seconds with color/alpha threshold 16. It saves five real diff PNGs, diff pixel counts and exact proportions, grouped into neutral impact sizes:

| Max changed area | Diagnostic label |
|---|---|
| <0.015% | NEGLIGIBLE |
| 0.015–<0.15% | MICRO |
| 0.15–<2% | SUBTLE |
| 2–<12% | VISIBLE |
| >=12% | EXTENSIVE |

The thresholds are heuristic diagnostic bins, not empirically validated aesthetic grades. At least one sample >=0.05% is needed for the limited `VISIBLY_APPLIED` marker; otherwise it is `INSUFFICIENT_PIXEL_EVIDENCE`. A small elegant glow might be preferable to huge glitter; a giant pixel change can be destructive. **We make no 'looks better' claim without human judgment.**

Each CI job outputs sampled native .riv with effect, five diff PNGs and machine-readable counts. The Studio workstream remains separate from source discovery, licensed third-party acquisition, semantic fit and high-end art-direction tasks.

    npm ci && npm run build
    node test/effectVisualImpact.mjs
    RIVE_MCP_CHROME=/path/to/Chrome node scripts/effect-visual-impact.mjs fx-atlas test/tmp/effect-visual-impact/fx-atlas
