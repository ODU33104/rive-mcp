# Constructive Scene Agent — bounded cross-domain authoring

This is an experimental **prompt → machine-readable plan → newly generated scene graph → editable RIVE** builder, not a watch-file string switch and not a replacement for official RML/Editor/CLI.

## Reproduce (Node ≥ 20)

```bash
npm ci
npm run build
node --test test/constructiveScene.test.mjs
node scripts/constructive-scene-agent.mjs --batch samples/constructive-scene/prompts.json --out test/tmp/constructive-scene --render
# After official runtime successfully wrote frame-000.png..frame-024.png per scene:
for scene in test/tmp/constructive-scene/*; do
  ffmpeg -nostdin -y -loglevel error -framerate 12 -i "$scene/frame-%03d.png" -vf "fps=12,scale=720:-1:flags=lanczos" "$scene/preview.gif"
done
```

Expected outputs for six fixture IDs: `ID/ID.riv`, `ID/ID.riv.evidence.json`, `ID/poster.png`, `ID/frame-000.png` through `frame-024.png`, and `ID/preview.gif`. **A planned/serialized scene without successful official-runtime inspect/render is not visual evidence.** CI uploads the generated files, rather than checking massive binaries into git. Any render or encoding failure must fail the job.

## Supported capability contract

| Domain | Generated geometry | Semantic rig pivots | Prompt-controlled changes |
| --- | --- | --- | --- |
| Earbuds/case | Case shell, lid, cavity, stems, speakers, status light | `earbud.case`, `earbud.case-lid`, `earbud.body`, `earbud.stem` | Open/closed lid, machining facets, split/diagonal arrangement, case-only movement |
| Orbital instrumentation | Nested dial rings, dynamic tick topology, scan waves/satellites, sensor needle | `instrument.root`, `instrument.needle` | Ring/tick count, scan vs orbit, needle energy, no-spin |
| Typographic poster | Compound vector bands, layout panel, rule, registration disc | `poster.composition`, `poster.band` | Grid vs modular construction, band count/shape, diagonal tilt, stagger energy |

The parser supports Japanese/English **instructions**, with a deliberately bounded vocabulary. It returns `ABSTAIN` with a reason when the subject is unknown or ambiguous or requires unsupported media, audio, 3D, seconds-hand motion, or unverified long Japanese typography. It never fabricates a success file for these requests. Generated display copy is deliberately English because the bundled Inter font is not a general Japanese glyph solution. The original request remains in plan/evidence JSON.

### Proof boundaries

* `plan.design` captures domain, mode, composition, visual language, material, geometry cardinalities, energy, animation, and hard prohibitions. It is not an intent-tag array.
* Domain builders emit different **new shape graphs**, not copied watch illustrations. A stem is rigged as a stem, not a mapped watch hand.
* Each rig carries an authored local anchor and semantic member list. `validateConstructiveSlots` evaluates local/world transforms through the actual scene hierarchy, verifies semantic ownership, and detects displaced pivots.
* No-bounce forbids overshoot/back/elastic; no-spin disallows rotation tracks; case-only forbids bud movement tracks. A prohibited combination must be rejected or truly satisfied.
* Repeated normalized prompt yields identical scene geometry and RIVE data when toolchain/font assets are unchanged. The JSON evidence includes separate scene/binary SHA-256 hashes, slot world locations, tracks and render status.
* Static scene edits from SOLSTICE are a different baseline. The dynamic test constructs new geometry in three unrelated domains; **this does not establish superiority** to handcrafted art or official RML.

### Evaluation still needed

Output quality has **not** been blinded against official RML, human-made Rive, or static scene editing. There is no broad subject understanding, semantic typography, external asset license review, polished font fallback, layout solver, 3D material model or a claim of universal generative authoring. Evidence depends on Actions actually passing; a workflow definition alone is not proof. For extensions, add independent holdouts and explicit unsupported-state tests before increasing coverage.
