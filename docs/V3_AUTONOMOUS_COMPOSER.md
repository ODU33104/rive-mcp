# V3 Autonomous Composer — bounded native construction

Issue: [#74](https://github.com/ODU33104/rive-mcp/issues/74) · Target base: `feat/motion-recipe-atlas`
Owned source: `scripts/v3-construct-agent.mjs`; benchmark: `scripts/v3-construct-compare.mjs`.

## Scope and truth boundary

A deterministic JP/EN textual request is converted to a `PLANNED` typed contract or explicit `ABSTAIN`. Approved plans generate **new editable Rive scene nodes**, groups, geometry, slot pivots and animation tracks. This is not unconstrained natural-language design generation, and does **not** demonstrate superior visual quality. Blinded aesthetic ratings: **NOT_EVALUATED**.

The V3 source is a deliberate, limited adaptation of PR #62's constructive-scene agent from `feat/motion-constructor-next` (not an implicit merge of PR #62). Original SVG, proprietary source artwork, arbitrary web-media downloads, and third-party `.riv` decode/merge are not imported.

## Component selection and typed transform contract

| Domain | Parametric geometry and motion | Semantic slot roles | Distinct topology |
| --- | --- | --- | --- |
| Earbuds | Hinged shell, lid cavity, transducer buds and actual stems; case-only or buds reveal | `earbud.case`, `earbud.case-lid`, `earbud.body`, `earbud.stem` | Open/closed state, high/low facet count, diagonal and split staging |
| Instrument | Radial rings, dynamically counted tick marks, scanning wave paths, sensor pointer | `instrument.root`, `instrument.needle` | Ring/tick cardinality, scan waves versus orbital indicators |
| Typography | Editorial panels, vector bands, registration marks, editable Inter text | `poster.composition`, `poster.band` | Grid bands vs polygon modules; slant, stagger, count |
| Transit (new) | Metro plate, loop or polyline graph, independently rigged stations, route segments and transfer mark | `transit.network`, `transit.station` | 4..10 stations; linear vs cyclic graph; junction/interchange styling |

The intermediate plan records `components` with `role`, `geometryTemplate`, `anchorUnits`, `rigIds`, `sourceId`, declared compatible fill/FX and tracks. Units are **scene:px** at root and **parent:px** for children; this is not a physical millimeter model. Each group has authored local translation, parent transform, and explicit anchor. `validateConstructiveSlots()` evaluates complete world transforms and fails on shifted pivots, missing members, or broken ancestry. Missing positions are not filled from an undocumented implicit previous grammar x/y.

Every shape has `sourceId: original:procedural-v3`. Material support: solid and linear gradient fill. FX support claimed: opacity only. No unimplemented blur, shadows, real 3D, mesh deformation, audio or arbitrary text shaping is silently substituted. Editorial copy is currently authored in English and rendered using the repository-bundled Inter font.

### Fail-closed behavior

Hard constraints `noSpin`, `noBounce`, and `onlyCase` are checked against actual emitted tracks. Long Japanese prose, audio/3D, unclear/combined subjects, impossible semantic slots, and transit graphs larger than 10 stations return `ABSTAIN`. A failed RIVE writer or failed official runtime inspect/render **throws**; it cannot produce a success receipt.

## Reproduction

```bash
npm ci
npm run build
node --test test/v3Construct.test.mjs
node scripts/v3-construct-agent.mjs --batch samples/v3-construct/prompts.json --out test/tmp/v3-construct --render
node scripts/v3-construct-compare.mjs
```

For each of 8 accepted frozen prompts, the runtime step writes `<id>/<id>.riv`, `<id>/<id>.riv.evidence.json`, 31 `frame-*.png`, and `poster.png`. GitHub Actions encodes `preview.gif` with FFmpeg, checks every required file, and uploads all artifacts. Render widths depend on the planned subject (earbuds 1080, instrument 1024, typography 900, transit 1200). Accepted + abstained holdouts: `samples/v3-construct/holdouts.json` (14 JP/EN requests).

**Only a successful latest-head CI build with inspectable artifact bytes proves the runtime outcome.** A workflow file and a successful compilation alone are **not** an achieved rendering claim. No claim of human aesthetics approval is authorized without independent blind review.

## Six matched-request comparison

Run `scripts/v3-construct-compare.mjs` after the eight rendered outputs are written; the `comparison.json` contains six identical inputs, constraints, V3 write time, output SHA, and the matching render receipt status.

1. **Completed-scene adaptation**: `scripts/prompt-solstice.mjs` is explicitly watch-only; it must `ABSTAIN` for all four V3 domains. This is a domain limitation, not a legitimate visual comparison. Time and frame evidence are null.
2. **V3 constructive route**: built .riv and measured plan+binary-write time, plus independently checked Rive runtime receipt (no invented render-time measurement).
3. **Direct official RML**: no verified RML authoring/runtime adapter is available in this branch. Mark `UNSUPPORTED`, time null, rendered false. Do not invent successful RML previews.

Thus the six-row comparison is an honest capability matrix, **not** a six-way aesthetic win. A true matched visually comparable baseline requires separately authorized source scenes or a verified RML runtime pipeline.

## Source provenance, licensing, and assessment gates

- Procedural geometry authored in this repository: `original:procedural-v3`. Design derivation: first-party work in PR #62 (not merged). Preserve any earlier source authorship when distributing.
- Font `assets/inter.ttf`: repository identifies SIL Open Font License 1.1; bundled font's coverage does not justify claims of Japanese long-text rendering. Font license and redistribution conditions remain relevant to exports.
- Repository `LICENSE` is a nonstandard freeware license **restricting modification/redistribution without written permission**. Repository write access alone does not establish third-party modification rights. Owner/maintainer must confirm the right to publish derivatives before external redistribution. No external third-party media has been ingested by this V3 path.
- Work-level source rights and rights of embedded source assets are separate. Imported user geometry, if added later, requires an explicit provenance/permission gate before encoding. No arbitrary web asset URL is a license grant.
- Static PNG/GIF inspection is not blind human scoring; **blinded aesthetics NOT_EVALUATED**, rendering quality assessment pending inspection of CI artifacts.

## Known visual and feature defects

Composition is deliberately constrained to fixed authored vector families; detailed user prompts beyond the supported grammar are not followed. Existing three-domain text/canvas hierarchy is shared and may visually resemble a template even when geometry topology changes. Rive gradient/typography behavior must be checked from official-runtime PNGs, especially legibility, negative space, overlap, and motion trajectories. Native editability is structurally claimed through shapes/groups/tracks, not certified by a manual Rive Editor inspection. Effects such as soft hardware reflections, complex feathering, ambient occlusion and polished art direction are **not proved**. Do not describe this as an autonomous professional-grade designer.

## PR verification checklist

- [ ] Latest commit `npm ci`, build, node tests green
- [ ] 8 RIVE binaries and runtime metadata successfully generated
- [ ] 8 actual official runtime poster PNGs, 248 frame PNGs and 8 GIFs available in CI artifacts
- [ ] Inspect representative screenshots for clipping, contrast, typographic quality and rigging artifacts
- [ ] Confirm font/source rights for third-party redistribution
- [ ] 6 matched rows, with unavailable baselines clearly marked
- [ ] Blinded aesthetics explicitly **NOT_EVALUATED**
