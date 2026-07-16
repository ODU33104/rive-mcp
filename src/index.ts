#!/usr/bin/env node
// rive-mcp: エディタ不要・無料・ローカル完結の Rive (.riv) MCP サーバー
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, statSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join, basename, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { RiveHost } from "./riveHost.js";
import { PAGE_SCRIPT } from "./pageScript.js";
import { encodeGif } from "./gif.js";
import { encodeApng } from "./apng.js";
import { generateCode, type Framework } from "./codegen.js";
import { readRiv } from "./rivBinary.js";
import { createRiv, type SceneSpec } from "./rivWriter.js";
import { editRiv, type EditOp } from "./rivEdit.js";
import { extractAssets } from "./rivAssets.js";
import { startStudio, stopStudio, takeStudioNotes } from "./studio.js";
import { buildCharacterRig } from "./rigCharacter.js";

const host = new RiveHost(PAGE_SCRIPT);

const server = new McpServer({
  name: "rive-mcp",
  version: "0.1.0",
});

type ToolResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  isError?: boolean;
};

function err(message: string): ToolResult {
  // page.evaluate のプレフィックスとスタックトレースを除去して本質だけ返す
  const clean = message
    .replace(/^page\.evaluate:\s*/i, "")
    .replace(/^Error:\s*/, "")
    .split("\n    at ")[0]
    .trim();
  return { content: [{ type: "text", text: `Error: ${clean}` }], isError: true };
}

function loadRiv(path: string): { bytes: Buffer; abs: string } {
  const abs = resolve(path);
  if (!existsSync(abs)) throw new Error(`File not found: ${abs}`);
  const bytes = readFileSync(abs);
  if (bytes.length < 4 || bytes.toString("latin1", 0, 4) !== "RIVE") {
    throw new Error(`Not a .riv file (missing RIVE fingerprint): ${abs}`);
  }
  return { bytes, abs };
}

// .riv ヘッダ: "RIVE" + varuint(major) + varuint(minor) + varuint(fileId)
function readHeader(bytes: Buffer): { major: number; minor: number } | null {
  if (bytes.length < 6 || bytes.toString("latin1", 0, 4) !== "RIVE") return null;
  let pos = 4;
  const varuint = () => {
    let result = 0;
    let shift = 0;
    while (pos < bytes.length) {
      const b = bytes[pos++];
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result;
      shift += 7;
    }
    return result;
  };
  const major = varuint();
  const minor = varuint();
  return { major, minor };
}

function wrap<A extends unknown[]>(fn: (...args: A) => Promise<ToolResult>) {
  return async (...args: A): Promise<ToolResult> => {
    try {
      return await fn(...args);
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e));
    }
  };
}

// ---- riv_list ----------------------------------------------------------
server.registerTool(
  "riv_list",
  {
    title: "List .riv files",
    description:
      "Recursively find .riv files under a directory and report size and format version for each.",
    inputSchema: {
      dir: z.string().describe("Directory to search (absolute or relative)"),
    },
  },
  wrap(async ({ dir }: { dir: string }) => {
    const root = resolve(dir);
    if (!existsSync(root)) return err(`Directory not found: ${root}`);
    const found: Array<{ path: string; sizeKB: number; format: string }> = [];
    const walk = (d: string, depth: number) => {
      if (depth > 6 || found.length >= 200) return;
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const p = join(d, entry.name);
        if (entry.isDirectory()) walk(p, depth + 1);
        else if (entry.name.toLowerCase().endsWith(".riv")) {
          const bytes = readFileSync(p);
          const h = readHeader(bytes);
          found.push({
            path: p,
            sizeKB: Math.round(statSync(p).size / 102.4) / 10,
            format: h ? `${h.major}.${h.minor}` : "invalid",
          });
        }
      }
    };
    walk(root, 0);
    return {
      content: [
        {
          type: "text",
          text: found.length
            ? JSON.stringify(found, null, 2)
            : `No .riv files found under ${root}`,
        },
      ],
    };
  })
);

// ---- riv_inspect -------------------------------------------------------
server.registerTool(
  "riv_inspect",
  {
    title: "Inspect a .riv file",
    description:
      "Extract full metadata from a .riv file: artboards, animations (duration/fps/loop), state machines and their inputs (name/type/initial value). Uses the official Rive runtime.",
    inputSchema: {
      path: z.string().describe("Path to the .riv file"),
    },
  },
  wrap(async ({ path }: { path: string }) => {
    const { bytes, abs } = loadRiv(path);
    const header = readHeader(bytes);
    const info = await host.inspect(bytes);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { file: abs, formatVersion: header ? `${header.major}.${header.minor}` : null, ...info },
            null,
            2
          ),
        },
      ],
    };
  })
);

// ---- riv_render_frame --------------------------------------------------
server.registerTool(
  "riv_render_frame",
  {
    title: "Render a single frame to PNG",
    description:
      "Render one frame of a .riv animation or state machine to PNG. Returns the image inline and saves it to disk.",
    inputSchema: {
      path: z.string().describe("Path to the .riv file"),
      artboard: z.string().optional().describe("Artboard name (default: first)"),
      animation: z.string().optional().describe("Linear animation name"),
      stateMachine: z.string().optional().describe("State machine name (takes precedence)"),
      time: z.number().optional().describe("Seconds to advance before capturing (default 0)"),
      width: z.number().int().positive().max(4096).optional(),
      height: z.number().int().positive().max(4096).optional(),
      background: z.string().optional().describe("CSS background color (default: transparent)"),
      outPath: z.string().optional().describe("Output PNG path (default: alongside the .riv)"),
    },
  },
  wrap(
    async (a: {
      path: string;
      artboard?: string;
      animation?: string;
      stateMachine?: string;
      time?: number;
      width?: number;
      height?: number;
      background?: string;
      outPath?: string;
    }) => {
      const { bytes, abs } = loadRiv(a.path);
      const result = await host.renderFrames(bytes, {
        artboard: a.artboard,
        animation: a.animation,
        stateMachine: a.stateMachine,
        startTime: a.time ?? 0,
        frameCount: 1,
        width: a.width,
        height: a.height,
        background: a.background,
        format: "png",
      });
      const png = result.frames[0];
      const out = resolve(
        a.outPath ??
          join(dirname(abs), `${basename(abs, extname(abs))}.frame.png`)
      );
      writeFileSync(out, Buffer.from(png, "base64"));
      return {
        content: [
          {
            type: "text",
            text: `Rendered ${result.width}x${result.height} frame at t=${a.time ?? 0}s -> ${out}`,
          },
          { type: "image", data: png, mimeType: "image/png" },
        ],
      };
    }
  )
);

