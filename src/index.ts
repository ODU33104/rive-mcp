#!/usr/bin/env node
// rive-mcp: エディタ不要・無料・ローカル完結の Rive (.riv) MCP サーバー
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, statSync, readdirSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, join, basename, dirname, extname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { RiveHost } from "./riveHost.js";
import { PAGE_SCRIPT } from "./pageScript.js";
import { encodeGif } from "./gif.js";
import { encodeApng } from "./apng.js";
import { generateCode, type Framework } from "./codegen.js";
import { readRiv } from "./rivBinary.js";
import { decodeDataBinding } from "./dataBinding.js";
import { lintRiv } from "./rivLint.js";
import { createRiv, type SceneSpec } from "./rivWriter.js";
import { editRiv, type EditOp } from "./rivEdit.js";
import { optimizeRiv } from "./rivOptimize.js";
import { extractAssets } from "./rivAssets.js";
import { startStudio, stopStudio, takeStudioNotes, postStudioReply } from "./studio.js";
import { buildCharacterRig } from "./rigCharacter.js";
import { generateTokens, paletteFromColors, type Mood } from "./designTokens.js";
import { detectUiElements, type UiElement } from "./uiDetect.js";
import { parseVectorScene, editableRatio, attachTextRasters, type VectorFont } from "./vectorScene.js";
import { fetchFigmaSvg } from "./figmaImport.js";
import { buildPrototypeScene, attachRasterAssets, ROLE_MOTION, type Role } from "./uiPrototype.js";
import { overlayLabels } from "./uiOverlay.js";
import { computeMetrics, CRITIQUE_CHECKLIST, composeFilmstrip, composeOnionSkin, encodePng, motionReport } from "./critique.js";
import { importSvg } from "./svgImport.js";
import { importLottie } from "./lottieImport.js";
import { decompileRiv } from "./rivDecompile.js";
import { runBatchRender, type BatchJobSpec } from "./batchRender.js";
import { runAbCompare, type AbCompareOptions } from "./abCompare.js";
import { FileRevisionStore, revisionSummary } from "./revisions/store.js";
import { stableJson } from "./revisions/hash.js";
import { FileReviewStore, reviewSummary } from "./review/store.js";
import { FileFinalizeStore } from "./finalize/store.js";

const host = new RiveHost(PAGE_SCRIPT);
const revisionStore = new FileRevisionStore();
const reviewStore = new FileReviewStore(revisionStore);
const finalizeStore = new FileFinalizeStore(revisionStore, reviewStore);

