// riv_batch_render: 複数の .riv × 複数フォーマットを1呼び出しで逐次書き出す (CI向け)。
// 同一の RiveHost (headless Chromium 1ページ) を使い回し、1ジョブずつ順番にレンダーする。
// 1ジョブの失敗は全体を止めず、ジョブごとの成否レポートを返す。
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, type Dirent } from "node:fs";
import { resolve, join, dirname, basename, extname } from "node:path";
import type { RiveHost } from "./riveHost.js";
import { encodeGif } from "./gif.js";
import { encodeApng } from "./apng.js";

export type BatchFormat = "png" | "gif" | "apng" | "webm" | "sprites";

export interface BatchJobSpec {
  rivPath?: string;
  glob?: string;
  format?: BatchFormat;
  outDir?: string;
  artboard?: string;
  animation?: string;
  stateMachine?: string;
  width?: number;
  height?: number;
  background?: string;
  time?: number;
  duration?: number;
  fps?: number;
  transparent?: boolean;
  loops?: number;
  count?: number;
}

export interface BatchJobResult {
  job: number; // index into the input jobs array
  rivPath: string;
  format: string;
  outPath?: string;
  success: boolean;
  error?: string;
  durationMs: number;
}

export interface BatchRenderReport {
  total: number;
  succeeded: number;
  failed: number;
  totalMs: number;
  results: BatchJobResult[];
}

// ---- 自前の簡易 glob（Node標準 fs.globSync は Node22+ 限定。package.json は node>=20 なので依存しない） --
// '*' = 1セグメント内の任意文字列、'**' = 0個以上のディレクトリ階層。それ以外は対応しない。
function escapeRegexChar(c: string): string {
  return /[.*+?^${}()|[\]\\]/.test(c) ? "\\" + c : c;
}

function segmentToRegex(seg: string): RegExp {
  let re = "";
  for (const c of seg) re += c === "*" ? "[^/\\\\]*" : escapeRegexChar(c);
  return new RegExp(`^${re}$`, "i");
}

export function simpleGlob(pattern: string, cwd: string): string[] {
  const norm = pattern.replace(/\\/g, "/");
  let rootDir: string;
  let segments: string[];
  if (/^[A-Za-z]:\//.test(norm)) {
    rootDir = norm.slice(0, 2) + "\\";
    segments = norm.slice(3).split("/").filter(Boolean);
  } else if (norm.startsWith("/")) {
    rootDir = "/";
    segments = norm.slice(1).split("/").filter(Boolean);
  } else {
    rootDir = cwd;
    segments = norm.split("/").filter(Boolean);
  }
  const results: string[] = [];
  const walk = (dir: string, segIdx: number) => {
    if (segIdx >= segments.length) return;
    const seg = segments[segIdx];
    const isLast = segIdx === segments.length - 1;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (seg === "**") {
      if (isLast) {
        for (const e of entries) {
          const p = join(dir, e.name);
          if (e.isDirectory()) walk(p, segIdx);
          else results.push(p);
        }
        return;
      }
      walk(dir, segIdx + 1); // '**' matches zero directories too
      for (const e of entries) {
        if (e.isDirectory()) walk(join(dir, e.name), segIdx);
      }
      return;
    }
    const re = segmentToRegex(seg);
    for (const e of entries) {
      if (!re.test(e.name)) continue;
      const p = join(dir, e.name);
      if (isLast) {
        if (e.isFile()) results.push(p);
      } else if (e.isDirectory()) {
        walk(p, segIdx + 1);
      }
    }
  };
  walk(rootDir, 0);
  return results.sort();
}

function loadRivBytes(path: string): Buffer {
  if (!existsSync(path)) throw new Error(`File not found: ${path}`);
  const bytes = readFileSync(path);
  if (bytes.length < 4 || bytes.toString("latin1", 0, 4) !== "RIVE") {
    throw new Error(`Not a .riv file (missing RIVE fingerprint): ${path}`);
  }
  return bytes;
}

function resolveFiles(job: BatchJobSpec, cwd: string): string[] {
  if (job.rivPath) {
    const abs = resolve(cwd, job.rivPath);
    return existsSync(abs) ? [abs] : [];
  }
  if (job.glob) {
    return simpleGlob(job.glob, cwd).filter((f) => f.toLowerCase().endsWith(".riv"));
  }
  return [];
}

function outputPath(file: string, job: BatchJobSpec, ext: string, cwd: string): string {
  const dir = resolve(cwd, job.outDir ?? dirname(file));
  return join(dir, `${basename(file, extname(file))}.${ext}`);
}

async function inferDuration(host: RiveHost, bytes: Buffer, job: BatchJobSpec): Promise<number> {
  if (job.duration !== undefined) return job.duration;
  if (job.stateMachine) return 2;
  const info = await host.inspect(bytes);
  const ab = info.artboards.find((x) => x.name === job.artboard) ?? info.artboards[0];
  const anim = ab?.animations.find((x) => x.name === job.animation) ?? ab?.animations[0];
  return anim?.durationSeconds ?? 2;
}