// ---- riv_render_gif ----------------------------------------------------
server.registerTool(
  "riv_render_gif",
  {
    title: "Render an animation to GIF",
    description:
      "Render a .riv animation (or state machine idle playback) to an animated GIF file for preview.",
    inputSchema: {
      path: z.string().describe("Path to the .riv file"),
      artboard: z.string().optional(),
      animation: z.string().optional().describe("Animation name (default: first state machine or animation)"),
      stateMachine: z.string().optional(),
      duration: z.number().positive().max(30).optional().describe("Seconds to render (default 2)"),
      fps: z.number().int().positive().max(60).optional().describe("Frames per second (default 20)"),
      width: z.number().int().positive().max(2048).optional().describe("Output width (default: artboard width, capped 800)"),
      background: z.string().optional().describe("CSS background color (default white — GIF has no alpha)"),
      outPath: z.string().optional().describe("Output GIF path (default: alongside the .riv)"),
    },
  },
  wrap(
    async (a: {
      path: string;
      artboard?: string;
      animation?: string;
      stateMachine?: string;
      duration?: number;
      fps?: number;
      width?: number;
      background?: string;
      outPath?: string;
    }) => {
      const { bytes, abs } = loadRiv(a.path);
      const fps = a.fps ?? 20;
      const duration = a.duration ?? 2;
      const frameCount = Math.min(Math.round(fps * duration), 600);
      const result = await host.renderFrames(bytes, {
        artboard: a.artboard,
        animation: a.animation,
        stateMachine: a.stateMachine,
        startTime: 0,
        frameCount,
        fps,
        width: a.width ?? 480,
        background: a.background ?? "#ffffff",
        format: "rgba",
      });
      const gif = encodeGif(
        result.frames.map((f) => Buffer.from(f, "base64")),
        result.width,
        result.height,
        fps
      );
      const out = resolve(
        a.outPath ?? join(dirname(abs), `${basename(abs, extname(abs))}.preview.gif`)
      );
      writeFileSync(out, gif);
      return {
        content: [
          {
            type: "text",
            text:
              `Rendered ${frameCount} frames (${result.width}x${result.height}, ${fps}fps, ${duration}s) -> ${out}` +
              ` (${Math.round(gif.length / 1024)} KB)` +
              (result.states.length
                ? `\nState changes: ${JSON.stringify(result.states)}`
                : ""),
          },
        ],
      };
    }
  )
);

// ---- riv_render_apng ---------------------------------------------------
server.registerTool(
  "riv_render_apng",
  {
    title: "Render an animation to APNG",
    description:
      "Render a .riv animation (or state machine playback) to an animated PNG (APNG). Unlike GIF this supports 24-bit color plus full alpha transparency, and GitHub READMEs animate it like a regular image. Frames are rendered with a transparent background by default.",
    inputSchema: {
      path: z.string().describe("Path to the .riv file"),
      artboard: z.string().optional(),
      animation: z.string().optional().describe("Animation name (default: first state machine or animation)"),
      stateMachine: z.string().optional(),
      duration: z.number().positive().max(30).optional().describe("Seconds to render (default 2)"),
      fps: z.number().int().positive().max(60).optional().describe("Frames per second (default 20)"),
      width: z.number().int().positive().max(2048).optional().describe("Output width (default 480)"),
      height: z.number().int().positive().max(2048).optional(),
      transparent: z.boolean().optional().describe("Render on a transparent background to keep APNG alpha (default true). Set false to composite onto 'background'"),
      background: z.string().optional().describe("CSS background color when transparent=false (default #ffffff)"),
      loops: z.number().int().min(0).optional().describe("Loop count (0 = infinite, default 0)"),
      out: z.string().optional().describe("Output path, .apng or .png (default: <name>.apng alongside the .riv)"),
    },
  },
  wrap(
    async (a: {
      path: string;
      artboard?: string;
      animation?: string;
      stateMachine?: string;
      duration?: number;
      fps?: number;
      width?: number;
      height?: number;
      transparent?: boolean;
      background?: string;
      loops?: number;
      out?: string;
    }) => {
      const { bytes, abs } = loadRiv(a.path);
      const fps = a.fps ?? 20;
      const duration = a.duration ?? 2;
      const frameCount = Math.min(Math.round(fps * duration), 600);
      const transparent = a.transparent ?? true;
      const result = await host.renderFrames(bytes, {
        artboard: a.artboard,
        animation: a.animation,
        stateMachine: a.stateMachine,
        startTime: 0,
        frameCount,
        fps,
        width: a.width ?? 480,
        height: a.height,
        background: transparent ? undefined : a.background ?? "#ffffff",
        format: "png",
      });
      const apng = encodeApng(
        result.frames.map((f) => new Uint8Array(Buffer.from(f, "base64"))),
        { delayMs: Math.round(1000 / fps), loops: a.loops ?? 0 }
      );
      const out = resolve(
        a.out ?? join(dirname(abs), `${basename(abs, extname(abs))}.apng`)
      );
      writeFileSync(out, apng);
      return {
        content: [
          {
            type: "text",
            text:
              `Rendered ${frameCount} frames (${result.width}x${result.height}, ${fps}fps, ${duration}s, ` +
              `${transparent ? "transparent" : `background ${a.background ?? "#ffffff"}`}) -> ${out}` +
              ` (${Math.round(apng.length / 1024)} KB)` +
              (result.states.length ? `\nState changes: ${JSON.stringify(result.states)}` : ""),
          },
        ],
      };
    }
  )
);