const server = new McpServer({
  name: "rive-mcp",
  version: "0.3.0",
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

// z.tuple() emits draft-07 tuple "items" (an array of schemas), which some
// MCP clients' JSON-schema validators reject. A length-2 number array emits
// the equivalent single-schema form; the cast keeps the [number, number]
// inferred type so handlers stay unchanged. Factory form: reusing one zod
// instance across tools would make the converter emit a $ref, which those
// validators also reject.
const point2D = () => z.array(z.number()).length(2) as unknown as z.ZodTuple<[z.ZodNumber, z.ZodNumber]>;

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
      "Extract full metadata from a .riv file: artboards, animations (duration/fps/loop), state machines and their inputs (name/type/initial value). Uses the official Rive runtime. Also decodes Data Binding (ViewModel) structure when present — ViewModel definitions and their properties, ViewModelInstances with resolved property values (including enum/nested-viewmodel/list references), enums, converters, and DataBind wiring (which target object/property each bind writes to) — via direct binary parsing (returned as `dataBinding`, omitted when the file has none).",
    inputSchema: {
      path: z.string().describe("Path to the .riv file"),
    },
  },
  wrap(async ({ path }: { path: string }) => {
    const { bytes, abs } = loadRiv(path);
    const header = readHeader(bytes);
    const info = await host.inspect(bytes);
    // dataBinding (ViewModel等) はランタイムのinspect APIでは取れないので、バイナリ解析で補完する
    let dataBinding = null;
    try {
      const dump = readRiv(bytes, { tolerant: true });
      dataBinding = decodeDataBinding(dump);
    } catch {
      // 解析失敗時は黙って省略（riv_inspect本来の結果は返す）
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              file: abs,
              formatVersion: header ? `${header.major}.${header.minor}` : null,
              ...info,
              ...(dataBinding ? { dataBinding } : {}),
            },
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

// ---- riv_lint ------------------------------------------------------------
server.registerTool(
  "riv_lint",
  {
    title: "Diagnose a .riv file for structural problems",
    description:
      "Static diagnostic pass over a .riv file: broken/out-of-range references, oversized embedded assets, state-machine states unreachable by any transition, unconditional self-transitions (infinite-loop risk), unused state-machine inputs, keyframe easing silently discarded on a track's last keyframe, plus motion-quality rules (all-linear robotic movement, teleporting objects, missing stagger on simultaneous fade-ins, one-sided scale animation). Complements riv_dump (which shows raw structure but doesn't judge it). Pass exactly one of path or assetRef; assetRef mode also records an immutable review receipt.",
    inputSchema: {
      path: z.string().optional().describe("Path to the .riv file (use exactly one of path or assetRef)"),
      assetRef: z.string().optional().describe("Immutable revision reference; records a lint review receipt"),
    },
  },
  wrap(async ({ path, assetRef }: { path?: string; assetRef?: string }) => {
    if ((path ? 1 : 0) + (assetRef ? 1 : 0) !== 1) {
      return err("Provide exactly one of path or assetRef");
    }
    let bytes: Buffer;
    if (assetRef) bytes = revisionStore.get(assetRef).rivBytes;
    else bytes = loadRiv(path!).bytes;

    const findings = lintRiv(bytes);
    const summary: Record<string, unknown> = {
      errorCount: findings.filter((f) => f.severity === "error").length,
      warningCount: findings.filter((f) => f.severity === "warning").length,
      infoCount: findings.filter((f) => f.severity === "info").length,
      findings,
    };
    if (assetRef) {
      const receipt = reviewStore.put({
        assetRef,
        kind: "lint",
        payload: {
          errorCount: summary.errorCount,
          warningCount: summary.warningCount,
          infoCount: summary.infoCount,
          findings,
        },
      });
      summary.review = reviewSummary(receipt);
    }
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  })
);

// ---- riv_design_tokens -------------------------------------------------
server.registerTool(
  "riv_design_tokens",
  {
    title: "Generate a design-token set (palette / motion / layout)",
    description:
      "Deterministically generate professional design tokens for a scene BEFORE calling riv_create: an OKLCH-harmonized palette (with WCAG contrast ratios), gradient pairs, Material-Motion-derived durations & easing roles, spacing/radius/stroke scales and a type scale. Call this first, then use ONLY the returned values in the scene spec — never invent raw hex colors or ad-hoc durations. Inputs: optional seed color, mood (calm|playful|elegant|tech|warm|natural), scheme (dark|light).",
    inputSchema: {
      seed: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("Brand/seed color #RRGGBB (optional; mood default hue otherwise)"),
      mood: z.enum(["calm", "playful", "elegant", "tech", "warm", "natural"]).optional(),
      scheme: z.enum(["dark", "light"]).optional().describe("Default dark"),
    },
  },
  wrap(async ({ seed, mood, scheme }: { seed?: string; mood?: Mood; scheme?: "dark" | "light" }) => {
    const tokens = generateTokens({ seed, mood, scheme });
    return { content: [{ type: "text", text: JSON.stringify(tokens, null, 1) }] };
  })
);

// ---- riv_critique ------------------------------------------------------
server.registerTool(
  "riv_critique",
  {
    title: "Critique a .riv: filmstrip + onion skin + motion vectors + metrics + checklist",
    description:
      "One-call review bundle for the render→critique→revise loop. Returns (1) a FILMSTRIP image — N frames left→right across the duration, so motion is readable as a sequence, (2) an ONION-SKIN image — all frames ghost-overlaid so every mover leaves a visible trail (use it to check trajectories and travel direction vs the artwork's facing), (3) a MOTION REPORT — net displacement/rotation vector per animated object computed from the file data, (4) objective design metrics + lint findings, and (5) a fixed 7-axis scoring checklist (incl. spatial/directional coherence). LOOK at the images, score each axis 1-5, fix anything below 4 (riv_edit / regenerate), then re-run. Iterate at least twice before delivering any non-trivial scene.",
    inputSchema: {
      path: z.string().optional().describe("Path to the .riv file (use exactly one of path or assetRef)"),
      assetRef: z.string().optional().describe("Immutable revision reference; records a critique review receipt"),
      artboard: z.string().optional(),
      animation: z.string().optional().describe("Animation to sample (default: first)"),
      stateMachine: z.string().optional(),
      frames: z.number().int().min(2).max(10).optional().describe("Frames to sample across the duration (default 6)"),
      width: z.number().int().min(120).max(480).optional().describe("Width of each filmstrip cell (default 200 — keep small, it saves tokens)"),
      individualFrames: z.boolean().optional().describe("Also return each sampled frame as a separate full-size image (default false)"),
    },
  },
  wrap(
    async (a: { path?: string; assetRef?: string; artboard?: string; animation?: string; stateMachine?: string; frames?: number; width?: number; individualFrames?: boolean }) => {
      if ((a.path ? 1 : 0) + (a.assetRef ? 1 : 0) !== 1) {
        return err("Provide exactly one of path or assetRef");
      }
      const bytes = a.assetRef ? revisionStore.get(a.assetRef).rivBytes : loadRiv(a.path!).bytes;
      const buf = Buffer.from(bytes);
      const metrics = computeMetrics(bytes);
      const info = await host.inspect(buf);
      const ab = (a.artboard && info.artboards.find((x) => x.name === a.artboard)) || info.artboards[0];
      const anim = a.animation ? ab?.animations.find((x) => x.name === a.animation) : ab?.animations[0];
      const durationSec = anim?.durationSeconds ?? 2;
      const n = a.frames ?? 6;
      const fps = durationSec > 0 ? Math.max(0.2, (n - 1) / durationSec) : 1;
      const r = await host.renderFrames(buf, {
        artboard: a.artboard,
        animation: a.stateMachine ? undefined : anim?.name,
        stateMachine: a.stateMachine,
        startTime: 0,
        frameCount: n,
        fps,
        width: a.width ?? 200,
        format: "rgba",
      });
      const rgbaFrames = r.frames.map((f) => new Uint8Array(Buffer.from(f, "base64")));
      const strip = composeFilmstrip(rgbaFrames, r.width, r.height);
      const onion = composeOnionSkin(rgbaFrames, r.width, r.height);
      const stripPng = Buffer.from(encodePng(strip.rgba, strip.width, strip.height)).toString("base64");
      const onionPng = Buffer.from(encodePng(onion.rgba, onion.width, onion.height)).toString("base64");
      const times = Array.from({ length: n }, (_, i) => Math.round((i / fps) * 100) / 100);
      const receipt = a.assetRef
        ? reviewStore.put({
            assetRef: a.assetRef,
            kind: "critique",
            payload: {
              runtimeValidation: { ok: true },
              target: {
                artboard: ab?.name ?? a.artboard ?? null,
                animation: anim?.name ?? null,
                stateMachine: a.stateMachine ?? null,
              },
              sampledFrames: n,
              width: r.width,
              height: r.height,
              times,
              metrics,
            },
          })
        : null;
      return {
        content: [
          {
            type: "text",
            text:
              `Sampled "${anim?.name ?? a.stateMachine ?? "?"}" at t=[${times.join(", ")}]s (cells ${r.width}x${r.height}). ` +
              `Image 1 = filmstrip (time flows left→right), image 2 = onion skin (motion trails).\n` +
              `${motionReport(bytes)}\n` +
              `METRICS ${JSON.stringify(metrics, null, 1)}\n` +
              (receipt ? `ReviewReceipt: ${JSON.stringify(reviewSummary(receipt))}\n` : "") +
              `\n${CRITIQUE_CHECKLIST}`,
          },
          { type: "image" as const, data: stripPng, mimeType: "image/png" },
          { type: "image" as const, data: onionPng, mimeType: "image/png" },
          ...(a.individualFrames
            ? rgbaFrames.map((f) => ({
                type: "image" as const,
                data: Buffer.from(encodePng(f, r.width, r.height)).toString("base64"),
                mimeType: "image/png",
              }))
            : []),
        ],
      };
    }
  )
);

// ---- riv_import_svg ----------------------------------------------------
// SVG→シーン断片。プレビュー用の一時rivも組んで画像を返す
async function svgToSpecFile(svgText: string, outSpec: string, idPrefix?: string) {
  const res = importSvg(svgText, { idPrefix });
  const specPath = resolve(outSpec);
  writeFileSync(specPath, JSON.stringify({ sourceWidth: res.width, sourceHeight: res.height, shapes: res.shapes }, null, 0));
  const previewScene: SceneSpec = {
    artboard: { name: "SvgPreview", width: Math.max(64, res.width), height: Math.max(64, res.height) },
    shapes: res.shapes,
  };
  const { bytes } = createRiv(previewScene);
  const r = await host.renderFrames(Buffer.from(bytes), { frameCount: 1, width: Math.min(480, Math.max(160, Math.round(res.width))), format: "png" });
  const totalPoints = res.shapes.reduce((n, s) => n + (s.subpaths?.reduce((m, sp) => m + sp.points.length, 0) ?? 0), 0);
  return {
    text:
      `Imported ${res.shapes.length} shapes (${totalPoints} bezier vertices) from ${res.width}x${res.height} SVG -> ${specPath}\n` +
      `shape ids: ${res.shapes.map((s) => s.id).join(", ")}\n` +
      (res.warnings.length ? `warnings: ${res.warnings.join("; ")}\n` : "") +
      `Use in riv_create via "imports":[{"spec":"${specPath}","x":...,"y":...,"scale":...}] — then animate the wrapper group or individual shape ids.`,
    image: r.frames[0],
  };
}

server.registerTool(
  "riv_import_svg",
  {
    title: "Import an SVG as Rive vector shapes",
    description:
      "Convert an SVG file (Figma/Illustrator export, icon, illustration) into Rive bezier path shapes — the professional way to get high-quality artwork instead of drawing with primitives. Writes a scene-fragment JSON (shapes with full cubic vertices, gradients, strokes) and returns a rendered preview. Use the fragment in riv_create via \"imports\". Supports path/rect/circle/ellipse/polygon/polyline/line, nested transforms, style attrs, linear/radial gradients. Not imported: <text> (use texts[] with a font), <image>, filters, masks.",
    inputSchema: {
      svgPath: z.string().optional().describe("Path to the .svg file"),
      svg: z.string().optional().describe("Inline SVG markup (alternative to svgPath)"),
      outSpec: z.string().describe("Output scene-fragment JSON path (e.g. logo.scene.json)"),
      idPrefix: z.string().optional().describe("Prefix for generated shape ids (avoid collisions)"),
    },
  },
  wrap(async ({ svgPath, svg, outSpec, idPrefix }: { svgPath?: string; svg?: string; outSpec: string; idPrefix?: string }) => {
    const text = svg ?? (svgPath ? readFileSync(resolve(svgPath), "utf8") : null);
    if (!text) return err("Provide svgPath or svg");
    const out = await svgToSpecFile(text, outSpec, idPrefix);
    return { content: [{ type: "text", text: out.text }, { type: "image", data: out.image, mimeType: "image/png" }] };
  })
);

// ---- riv_asset_search --------------------------------------------------
server.registerTool(
  "riv_asset_search",
  {
    title: "Search/fetch professional vector icons (Iconify)",
    description:
      "Search Iconify's ~200k professionally designed open-source icons and convert one directly into Rive shapes. Two modes: query-only returns matching icon names; icon+outSpec downloads the SVG and imports it (same output as riv_import_svg). Requires network access to api.iconify.design.",
    inputSchema: {
      query: z.string().optional().describe("Search terms, e.g. 'rocket launch'"),
      limit: z.number().int().min(1).max(64).optional().describe("Max results (default 24)"),
      icon: z.string().optional().describe("Icon to fetch, e.g. 'solar:rocket-bold' (from a previous search)"),
      outSpec: z.string().optional().describe("Required with icon: output scene-fragment JSON path"),
      idPrefix: z.string().optional(),
    },
  },
  wrap(async ({ query, limit, icon, outSpec, idPrefix }: { query?: string; limit?: number; icon?: string; outSpec?: string; idPrefix?: string }) => {
    const get = async (url: string): Promise<string> => {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) }).catch((e) => {
        throw new Error(`Iconify API unreachable (${e.message}) — this tool needs network access to api.iconify.design`);
      });
      if (!res.ok) throw new Error(`Iconify API ${res.status} for ${url}`);
      return res.text();
    };
    if (icon) {
      if (!outSpec) return err("outSpec is required when fetching an icon");
      const [prefix, name] = icon.split(":");
      if (!prefix || !name) return err("icon must be 'prefix:name' (e.g. 'solar:rocket-bold')");
      const svg = await get(`https://api.iconify.design/${prefix}/${name}.svg`);
      if (!svg.includes("<svg")) return err(`Icon '${icon}' not found`);
      const out = await svgToSpecFile(svg, outSpec, idPrefix ?? name.replace(/[^a-z0-9]/gi, "_") + "_");
      return { content: [{ type: "text", text: out.text }, { type: "image", data: out.image, mimeType: "image/png" }] };
    }
    if (!query) return err("Provide query (search) or icon (fetch)");
    const json = JSON.parse(await get(`https://api.iconify.design/search?query=${encodeURIComponent(query)}&limit=${limit ?? 24}`));
    const icons: string[] = json.icons ?? [];
    return {
      content: [{
        type: "text",
        text: icons.length
          ? `${icons.length} icons:\n${icons.join("\n")}\nFetch one with {icon:"<prefix:name>", outSpec:"..."}.`
          : `No icons found for '${query}'`,
      }],
    };
  })
);

