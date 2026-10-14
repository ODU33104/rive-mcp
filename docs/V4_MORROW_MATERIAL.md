# MORROW V4 — art direction beyond a successful .riv build

**A controlled re-authoring exercise of one known weak flagship (MORROW).** We don't count one more new gallery preset or downloaded FX link as progress. Previous MORROW is geometrically competent but looked like a flat vector bottle with generic typography. V4 preserves the actual editable bottle/source motion yet radically shifts the visual composition and lighting/material hierarchy.

## Real re-authoring rather than FX on an unchanged poster

1. Re-composes the 960×600 original as an asymmetric editorial product study; bottle shifts right, grows physically and all original X/Y/scale animation curves are retimed/translated, rather than changing only the final rest position.
2. Rebuilds the actual source bottle `outer-wall`, fluid, meniscus, cap, inner glass, refracted facets and matching silhouette with native Rive **radial** and linear gradients, existing native clip mask, subtle screened diffuse and focal edge glints.
3. Adds crisp rim light, source glass microgrooves and quieter editorial typography/negative space without bitmap overlays or calling conventional gradients real refraction. Adds restrained separate light choreography.
4. Variant `atelier`: reauthored source, no imported spectral beams. Variant `spectral`: same composition plus **8 genuinely existing PRISM authored vector beams and original opacity keyframes**, retargeted inside the physical glass silhouette. This is source-to-source use of project-authored FX, not from visual screenshots.
5. **No unsupported feather** is used here. The repo's current Canvas Advanced Rive browser host cannot automatically guarantee the Rive Renderer/WebGL feathered-blur path. Screen-blend and native radial fill are captured as actual browser-rendered pixels; if unsupported they will appear wrong and need rejection.

## Evidence

`scripts/v4-morrow-material.mjs` can compile both variants into native `.riv` and generate **76 actual official Rive runtime PNG frames at 15fps per candidate**, GIF and per-candidate A/B posteriors. CI checks source scene immutability, genuine radial/specular/clip layers, inherited source tracks, stable parent hierarchy, no duplicate animation lanes and refused undefined effects.

Native `visualDiff` compares every candidate with the **unchanged original V3 MORROW**, at exactly matched times/size; a meaningful changed area is required. Note: changed pixels are neither beauty nor a blind aesthetic comparison. The two new variants also share an art direction, so comparing them separately tests whether this particular imported effect helps. **Human aesthetic superiority is NOT_EVALUATED until real independent judgments.** Both variants must be manually reviewed at multiple frames, cropped titles and cap included. Weak variants must not be merged merely because tests are green.

## Commands

    npm ci && npm run build
    node test/v4MorrowMaterial.mjs
    node scripts/v4-morrow-material.mjs atelier test/tmp/v4-morrow/atelier
    RIVE_MCP_CHROME=/path/to/playwright-chromium node scripts/v4-morrow-material.mjs spectral test/tmp/v4-morrow/spectral --render

## Known limitations

- It remains stylized vector material, not physically correct ray-traced glass or volumetric lighting.
- No new external copyrighted asset is downloaded; source animations still only exercise this one authored product.
- The library cannot yet combine arbitrary external .riv/.rev files safely or guarantee Rive Editor import parity.
- Aesthetics, color grading, real camera quality and actual human surprise are still open evaluation criteria.
- A matching original title/product task with identical semantic constraints is necessary before route superiority claims.

PR target is the V3 flagship authoring branch `parallel/flagship-scenes-v3-20261014` (not main). It is intentionally isolated in new V4 scripts/tests/CI and does not alter the production writer.