// ---- riv_play_state_machine -------------------------------------------
const stepSchema = z.object({
  input: z.string().optional().describe("Input name to set/fire before advancing"),
  value: z.union([z.number(), z.boolean()]).optional().describe("Value for number/boolean inputs"),
  advance: z.number().min(0).max(30).optional().describe("Seconds to advance (default 0)"),
  capture: z.boolean().optional().describe("Capture a PNG frame after this step"),
});

server.registerTool(
  "riv_play_state_machine",
  {
    title: "Interactively drive a state machine",
    description:
      "Run a .riv state machine step by step: set/fire inputs, advance time, observe state transitions, and optionally capture frames. Returns a transition report.",
    inputSchema: {
      path: z.string().describe("Path to the .riv file"),
      stateMachine: z.string().optional().describe("State machine name (default: first)"),
      artboard: z.string().optional(),
      steps: z.array(stepSchema).max(50).describe("Sequence of interaction steps"),
      width: z.number().int().positive().max(2048).optional(),
      background: z.string().optional(),
    },
  },
  wrap(
    async (a: {
      path: string;
      stateMachine?: string;
      artboard?: string;
      steps: Array<{ input?: string; value?: number | boolean; advance?: number; capture?: boolean }>;
      width?: number;
      background?: string;
    }) => {
      const { bytes } = loadRiv(a.path);
      // stateMachine 未指定時はページ側で先頭SMを使う
      const info = a.stateMachine
        ? null
        : await host.inspect(bytes);
      const smName =
        a.stateMachine ??
        info?.artboards.find((ab) => ab.stateMachines.length > 0)?.stateMachines[0]?.name;
      if (!smName) return err("No state machine found in this file");
      const result = await host.playStateMachine(bytes, {
        artboard: a.artboard,
        stateMachine: smName,
        steps: a.steps,
        width: a.width ?? 480,
        background: a.background,
      });
      const content: ToolResult["content"] = [
        {
          type: "text",
          text: JSON.stringify({ stateMachine: smName, report: result.report }, null, 2),
        },
      ];
      for (const frame of result.frames) {
        content.push({ type: "image", data: frame, mimeType: "image/png" });
      }
      return { content };
    }
  )
);

// ---- riv_generate_code -------------------------------------------------
server.registerTool(
  "riv_generate_code",
  {
    title: "Generate integration code",
    description:
      "Generate ready-to-use integration code (React/Vue/Svelte/plain JS/Flutter) for a .riv file, using its real artboard, state machine and input names.",
    inputSchema: {
      path: z.string().describe("Path to the .riv file"),
      framework: z.enum(["react", "js", "vue", "svelte", "flutter"]),
    },
  },
  wrap(async ({ path, framework }: { path: string; framework: Framework }) => {
    const { bytes, abs } = loadRiv(path);
    const info = await host.inspect(bytes);
    const code = generateCode(framework, basename(abs), info);
    return { content: [{ type: "text", text: code }] };
  })
);

// ---- riv_dump ----------------------------------------------------------
server.registerTool(
  "riv_dump",
  {
    title: "Dump .riv binary structure",
    description:
      "Low-level dump of a .riv file's object stream (typeKeys, property values, hierarchy). Useful for debugging and format research. Large files return a summary unless full=true.",
    inputSchema: {
      path: z.string().describe("Path to the .riv file"),
      full: z.boolean().optional().describe("Return every object (default: summary + first 50)"),
    },
  },
  wrap(async ({ path, full }: { path: string; full?: boolean }) => {
    const { bytes } = loadRiv(path);
    const dump = readRiv(bytes, { tolerant: true });
    const counts: Record<string, number> = {};
    for (const o of dump.objects) counts[o.typeName] = (counts[o.typeName] ?? 0) + 1;
    const body = {
      version: `${dump.major}.${dump.minor}`,
      objectCount: dump.objects.length,
      typeCounts: counts,
      parseError: dump.error ?? null,
      objects: full ? dump.objects : dump.objects.slice(0, 50),
    };
    return { content: [{ type: "text", text: JSON.stringify(body, null, 1) }] };
  })
);