// ---- riv_lottie_import ---------------------------------------------------
// Lottie(bodymovin) JSON → シーン断片。groups/shapes/animations を全て持つ
// (riv_import_svg のフラグメントより richer: LottieFilesの完成品はタイミング/振付/
// イージングそのものが素材なので、静止形状だけでなくアニメも一緒に持ち出す)
server.registerTool(
  "riv_lottie_import",
  {
    title: "Import a Lottie/bodymovin JSON as a Rive scene fragment (art + timing + easing)",
    description:
      "Convert a Lottie (bodymovin, .json) animation — the format used by LottieFiles' huge library of free, professionally animated assets — into a riv_create scene fragment. Unlike riv_import_svg (shapes only), this carries over the professional's actual choreography: keyframed position/rotation/scale/opacity with their exact bezier easing curves (not approximated to a named preset), shape/null/precomp layer hierarchy, solid layers, gradient fills, stroke trim-path animation, and layer in/out visibility windows. Writes a scene-fragment JSON with {groups,shapes,animations} plus a rendered preview and a coverage/warnings summary. Since the fragment includes animations (which riv_create's \"imports\" mechanism does not merge), splice its groups/shapes/animations arrays directly into your riv_create scene spec instead of using \"imports\". Supported: shape layers (path/ellipse/rect/star/polygon/fill/stroke/gradient/trim/nested groups), null layers, solid layers, one level of precomp inlining, parented layers, hold and bezier easing. Not imported (counted in coverage.skipped, not silently dropped): text layers, masks, track mattes, repeaters, merge-paths, path/gradient-position keyframe morphing (frozen to first frame + warning), time-remapped precomps, expressions.",
    inputSchema: {
      path: z.string().optional().describe("Path to the Lottie .json file"),
      json: z.string().optional().describe("Inline Lottie JSON text (alternative to path)"),
      outSpec: z.string().describe("Output scene-fragment JSON path (e.g. anim.scene.json)"),
      idPrefix: z.string().optional().describe("Prefix for generated group/shape ids (avoid collisions)"),
    },
  },
  wrap(async ({ path, json, outSpec, idPrefix }: { path?: string; json?: string; outSpec: string; idPrefix?: string }) => {
    const text = json ?? (path ? readFileSync(resolve(path), "utf8") : null);
    if (!text) return err("Provide path or json");
    const res = importLottie(text, { idPrefix });
    const specPath = resolve(outSpec);
    writeFileSync(
      specPath,
      JSON.stringify(
        { sourceWidth: res.width, sourceHeight: res.height, fps: res.fps, durationFrames: res.durationFrames, groups: res.groups, shapes: res.shapes, animations: res.animations },
        null,
        0
      )
    );
    const previewScene: SceneSpec = {
      artboard: { name: "LottiePreview", width: Math.max(64, Math.round(res.width)), height: Math.max(64, Math.round(res.height)) },
      groups: res.groups,
      shapes: res.shapes,
      animations: res.animations,
    };
    const { bytes } = createRiv(previewScene);
    const animName = res.animations[0]?.name;
    const previewSeconds = animName ? Math.min(0.4, (res.durationFrames / res.fps) * 0.4) : 0;
    const r = await host.renderFrames(Buffer.from(bytes), {
      animation: animName,
      startTime: previewSeconds,
      frameCount: 1,
      width: Math.min(480, Math.max(160, Math.round(res.width))),
      format: "png",
    });
    const keyframeCount = res.animations.reduce((n, a) => n + a.tracks.reduce((m, t) => m + t.keyframes.length, 0), 0);
    const text2 =
      `Imported ${res.groups.length} groups, ${res.shapes.length} shapes, ${keyframeCount} keyframes ` +
      `(${res.fps}fps, ${res.durationFrames} frames) from Lottie -> ${specPath}\n` +
      `coverage: decompiled=${res.coverage.decompiled} skipped=${JSON.stringify(res.coverage.skipped)}\n` +
      (res.warnings.length ? `warnings (${res.warnings.length}): ${res.warnings.slice(0, 12).join("; ")}${res.warnings.length > 12 ? " …" : ""}\n` : "") +
      `Splice into riv_create: scene.groups = [...scene.groups, ...fragment.groups], scene.shapes = [...scene.shapes, ...fragment.shapes], ` +
      `scene.animations = [...scene.animations, ...fragment.animations] (fragment loaded from "${specPath}") — do NOT use "imports" for this fragment, it only merges shapes.`;
    return { content: [{ type: "text", text: text2 }, { type: "image", data: r.frames[0], mimeType: "image/png" }] };
  })
);

// ---- riv_decompile -----------------------------------------------------
server.registerTool(
  "riv_decompile",
  {
    title: "Decompile a .riv into an editable scene spec",
    description:
      "Reverse a .riv file into a riv_create scene spec (shapes with bezier vertices, solid/gradient fills incl. gradient opacity, blend modes, artboard background, groups/solos, trim paths, clipping, animations with named easings, loop modes). Paint objects are resolved by parentId, so editor-authored files (paints deferred to the stream tail) decompile correctly. Use it to study professional files as few-shot examples, or to remix them — art AND hand-tuned animation tracks — into new scenes (decompile → edit spec → riv_create; see samples/night-delivery). Object types outside the writer's coverage are counted in 'skipped', not silently dropped. Note: community/marketplace files are CC BY 4.0 — keep attribution.",
    inputSchema: {
      path: z.string().describe("Path to the .riv file"),
      outSpec: z.string().optional().describe("Write the scene spec JSON here (default: return summary only)"),
    },
  },
  wrap(async ({ path, outSpec }: { path: string; outSpec?: string }) => {
    const { bytes } = loadRiv(path);
    const { scene, coverage } = decompileRiv(bytes);
    let text = `decompiled ${coverage.decompiled} objects; skipped: ${JSON.stringify(coverage.skipped)}`;
    if (coverage.warnings.length) text += `\nwarnings: ${coverage.warnings.slice(0, 12).join("; ")}`;
    if (outSpec) {
      const p = resolve(outSpec);
      writeFileSync(p, JSON.stringify(scene, null, 1));
      text += `\nscene spec -> ${p}`;
    } else {
      const s = JSON.stringify(scene);
      text += s.length > 6000 ? `\n(spec is ${s.length} chars — pass outSpec to write it to a file)` : `\n${s}`;
    }
    return { content: [{ type: "text", text }] };
  })
);