async function renderOne(host: RiveHost, file: string, job: BatchJobSpec, cwd: string): Promise<string> {
  const bytes = loadRivBytes(file);
  const format = job.format;
  if (!format) throw new Error("format is required (png|gif|apng|webm|sprites)");

  switch (format) {
    case "png": {
      const r = await host.renderFrames(bytes, {
        artboard: job.artboard,
        animation: job.animation,
        stateMachine: job.stateMachine,
        startTime: job.time ?? 0,
        frameCount: 1,
        width: job.width,
        height: job.height,
        background: job.background,
        format: "png",
      });
      const out = outputPath(file, job, "png", cwd);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, Buffer.from(r.frames[0], "base64"));
      return out;
    }
    case "gif": {
      const fps = job.fps ?? 20;
      const duration = job.duration ?? 2;
      const frameCount = Math.min(Math.round(fps * duration), 600);
      const r = await host.renderFrames(bytes, {
        artboard: job.artboard,
        animation: job.animation,
        stateMachine: job.stateMachine,
        startTime: 0,
        frameCount,
        fps,
        width: job.width ?? 480,
        background: job.background ?? "#ffffff",
        format: "rgba",
      });
      const gif = encodeGif(r.frames.map((f) => Buffer.from(f, "base64")), r.width, r.height, fps);
      const out = outputPath(file, job, "gif", cwd);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, gif);
      return out;
    }
    case "apng": {
      const fps = job.fps ?? 20;
      const duration = job.duration ?? 2;
      const frameCount = Math.min(Math.round(fps * duration), 600);
      const transparent = job.transparent ?? true;
      const r = await host.renderFrames(bytes, {
        artboard: job.artboard,
        animation: job.animation,
        stateMachine: job.stateMachine,
        startTime: 0,
        frameCount,
        fps,
        width: job.width ?? 480,
        height: job.height,
        background: transparent ? undefined : job.background ?? "#ffffff",
        format: "png",
      });
      const apng = encodeApng(
        r.frames.map((f) => new Uint8Array(Buffer.from(f, "base64"))),
        { delayMs: Math.round(1000 / fps), loops: job.loops ?? 0 }
      );
      const out = outputPath(file, job, "apng", cwd);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, apng);
      return out;
    }
    case "webm": {
      const duration = await inferDuration(host, bytes, job);
      const fps = job.fps ?? 30;
      const r = await host.renderVideo(bytes, {
        artboard: job.artboard,
        animation: job.animation,
        stateMachine: job.stateMachine,
        duration,
        fps,
        width: job.width,
        height: job.height,
        background: job.background,
      });
      const out = outputPath(file, job, "webm", cwd);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, Buffer.from(r.base64, "base64"));
      return out;
    }
    case "sprites": {
      const duration = await inferDuration(host, bytes, job);
      const r = await host.renderSprites(bytes, {
        artboard: job.artboard,
        animation: job.animation,
        stateMachine: job.stateMachine,
        count: job.count ?? 16,
        duration,
        fps: job.fps,
        width: job.width,
        height: job.height,
        background: job.background,
      });
      const out = outputPath(file, job, "sprites.png", cwd);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, Buffer.from(r.image, "base64"));
      const metaPath = out.replace(/\.sprites\.png$/, ".sprites.json");
      writeFileSync(
        metaPath,
        JSON.stringify({ cellW: r.cellW, cellH: r.cellH, cols: r.cols, rows: r.rows, count: r.count, fps: r.fps }, null, 2)
      );
      return out;
    }
    default:
      throw new Error(`Unknown format: ${format}`);
  }
}

export async function runBatchRender(
  host: RiveHost,
  jobs: BatchJobSpec[],
  defaults: BatchJobSpec | undefined,
  cwd: string
): Promise<BatchRenderReport> {
  const results: BatchJobResult[] = [];
  const overallStart = Date.now();
  for (let ji = 0; ji < jobs.length; ji++) {
    const job: BatchJobSpec = { ...defaults, ...jobs[ji] };
    const files = resolveFiles(job, cwd);
    if (!files.length) {
      results.push({
        job: ji,
        rivPath: job.rivPath ?? job.glob ?? "?",
        format: job.format ?? "?",
        success: false,
        error: job.rivPath
          ? `File not found: ${resolve(cwd, job.rivPath)}`
          : `No .riv files matched glob: ${job.glob ?? "(neither rivPath nor glob given)"}`,
        durationMs: 0,
      });
      continue;
    }
    for (const file of files) {
      const start = Date.now();
      try {
        const outPath = await renderOne(host, file, job, cwd);
        results.push({ job: ji, rivPath: file, format: job.format!, outPath, success: true, durationMs: Date.now() - start });
      } catch (e) {
        results.push({
          job: ji,
          rivPath: file,
          format: job.format ?? "?",
          success: false,
          error: e instanceof Error ? e.message : String(e),
          durationMs: Date.now() - start,
        });
      }
    }
  }
  const succeeded = results.filter((r) => r.success).length;
  return { total: results.length, succeeded, failed: results.length - succeeded, totalMs: Date.now() - overallStart, results };
}