// ---- riv_create --------------------------------------------------------
server.registerTool(
  "riv_create",
  {
    title: "Create a .riv file from a scene spec",
    description: `Create a working .riv animation file from scratch (no Rive editor needed) and validate it with the official runtime. Returns a rendered preview frame.
Scene spec example:
{
  "artboard": {"name":"Demo","width":400,"height":300},
  "backgroundColor": "#1a1a2e",
  "shapes": [
    {"id":"box","type":"rect","x":120,"y":150,"width":80,"height":80,"cornerRadius":12,"rotation":0,"opacity":1,
     "fill":{"color":"#e94560"},"stroke":{"color":"#fff","thickness":3}},
    {"id":"ball","type":"ellipse","x":280,"y":150,"width":70,"height":70,
     "fill":{"gradient":{"type":"linear","stops":[{"color":"#00d9ff"},{"color":"#0066ff"}]}}},
    {"id":"tri","type":"polygon","x":200,"y":100,"points":[{"x":0,"y":-40},{"x":35,"y":20},{"x":-35,"y":20}],"fill":{"color":"#ffd700"}}
  ],
  "animations": [
    {"name":"spin","fps":60,"duration":60,"loop":"loop","tracks":[
      {"target":"box","property":"rotation","keyframes":[{"frame":0,"value":0},{"frame":60,"value":360,"easing":"linear"}]},
      {"target":"ball","property":"y","keyframes":[{"frame":0,"value":150},{"frame":30,"value":80,"easing":"ease-out"},{"frame":60,"value":150,"easing":"ease-in"}]}
    ]}
  ],
  "stateMachine": {"name":"SM","inputs":[{"name":"go","type":"bool"}],
    "states":[{"name":"spinning","animation":"spin"}],
    "transitions":[{"from":"entry","to":"spinning","condition":{"input":"go"}}]}
}
Character animation (images/groups/mesh):
{
  "groups": [{"id":"rig","x":300,"y":200}],
  "images": [{"id":"chara","pngPath":"./cat.png","x":0,"y":0,"scale":0.25,"parent":"rig",
    "mesh":{"columns":6,"rows":6}}],
  "animations": [{"name":"idle","duration":240,"loop":"loop","tracks":[
    {"target":"rig","property":"y","keyframes":[{"frame":0,"value":200},{"frame":120,"value":195,"easing":"ease-in-out"},{"frame":240,"value":200,"easing":"ease-in-out"}]},
    {"target":"chara#v0_3","property":"x","keyframes":[{"frame":0,"value":0},{"frame":120,"value":40,"easing":"ease-in-out"},{"frame":240,"value":0,"easing":"ease-in-out"}]}
  ]}]
}
- images[].pngPath: PNG file embedded into the .riv. mesh enables vertex deformation; vertices addressed as "<imageId>#v<row>_<col>" (row 0 = top), coordinates in the image's natural pixel space centered at origin. Mesh vertex tracks support x/y only.
- groups are Nodes usable as parents (parent) of shapes/images for rig hierarchies and pivots; animatable like shapes.
- transitions support exitTimeMs (play source animation this long before transitioning).
Shape z-order: later in array = on top; images render above shapes. properties for tracks: x,y,rotation(deg),scaleX,scaleY,opacity(0-1),width,height,fillColor(needs "color" in keyframes). Colors: #RRGGBB or #AARRGGBB. rotation in degrees.`,
    inputSchema: {
      outPath: z.string().describe("Output .riv path"),
      scene: z.record(z.unknown()).describe("Scene spec (see tool description for schema)"),
      previewTime: z.number().optional().describe("Seconds into first animation for the preview frame (default 0.4)"),
    },
  },
  wrap(
    async ({ outPath, scene, previewTime }: { outPath: string; scene: Record<string, unknown>; previewTime?: number }) => {
      const spec = scene as unknown as SceneSpec;
      // pngPath/フォントpath → bytes 解決（cwd 基準）
      const imageLists = [spec.images ?? [], ...(spec.artboards ?? []).map((a) => a.images ?? [])];
      for (const img of imageLists.flat()) {
        if (!img.bytes && img.pngPath) {
          const p = resolve(img.pngPath);
          if (!existsSync(p)) return err(`Image file not found: ${p}`);
          img.bytes = new Uint8Array(readFileSync(p));
        }
      }
      for (const font of spec.fonts ?? []) {
        if (!font.bytes) {
          // path 省略時は同梱 Inter (OFL) を使用
          const p = font.path
            ? resolve(font.path)
            : join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "inter.ttf");
          if (!existsSync(p)) return err(`Font file not found: ${p}`);
          font.bytes = new Uint8Array(readFileSync(p));
        }
      }
      const { bytes, warnings } = createRiv(spec);
      const out = resolve(outPath);
      writeFileSync(out, bytes);
      // 公式ランタイムで検証 + プレビュー
      const buf = Buffer.from(bytes);
      const info = await host.inspect(buf);
      const anim = info.artboards[0]?.animations[0];
      const r = await host.renderFrames(buf, {
        animation: anim?.name,
        startTime: previewTime ?? 0.4,
        frameCount: 1,
        format: "png",
      });
      return {
        content: [
          {
            type: "text",
            text:
              `Created ${out} (${bytes.length} bytes) — validated with official Rive runtime.\n` +
              JSON.stringify(info, null, 1) +
              (warnings.length ? `\nWarnings: ${warnings.join("; ")}` : ""),
          },
          { type: "image", data: r.frames[0], mimeType: "image/png" },
        ],
      };
    }
  )
);

// ---- riv_edit ----------------------------------------------------------
server.registerTool(
  "riv_edit",
  {
    title: "Edit an existing .riv file",
    description:
      "Modify an existing .riv (lossless roundtrip): set any property, change named text runs, delete objects (with automatic subtree + reference remapping), or edit keyframes on an existing animation (op=setKeyframes). Use riv_dump to find object indices/names. Renders a preview of the result.\n" +
      "setKeyframes: target an animated object via index/name(+type), give 'animation' (LinearAnimation name) and 'property' (x/y/rotation/scaleX/scaleY/opacity/width/height — rotation in degrees), then 'keyframes' (array of {frame,value,easing}). 'mode': replace (default, swaps the whole track) | add (appends keyframes, creating the track if absent) | remove (deletes keyframes matching the given frame numbers; keyframes[].value/easing are ignored).",
    inputSchema: {
      path: z.string().describe("Source .riv path"),
      outPath: z.string().optional().describe("Output path (default: overwrite source)"),
      edits: z.array(
        z.object({
          op: z.enum(["set", "setText", "delete", "setKeyframes"]),
          index: z.number().int().optional().describe("Target by riv_dump global index"),
          name: z.string().optional().describe("Target by object name (setText: run name; setKeyframes: animated object name)"),
          type: z.string().optional().describe("Filter by typeName when targeting by name"),
          set: z.record(z.unknown()).optional().describe("op=set: property name -> value (colors as #RRGGBB)"),
          text: z.string().optional().describe("op=setText: new text"),
          animation: z.string().optional().describe("op=setKeyframes: LinearAnimation name"),
          property: z.enum(["x", "y", "rotation", "scaleX", "scaleY", "opacity", "width", "height"]).optional()
            .describe("op=setKeyframes: animated property (rotation in degrees)"),
          keyframes: z.array(
            z.object({
              frame: z.number().int().min(0),
              value: z.number().optional(),
              easing: z.enum(["hold", "linear", "ease", "ease-in", "ease-out", "ease-in-out", "ease-out-back", "ease-in-back", "smooth", "snap"]).optional(),
            })
          ).optional().describe("op=setKeyframes: keyframe list (value required unless mode=remove)"),
          mode: z.enum(["replace", "add", "remove"]).optional().describe("op=setKeyframes: default replace"),
        })
      ).min(1),
    },
  },
  wrap(async ({ path, outPath, edits }: { path: string; outPath?: string; edits: EditOp[] }) => {
    const { bytes, abs } = loadRiv(path);
    const result = editRiv(bytes, edits);
    const out = resolve(outPath ?? abs);
    writeFileSync(out, result.bytes);
    const r = await host.renderFrames(Buffer.from(result.bytes), { frameCount: 1, format: "png" });
    return {
      content: [
        { type: "text", text: `Edited -> ${out}\n${result.log.join("\n")}` },
        { type: "image", data: r.frames[0], mimeType: "image/png" },
      ],
    };
  })
);