// ---- riv_create --------------------------------------------------------
server.registerTool(
  "riv_create",
  {
    title: "Create a .riv file from a scene spec",
    description: `Create a working .riv animation file from scratch (no Rive editor needed) and validate it with the official runtime. Returns a rendered preview frame.
For non-flat, non-"AI placeholder" quality (gradients, organic bezier curves, proper easing, springy motion), read the "rive-design-guidelines" prompt this server exposes before designing a non-trivial scene.
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
Motion presets — PREFER these over hand-authored keyframes (professionally tuned amplitudes/easings, ~10x fewer tokens):
"animations":[{"name":"intro","duration":90,"presets":[
  {"preset":"pop-in","target":"logo"},
  {"preset":"rise-in","targets":["c1","c2","c3"],"at":12,"stagger":4},
  {"preset":"float","target":"logo"}
],"tracks":[]}]
Available: fade-in rise-in drop-in slide-in pop-in bounce-in | fade-out sink-out slide-out pop-out | pulse heartbeat tada shake wobble | breathing float sway spin glow-pulse blink(for eyelid overlays). Options: at(start frame), stagger(frames between targets), intensity(0.25-3), direction(left|right|up|down), cycleSeconds. Ambient presets (breathing..blink) span the whole animation seamlessly. A preset and a manual track must not drive the same target+property.
Pro features: stroke.trim {start,end,mode} + trimStart/trimEnd tracks (draw-on effect), shapes[].clipBy (mask via an invisible shape), groups[].solo+active + soloActive track with keyframes[].ref (pose/mouth switching), constraints [{type:"followPath",item,path}] + followDistance track 0-1 (motion along a path), open paths (closed:false), multi-contour shapes (subpaths), stroke cap/join.
"imports":[{"spec":"logo.scene.json","x":200,"y":150,"scale":0.8}] places riv_import_svg / riv_asset_search fragments under a wrapper group (id = file basename) — animate the wrapper or individual shape ids. PREFER imported real vector art over drawing with primitives for anything illustrative.
Recommended flow: riv_design_tokens → (riv_import_svg / riv_asset_search for artwork) → riv_create (token values + presets + imports) → riv_critique → fix → re-critique.
Shape z-order: later in array = on top; images render above shapes. properties for tracks: x,y,rotation(deg),scaleX,scaleY,opacity(0-1),width,height,fillColor(needs "color" in keyframes). Colors: #RRGGBB or #AARRGGBB. rotation in degrees. Easings include emphasized-decel (enters) / emphasized-accel (exits).
Audio: "audio":[{"id":"beep","path":"./beep.wav"}] embeds a WAV/MP3/FLAC file (path resolved relative to cwd, or pass bytes directly). "events":[{"id":"beepEvent","type":"audio","audio":"beep"}] declares an AudioEvent bound to that clip. Trigger it either from a state machine state ("states":[{"name":"s1","fireEvent":"beepEvent"}]) or at specific frames inside a timeline via animations[].events: {"name":"anim1","duration":60,"tracks":[...],"events":[{"event":"beepEvent","frame":0},{"event":"beepEvent","frame":30}]}. NOTE: playback support depends on the runtime — this server's own preview (a Canvas2D-based renderer) does not play audio, so rendered PNG/GIF/video previews and riv_studio will stay silent even though the AudioAsset/AudioEvent are written correctly and will play in a GPU-backed Rive runtime (WebGL/Skia, e.g. rive.app or the production player).`,
    inputSchema: {
      outPath: z.string().describe("Output .riv path"),
      scene: z.record(z.unknown()).describe("Scene spec (see tool description for schema)"),
      previewTime: z.number().optional().describe("Seconds into first animation for the preview frame (default 0.4)"),
    },
  },
  wrap(
    async ({ outPath, scene, previewTime }: { outPath: string; scene: Record<string, unknown>; previewTime?: number }) => {
      const sourceSnapshot = stableJson(scene);
      const spec = scene as unknown as SceneSpec & {
        imports?: Array<{ spec: string; id?: string; parent?: string; x?: number; y?: number; scale?: number; z?: number }>;
      };
      // imports: riv_import_svg / riv_asset_search の scene断片をラッパーグループ付きでマージ
      if (spec.imports?.length) {
        spec.groups = spec.groups ?? [];
        spec.shapes = spec.shapes ?? [];
        for (const imp of spec.imports) {
          const p = resolve(imp.spec);
          if (!existsSync(p)) return err(`import spec not found: ${p}`);
          const frag = JSON.parse(readFileSync(p, "utf8")) as { shapes: NonNullable<SceneSpec["shapes"]> };
          const gid = imp.id ?? basename(p).replace(/\.(scene\.)?json$/i, "");
          spec.groups.push({
            id: gid, x: imp.x ?? 0, y: imp.y ?? 0, parent: imp.parent,
            ...(imp.scale !== undefined ? { scaleX: imp.scale, scaleY: imp.scale } : {}),
          });
          frag.shapes.forEach((s, i) => {
            spec.shapes!.push({ ...s, parent: s.parent ?? gid, z: imp.z !== undefined ? imp.z + i * 0.001 : s.z });
          });
        }
        delete spec.imports;
      }
      // pngPath/フォントpath/audioPath → bytes 解決（cwd 基準）
      const imageLists = [spec.images ?? [], ...(spec.artboards ?? []).map((a) => a.images ?? [])];
      for (const img of imageLists.flat()) {
        if (!img.bytes && img.pngPath) {
          const p = resolve(img.pngPath);
          if (!existsSync(p)) return err(`Image file not found: ${p}`);
          img.bytes = new Uint8Array(readFileSync(p));
        }
      }
      const audioLists = [spec.audio ?? [], ...(spec.artboards ?? []).map((a) => a.audio ?? [])];
      for (const clip of audioLists.flat()) {
        if (!clip.bytes && clip.path) {
          const p = resolve(clip.path);
          if (!existsSync(p)) return err(`Audio file not found: ${p}`);
          clip.bytes = new Uint8Array(readFileSync(p));
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
      const revision = revisionStore.put({
        rivBytes: bytes,
        sourceBytes: sourceSnapshot,
        sourceKind: "scene-spec",
        rivPath: out,
        operation: { tool: "riv_create" },
      });
      return {
        content: [
          {
            type: "text",
            text:
              `Created ${out} (${bytes.length} bytes) — validated with official Rive runtime.\n` +
              JSON.stringify(info, null, 1) +
              `\nRevision: ${JSON.stringify(revisionSummary(revision))}` +
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
      path: z.string().optional().describe("Source .riv path (use exactly one of path or assetRef)"),
      assetRef: z.string().optional().describe("Immutable revision reference (use exactly one of path or assetRef)"),
      outPath: z.string().optional().describe("Output path (path mode default: overwrite source; assetRef mode default: no file write)"),
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
              easing: z.enum(["hold", "linear", "ease", "ease-in", "ease-out", "ease-in-out", "ease-out-back", "ease-in-back", "smooth", "snap", "emphasized-decel", "emphasized-accel"]).optional(),
            })
          ).optional().describe("op=setKeyframes: keyframe list (value required unless mode=remove)"),
          mode: z.enum(["replace", "add", "remove"]).optional().describe("op=setKeyframes: default replace"),
        })
      ).min(1),
    },
  },
  wrap(async ({ path, assetRef, outPath, edits }: { path?: string; assetRef?: string; outPath?: string; edits: EditOp[] }) => {
    if ((path ? 1 : 0) + (assetRef ? 1 : 0) !== 1) {
      return err("Provide exactly one of path or assetRef");
    }

    let bytes: Buffer;
    let abs: string | undefined;
    let parentRef: string | undefined;
    if (assetRef) {
      const resolvedRevision = revisionStore.get(assetRef);
      bytes = resolvedRevision.rivBytes;
      abs = resolvedRevision.revision.rivPath;
      parentRef = assetRef;
    } else {
      const loaded = loadRiv(path!);
      bytes = loaded.bytes;
      abs = loaded.abs;
    }

    const result = editRiv(bytes, edits);
    let out: string | undefined;
    if (assetRef) {
      if (outPath) {
        out = resolve(outPath);
        writeFileSync(out, result.bytes);
      }
    } else {
      out = resolve(outPath ?? abs!);
      writeFileSync(out, result.bytes);
    }

    const revision = revisionStore.put({
      rivBytes: result.bytes,
      parentRef,
      sourceKind: "binary-edit",
      rivPath: out,
      operation: { tool: "riv_edit", details: edits },
    });
    const r = await host.renderFrames(Buffer.from(result.bytes), { frameCount: 1, format: "png" });
    const target = out ?? "(revision store only)";
    return {
      content: [
        {
          type: "text",
          text:
            `Edited -> ${target}\n${result.log.join("\n")}\n` +
            `Revision: ${JSON.stringify(revisionSummary(revision))}`,
        },
        { type: "image", data: r.frames[0], mimeType: "image/png" },
      ],
    };
  }));

// ---- riv_finalize ------------------------------------------------------
server.registerTool(
  "riv_finalize",
  {
    title: "Finalize a reviewed immutable revision",
    description:
      "Export an immutable assetRef only after the exact same revision has a zero-error lint review receipt and a critique review receipt. Re-validates the .riv with the official Rive runtime before writing. Reviews from a parent or sibling revision never count.",
    inputSchema: {
      assetRef: z.string().describe("Immutable revision to finalize"),
      outPath: z.string().describe("Destination .riv path"),
    },
  },
  wrap(async ({ assetRef, outPath }: { assetRef: string; outPath: string }) => {
    const resolvedRevision = revisionStore.get(assetRef);
    const reviews = reviewStore.listForAsset(assetRef);
    const lint = reviews.find((receipt) => {
      if (receipt.kind !== "lint") return false;
      const payload = receipt.payload as { errorCount?: unknown };
      return payload && payload.errorCount === 0;
    });
    const critique = reviews.find((receipt) => receipt.kind === "critique");

    if (!lint) return err("Finalize blocked: this exact revision has no zero-error lint review receipt");
    if (!critique) return err("Finalize blocked: this exact revision has no critique review receipt");

    // Official runtime validation is intentionally repeated at the delivery boundary.
    await host.inspect(resolvedRevision.rivBytes);

    const out = resolve(outPath);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, resolvedRevision.rivBytes);

    const receipt = finalizeStore.put({
      assetRef,
      lintReviewRef: lint.reviewRef,
      critiqueReviewRef: critique.reviewRef,
      outPath: out,
    });
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          finalized: true,
          assetRef,
          rivHash: resolvedRevision.revision.rivHash,
          outPath: out,
          lintReviewRef: lint.reviewRef,
          critiqueReviewRef: critique.reviewRef,
          finalizeRef: receipt.finalizeRef,
          runtimeValidation: { ok: true },
        }, null, 2),
      }],
    };
  })
);

