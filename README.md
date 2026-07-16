# rive-mcp

**Create, edit, inspect, render and live-preview Rive (`.riv`) animations from Claude — no Rive editor, no cloud, no subscription.**

[日本語 README はこちら](./README.ja.md)

rive-mcp is a free MCP (Model Context Protocol) server that gives Claude (or any MCP client) full control over `.riv` files. Unlike the official Rive MCP (which requires the editor running) or paid third-party servers, it works with nothing but a `.riv` file — and it can even **build `.riv` files from scratch** by serializing the binary format directly.

Rendering runs the **official Rive runtime** (`@rive-app/canvas-advanced` WASM) inside headless Chromium, so what you see is exactly what ships.

![Studio screenshot](docs/media/studio.png)

<p align="center"><img src="docs/media/showcase.apng" width="420" alt="Animation generated entirely by riv_create"></p>
<p align="center"><i>This animation was generated entirely by <code>riv_create</code> — no Rive editor involved.</i></p>

## Highlights

- **Generate `.riv` from JSON** — shapes, gradients, embedded PNGs, text, bones + skinning, IK, mesh deformation, keyframe animation with easing, multi-layer state machines, listeners, events, physics baking, particles
- **Losslessly edit existing `.riv`** — change any property, swap text, delete subtrees (references auto-remapped); round-trip verified pixel-perfect
- **Local web Studio** — Rive-editor-style 3-pane UI (hierarchy / canvas with click-select & drag / inspector / timeline) with hot reload; edits apply live
- **Human ⇄ AI loop** — an "Instructions for AI" box in the Studio: you type feedback, the AI picks it up via `riv_studio_notes` and fixes the file, your browser updates instantly
- **Auto-rig characters** — one call turns a character PNG into a rigged `.riv` with cutout parts, bone-skinned head mesh, eye blink, idle/happy animations and a state machine
- **Everything verified** — generated files are loaded, rendered and state-machine-driven by the official runtime in E2E tests

## Tools (19)

| Tool | What it does |
|---|---|
| `riv_list` | Recursively find `.riv` files (size, format version) |
| `riv_inspect` | Full metadata: artboards, animations (duration/fps/loop), state machines and inputs |
| `riv_render_frame` | Render any moment to PNG (inline image + file) |
| `riv_render_gif` | Turn an animation into a preview GIF |
| `riv_render_apng` | Animated PNG export — 24-bit color + alpha transparency (plays on GitHub) |
| `riv_render_video` | Record an animation or state machine to WebM video |
| `riv_render_sprites` | Sprite-sheet PNG + JSON metadata (for game engines) |
| `riv_play_state_machine` | Set/fire inputs → advance → state-transition report (+ optional frame captures) |
| `riv_generate_code` | Integration code with real artboard/SM/input names (React / JS / Vue / Svelte / Flutter) |
| `riv_create` | **Build a `.riv` from a JSON scene spec** — validated with the official runtime, returns a preview |
| `riv_edit` | Lossless editing of existing `.riv` files: set properties, swap named text, delete subtrees, **add/replace/remove keyframes** |
| `riv_extract_assets` | Extract embedded images/fonts from a `.riv` |
| `riv_visual_diff` | Pixel diff of two `.riv` files with a highlighted diff image |
| `riv_dump` | Low-level binary structure dump (typeKeys / properties / hierarchy) |
| `riv_slice_image` | Cut character parts out of a PNG by polygon (for cutout rigging) |
| `riv_rig_character` | **Character PNG → fully rigged `.riv` in one call** |
| `riv_diff` | Structural diff between two `.riv` files |
| `riv_studio` | **Local web Studio**: Rive-editor-style dark UI — hierarchy tree, canvas select/drag/resize, inspector, keyframe timeline editing, undo/redo, playback speed, one-click export (PNG/APNG/GIF/WebM), live preview + hot reload, EN/JA |
| `riv_studio_notes` | Fetch instructions the human typed into the Studio UI |

## Quick start

Install from npm:

```bash
npm install -g rive-mcp-server

# Register with Claude Code (user scope = available in every project)
claude mcp add --scope user rive -- rive-mcp
```

Or run from source:

```bash
git clone https://github.com/ODU33104/rive-mcp.git
cd rive-mcp
npm install
npm run build
claude mcp add --scope user rive -- node /absolute/path/to/rive-mcp/dist/index.js
```

A Chromium-based browser is auto-detected in this order (usually nothing to install):

1. `RIVE_MCP_CHROME` env var (path to Chrome/Edge executable)
2. Playwright browser cache
3. Installed Chrome → Edge

Requires Node.js 20+.

## The Studio: human ⇄ AI collaboration

`riv_studio` opens a local web page where a human can inspect, directly edit, and request changes to whatever the AI built (first-run guide included, UI in English/Japanese):

1. **Let the AI build** — "create a bouncing-ball riv and open it with riv_studio"
2. **Touch it** — click/drag objects on the canvas, tweak numbers & colors in the inspector (applies live)
3. **Ask the AI** — type bigger changes into *Instructions for AI*, then say "check the studio notes" in chat
4. When the AI edits the file, the browser hot-reloads instantly

Works without a scene JSON too: any `.riv` can be edited property-by-property through the hierarchy + inspector.

## Character animation

Turn a single character PNG into a naturally moving `.riv`:

- `riv_slice_image` cuts out ears/tail/etc. by polygon, `riv_rig_character` assembles the whole rig in one call: pivot groups, a seamless 2-bone head mesh for tilting, vector eyelid blink, idle/happy animations and a `happy` trigger
- Or compose manually with `riv_create`: image embedding, grid meshes with per-vertex keyframes, bone chains with distance-weighted skinning, IK constraints

## Example prompts

- "List the riv files in `samples/` and inspect vehicles.riv"
- "Render the `curves` animation as a GIF"
- "Create a riv of falling snow over a night sky and open it in the studio"
- "Rig `characters/cat.png` — ears and tail should move, and it should look happy on click"
- "Check the studio notes" *(after typing feedback into the Studio UI)*
- "Write the React integration code for this file"

## Development

```bash
npm run build      # vendor runtime assets + tsc
npm run test:e2e   # spawns the real server, exercises all 18 tools over JSON-RPC (48 checks)
```

`docs/riv-format.md` documents the reverse-engineered knowledge of the `.riv` binary format used by the writer (typeKeys/propertyKeys resolved from the official `rive-runtime` type definitions vendored in `vendor/rive-defs/defs.json`).

## Limitations

- Text-run enumeration is not exposed by the runtime API (access by name works)
- GIF output has no transparency (composited on a background color)
- The Canvas2D preview renderer can show mesh seams that don't exist in the file (WebGL/Skia render clean)
- Luau scripting and the Layout engine are not generated (runtime spec still moving)

## License

**Free to use** (personal & commercial) — but **not open source**. This is source-available freeware:

- ✅ Use the software freely; the `.riv` files and code it generates are yours without restriction
- ❌ No modification, no redistribution, no derivative works
- ❌ No reverse engineering; no AI-assisted analysis, extraction or reproduction of the code (including use as training data)

See [LICENSE](./LICENSE) for the exact terms. Bundled third-party components: Inter font (OFL 1.1), Rive runtime & type definitions (MIT, © Rive, Inc.).

*rive-mcp is an unofficial tool and is not affiliated with or endorsed by Rive, Inc.*