// ---- riv_slice_image ---------------------------------------------------
server.registerTool(
  "riv_slice_image",
  {
    title: "Slice a PNG into parts for rigging",
    description:
      "Cut polygon regions out of a character PNG for parts-based rigging (cutout animation). Writes each part as <name>.png plus base.png (source with parts erased) into outDir, and returns each part's bbox for placement. Use with riv_create: images per part + groups as pivots.",
    inputSchema: {
      pngPath: z.string().describe("Source PNG path"),
      outDir: z.string().describe("Directory to write part PNGs into"),
      regions: z
        .array(
          z.object({
            name: z.string(),
            polygon: z.array(z.tuple([z.number(), z.number()])).min(3)
              .describe("Polygon vertices in source image pixel coords"),
            keepInBase: z.boolean().optional().describe("Don't erase this region from base.png"),
          })
        )
        .min(1),
    },
  },
  wrap(
    async ({ pngPath, outDir, regions }: {
      pngPath: string;
      outDir: string;
      regions: Array<{ name: string; polygon: Array<[number, number]>; keepInBase?: boolean }>;
    }) => {
      const src = resolve(pngPath);
      if (!existsSync(src)) return err(`PNG not found: ${src}`);
      const dir = resolve(outDir);
      mkdirSync(dir, { recursive: true });
      const result = await host.sliceImage(readFileSync(src), regions);
      const placements: Record<string, unknown>[] = [];
      for (const p of result.parts) {
        writeFileSync(join(dir, `${p.name}.png`), Buffer.from(p.png, "base64"));
        placements.push({ name: p.name, x: p.x, y: p.y, width: p.width, height: p.height,
          centerX: p.x + p.width / 2, centerY: p.y + p.height / 2 });
      }
      writeFileSync(join(dir, "base.png"), Buffer.from(result.base, "base64"));
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            sourceSize: { width: result.width, height: result.height },
            written: [...result.parts.map((p) => join(dir, `${p.name}.png`)), join(dir, "base.png")],
            placements,
          }, null, 1),
        }],
      };
    }
  )
);

// ---- riv_rig_character -------------------------------------------------
server.registerTool(
  "riv_rig_character",
  {
    title: "Auto-rig a character PNG",
    description:
      "One call: character PNG -> fully rigged .riv with cutout parts (ears/tail via polygons), 2-bone head-tilt mesh (seamless), vector eyelid blink, idle + happy animations, and a state machine with a 'happy' trigger. Returns a preview. Fine-tune afterwards with riv_edit or riv_studio.",
    inputSchema: {
      pngPath: z.string().describe("Character PNG (transparent background recommended)"),
      outPath: z.string().describe("Output .riv path"),
      parts: z.record(
        z.object({
          polygon: z.array(z.tuple([z.number(), z.number()])).min(3).describe("Region in image px coords"),
          pivot: z.tuple([z.number(), z.number()]).optional().describe("Attachment point (default: bottom-center of bbox)"),
          behindBody: z.boolean().optional().describe("Draw behind the body (e.g. tail)"),
        })
      ).optional().describe("Named cutout parts, e.g. {earL, earR, tail}. Names containing 'ear' attach to the head"),
      eyes: z.array(
        z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
      ).optional().describe("Eye rects in image px coords (generates blink overlays)"),
      artboardWidth: z.number().optional(),
      artboardHeight: z.number().optional(),
      backgroundColor: z.string().optional(),
      furColor: z.string().optional().describe("Eyelid/patch color matching the fur (default #f8eee2)"),
      headRatio: z.number().optional().describe("Top fraction of the image that is 'head' (default 0.45)"),
    },
  },
  wrap(
    async (a: {
      pngPath: string;
      outPath: string;
      parts?: Record<string, { polygon: Array<[number, number]>; pivot?: [number, number]; behindBody?: boolean }>;
      eyes?: Array<{ x: number; y: number; width: number; height: number }>;
      artboardWidth?: number;
      artboardHeight?: number;
      backgroundColor?: string;
      furColor?: string;
      headRatio?: number;
    }) => {
      const src = resolve(a.pngPath);
      if (!existsSync(src)) return err(`PNG not found: ${src}`);
      const png = readFileSync(src);
      const regions = Object.entries(a.parts ?? {}).map(([name, def]) => ({ name, polygon: def.polygon }));
      const sliced = regions.length
        ? await host.sliceImage(png, regions)
        : { base: png.toString("base64"), parts: [] as Array<{ name: string; x: number; y: number; width: number; height: number; png: string }> };
      const spec = buildCharacterRig(new Uint8Array(png), sliced, {
        artboardWidth: a.artboardWidth,
        artboardHeight: a.artboardHeight,
        backgroundColor: a.backgroundColor,
        furColor: a.furColor,
        headRatio: a.headRatio,
        parts: a.parts,
        eyes: a.eyes,
      });
      const { bytes } = createRiv(spec);
      const out = resolve(a.outPath);
      writeFileSync(out, bytes);
      const info = await host.inspect(Buffer.from(bytes));
      const r = await host.renderFrames(Buffer.from(bytes), {
        animation: "idle", startTime: 1.7, frameCount: 1, format: "png",
      });
      return {
        content: [
          {
            type: "text",
            text:
              `Rigged character -> ${out} (${bytes.length} bytes)\n` +
              `Parts: ${regions.map((r2) => r2.name).join(", ") || "(none)"} / Eyes: ${a.eyes?.length ?? 0}\n` +
              `Animations: idle(blink/breath/tilt), happy(trigger). SM input: happy\n` +
              JSON.stringify(info.artboards[0]?.stateMachines ?? []),
          },
          { type: "image", data: r.frames[0], mimeType: "image/png" },
        ],
      };
    }
  )
);

