# Genuine CC BY Rive FX: from Kabi's authored vector source into Studio

**First explicitly third-party-authored component integrated from source into our native editable Rive scenes** (if CI passes). Not from screenshots and not newly hand-drawn. Component author: **Bryl Lim**. Licensed CC BY 4.0: https://github.com/bryllim/kabi-mascot, source commit `7dee2abc2320fcc72f08c7064214ba9df84687f5`.

## What is copied rather than invented

The upstream editable `dist/kabi.model.json` contains five actual `sparkle1..5` shapes in parent `sparkles`, each with the original SVG cubic path, source palette tokens, authored local coordinates, and fifteen original `celebrate` rotation/scale property tracks. The portable subset comes from hand-authored extras described by the Kabi creator; **we do not import the photo-traced character, logos or unknown external embedded raster assets**.

The transformer verifies a pinned SHA-256 of the complete upstream authoring model, specifically parses its M/C/Z SVG cubic segments and samples the original curves into real editable Rive vector polygon paths. It retains the exact original color tokens and animation property/value/relative timing from the source; it uses only explicit spatial/time adaptations (0.48× local placement, 0.64× path size, +151f time offset) so the imported effect can appear in a different scene without colliding with copy. Any unrecognized source command, changed source hash, missing motion lane or illegal target causes failure.

Admitted targets are the playful LUMA character and kinetic ZENITH wordmark — **not** solemn premium watches or arbitrary quiet scenes. This is a semantic compatibility gate, not generic effect injection. It does not mean the complete external Kabi Rive was loaded as a nested artboard or that compiled `.riv` files are freely mergeable. The editable source model, attribution and work-level license are available through the upstream repo.

## Hard runtime evidence

Two CI jobs download the original source model and LICENSE from the pinned author commit. Each produces an actual editable `.riv` host scene with five third-party-derived shapes + fifteen original animation tracks, uses the official Rive runtime `visualDiff` at 2.5, 2.8, 3.1 and 3.3 seconds, requires a visible difference above 0.05% of 720×460 pixels and captures 46 genuine PNG frames and a GIF. Outputs include before/after `.riv`, PNG, GIF, source hashes, component mapping and author attribution. Unsupported/import-invisible outcomes fail.

The licensing and quality decision is deliberately narrow: CC BY requires author/URL/license/edit notice; separate reference image lineage applies to the Kabi figure and is NOT included in this subset. The creator's claim of hand-authored sparkles is the present subset evidence; if independent review disputes it, quarantine the effect. Image difference confirms visibility, NOT aesthetic merit. **No independent beauty rating has been performed.**

## Reproduce

    npm ci && npm run build
    # download model JSON from upstream pinned commit into /tmp/kabi.model.json
    node test/ccbyKabiSparklePort.mjs /tmp/kabi.model.json
    RIVE_MCP_CHROME=/path/to/Chromium node scripts/ccby-kabi-sparkle-port.mjs /tmp/kabi.model.json luma test/tmp/kabi-port/luma --render

Goal next: add additional legally sourced, *actually editable* Rive effects one by one and prove cross-scene improvements, rather than inflate the 42-link discovery list.
