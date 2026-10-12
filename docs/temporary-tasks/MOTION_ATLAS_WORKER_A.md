# Worker A — Global motion sources, licensing and usable evidence

**Execute this assignment without requesting more user instructions.** Start by reading `docs/temporary-tasks/MOTION_ATLAS_README_20261012.md` on `coord/motion-atlas-parallel-20261012`, then `docs/MOTION_RECIPE_ATLAS.md` and `data/motion-recipes/catalog.v1.json` on `feat/motion-recipe-atlas`.

**Branch:** `feat/motion-atlas-sources-20261012` from `feat/motion-recipe-atlas` (use a different suffix if this branch exists). **PR base:** `feat/motion-recipe-atlas`.

## Mission

Find a **diverse, recent, high-signal international corpus** for AI-generated, Rive, web UI, kinetic typography, motion design and interactive motion. Prioritize high quality reference works from official demos, libraries, creator portfolios and relevant public AI showcases. Identify **concrete individual examples**; an index root URL is useful for discovery but is not a verified example.

Sources to investigate (not a mandate to scrape): Rive Marketplace / official examples, Motion examples, React Bits, Animista, Lucide Animated, CodePen, Awwwards, Codrops, GSAP showcase, Lottie community, public demo repos, current Claude/AI community showreels. Site claims about model versions or output provenance are **self-reported** unless independently verified. Do not copy site content into a training dataset.

## Deliverables (own only these)

1. `data/motion-recipes/source-candidates-2026.json`: **at least 30 verifiable example-level entries if reliably accessible**; prefer 15 credible entries over 100 fabricated ones. Fields: `id`, `title`, `workUrl`, `author` (null if unknown), `site`, `publishedAt` (null if unverified), `format`, `featureTags`, `referenceRole`, `licenseStatus` (`verified|unknown|restricted`), `licenseName` (null if uncertain), `licenseEvidenceUrl` (null if absent), `allowedUses` array (default `["link"]`), `provenanceConfidence` (`high|medium|low`), `notes`. Do not assume a collection license covers individual works or embedded images.
2. `docs/MOTION_SOURCE_LEDGER_2026.md`: catalog of the top 10–20 candidates with concrete **why this teaches motion composition** (hero/stagger/anticipation/settle, physical timing, visual assets). Group by animation intent, describe major reuse-rights risks, and prioritize 3 rights-cleared examples for later deep study.
3. Optional `test/motionSourceLedger.mjs` that validates schema, unique IDs, URLs, and evidence state.

## Constraints

- **No bulk scraping or downloads** of copyrighted animations, videos, or creators' prompt archives. Use URLs + original one-sentence annotations first. Only bring over actual media or source code when concrete terms permit and attribution is recorded.
- The user's statement that authors invite reuse is not itself a site-wide reuse grant.
- Never mark a reference as commercially reusable without license evidence linked to the exact asset or code.
- Avoid repository-wide churn; **do not edit** `data/motion-recipes/catalog.v1.json` (lead integrates vetted findings later) or worker B/C scripts.
- Research a broad range of visual styles; prioritize world-class aesthetic examples over quantity.
- Be explicit when a site cannot be accessed, or when an attribution/claim cannot be verified.

## Acceptance

- Real, reachable example URLs and a rights audit; confidence tagging; no invented releases.
- At least 3 shortlisted works (or explicitly document if rights prevent this).
- Validation command documented; share an open GitHub PR with measured counts, limitations and suggested next integration.