// ---- riv_diff ----------------------------------------------------------
server.registerTool(
  "riv_diff",
  {
    title: "Diff two .riv files",
    description: "Structural diff between two .riv files: type count changes and per-object property differences.",
    inputSchema: {
      pathA: z.string(),
      pathB: z.string(),
      maxDiffs: z.number().int().optional().describe("Max object diffs to list (default 30)"),
    },
  },
  wrap(async ({ pathA, pathB, maxDiffs }: { pathA: string; pathB: string; maxDiffs?: number }) => {
    const a = readRiv(loadRiv(pathA).bytes, { tolerant: true });
    const b = readRiv(loadRiv(pathB).bytes, { tolerant: true });
    const countOf = (d: typeof a) => {
      const c: Record<string, number> = {};
      for (const o of d.objects) c[o.typeName] = (c[o.typeName] ?? 0) + 1;
      return c;
    };
    const ca = countOf(a), cb = countOf(b);
    const typeDiff: string[] = [];
    for (const t of new Set([...Object.keys(ca), ...Object.keys(cb)])) {
      if ((ca[t] ?? 0) !== (cb[t] ?? 0)) typeDiff.push(`${t}: ${ca[t] ?? 0} -> ${cb[t] ?? 0}`);
    }
    const diffs: string[] = [];
    const limit = maxDiffs ?? 30;
    const n = Math.min(a.objects.length, b.objects.length);
    for (let i = 0; i < n && diffs.length < limit; i++) {
      const oa = a.objects[i], ob = b.objects[i];
      if (oa.typeName !== ob.typeName) {
        diffs.push(`#${i}: type ${oa.typeName} -> ${ob.typeName}`);
        continue;
      }
      const ja = JSON.stringify(oa.properties), jb = JSON.stringify(ob.properties);
      if (ja !== jb) {
        const changed: string[] = [];
        for (const k of new Set([...Object.keys(oa.properties), ...Object.keys(ob.properties)])) {
          if (JSON.stringify(oa.properties[k]) !== JSON.stringify(ob.properties[k])) {
            changed.push(`${k}: ${JSON.stringify(oa.properties[k])} -> ${JSON.stringify(ob.properties[k])}`);
          }
        }
        diffs.push(`#${i} ${oa.typeName}(${oa.properties.name ?? ""}): ${changed.join(", ")}`);
      }
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          objectCount: { a: a.objects.length, b: b.objects.length },
          typeCountChanges: typeDiff,
          objectDiffs: diffs,
          truncated: diffs.length >= limit,
        }, null, 1),
      }],
    };
  })
);

// ---- riv_render_video ---------------------------------------------------
server.registerTool(
  "riv_render_video",
  {
    title: "Render an animation to a WebM video",
    description:
      "Render a .riv animation (or state machine) to a real-time WebM video using canvas.captureStream() + MediaRecorder (VP9, falls back to VP8/generic webm). Default duration is one loop of the animation (2s for a bare state machine or when the animation's length can't be determined).",
    inputSchema: {
      path: z.string().describe("Path to the .riv file"),
      artboard: z.string().optional(),
      animation: z.string().optional(),
      stateMachine: z.string().optional(),
      duration: z.number().positive().max(30).optional().describe("Seconds to record (default: one animation loop, or 2s)"),
      fps: z.number().int().positive().max(60).optional().describe("captureStream() frame rate (default 30)"),
      width: z.number().int().positive().max(2048).optional(),
      height: z.number().int().positive().max(2048).optional(),
      background: z.string().optional().describe("CSS background color (default: transparent)"),
      out: z.string().optional().describe("Output .webm path (default: alongside the .riv)"),
    },
  },
  wrap(
    async (a: {
      path: string;
      artboard?: string;
      animation?: string;
      stateMachine?: string;
      duration?: number;
      fps?: number;
      width?: number;
      height?: number;
      background?: string;
      out?: string;
    }) => {
      const { bytes, abs } = loadRiv(a.path);
      let duration = a.duration;
      if (duration === undefined) {
        if (a.stateMachine) {
          duration = 2;
        } else {
          const info = await host.inspect(bytes);
          const ab = info.artboards.find((x) => x.name === a.artboard) ?? info.artboards[0];
          const anim = ab?.animations.find((x) => x.name === a.animation) ?? ab?.animations[0];
          duration = anim?.durationSeconds ?? 2;
        }
      }
      const fps = a.fps ?? 30;
      const result = await host.renderVideo(bytes, {
        artboard: a.artboard,
        animation: a.animation,
        stateMachine: a.stateMachine,
        duration,
        fps,
        width: a.width,
        height: a.height,
        background: a.background,
      });
      const out = resolve(a.out ?? join(dirname(abs), `${basename(abs, extname(abs))}.webm`));
      writeFileSync(out, Buffer.from(result.base64, "base64"));
      return {
        content: [
          {
            type: "text",
            text:
              `Recorded ${result.durationSeconds.toFixed(2)}s, ${result.estimatedFrames} frames (${result.width}x${result.height}, ${result.mimeType}) -> ${out}` +
              ` (${Math.round(result.byteLength / 1024)} KB)`,
          },
        ],
      };
    }
  )
);

