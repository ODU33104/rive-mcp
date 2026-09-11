# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-09-11

### Added

- `riv_ui_detect` — read a screenshot into a UI element tree: colour-quantised
  region detection, text-run clustering, bounding-box containment, and a
  numbered overlay to inspect the result.
- `riv_ui_prototype` — turn a screenshot or an SVG into a working animated
  `.riv` in two calls: vector panels, raster text cut out with an alpha matte,
  entrance animations, and hover/press interaction states driven by real
  element states rather than bare inputs.
- SVG import path that reads the design directly from the source instead of
  inferring it from a screenshot, including text rendered with a real font.
- Figma frame fetching, performed only when a token explicitly authorises it.
- Design-token extraction: a role-tagged palette derived from sampled colours.
- A measurement harness for the detector — synthetic scenes, reconstruction
  error, guardrails, and a holdout set nothing was tuned against.
- Japanese README (`README.ja.md`), kept in sync with the English one.

### Changed

- Studio matches the official Rive editor layout, with two-way agent chat.
- Palette accent selection uses OKLCH chroma instead of HSL saturation, and
  palette usage is weighted by area rather than occurrence count.
- UI element `kind` split into `renderMode` + `semanticHint`.

### Fixed

- Tool schemas no longer emit draft-07 tuple form (`items` as an array) or
  `$ref` dedup pointers. Strict JSON-schema validators in some MCP clients
  (Kimi Code / Moonshot-flavored among them) rejected the entire `tools/list`
  payload over this, disabling every tool for the session. Affected
  `riv_slice_image`, `riv_rig_character` and `riv_batch_render`; coordinates
  are still validated as exactly two numbers, so there is no runtime change.
  Thanks to [@gbcdby](https://github.com/gbcdby) ([#3]).
- Lottie import: a null layer's opacity no longer blanks the whole file.
- State machine parser: state ids derive from encounter order.
- Corner-radius inverse factor and asymmetric-corner median bias.
- `buildTree` parent/child cycles caused by near-duplicate detections.
- Elements without real transparency no longer move silently — the tool says
  when a move cannot be honoured.

## [0.5.0] and earlier

See the [release history](https://github.com/ODU33104/rive-mcp/releases).

[0.6.0]: https://github.com/ODU33104/rive-mcp/compare/v0.5.0...v0.6.0
[#3]: https://github.com/ODU33104/rive-mcp/pull/3
