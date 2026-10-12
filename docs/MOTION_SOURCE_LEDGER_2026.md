# Motion Source Ledger 2026 — Worker A

**Reviewed:** 2026-10-12. **Purpose:** curated, independently attributable *individual reference works* for the Motion Recipe Atlas; **not** a dataset of downloaded animations, code, videos, screenshots, or creator prompts. Inventory: [source-candidates-2026.json](../data/motion-recipes/source-candidates-2026.json).

## Measured coverage and audit standard

| Metric | Result |
| --- | ---: |
| Unique example-level candidates | **34** |
| Source sites | **5**: Rive Marketplace 10; Motion Examples 8; Codrops 6; React Bits 5; Aceternity UI 5 |
| Individual Rive listing's linked CC BY 4.0 notice | **10** |
| Restricted (Motion+ source and React Bits component redistribution terms) | **10** |
| Individual example reuse grant unknown | **14** |
| Published in 2026, per date on source | **17** |
| Exact publication date unverified (null) | **10** |
| Work-level-rights shortlist | **3** |

**Rights interpretation:** An individual Rive Marketplace example that visibly labels itself **CC BY** and links directly to the [CC BY 4.0 deed](https://creativecommons.org/licenses/by/4.0/) counts as `verified` for its **work-level notice only**; `licenseEvidenceUrl` points to that specific marketplace listing. This does not prove that the work contains no third-party logos, font files, music, illustration assets or remixed material. The [React Bits repository license](https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md) is **MIT + Commons Clause**: software may be used in apps, but selling or redistributing its reusable components (including ports) is restricted. Motion+ examples explicitly gate full source; the Motion runtime's MIT license is **not** an example-specific grant. While [Codrops' demos index](https://tympanus.net/codrops/demos/) discusses MIT demos, it does not clear specific contributor articles, photographs, or embedded media. The Aceternity UI preview and copy controls are not treated as asset-level commercial reuse permission.

**Research method/limitations:** We checked indexed individual listings, official sample descriptions, and published tutorial articles. Several Rive direct page opens failed or required JavaScript even though indexed per-work pages were accessible; React Bits individual pages are largely client-rendered, so their exact demo imagery and variants were not independently reviewed (these records have medium confidence where appropriate). We did **not** run animation playback, inspect frames/keyframe timelines, download sources, bulk scrape catalogs, or confirm live availability from CI. Below are **composition hypotheses grounded in the creators' descriptions**, not assertions that their precise timing or visual quality was independently benchmarked.

## Selected 18 composition studies, grouped by intent

### 1. Hero scenes, product framing and narrative scroll

| Work | Why it teaches *composition*, not just movement | Rights |
| --- | --- | --- |
| [Interactive Hero Section — Rive UI Template](https://rive.app/marketplace/28570-54030-interactive-hero-section-rive-ui-template/) `rive-interactive-hero` | **Hero → hover response → progress/counter settle.** Six interaction states suggest sequencing one focal hero before secondary metrics. Requires bespoke type scale, data widgets and hierarchy; verify actual hold/settle in next study. | CC BY 4.0 **work notice**, high |
| [Interactive UI Motion Showcase](https://rive.app/marketplace/28467-53824-interactive-ui-motion-showcase-rive-components-collection/) `rive-ui-showcase` | **Tactile action → feedback → ambient UI.** A gauge, knob, music player and cards allow comparison of consistent primary/secondary motion across a unified visual kit; requires ownable icons and controls. | CC BY 4.0 **work notice**, high |
| [Maxima Therapy website study](https://tympanus.net/codrops/2026/04/06/building-the-maxima-therapy-website-react-gsap-and-dabbling-with-ai/) `codrops-maxima` | **Hero carousel → suspend animated SVG → rotate wheel → next scene.** The author's explicit handoff prevents simultaneously competing animation. Requires distinct illustrations, hit areas and art direction; AI assistance is *self-reported*. | Unknown specific-asset rights, high |
| [Scroll Horizontal Gallery](https://motion.dev/examples/react-scroll-horizontal) `motion-scroll-horizontal` | **Sticky viewpoint → serial image focus → exit.** Vertical input maps onto sideways movement, but the actual story depends on crop, contrast, caption placement and pacing. | Unknown example/media rights, high |

### 2. Kinetic typography and editorial reveal

| Work | Why it teaches composition | Rights |
| --- | --- | --- |
| [Scroll word reveal](https://motion.dev/examples/react-text-scroll-word-reveal) `motion-word-reveal` | **Reading order → sequential opacity → calm hold.** Scroll progress drives word-level emphasis; text layout, line lengths, contrast and reduced-motion behavior determine whether the effect helps comprehension. | Unknown, high |
| [Rolling text button: Staggered](https://motion.dev/examples/react-rolling-text-button-stagger) `motion-rolling-stagger` | **Hover anticipation → letter rollover → settle.** Coordinate both label rows while keeping button geometry stable; font metrics are part of choreography. | Restricted Motion+, high |
| [Dual-Wave Text with GSAP](https://tympanus.net/codrops/2026/01/15/building-a-scroll-driven-dual-wave-text-animation-with-gsap/) `codrops-dual-wave` | **Counter-moving type → central image update.** Opposing wave columns surround a relatively stable focal image, balancing energy and reading position. | Unknown media/source rights, high |
| [Responsive WebGL Text](https://tympanus.net/codrops/2025/06/05/how-to-create-responsive-and-seo-friendly-webgl-text/) `codrops-webgl-text` | **Semantic HTML layout → shader reveal.** Motion relies on accessible text and a controlled progress uniform rather than flattened text screenshots; demands original shader/art direction. | Unknown, high |
| [Split Text](https://reactbits.dev/text-animations/split-text) `bits-split-text` | **Characters/words → staggered group entrance → settle.** Letter animation is useful only after committing to typography, wrapping and hierarchy. | Restricted component redistribution, medium (JS-rendered) |

### 3. Character action, physicality and spatial interactions

| Work | Why it teaches composition | Rights |
| --- | --- | --- |
| [Friendly Floating Bot](https://rive.app/marketplace/28071-53022-friendly-floating-bot/) `rive-floating-bot` | **Idle → receive → welcome/talking.** Character pose changes represent communicative intent; deep study should inspect anticipation, eye line, mass and state interruptions against its actual rig. | CC BY 4.0 **work notice**, high |
| [Interactive Particle Globe](https://rive.app/marketplace/26161-48888-interactive-particle-globe/) `rive-globe` | **Drag → spatial response → icon focus → settle.** Foreground controls must remain readable while the globe spins; requires depth cues, coherent icon system and particle restraint. | CC BY 4.0 **work notice**, high |
| [Interactive Character Follow](https://rive.app/marketplace/28334-53514-interactive-character-follow/) `rive-character-follow` | **Pointer stimulus → constrained gaze → neutral return.** A believable response depends on silhouette/joints and layered delay, not constant linear pointer chasing. | CC BY 4.0 **work notice**, high |
| [Gravity-based Mouse Trail](https://tympanus.net/codrops/2026/05/20/made-with-gsap-building-a-fun-gravity-based-mouse-trail/) `codrops-gravity-trail` | **Spawn → fall → bounce → dissipate.** Physics-based decay teaches an actual settling phase; use independent images instead of copying the examples' art. | Unknown image rights, high |
| [Reverse-engineering Claude mascot animations](https://tympanus.net/codrops/2026/05/05/reverse-engineering-claude-ais-mascot-animations-with-svg-and-gsap/) `codrops-claude-mascot` | **Pose anticipation → offset confetti; variable sprite holds.** Author discusses deliberately delayed cues and long exertion holds. Study the *timing principle only*: recreation of an identifiable third-party mascot creates IP risk. | Unknown derivative-art rights, high |

### 4. Reward, feedback, notification and loading

| Work | Why it teaches composition | Rights |
| --- | --- | --- |
| [Confetti](https://motion.dev/examples/react-confetti) `motion-confetti` | **Press → spring button response → burst → dissolve.** Separating cause and reward makes a success scene legible before spectacle; requires an original emblem and restrained palette. | Restricted Motion+, high |
| [Data Binding Card](https://rive.app/marketplace/25446-47494-data-binding-card/) `rive-data-card` | **Data change → clear card transition → stable selection.** Card number/suit content must keep alignment and typographic system through state change. | CC BY 4.0 **work notice**, high |
| [Toast: Stacked notifications](https://motion.dev/examples/react-toast-stack) `motion-toast-stack` | **New toast → background stack compression → dismissal.** Shared depth, opacity and interruption behavior carry coherent notification hierarchy. | Restricted Motion+, high |
| [Loading: Jumping dots](https://motion.dev/examples/vue-loading-jumping-dots) `motion-jumping-dots` | **Three offset impulses → seamless repeat.** A common loop period and exact return pose matter more than isolated bounces; check reduced-motion fallback. | Unknown per-example grant, high |

## Rights-cleared shortlist (human study only)

- **Priority 1 — `rive-interactive-hero`**: [specific CC BY 4.0 listing](https://rive.app/marketplace/28570-54030-interactive-hero-section-rive-ui-template/), creator `robin-islam`. Explore hover states, dominant hero and subordinate counters; independently audit branded interface elements/fonts before reuse.
- **Priority 2 — `rive-floating-bot`**: [specific CC BY 4.0 listing](https://rive.app/marketplace/28071-53022-friendly-floating-bot/), creator `sukeycool`. Examine state-aware anticipation and return motion; inspect all character art and rig dependencies.
- **Priority 3 — `rive-globe`**: [specific CC BY 4.0 listing](https://rive.app/marketplace/26161-48888-interactive-particle-globe/), creator `sm_motion`. Examine pointer authority, icon depth and particle response; audit icons and scripts before adaptation.

These are **rights-cleared at the explicitly displayed *work-level notice***, not green-lit for training ingestion or automatic asset bundling. For any later CC BY 4.0 adaptation, credit the original creator and title, link the original and [license](https://creativecommons.org/licenses/by/4.0/), identify modifications, and check any third-party elements. CC licenses do not waive privacy/trademark/publicity rights.

## Risks, exclusions and concrete next integration

1. **Quality evidence gap:** These are visual-design hypotheses; no frame-level trajectory, easing curves, artist-verified source file or measured scene quality has been collected. Record manual hero/lead/response/stagger/hold/settle observations only after a rights-gated inspection.
2. **No blanket license:** Public CodePen MIT code policy, a Codrops index label, an MIT animation *runtime*, and an open-source component collection's license must not be used to clear embedded visuals or paywalled examples. LottieFiles assets were not bulk harvested; its service terms warrant a separate review before reuse.
3. **Access gap:** Some Rive URL bodies and JS-rendered React Bits previews were not accessible as plain text. Indexed work identity is distinct from independently inspected motion; re-check browser playback before assigning visual-quality scores.
4. **AI provenance:** Maxima Therapy's AI workflow and the Claude mascot reconstruction come from their authors' own published accounts. Neither establishes model-version truth nor permission from a trademark/character rights holder. AI gallery roots without confirmed *individual* work pages were deliberately excluded.
5. **Next integration:** The lead may promote vetted pointers into the Atlas later, preserving `reference-only` status (Worker A does **not** edit `catalog.v1.json`). First review the three CC BY listings, independently create visually coherent hero/character/spatial scenes, and compare first-request Rive results against identical baseline art assets.

## Reproducible offline validation

```sh
node --check test/motionSourceLedger.mjs
node test/motionSourceLedger.mjs
python -m json.tool data/motion-recipes/source-candidates-2026.json > /dev/null
```

This checks required fields, unique work IDs and URLs, example-level paths, date integrity, rights evidence gate, and three shortlist references. **It makes no online availability, aesthetic quality or blanket legal permission claims.**