// ---- riv_render_sprites --------------------------------------------------
server.registerTool(
  "riv_render_sprites",
  {
    title: "Render an animation to a sprite sheet PNG",
    description:
      "Render N evenly-spaced frames of a .riv animation/state machine into a single grid sprite sheet PNG (columns = ceil(sqrt(N))). Writes the PNG plus a JSON metadata file (cellW/cellH/cols/rows/count/fps) alongside.",
    inputSchema: {
      path: z.string().describe("Path to the .riv file"),
      artboard: z.string().optional(),
      animation: z.string().optional(),
      stateMachine: z.string().optional(),
      count: z.number().int().positive().max(256).optional().describe("Number of frames (default 16)"),
      duration: z.number().positive().max(30).optional().describe("Seconds spanned by the frames (default: one animation loop, or 2s)"),
      fps: z.number().int().positive().max(60).optional().describe("Metadata playback fps (default: count/duration)"),
      width: z.number().int().positive().max(2048).optional(),
      height: z.number().int().positive().max(2048).optional(),
      background: z.string().optional(),
      out: z.string().optional().describe("Output PNG path (default: alongside the .riv); metadata is written next to it with a .json extension"),
    },
  },
  wrap(
    async (a: {
      path: string;
      artboard?: string;
      animation?: string;
      stateMachine?: string;
      count?: number;
      duration?: number;
      fps?: number;
      width?: number;
      height?: number;
      background?: string;
      out?: string;
    }) => {
      const { bytes, abs } = loadRiv(a.path);
      let duration = a.duration;
      if (duration === undefined) {
        if (a.stateMachine) {
          duration = 2;
        } else {
          const info = await host.inspect(bytes);
          const ab = info.artboards.find((x) => x.name === a.artboard) ?? info.artboards[0];
          const anim = ab?.animations.find((x) => x.name === a.animation) ?? ab?.animations[0];
          duration = anim?.durationSeconds ?? 2;
        }
      }
      const result = await host.renderSprites(bytes, {
        artboard: a.artboard,
        animation: a.animation,
        stateMachine: a.stateMachine,
        count: a.count ?? 16,
        duration,
        fps: a.fps,
        width: a.width,
        height: a.height,
        background: a.background,
      });
      const out = resolve(a.out ?? join(dirname(abs), `${basename(abs, extname(abs))}.sprites.png`));
      writeFileSync(out, Buffer.from(result.image, "base64"));
      const metaPath = (out.toLowerCase().endsWith(".png") ? out.slice(0, -4) : out) + ".json";
      const meta = { cellW: result.cellW, cellH: result.cellH, cols: result.cols, rows: result.rows, count: result.count, fps: result.fps };
      writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      return {
        content: [
          {
            type: "text",
            text:
              `Sprite sheet ${result.width}x${result.height} (${result.cols}x${result.rows} grid, ${result.count} frames, cell ${result.cellW}x${result.cellH}, ${result.fps}fps) -> ${out}\n` +
              `Metadata -> ${metaPath}`,
          },
          { type: "image", data: result.image, mimeType: "image/png" },
        ],
      };
    }
  )
);

// ---- riv_extract_assets --------------------------------------------------
server.registerTool(
  "riv_extract_assets",
  {
    title: "Extract embedded assets from a .riv file",
    description:
      "Extract embedded image/font/audio asset binary contents (ImageAsset/FontAsset/AudioAsset + FileAssetContents pairs) from a .riv file to disk, with the file extension inferred from magic bytes (PNG/JPEG/WEBP/TTF/OTF/WOFF/WOFF2/GIF). Externally-referenced (non-embedded) assets are skipped.",
    inputSchema: {
      path: z.string().describe("Path to the .riv file"),
      outDir: z.string().optional().describe("Output directory (default: <file>.assets alongside the .riv)"),
    },
  },
  wrap(async ({ path, outDir }: { path: string; outDir?: string }) => {
    const { bytes, abs } = loadRiv(path);
    const assets = extractAssets(bytes);
    const dir = resolve(outDir ?? join(dirname(abs), `${basename(abs, extname(abs))}.assets`));
    if (assets.length) mkdirSync(dir, { recursive: true });
    const written: Array<{ name: string; type: string; sizeKB: number; path: string }> = [];
    const usedNames = new Set<string>();
    for (const a of assets) {
      const safeName = a.name.replace(/[^\w.-]+/g, "_") || "asset";
      let fname = `${safeName}.${a.ext}`;
      let n = 1;
      while (usedNames.has(fname)) fname = `${safeName}_${n++}.${a.ext}`;
      usedNames.add(fname);
      const p = join(dir, fname);
      writeFileSync(p, Buffer.from(a.bytes));
      written.push({ name: a.name, type: a.typeName, sizeKB: Math.round(a.bytes.length / 102.4) / 10, path: p });
    }
    return {
      content: [
        {
          type: "text",
          text: written.length
            ? JSON.stringify(written, null, 2)
            : `No embedded assets found in ${abs} (assets may be externally referenced rather than embedded)`,
        },
      ],
    };
  })
);