// ---- riv_optimize --------------------------------------------------------
server.registerTool(
  "riv_optimize",
  {
    title: "Optimize a .riv file (lossless)",
    description:
      "Shrink a .riv without changing its visual output: remove unreferenced objects (dangling easing interpolators, fired-events nothing points to, empty keyframe tracks left over from prior edits) and thin redundant keyframes on strictly-linear-interpolation runs within a tolerance. Only runs where every segment is linear are touched — any run touching hold/cubic easing is left alone, so no easing gets shifted (see keyed_property.cpp semantics: a KeyFrame's interpolationType applies to the segment going INTO the next frame). Colors and id-keyframes (soloActive) are never thinned, only numeric (KeyFrameDouble) tracks. All steps are opt-in booleans (default: all on) and idempotent/safe to run repeatedly. Use dryRun=true to see the removal/thinning plan without writing anything. Run riv_lint afterwards if in doubt.",
    inputSchema: {
      path: z.string().describe("Source .riv path"),
      outPath: z.string().optional().describe("Output path (default: overwrite source)"),
      removeUnreferenced: z.boolean().optional().describe("Remove unreferenced interpolators/events/empty tracks (default true)"),
      thinKeyframes: z.boolean().optional().describe("Douglas-Peucker thin redundant keyframes on linear-only runs (default true)"),
      tolerance: z.number().min(0).max(1).optional().describe("Thinning tolerance as a ratio of each track's own value range (default 0.01 = 1%, conservative)"),
      dryRun: z.boolean().optional().describe("Report the plan only; don't write anything (default false)"),
    },
  },
  wrap(
    async ({ path, outPath, removeUnreferenced, thinKeyframes, tolerance, dryRun }: {
      path: string;
      outPath?: string;
      removeUnreferenced?: boolean;
      thinKeyframes?: boolean;
      tolerance?: number;
      dryRun?: boolean;
    }) => {
      const { bytes, abs } = loadRiv(path);
      const { bytes: outBytes, report } = optimizeRiv(bytes, { removeUnreferenced, thinKeyframes, tolerance, dryRun });
      if (dryRun) {
        return { content: [{ type: "text", text: JSON.stringify(report, null, 1) }] };
      }
      const out = resolve(outPath ?? abs);
      writeFileSync(out, outBytes);
      const r = await host.renderFrames(Buffer.from(outBytes), { frameCount: 1, format: "png" });
      return {
        content: [
          { type: "text", text: `Optimized -> ${out}\n${JSON.stringify(report, null, 1)}` },
          { type: "image", data: r.frames[0], mimeType: "image/png" },
        ],
      };
    }
  )
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
            polygon: z.array(point2D()).min(3)
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
          polygon: z.array(point2D()).min(3).describe("Region in image px coords"),
          pivot: point2D().optional().describe("Attachment point (default: bottom-center of bbox)"),
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

// ---- riv_batch_render ------------------------------------------------------
// Factory, not a shared object: spreading the same zod instances into both
// batchJobSchema and `defaults` would make the JSON-schema converter emit
// $ref dedup pointers, which some MCP clients' validators reject.
const batchDefaultsShape = () => ({
  format: z.enum(["png", "gif", "apng", "webm", "sprites"]).optional().describe("Output format for this job"),
  outDir: z.string().optional().describe("Output directory (default: alongside the source .riv)"),
  artboard: z.string().optional(),
  animation: z.string().optional(),
  stateMachine: z.string().optional(),
  width: z.number().int().positive().max(2048).optional(),
  height: z.number().int().positive().max(2048).optional(),
  background: z.string().optional().describe("CSS background color"),
  time: z.number().optional().describe("format=png: seconds to advance before capture (default 0)"),
  duration: z.number().positive().max(30).optional().describe("format=gif/apng/webm/sprites: seconds to render (default: one animation loop, or 2s)"),
  fps: z.number().int().positive().max(60).optional(),
  transparent: z.boolean().optional().describe("format=apng: render on a transparent background (default true)"),
  loops: z.number().int().min(0).optional().describe("format=apng: loop count, 0=infinite (default 0)"),
  count: z.number().int().positive().max(256).optional().describe("format=sprites: frame count (default 16)"),
});
const batchJobSchema = z.object({
  rivPath: z.string().optional().describe("Path to a single .riv file (mutually exclusive with glob)"),
  glob: z.string().optional().describe("Glob pattern matching multiple .riv files, e.g. 'samples/**/*.riv' (self-contained matcher: only '*' and '**' are supported, no {a,b} or [abc])"),
  ...batchDefaultsShape(),
});

server.registerTool(
  "riv_batch_render",
  {
    title: "Batch-render many .riv files/formats in one call",
    description:
      "Render a list of jobs — each a single .riv (rivPath) or a glob of .riv files (glob) — to png/gif/apng/webm/sprites, sequentially reusing the same headless Chromium page (no parallel pages). Built for CI/scripts: call this tool repeatedly from your pipeline instead of expecting a live watch mode — none is provided, since MCP's request/response model doesn't fit a background file watcher. 'defaults' holds options shared across every job; each job's own fields override them. One job's failure does not stop the batch — every job (and every file a glob expands to) gets its own success/error/outPath/durationMs entry in the returned report.",
    inputSchema: {
      jobs: z.array(batchJobSchema).min(1).max(200).describe("Jobs to render, in order"),
      defaults: z.object(batchDefaultsShape()).optional().describe("Shared defaults merged under each job (job-level values win)"),
    },
  },
  wrap(async ({ jobs, defaults }: { jobs: BatchJobSpec[]; defaults?: BatchJobSpec }) => {
    const report = await runBatchRender(host, jobs, defaults, process.cwd());
    return {
      content: [
        {
          type: "text",
          text: `Batch render: ${report.succeeded}/${report.total} succeeded, ${report.failed} failed (${report.totalMs}ms)\n${JSON.stringify(report.results, null, 1)}`,
        },
      ],
    };
  })
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

// ---- riv_ab_compare ------------------------------------------------------
server.registerTool(
  "riv_ab_compare",
  {
    title: "Render two .riv files side by side for visual A/B review",
    description:
      "Render the same artboard/animation/state-machine from two .riv files under identical conditions and composite them side by side (horizontal or vertical) into a single GIF/APNG for human review — e.g. a rig before/after an edit, or two design variants. 'A: <file>' / 'B: <file>' labels are burned into each frame by default. If the two files' animation lengths differ, the shorter one holds on its final frame once it ends. Different from riv_visual_diff: that tool computes a per-pixel numeric diff of the SAME thing rendered two ways (for regression testing); this tool is for eyeballing two DIFFERENT things playing side by side (for design review), not measuring a delta.",
    inputSchema: {
      pathA: z.string().describe("First .riv file"),
      pathB: z.string().describe("Second .riv file"),
      artboard: z.string().optional().describe("Artboard name, applied to both files (default: first)"),
      animation: z.string().optional().describe("Animation name, applied to both files (default: first)"),
      stateMachine: z.string().optional().describe("State machine name, applied to both files (takes precedence over animation)"),
      width: z.number().int().positive().max(1024).optional().describe("Panel width (default 320); panel height is derived from file A's aspect ratio and then forced onto file B so both panels align"),
      height: z.number().int().positive().max(1024).optional().describe("Panel height (default: derived from file A's own aspect ratio)"),
      fps: z.number().int().positive().max(60).optional().describe("Default 20"),
      duration: z.number().positive().max(30).optional().describe("Seconds to render (default: the longer of the two files' own animation lengths)"),
      background: z.string().optional().describe("CSS background per panel (default: white for gif, transparent for apng)"),
      format: z.enum(["gif", "apng"]).optional().describe("Output format (default gif)"),
      layout: z.enum(["horizontal", "vertical"]).optional().describe("Panel arrangement (default horizontal)"),
      labels: z.boolean().optional().describe("Burn 'A: <file>' / 'B: <file>' labels into each frame (default true)"),
      out: z.string().optional().describe("Output path (default: alongside pathA)"),
    },
  },
  wrap(async (a: AbCompareOptions) => {
    const result = await runAbCompare(host, a);
    return {
      content: [
        {
          type: "text",
          text:
            `A/B compare (${result.layout}, ${result.format}) -> ${result.outPath}\n` +
            `${result.width}x${result.height}, ${result.frameCount} frames @ ${result.fps}fps ` +
            `(A duration ${result.durationA.toFixed(2)}s, B duration ${result.durationB.toFixed(2)}s, target ${result.targetDuration.toFixed(2)}s)`,
        },
        { type: "image", data: result.previewFramePng, mimeType: "image/png" },
      ],
    };
  })
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
        text: `Studio running at ${handle.url}\nwatching: ${resolve(path)}${scenePath ? `\nscene: ${resolve(scenePath)}` : ""}\nブラウザで開いてください。ファイルを riv_create / riv_edit で更新すると即座に反映されます。\n左パネル下部の「エージェント」はチャットです。ユーザーの発言は riv_studio_notes で取得し、作業が終わったら同ツールの reply 引数で結果を必ず返すこと（返さないとユーザー側は何が起きたか分かりません）。`,
      }],
    };
  })
);

