// riv_ab_compare: 2つの .riv を同条件でレンダーし、横/縦並びの1本の GIF/APNG に合成する
// (目視レビュー用。riv_visual_diff の画素差分とは役割が異なる — あちらは同一素材の定量比較、
// こちらは別々の素材を並べて眺めるためのもの)。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join, dirname, basename, extname } from "node:path";
import type { RiveHost } from "./riveHost.js";
import { encodeGif } from "./gif.js";
import { encodeApng } from "./apng.js";
import { encodePng } from "./critique.js";

export interface AbCompareOptions {
  pathA: string;
  pathB: string;
  artboard?: string;
  animation?: string;
  stateMachine?: string;
  width?: number;
  height?: number;
  fps?: number;
  duration?: number;
  background?: string;
  format?: "gif" | "apng";
  layout?: "horizontal" | "vertical";
  labels?: boolean;
  out?: string;
}

export interface AbCompareResult {
  outPath: string;
  format: "gif" | "apng";
  layout: "horizontal" | "vertical";
  width: number;
  height: number;
  frameCount: number;
  fps: number;
  durationA: number;
  durationB: number;
  targetDuration: number;
  previewFramePng: string; // base64 PNG of the first composited frame
}

function loadRivBytes(path: string): { bytes: Buffer; abs: string } {
  const abs = resolve(path);
  if (!existsSync(abs)) throw new Error(`File not found: ${abs}`);
  const bytes = readFileSync(abs);
  if (bytes.length < 4 || bytes.toString("latin1", 0, 4) !== "RIVE") {
    throw new Error(`Not a .riv file (missing RIVE fingerprint): ${abs}`);
  }
  return { bytes, abs };
}

async function resolveDuration(
  host: RiveHost,
  bytes: Buffer,
  artboard?: string,
  animation?: string,
  stateMachine?: string
): Promise<number> {
  if (stateMachine) return 2;
  const info = await host.inspect(bytes);
  const ab = (artboard && info.artboards.find((a) => a.name === artboard)) || info.artboards[0];
  const anim = animation ? ab?.animations.find((a) => a.name === animation) : ab?.animations[0];
  return anim?.durationSeconds ?? 2;
}

// ---- 極小 3x5 ビットマップフォント（自前構築。ラベル焼き込み専用・大文字化して使う） -------------
const FONT3X5: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "001", "001", "001"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  A: ["010", "101", "111", "101", "101"],
  B: ["110", "101", "110", "101", "110"],
  C: ["011", "100", "100", "100", "011"],
  D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "110", "100", "111"],
  F: ["111", "100", "110", "100", "100"],
  G: ["011", "100", "101", "101", "011"],
  H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
  J: ["001", "001", "001", "101", "010"],
  K: ["101", "101", "110", "101", "101"],
  L: ["100", "100", "100", "100", "111"],
  M: ["101", "111", "111", "101", "101"],
  N: ["101", "111", "111", "111", "101"],
  O: ["010", "101", "101", "101", "010"],
  P: ["110", "101", "110", "100", "100"],
  Q: ["010", "101", "101", "111", "011"],
  R: ["110", "101", "110", "101", "101"],
  S: ["011", "100", "010", "001", "110"],
  T: ["111", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "111"],
  V: ["101", "101", "101", "101", "010"],
  W: ["101", "101", "111", "111", "101"],
  X: ["101", "101", "010", "101", "101"],
  Y: ["101", "101", "010", "010", "010"],
  Z: ["111", "001", "010", "100", "111"],
  ".": ["000", "000", "000", "000", "010"],
  ":": ["000", "010", "000", "010", "000"],
  "-": ["000", "000", "111", "000", "000"],
  _: ["000", "000", "000", "000", "111"],
  "/": ["001", "001", "010", "100", "100"],
  " ": ["000", "000", "000", "000", "000"],
};

function glyphRows(ch: string): string[] {
  return FONT3X5[ch.toUpperCase()] ?? FONT3X5[" "];
}

// テキストをRGBAバッファに直接焼き込む（半透明の黒帯 + 白ピクセル文字）
function drawLabelBar(rgba: Uint8Array, width: number, height: number, text: string, x0: number, y0: number, scale: number): void {
  const charW = 3, charH = 5, gap = 1;
  const cellW = (charW + gap) * scale;
  const textWidth = text.length * cellW;
  const textHeight = charH * scale;
  const pad = scale * 2;
  const barX0 = Math.max(0, x0 - pad);
  const barY0 = Math.max(0, y0 - pad);
  const barX1 = Math.min(width, x0 + textWidth + pad);
  const barY1 = Math.min(height, y0 + textHeight + pad);
  for (let y = barY0; y < barY1; y++) {
    for (let x = barX0; x < barX1; x++) {
      const idx = (y * width + x) * 4;
      rgba[idx] = Math.round(rgba[idx] * 0.25);
      rgba[idx + 1] = Math.round(rgba[idx + 1] * 0.25);
      rgba[idx + 2] = Math.round(rgba[idx + 2] * 0.25);
      rgba[idx + 3] = 255;
    }
  }
  for (let ci = 0; ci < text.length; ci++) {
    const rows = glyphRows(text[ci]);
    const cx0 = x0 + ci * cellW;
    for (let ry = 0; ry < charH; ry++) {
      const row = rows[ry];
      for (let rx = 0; rx < charW; rx++) {
        if (row[rx] !== "1") continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = cx0 + rx * scale + sx;
            const py = y0 + ry * scale + sy;
            if (px < 0 || px >= width || py < 0 || py >= height) continue;
            const idx = (py * width + px) * 4;
            rgba[idx] = 255;
            rgba[idx + 1] = 255;
            rgba[idx + 2] = 255;
            rgba[idx + 3] = 255;
          }
        }
      }
    }
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const n = hex.replace("#", "");
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