// ---- riv_visual_diff ------------------------------------------------------
server.registerTool(
  "riv_visual_diff",
  {
    title: "Pixel-diff two .riv files",
    description:
      "Render the same artboard/animation/time from two .riv files under identical conditions (forced to the same output size) and compute a thresholded per-pixel visual diff. Returns match rate, differing pixel count, and a diff visualization PNG (differing pixels in red, matching pixels dimmed).",
    inputSchema: {
      pathA: z.string().describe("Path to the first .riv file"),
      pathB: z.string().describe("Path to the second .riv file"),
      artboard: z.string().optional(),
      animation: z.string().optional(),
      stateMachine: z.string().optional(),
      time: z.number().optional().describe("Seconds to advance before capturing (default 0)"),
      threshold: z.number().min(0).max(255).optional().describe("Max per-channel diff (0-255) still counted as a match (default 16)"),
      width: z.number().int().positive().max(2048).optional(),
      height: z.number().int().positive().max(2048).optional(),
      background: z.string().optional(),
      out: z.string().optional().describe("Output diff PNG path (default: alongside pathA)"),
    },
  },
  wrap(
    async (a: {
      pathA: string;
      pathB: string;
      artboard?: string;
      animation?: string;
      stateMachine?: string;
      time?: number;
      threshold?: number;
      width?: number;
      height?: number;
      background?: string;
      out?: string;
    }) => {
      const { bytes: bytesA, abs: absA } = loadRiv(a.pathA);
      const { bytes: bytesB, abs: absB } = loadRiv(a.pathB);
      const result = await host.visualDiff(bytesA, bytesB, {
        artboard: a.artboard,
        animation: a.animation,
        stateMachine: a.stateMachine,
        time: a.time ?? 0,
        threshold: a.threshold,
        width: a.width,
        height: a.height,
        background: a.background,
      });
      const out = resolve(a.out ?? join(dirname(absA), `${basename(absA, extname(absA))}.vs.${basename(absB)}.diff.png`));
      writeFileSync(out, Buffer.from(result.diffImage, "base64"));
      return {
        content: [
          {
            type: "text",
            text:
              `Match rate: ${result.matchRate.toFixed(2)}% (${result.diffPixels}/${result.totalPixels} differing pixels, ` +
              `threshold=${result.threshold}, ${result.width}x${result.height}) -> ${out}`,
          },
          { type: "image", data: result.diffImage, mimeType: "image/png" },
        ],
      };
    }
  )
);

// ---- riv_studio --------------------------------------------------------
server.registerTool(
  "riv_studio",
  {
    title: "Start the local Studio web UI",
    description:
      "Start a local web UI (Rive-editor-like 3-pane layout) for live-previewing and editing a .riv file: hierarchy tree + click/drag selection on canvas + inspector (position/size/color/text edits apply live), timeline with keyframe markers, hot reload on file change, auto-generated state machine input controls, event log, and (with scenePath) direct scene-JSON editing. The UI also has an 'Instructions for AI' box — fetch those with riv_studio_notes. Re-running riv_create/riv_edit on the watched file updates the browser instantly. Only one studio runs at a time.",
    inputSchema: {
      path: z.string().describe("The .riv file to preview (watched for changes)"),
      scenePath: z.string().optional().describe("Scene spec JSON path — enables the edit+rebuild panel"),
      port: z.number().int().optional().describe("Port (default 8787)"),
      stop: z.boolean().optional().describe("Stop the running studio instead"),
    },
  },
  wrap(async ({ path, scenePath, port, stop }: { path: string; scenePath?: string; port?: number; stop?: boolean }) => {
    if (stop) {
      stopStudio();
      return { content: [{ type: "text", text: "Studio stopped." }] };
    }
    const handle = startStudio({ rivPath: resolve(path), scenePath, port });
    return {
      content: [{
        type: "text",
        text: `Studio running at ${handle.url}\nwatching: ${resolve(path)}${scenePath ? `\nscene: ${resolve(scenePath)}` : ""}\nブラウザで開いてください。ファイルを riv_create / riv_edit で更新すると即座に反映されます。\nUI右側の「AIへの指示」に書かれた内容は riv_studio_notes で取得できます（ユーザーが「スタジオの指示を確認して」と言ったら呼ぶこと）。`,
      }],
    };
  })
);

// ---- riv_studio_notes --------------------------------------------------
server.registerTool(
  "riv_studio_notes",
  {
    title: "Fetch human instructions from the Studio UI",
    description:
      "Fetch pending instructions the user typed into the Studio web UI's 'Instructions for AI' box. Call this when the user says things like 'check the studio notes' / 「スタジオの指示を確認して」, or after opening riv_studio when the user mentions they left notes. Consumes (clears) the queue by default; the Studio UI then shows the notes were picked up. Act on each instruction (usually via riv_edit or riv_create on the watched file — changes hot-reload in the browser).",
    inputSchema: {
      port: z.number().int().optional().describe("Studio port (default 8787)"),
      peek: z.boolean().optional().describe("Read without consuming"),
    },
  },
  wrap(async ({ port, peek }: { port?: number; peek?: boolean }) => {
    const p = port ?? 8787;
    let data: { notes: Array<{ text: string; time: string }> };
    try {
      const res = await fetch(`http://localhost:${p}/notes${peek ? "" : "?consume=1"}`);
      data = (await res.json()) as typeof data;
    } catch {
      const notes = takeStudioNotes();
      if (notes === null) {
        return { content: [{ type: "text", text: `Studio is not running on port ${p}. Start it with riv_studio first.` }] };
      }
      data = { notes };
    }
    if (!data.notes.length) {
      return { content: [{ type: "text", text: "No pending instructions from the Studio UI." }] };
    }
    const lines = data.notes.map((n, i) => `${i + 1}. [${n.time.slice(11, 19)}] ${n.text}`);
    return {
      content: [{
        type: "text",
        text: `Instructions from the Studio UI (${data.notes.length}):\n${lines.join("\n")}\n\nApply them to the watched .riv (riv_edit / riv_create) — the browser hot-reloads automatically.`,
      }],
    };
  })
);

// ---- startup -----------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[rive-mcp] server started (stdio)");
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await host.close();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error("[rive-mcp] fatal:", e);
  process.exit(1);
});