// ---- riv_studio_notes --------------------------------------------------
server.registerTool(
  "riv_studio_notes",
  {
    title: "Read the Studio chat and reply into it",
    description:
      "The Studio web UI's Agent panel is a two-way chat. Use this tool for both halves of it.\n" +
      "1) READ: call with no `reply` to fetch the messages the user typed (consumes the queue; the Studio shows them as picked up). Trigger on 'check the studio notes' / 「スタジオの指示を確認して」, or after opening riv_studio when the user mentions they left notes. Act on each instruction — usually riv_edit or riv_create on the watched file, which hot-reloads the browser.\n" +
      "2) REPLY: after doing the work, call again with `reply` set to a short summary of what you changed (and anything you could not do). It appears as your message in the same chat. ALWAYS reply — otherwise the user is left staring at the Studio with no idea whether you acted. Both can be done in one call: pass `reply` together with the read to answer and pick up anything new at the same time.",
    inputSchema: {
      port: z.number().int().optional().describe("Studio port (default 8787)"),
      peek: z.boolean().optional().describe("Read without consuming"),
      reply: z.string().optional().describe("Message to post back into the Studio chat as the assistant (what you changed, what you skipped, what you need)"),
    },
  },
  wrap(async ({ port, peek, reply }: { port?: number; peek?: boolean; reply?: string }) => {
    const p = port ?? 8787;
    let replied = false;
    if (reply && reply.trim()) {
      try {
        const res = await fetch(`http://localhost:${p}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ text: reply.trim(), role: "assistant" }),
        });
        replied = res.ok;
      } catch {
        replied = postStudioReply(reply.trim());
      }
    }
    const replyNote = reply ? (replied ? "Reply posted to the Studio chat.\n" : "Could not post the reply — the Studio is not reachable.\n") : "";
    let data: { notes: Array<{ text: string; time: string; context?: { selection?: string | null; artboard?: string | null; animation?: string | null; timeSec?: number | null } }> };
    try {
      const res = await fetch(`http://localhost:${p}/notes${peek ? "" : "?consume=1"}`);
      data = (await res.json()) as typeof data;
    } catch {
      const notes = takeStudioNotes();
      if (notes === null) {
        return { content: [{ type: "text", text: `${replyNote}Studio is not running on port ${p}. Start it with riv_studio first.` }] };
      }
      data = { notes };
    }
    if (!data.notes.length) {
      return { content: [{ type: "text", text: `${replyNote}No pending instructions from the Studio UI.` }] };
    }
    const lines = data.notes.map((n, i) => {
      const c = n.context;
      const ctx = c
        ? [
            c.selection ? `selection=${c.selection}` : "",
            c.artboard ? `artboard=${c.artboard}` : "",
            c.animation ? `animation=${c.animation}` : "",
            typeof c.timeSec === "number" ? `t=${c.timeSec.toFixed(2)}s` : "",
          ].filter(Boolean).join(" ")
        : "";
      return `${i + 1}. [${n.time.slice(11, 19)}]${ctx ? ` (${ctx})` : ""} ${n.text}`;
    });
    return {
      content: [{
        type: "text",
        text: `${replyNote}Instructions from the Studio UI (${data.notes.length}):\n${lines.join("\n")}\n\nApply them to the watched .riv (riv_edit / riv_create) — the browser hot-reloads automatically. When you are done, call riv_studio_notes again with \`reply\` to tell the user in the Studio chat what you changed.`,
      }],
    };
  })
);

// ---- riv_ui_detect -------------------------------------------------------
// 入力は「スクリーンショット(imagePath)」か「ベクター(svgPath)」のどちらか。
// SVG のときは推定が要らない（元データに座標・塗り・入れ子が書いてある）ので、
// 検出器ではなく vectorScene.ts を通る。renderRisk / demoted / patched のような
// **推定の副産物は SVG 経路には存在しない**ので、無理に 0 を返さず出さない。
// 失敗は投げる（呼び出しは両方とも wrap の中なので、そのまま Error: 応答になる）
/** 同梱 Inter (OFL)。riv_create の fonts[] 既定と同じファイルを使う */
const BUNDLED_FONT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "inter.ttf");

/** SVG 文字列 → シーン。baseDir は `<image href="logo.png">` を探す場所（無ければ探さない）。 */
function vectorSceneOf(
  svgText: string,
  baseDir: string | null,
  origin: string,
  maxElements?: number,
  fonts?: Array<{ family?: string; path: string }>
) {
  const userFonts: VectorFont[] = (fonts ?? []).map((f) => {
    const p = resolve(f.path);
    if (!existsSync(p)) throw new Error(`Font file not found: ${p}`);
    return { label: basename(p), bytes: new Uint8Array(readFileSync(p)), family: f.family };
  });
  const scene = parseVectorScene(svgText, {
    maxElements,
    fonts: userFonts,
    ...(existsSync(BUNDLED_FONT)
      ? { fallbackFont: { label: "the bundled Inter", family: "Inter", bytes: new Uint8Array(readFileSync(BUNDLED_FONT)) } }
      : {}),
    // <image href="logo.png"> は SVG の隣を見る。**ネットワークには一切出ない**
    // （http(s) は svgImport が警告して捨てる）
    resolveHref: (href) => {
      if (!baseDir) return null;
      const p = resolve(baseDir, decodeURIComponent(href.split("#")[0]));
      return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
    },
  });
  if (!scene.elements.length) throw new Error(`No drawable elements found in ${origin}.`);
  return { svgText, scene };
}

function vectorSceneFrom(
  svgPath: string,
  maxElements?: number,
  fonts?: Array<{ family?: string; path: string }>
) {
  const src = resolve(svgPath);
  if (!existsSync(src)) throw new Error(`SVG not found: ${src}`);
  return vectorSceneOf(readFileSync(src, "utf8"), dirname(src), src, maxElements, fonts);
}

/** Figma REST 経路（M5）。**FIGMA_TOKEN が無ければ何も起きない** — このサーバーが
 *  ネットワークに出るのはここだけで、既定はローカル完結のまま。取ってきた SVG は
 *  svgPath とまったく同じ経路を通る（下流に「どこから来たか」は伝わらない）。 */
async function vectorSceneFromFigma(
  figmaUrl: string,
  maxElements?: number,
  fonts?: Array<{ family?: string; path: string }>
) {
  const { svg, ref } = await fetchFigmaSvg(figmaUrl, { token: process.env.FIGMA_TOKEN });
  // baseDir は無い。Figma の書き出しはビットマップを data URI で埋めてくるので、
  // 相対パスの <image> はそもそも出てこない
  return { ...vectorSceneOf(svg, null, `Figma node ${ref.nodeId}`, maxElements, fonts), ref };
}

/** 頂点座標・画像バイト列・SVG 断片をそのまま返すとツールの応答がそれで埋まる。要約だけ載せる。 */
function withoutVertices(elements: UiElement[]) {
  return elements.map((e) => {
    const { shapes, imageBytes, svgFragment, ...rest } = e;
    const out: Record<string, unknown> = { ...rest };
    if (shapes) {
      out.vertices = shapes.reduce(
        (n, s) => n + (s.subpaths?.reduce((m, sp) => m + sp.points.length, 0) ?? s.points?.length ?? 0), 0);
    }
    if (imageBytes) out.imageBytes = imageBytes.length;
    if (svgFragment) out.rasterizedText = true;
    return out;
  });
}

/** riv_ui_prototype の SVG 経路。スクリーンショット経路との違いは
 *  **元画像を一切埋め込まないこと**（切り出しも base も無い）だけ。 */
async function svgPrototype(a: {
  svgPath?: string; figmaUrl?: string; outPath: string;
  roles: Array<{ id: number; role: string; name?: string }>;
  maxElements?: number; interactions?: boolean;
  entranceMs?: number; stagger?: number; ambient?: boolean;
  fonts?: Array<{ family?: string; path: string }>;
}): Promise<ToolResult> {
  const { scene } = a.svgPath
    ? vectorSceneFrom(a.svgPath, a.maxElements, a.fonts)
    : await vectorSceneFromFigma(a.figmaUrl!, a.maxElements, a.fonts);
  // ラスタへ降格したテキストだけはブラウザが要る（その 1 行を透明背景で焼く）。
  // シーンを組み立てる前に済ませて、下流には bytes だけを渡す
  await attachTextRasters(scene.elements, host);
  const roleById = new Map(a.roles.map((r) => [r.id, r]));
  const unknownIds = a.roles.filter((r) => !scene.elements.some((e) => e.id === r.id)).map((r) => r.id);
  const withRoles = scene.elements.map((e) => {
    const r = roleById.get(e.id);
    // 明示指定が無ければレイヤー名から読めたロールを使う。汎用パネルに落とす前に、
    // 元データが持っている唯一の意味情報を使い切る
    return { ...e, role: r?.role ?? e.roleHint ?? "panel", name: r?.name ?? e.layerName };
  });

  const built = buildPrototypeScene({
    elements: withRoles,
    source: { width: scene.width, height: scene.height },
    interactions: a.interactions ?? true,
    motion: { entranceMs: a.entranceMs, stagger: a.stagger, ambient: a.ambient ?? true },
    fonts: scene.fonts,
  });
  // **base 画像を貼らない。** スクリーンショット経路が最背面に元画像を置くのは
  // 「検出できなかった画素を失わないため」で、ベクター入力にはそれが無い。貼ると
  // 要素を動かした瞬間に下から同じ絵が出てきて二重になる（ラスタ切り出しと同じ壊れ方）。
  const out = resolve(a.outPath);
  mkdirSync(dirname(out), { recursive: true });
  const { bytes, warnings: writerWarnings } = createRiv(built.spec);
  writeFileSync(out, bytes);

  const warnings = [...scene.warnings, ...built.warnings, ...(writerWarnings ?? [])];
  if (unknownIds.length) {
    warnings.push(
      `These ids are not in the element list and were ignored: ${unknownIds.join(", ")}. ` +
        `Check that ${a.svgPath ? "svgPath" : "figmaUrl"} and maxElements match the riv_ui_detect call.`
    );
  }
  if (a.figmaUrl) {
    // ファイルと違い、2 回の呼び出しの間にデザインが変わりうる。id が動く唯一の理由なので明示する
    warnings.push(
      `The frame was fetched from Figma again for this call. If it changed since riv_ui_detect, ` +
        `the element ids in roles may no longer line up.`
    );
  }
  const editable = editableRatio(scene.elements);
  const roleCounts: Record<string, number> = {};
  for (const e of withRoles) roleCounts[e.role] = (roleCounts[e.role] ?? 0) + 1;
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        outPath: out,
        bytes: bytes.length,
        source: { width: scene.width, height: scene.height, kind: a.figmaUrl ? "figma" : "svg" },
        elements: withRoles.length,
        editable: `${editable.editable}/${editable.total}`,
        text: scene.textStats,
        // ベクター経路で画像アセットになるのは、SVG に埋め込まれていたビットマップと
        // ラスタへ降格したテキストだけ。元画像の切り出しは 1 枚も無い
        rasterAssets: built.spec.images?.length ?? 0,
        animations: built.spec.animations?.map((an) => an.name) ?? [],
        stateMachines: (Array.isArray(built.spec.stateMachine)
          ? built.spec.stateMachine
          : built.spec.stateMachine ? [built.spec.stateMachine] : []).map((sm) => sm.name),
        roleCounts,
        warnings,
        next: "Render it with riv_render_gif or open it in riv_studio.",
      }, null, 1),
    }],
  };
}