function compositeSideBySide(
  a: Uint8Array,
  b: Uint8Array,
  w: number,
  h: number,
  layout: "horizontal" | "vertical",
  gap: number,
  dividerHex: string
): { rgba: Uint8Array; width: number; height: number } {
  const [dr, dg, db] = hexToRgb(dividerHex);
  const width = layout === "vertical" ? w : w * 2 + gap;
  const height = layout === "vertical" ? h * 2 + gap : h;
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    rgba[p * 4] = dr;
    rgba[p * 4 + 1] = dg;
    rgba[p * 4 + 2] = db;
    rgba[p * 4 + 3] = 255;
  }
  if (layout === "vertical") {
    for (let y = 0; y < h; y++) {
      rgba.set(a.subarray(y * w * 4, (y + 1) * w * 4), y * width * 4);
      rgba.set(b.subarray(y * w * 4, (y + 1) * w * 4), (h + gap + y) * width * 4);
    }
  } else {
    for (let y = 0; y < h; y++) {
      rgba.set(a.subarray(y * w * 4, (y + 1) * w * 4), y * width * 4);
      rgba.set(b.subarray(y * w * 4, (y + 1) * w * 4), (y * width + w + gap) * 4);
    }
  }
  return { rgba, width, height };
}

export async function runAbCompare(host: RiveHost, opts: AbCompareOptions): Promise<AbCompareResult> {
  const { bytes: bytesA, abs: absA } = loadRivBytes(opts.pathA);
  const { bytes: bytesB, abs: absB } = loadRivBytes(opts.pathB);
  const format = opts.format ?? "gif";
  const layout = opts.layout ?? "horizontal";
  const labels = opts.labels ?? true;
  const fps = opts.fps ?? 20;

  const durA = await resolveDuration(host, bytesA, opts.artboard, opts.animation, opts.stateMachine);
  const durB = await resolveDuration(host, bytesB, opts.artboard, opts.animation, opts.stateMachine);
  const targetDuration = Math.min(30, opts.duration ?? Math.max(durA, durB, 0.05));

  const totalFrames = Math.min(600, Math.max(1, Math.round(fps * targetDuration)));
  const countA = Math.min(totalFrames, Math.max(1, Math.round(fps * Math.min(durA, targetDuration))));
  const countB = Math.min(totalFrames, Math.max(1, Math.round(fps * Math.min(durB, targetDuration))));

  const background = opts.background ?? (format === "gif" ? "#ffffff" : undefined);

  const resultA = await host.renderFrames(bytesA, {
    artboard: opts.artboard,
    animation: opts.stateMachine ? undefined : opts.animation,
    stateMachine: opts.stateMachine,
    startTime: 0,
    frameCount: countA,
    fps,
    width: opts.width ?? 320,
    height: opts.height,
    background,
    format: "rgba",
  });
  // B は A が確定した幅・高さに強制して揃える（riv_visual_diff と同様、並べる以上サイズ一致が必須）
  const resultB = await host.renderFrames(bytesB, {
    artboard: opts.artboard,
    animation: opts.stateMachine ? undefined : opts.animation,
    stateMachine: opts.stateMachine,
    startTime: 0,
    frameCount: countB,
    fps,
    width: resultA.width,
    height: resultA.height,
    background,
    format: "rgba",
  });

  const w = resultA.width, h = resultA.height;
  const framesA = resultA.frames.map((f) => new Uint8Array(Buffer.from(f, "base64")));
  const framesB = resultB.frames.map((f) => new Uint8Array(Buffer.from(f, "base64")));
  const nameA = basename(absA), nameB = basename(absB);
  const dividerHex = "#202020";

  const composed: Uint8Array[] = [];
  let composedWidth = 0, composedHeight = 0;
  for (let i = 0; i < totalFrames; i++) {
    // 尺の短い方はfreeze: 自分の最終フレームを繰り返す
    const fa = new Uint8Array(framesA[Math.min(i, framesA.length - 1)]);
    const fb = new Uint8Array(framesB[Math.min(i, framesB.length - 1)]);
    if (labels) {
      drawLabelBar(fa, w, h, `A: ${nameA}`, 6, 6, 2);
      drawLabelBar(fb, w, h, `B: ${nameB}`, 6, 6, 2);
    }
    const { rgba, width, height } = compositeSideBySide(fa, fb, w, h, layout, 4, dividerHex);
    composedWidth = width;
    composedHeight = height;
    composed.push(rgba);
  }

  const defaultOut = join(dirname(absA), `${basename(absA, extname(absA))}.vs.${basename(absB, extname(absB))}.ab.${format}`);
  const outPath = resolve(opts.out ?? defaultOut);
  mkdirSync(dirname(outPath), { recursive: true });

  if (format === "gif") {
    const gif = encodeGif(composed.map((c) => Buffer.from(c)), composedWidth, composedHeight, fps);
    writeFileSync(outPath, gif);
  } else {
    const pngFrames = composed.map((c) => encodePng(c, composedWidth, composedHeight));
    const apng = encodeApng(pngFrames, { delayMs: Math.round(1000 / fps), loops: 0 });
    writeFileSync(outPath, apng);
  }

  const previewFramePng = Buffer.from(encodePng(composed[0], composedWidth, composedHeight)).toString("base64");

  return {
    outPath,
    format,
    layout,
    width: composedWidth,
    height: composedHeight,
    frameCount: totalFrames,
    fps,
    durationA: durA,
    durationB: durB,
    targetDuration,
    previewFramePng,
  };
}
