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


## Actual results, pinned official runtime CI (not hypotheses)

Run: https://github.com/ODU33104/rive-mcp/actions/runs/38480696536
Metadata: data/effect-quality/native-impact-20261014.v1.json

| Variant | Maximum changed screen pixels | Gate |
|---|---:|---|
| fx-atlas | 1.1606% | Technical visible candidate |
| fx-spectra | 0.3472% | Technical visible candidate |
| fx-zenith | 0.3046% | Technical visible candidate |
| fx-meridian | 0.2065% | Technical visible candidate |
| fx-bassline | 0.0966% | Technical visible candidate, micro |
| fx-prism | 0.0731% | Technical visible candidate, micro |
| **fx-quantum** | **0.0266%** | **QUARANTINE** |
| **fx-vesper** | **0.0000%** | **QUARANTINE** |

The two weak transfers previously passed valid Rive compile and hash-difference checks. The actual native rendering test exposed insufficient pixel-level impact under the 16-channel-difference threshold. The code now includes a fail-closed `classifyForPromotion` gate. Technical candidate **does not mean beautiful**. All eight lack independent subjective ratings. Release-ready remains **zero**.

These measurements are tied to the cited CI head/run. They should be recomputed after relevant changes; untested future code must never inherit the pass label.