server.registerTool(
  "riv_ui_detect",
  {
    title: "Detect UI elements in a screenshot",
    description:
      "Find the rectangles, text runs and images in a UI screenshot or design comp. Returns a nested element tree with rects, corner radii and fill colours, plus a numbered overlay PNG. Coordinates come back in the source resolution but are recovered from a downscaled analysis, so expect a pixel or two, and corner radii within about a pixel. Each element carries renderMode (\"vector-panel\" | \"raster\" — how it would be reconstructed; flat fills are test-rendered and turned into crops when more than 2% of their visible pixels would differ, the measured share is returned as renderRisk) and semanticHint (\"panel\" | \"text\" | \"image\" | \"line\" — what it looks like) as independent fields. Look at the overlay, give each element a role, and pass the result to riv_ui_prototype to get an animated .riv. This is geometry only — it does not know a button from a card. If you have the vector source, pass svgPath instead of imagePath: nothing is estimated, the element tree is the SVG's own group nesting, non-rectangular artwork comes through as \"vector-shape\" with its real bezier vertices, <text> becomes \"vector-text\" (editable Rive text — the bundled Inter is substituted unless you pass fonts, and a run whose glyphs are missing is baked as a picture instead, always with a warning), embedded <image> data comes through as its own pixels, and Figma layer names arrive as roleHint.",
    inputSchema: {
      imagePath: z.string().optional().describe("Screenshot or design comp (PNG/JPEG)"),
      svgPath: z.string().optional().describe("Vector source instead of a screenshot (Figma/Illustrator SVG export). Nothing is estimated: rects, fills, corner radii and nesting come straight from the file"),
      figmaUrl: z.string().optional().describe("A Figma link to one frame (Copy link to selection), fetched as SVG through the Figma REST API. Off unless FIGMA_TOKEN is set in the server's environment; without it this errors and nothing is requested. Everything else works offline"),
      overlayPath: z.string().optional().describe("Where to write the numbered overlay PNG"),
      minArea: z.number().optional().describe("Ignore regions smaller than this many pixels (default 576). imagePath only"),
      maxElements: z.number().optional().describe("Keep at most this many elements, largest first (default 120, or 300 for svgPath)"),
      fonts: z
        .array(z.object({
          family: z.string().optional().describe("The SVG font-family this file is for. Omit to use it for every run"),
          path: z.string().describe("Path to a .ttf/.otf file"),
        }))
        .optional()
        .describe("Fonts for the SVG's <text>. svgPath only — pass the same list to riv_ui_prototype"),
    },
  },
  wrap(async (a: { imagePath?: string; svgPath?: string; figmaUrl?: string; overlayPath?: string; minArea?: number; maxElements?: number; fonts?: Array<{ family?: string; path: string }> }) => {
    if ([a.imagePath, a.svgPath, a.figmaUrl].filter(Boolean).length > 1) {
      return err("Pass one of imagePath, svgPath or figmaUrl, not several");
    }
    if (a.svgPath || a.figmaUrl) {
      const { svgText, scene } = a.svgPath
        ? vectorSceneFrom(a.svgPath, a.maxElements, a.fonts)
        : await vectorSceneFromFigma(a.figmaUrl!, a.maxElements, a.fonts);
      let overlayPath: string | undefined;
      if (a.overlayPath) {
        // オーバーレイは SVG をラスタライズした絵の上に描く（番号を見て役割を決めるのは
        // 人/LLM なので、見るものはスクリーンショット経路と同じ形でなければならない）
        overlayPath = resolve(a.overlayPath);
        writeFileSync(overlayPath, await host.drawOverlay(await host.rasterize(svgText), overlayLabels(scene.elements)));
      }
      const editable = editableRatio(scene.elements);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            source: { width: scene.width, height: scene.height, kind: a.figmaUrl ? "figma" : "svg" },
            elements: withoutVertices(scene.elements),
            palette: paletteFromColors(
              scene.elements.filter((e) => e.fill).map((e) => ({ hex: e.fill!, weight: e.rect[2] * e.rect[3] }))
            ),
            overlayPath,
            dropped: scene.dropped,
            editable: `${editable.editable}/${editable.total}`,
            text: scene.textStats,
            warnings: scene.warnings,
            next: `Assign a role to each element, then call riv_ui_prototype with the same ${a.figmaUrl ? "figmaUrl" : "svgPath"}.`,
          }, null, 1),
        }],
      };
    }
    if (!a.imagePath) return err("Provide imagePath (screenshot), svgPath (vector source) or figmaUrl");
    const src = resolve(a.imagePath);
    if (!existsSync(src)) return err(`Image not found: ${src}`);
    const png = readFileSync(src);
    const det = await detectUiElements(host, png, { minArea: a.minArea ?? 576, maxElements: a.maxElements ?? 120 });
    if (!det.regions.length) {
      return err(
        `No UI elements detected in ${src}. The image may be a photograph, a gradient, or too small. ` +
          `Try lowering minArea (current ${a.minArea ?? 576}).`
      );
    }
    const { elements, dropped } = det;
    const palette = paletteFromColors(det.sampledColors);
    let overlayPath: string | undefined;
    if (a.overlayPath) {
      overlayPath = resolve(a.overlayPath);
      writeFileSync(overlayPath, await host.drawOverlay(png, overlayLabels(elements)));
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          source: { width: det.width, height: det.height },
          elements,
          palette,
          overlayPath,
          dropped,
          // 反実仮想判定の結果。要素の renderRisk と対で読む数字なので、
          // 要素の中だけでなく要約としても返す（何件が判定で動いたかが一目で分かる）
          demoted: det.demoted,
          patched: det.patched,
          next: "Assign a role to each element, then call riv_ui_prototype.",
        }, null, 1),
      }],
    };
  })
);

// ---- riv_ui_prototype ----------------------------------------------------
// riv_ui_detect が返した要素にロールを付けて渡すと、動くプロトタイプ(.riv)を書き出す。
// **検出をここで再実行してロールを id で突き合わせる。** 要素の全文をもう一度
// 送らせない代わりに、minArea/maxElements は riv_ui_detect と同じ値でなければ
// id がずれる（検出自体は決定的なので、同じ画像と同じ引数なら同じ id になる）。
server.registerTool(
  "riv_ui_prototype",
  {
    title: "Turn a detected UI screenshot into an animated .riv",
    description:
      "Take the elements from riv_ui_detect, assign each one a role, and get back a working .riv: every element becomes a shape or an image asset, each gets an entrance appropriate to its role, and buttons and cards get hover and press states. Roles: " +
      (Object.keys(ROLE_MOTION) as Role[]).join(", ") +
      ". Elements you leave unassigned animate as a generic panel. Pass the same imagePath (or svgPath), minArea and maxElements you gave riv_ui_detect, or the ids will not line up. With svgPath no screenshot is embedded, every element stays editable, and the file reproduces the SVG; its <text> becomes real Rive text you can re-type at runtime, and its embedded <image> data becomes an image asset. figmaUrl fetches the same thing straight from Figma, and needs FIGMA_TOKEN.",
    inputSchema: {
      imagePath: z.string().optional().describe("The same screenshot you passed to riv_ui_detect"),
      svgPath: z.string().optional().describe("The same SVG you passed to riv_ui_detect (instead of imagePath)"),
      figmaUrl: z.string().optional().describe("The same Figma link you passed to riv_ui_detect. Off unless FIGMA_TOKEN is set in the server's environment. The frame is fetched again, so a design that changed in between can move the ids"),
      outPath: z.string().describe("Where to write the .riv"),
      roles: z
        .array(
          z.object({
            id: z.number().describe("Element id from riv_ui_detect"),
            role: z.string().describe("One of the roles listed in the description"),
            name: z.string().optional().describe("Name for this object inside the .riv"),
          })
        )
        .describe("Role for each element. Ids you omit fall back to a generic panel."),
      minArea: z.number().optional().describe("Must match the riv_ui_detect call (default 576)"),
      maxElements: z.number().optional().describe("Must match the riv_ui_detect call (default 120)"),
      interactions: z.boolean().optional().describe("Add hover and press states where the role has them (default true)"),
      entranceMs: z.number().optional().describe("How long the whole entrance takes, in milliseconds"),
      stagger: z.number().optional().describe("Delay between elements entering, in milliseconds"),
      ambient: z.boolean().optional().describe("Give roles with an idle motion a looping ambient animation (default true)"),
      fonts: z
        .array(z.object({
          family: z.string().optional().describe("The SVG font-family this file is for. Omit to use it for every run"),
          path: z.string().describe("Path to a .ttf/.otf file"),
        }))
        .optional()
        .describe("Fonts for the SVG's <text>. svgPath only. Without a match the bundled Inter is used and a warning says so; a run whose glyphs the font lacks (CJK, say) is baked as a picture rather than embedded as tofu"),
    },
  },
  wrap(async (a: {
    imagePath?: string; svgPath?: string; figmaUrl?: string; outPath: string;
    roles: Array<{ id: number; role: string; name?: string }>;
    minArea?: number; maxElements?: number; interactions?: boolean;
    entranceMs?: number; stagger?: number; ambient?: boolean;
    fonts?: Array<{ family?: string; path: string }>;
  }) => {
    if ([a.imagePath, a.svgPath, a.figmaUrl].filter(Boolean).length > 1) {
      return err("Pass one of imagePath, svgPath or figmaUrl, not several");
    }
    if (a.svgPath || a.figmaUrl) return svgPrototype(a);
    if (!a.imagePath) return err("Provide imagePath (screenshot), svgPath (vector source) or figmaUrl");
    const src = resolve(a.imagePath);
    if (!existsSync(src)) return err(`Image not found: ${src}`);
    const png = readFileSync(src);
    const det = await detectUiElements(host, png, { minArea: a.minArea ?? 576, maxElements: a.maxElements ?? 120 });
    if (!det.regions.length) {
      return err(
        `No UI elements detected in ${src}. Run riv_ui_detect first to see what this image gives you.`
      );
    }
    const { elements, dropped } = det;

    const roleById = new Map(a.roles.map((r) => [r.id, r]));
    const unknownIds = a.roles.filter((r) => !elements.some((e) => e.id === r.id)).map((r) => r.id);
    const withRoles = elements.map((e) => {
      const r = roleById.get(e.id);
      return { ...e, role: r?.role ?? "panel", name: r?.name };
    });

    const built = buildPrototypeScene({
      elements: withRoles,
      source: { width: det.width, height: det.height },
      interactions: a.interactions ?? true,
      motion: { entranceMs: a.entranceMs, stagger: a.stagger, ambient: a.ambient ?? true },
    });

    // ラスタ要素は元画像から切り出して .riv に埋め込む。切り出す領域が無ければ
    // 元画像をまるごと base として持たせる（背景が消えた .riv を作らないため）。
    const sliced = built.rasterRegions.length
      ? await host.sliceImage(png, built.rasterRegions)
      : { width: det.width, height: det.height, parts: [], base: png.toString("base64") };
    attachRasterAssets(built.spec, sliced);

    const out = resolve(a.outPath);
    mkdirSync(dirname(out), { recursive: true });
    const { bytes, warnings: writerWarnings } = createRiv(built.spec);
    writeFileSync(out, bytes);

    const warnings = [...built.warnings, ...(writerWarnings ?? [])];
    if (unknownIds.length) {
      warnings.push(
        `These ids are not in the detected element list and were ignored: ${unknownIds.join(", ")}. ` +
          `Check that minArea and maxElements match the riv_ui_detect call.`
      );
    }
    if (dropped > 0) {
      warnings.push(`${dropped} smaller elements were dropped by the maxElements cap.`);
    }
    // 反実仮想判定で動いた件数。要素の renderMode を見れば分かるが、**使う側が見るのは
    // warnings** なので、「編集できるはずのものが切り抜きになった」理由をここに出す。
    if (det.demoted > 0) {
      warnings.push(
        `${det.demoted} flat ${det.demoted === 1 ? "fill was" : "fills were"} turned into crops ` +
          `because the screenshot disagreed with painting them flat. Their renderRisk says by how much.`
      );
    }
    if (det.patched > 0) {
      const patchCount = elements.filter((e) => e.renderPatch).length;
      warnings.push(
        `${det.patched} ${det.patched === 1 ? "fill was" : "fills were"} kept as vectors with ` +
          `${patchCount} cut-out ${patchCount === 1 ? "patch" : "patches"} on top ` +
          `(an accent bar, a dashed line or an icon that nothing else covers).`
      );
    }

    const roleCounts: Record<string, number> = {};
    for (const e of withRoles) roleCounts[e.role] = (roleCounts[e.role] ?? 0) + 1;

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          outPath: out,
          bytes: bytes.length,
          source: { width: det.width, height: det.height },
          elements: withRoles.length,
          demoted: det.demoted,
          patched: det.patched,
          rasterAssets: sliced.parts.length,
          animations: built.spec.animations?.map((an) => an.name) ?? [],
          stateMachines: (Array.isArray(built.spec.stateMachine)
            ? built.spec.stateMachine
            : built.spec.stateMachine ? [built.spec.stateMachine] : []).map((sm) => sm.name),
          roleCounts,
          warnings,
          next: "Render it with riv_render_gif or open it in riv_studio.",
        }, null, 1),
      }],
    };
  })
);

