# Causal motif distillation — independent evidence contract

**Status: research lane, not a production recipe expansion.** Implements part of R3-I6 from [V5](https://github.com/ODU33104/rive-mcp/pull/59), without editing production retrieval/catalog. The official Rive runtime renders native Rive objects; the existing in-repo SceneSpec writer authors them. **Official Rive CLI verification has not been run.** Do not mislabel runtime inspection as CLI verification.

## Reproduce

With Node 22, Chromium and FFmpeg:

~~~sh
npm ci
npm run build
node scripts/motif-distill-catalog.mjs --write
node scripts/motif-distill-catalog.mjs --check
node test/motifDistill.mjs
RIVE_MCP_CHROME=/path/to/chromium node scripts/motif-distill-ablate.mjs test/tmp/motif-distillation --render --gif
~~~

Generated inventory is under data/motion-motifs/catalog-analyses.v1.json (all 60 original recipe analyses), with data/motion-motifs/discovery.v1.json (36 original concepts). The ablation evidence report, 12 editable native .riv scenes, official runtime PNGs and GIF previews are placed in test/tmp/motif-distillation; CI uploads them.

## Source-derived fact versus hypothesis

- Role/property tracks, times, easing strings, duration and stages come from existing catalog definitions; the recipe record SHA-256 is preserved.
- Role semantics are explicitly unverified name heuristics. Start-order edges are observed *temporal precedence*, not proof of causation.
- Shape geometry, pivot, local-world attachment, materials, prohibitions, transfer safety, external permissions and actual audience preference are **unknown** unless separately verified.
- The 36 ideas are independent short texts, not third-party keyframe, media, logo or font copies. The discovered count is not a runnable count or a quality measure.
- Dedup signatures identify candidates for review, not equivalent artistic designs or safe merges.

## Three controlled, two-domain interventions

Each control–ablation pair retains every native vector shape and every property track except the specified intervention. The two separately authored domains are round instruments and parcel-tracking cards.

| Motif | Isolated removal | Program-level metric |
| --- | --- | --- |
| detail-after-hero | No delayed supporting detail (appears immediately) | Early detail opacity at frame 25 |
| material-glint | Specular highlight pulse suppressed | Glint opacity at frame 61 |
| shadow-follows-object | Shadow x-position frozen while hero moves | Maximum x-offset residual, artboard px |

The measurement proves changed source-level property traces, **not** improved visual beauty, comprehension or mathematical aesthetic causation. Rive runtime PNGs and GIFs are inspection witnesses, not human preference evidence. Human blinded ratings are **NOT_EVALUATED**. The binary Rive structure contains editable shapes, groups, animations and a state machine, not screenshot-only stand-ins.

## Strict promotion gate

Stage order: discovery-only → buildable → rendered → cross-domain-tested. Skipping stages is denied.

Buildable requires verified geometry and editable source, an exact manipulable variable, a source SHA-256, recorded source permission for adapt/render/embed/redistribute and independently reviewed embedded assets. Rendered additionally requires a pinned runtime version, a verified native Rive SHA, runtime inspection and at least two actual frame hashes. Cross-domain-tested requires at least two distinct domains with measured effects and actual blind human ratings from at least three evaluators **per domain**. Unit tests use synthetic permissions and ratings to test fail-closed behavior; these fixtures are not evidence that the work was reviewed by a person.

The existing 34 reference works are not a reusable asset stock. A CC BY work-level label does not clear embedded art, fonts, branding, music, code, or training rights. Unknown and restricted records remain quarantine-only.

## Pending evidence and stopping rule

No independent human blind ratings, cross-domain behavioral/semantic success, official Rive CLI verify/test/bench, or demonstrated production retrieval advantage exists. **Zero discovered candidates have been promoted into production.** Do not expand the production atlas until independent rights review, live editability checks, blind outcomes and held-out real Rive generation success demonstrate a material gain without regressions.