// ---- riv_setup -----------------------------------------------------------
// 同梱スキルをクライアント環境へコピーする。MCPのツール許可プロンプトが
// そのまま「確認だけされて任意」のUXになる（勝手には書き込まれない）。
server.registerTool(
  "riv_setup",
  {
    title: "Install the bundled rive-design-guidelines skill into this environment",
    description:
      "One-time setup: copies the bundled `rive-design-guidelines` skill (the mandatory tokens → pro-asset ingestion → presets → critique workflow, asset-source registry, icon-animation recipes and craft rules) into the client's skills directory so it auto-triggers on future Rive work — .claude/skills/ in the current project (scope=project, default) or ~/.claude/skills/ for all projects (scope=user). Idempotent: re-running updates the skill to this server version's copy. Recommended on first use of this server in a new environment; clients without skill support can read the same content via the rive-design-guidelines MCP prompt instead.",
    inputSchema: {
      scope: z.enum(["project", "user"]).optional().describe("project = <projectDir>/.claude/skills (default), user = ~/.claude/skills"),
      projectDir: z.string().optional().describe("Project root for scope=project (default: current working directory)"),
    },
  },
  wrap(async ({ scope, projectDir }: { scope?: "project" | "user"; projectDir?: string }) => {
    const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
    if (!existsSync(srcDir)) return err(`Bundled skills directory not found at ${srcDir}`);
    const destBase =
      (scope ?? "project") === "user"
        ? join(homedir(), ".claude", "skills")
        : join(resolve(projectDir ?? process.cwd()), ".claude", "skills");
    const copied: string[] = [];
    const copyDir = (from: string, to: string) => {
      mkdirSync(to, { recursive: true });
      for (const entry of readdirSync(from, { withFileTypes: true })) {
        const f = join(from, entry.name);
        const t = join(to, entry.name);
        if (entry.isDirectory()) copyDir(f, t);
        else {
          copyFileSync(f, t);
          copied.push(t);
        }
      }
    };
    copyDir(srcDir, destBase);
    return {
      content: [{
        type: "text",
        text:
          `Installed ${copied.length} skill file(s) to ${destBase}:\n${copied.map((c) => `- ${c}`).join("\n")}\n` +
          `The skill auto-triggers on future non-trivial Rive design work (it may require restarting the client session to be picked up).`,
      }],
    };
  })
);

// ---- prompts -------------------------------------------------------------
server.registerPrompt(
  "rive-design-guidelines",
  {
    title: "Rive design quality guidelines",
    description:
      "Guidelines for producing polished, non-\"AI-generated-looking\" .riv output with riv_create — color, gradients, easing semantics, organic curves, rigging.",
  },
  () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `When building a scene with riv_create, aim for the quality of a modern SaaS product or game UI, not flat placeholder shapes.

**Mandatory workflow for any non-trivial scene**:
1. \`riv_design_tokens\` (seed/mood/scheme) → use ONLY the returned palette/gradients/durations/easings/spacing. Never invent raw hex colors or ad-hoc durations.
2. **Ingest professional artwork — do NOT free-draw illustrative art.** Characters/objects/icons must come from a pro source: \`riv_asset_search\` (Iconify, needs network), \`riv_import_svg\` (Figma/Illustrator exports, or npm SVG sets when network is limited: \`npm pack @twemoji/svg\` CC-BY 4.0, \`@mdi/svg\`, \`@tabler/icons\`), or \`riv_decompile\` (remix pro-made .riv art + its hand-tuned animation tracks). Hand-drawn primitives are for backgrounds/panels/particles only. **Respect the asset's viewpoint**: state its facing direction & perspective (side/isometric/front) before animating — movers travel toward their own visual front, and the whole scene keeps ONE consistent perspective (isometric art never sits on a flat side-view ground).
3. \`riv_create\` — express motion with \`presets\` (pop-in, rise-in+stagger, float, breathing, …) instead of hand-authored keyframes wherever a preset fits; hand-keyframe only what presets can't express. Icon micro-animation recipe: riv_asset_search icon → \`spin\` (loader) / \`pop-in\`·\`tada\` (success) / \`shake\` (error) / \`glow-pulse\` (notification) / stroke-trim draw-on.
4. \`riv_critique\` — read the filmstrip (time left→right), onion skin (motion trails) and motion report (displacement vectors), check every mover's direction against its artwork's facing, score the 7-axis checklist, fix anything below 4 with riv_edit or a regenerate, and re-run. Iterate at least twice.

Craft knowledge for the parts you author by hand:
- **Color**: no saturated primaries (#FF0000-style). Use \`fill.gradient\` on hero shapes far more often than flat \`fill.color\`.
- **Organic curves**: \`shapes[].points[].cubic: { rotation, distance }\` turns a vertex into a bezier handle. 4-point circle: points at 0/90/180/270°, \`cubic.rotation\` along the tangent, \`distance ≈ radius * 0.5523\`. Use for blobs and organic forms — never chains of straight segments.
- **Easing semantics**: a keyframe's \`easing\` describes the motion *arriving at* that keyframe, so it goes on the later keyframe (first keyframe easing has no effect). Enters decelerate (\`emphasized-decel\`/\`ease-out\`), exits accelerate (\`emphasized-accel\`/\`ease-in\`), back-and-forth is \`ease-in-out\`, springy pop-ins are \`elastic-out\` (optional \`amplitude\`/\`period\`). Never leave transform tracks all-linear — riv_lint flags this as motion-robotic.
- **Physics bake**: prefer \`bake: { type: "pendulum"|"wind"|"spring"|"gravity", ... }\` for anything that sways, drops, or bounces.
- **Rigging**: chain \`bones\`/RootBone with \`mesh.bones\` skinning for anything that bends; add \`constraints: [{type:"ik"}]\` for reaching/pointing instead of hand-animating bone rotations.
- **Known limitation**: \`fill.feather\`/\`stroke.feather\` writes correctly but is NOT rendered by this server's Canvas2D preview pipeline — only Rive's GPU renderer shows it.`,
        },
      },
    ],
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
