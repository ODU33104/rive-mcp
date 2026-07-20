// デザイントークン生成(決定論的・依存なし)
// LLMに生の16進数やdurationを発明させると「AIっぽい安さ」の主因になる。
// シード色+ムードから、OKLCH色空間で調和の取れたパレット・M3準拠モーショントークン・
// 余白/角丸/文字スケールをサーバー側で生成し、モデルは「役割名」だけ使う。
// OKLab変換: Björn Ottosson (https://bottosson.github.io/posts/oklab/)

export interface TokenRequest {
  seed?: string; // #RRGGBB。省略時はmoodの既定色相
  mood?: Mood;
  scheme?: "dark" | "light";
}
export type Mood = "calm" | "playful" | "elegant" | "tech" | "warm" | "natural";

// ---- sRGB <-> OKLCH -------------------------------------------------------
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
function hexToOklch(hex: string): { l: number; c: number; h: number } {
  const n = hex.replace("#", "");
  const r = srgbToLinear(parseInt(n.slice(0, 2), 16) / 255);
  const g = srgbToLinear(parseInt(n.slice(2, 4), 16) / 255);
  const b = srgbToLinear(parseInt(n.slice(4, 6), 16) / 255);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}
function oklchToRgb(l: number, c: number, h: number): [number, number, number] | null {
  const hr = (h * Math.PI) / 180;
  const A = c * Math.cos(hr), B = c * Math.sin(hr);
  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
  const g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
  const b = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_;
  const out: [number, number, number] = [r, g, b].map(linearToSrgb) as [number, number, number];
  if (out.some((v) => v < -0.001 || v > 1.001)) return null;
  return out.map((v) => Math.min(1, Math.max(0, v))) as [number, number, number];
}
// 色域外なら chroma を落として必ずsRGBに収める
export function oklch(l: number, c: number, h: number): string {
  let rgb = oklchToRgb(l, c, h);
  let cc = c;
  while (!rgb && cc > 0.001) {
    cc *= 0.92;
    rgb = oklchToRgb(l, cc, h);
  }
  if (!rgb) rgb = oklchToRgb(l, 0, h) ?? [0, 0, 0];
  return (
    "#" + rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")
  );
}

// WCAG相対輝度・コントラスト比
function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => srgbToLinear(parseInt(n.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 10) / 10;
}

// ---- ムード定義 -----------------------------------------------------------
interface MoodDef {
  defaultHue: number;
  chroma: number; // primary の彩度上限
  accentShift: number; // アクセント色相の回転(調和: 類似±30 / 補色系150-210)
  bgChroma: number;
}
const MOODS: Record<Mood, MoodDef> = {
  calm: { defaultHue: 230, chroma: 0.09, accentShift: 40, bgChroma: 0.015 },
  playful: { defaultHue: 20, chroma: 0.17, accentShift: 160, bgChroma: 0.03 },
  elegant: { defaultHue: 300, chroma: 0.06, accentShift: -250, bgChroma: 0.008 }, // accent≒gold(50)
  tech: { defaultHue: 210, chroma: 0.14, accentShift: -60, bgChroma: 0.02 },
  warm: { defaultHue: 40, chroma: 0.13, accentShift: -25, bgChroma: 0.02 },
  natural: { defaultHue: 145, chroma: 0.1, accentShift: 65, bgChroma: 0.015 },
};

export function generateTokens(req: TokenRequest): Record<string, unknown> {
  const mood = req.mood ?? "calm";
  const scheme = req.scheme ?? "dark";
  const m = MOODS[mood];
  const seed = req.seed ? hexToOklch(req.seed) : { l: 0.65, c: m.chroma, h: m.defaultHue };
  const H = seed.h;
  const C = Math.min(seed.c || m.chroma, m.chroma + 0.04);
  const aH = (H + m.accentShift + 360) % 360;
  const dark = scheme === "dark";

  const palette = {
    bg: dark ? oklch(0.19, m.bgChroma, H) : oklch(0.97, m.bgChroma * 0.7, H),
    bgDeep: dark ? oklch(0.14, m.bgChroma, H) : oklch(0.93, m.bgChroma, H),
    surface: dark ? oklch(0.26, m.bgChroma * 1.6, H) : oklch(1.0, 0, H),
    primary: oklch(dark ? 0.7 : 0.55, C, H),
    primaryStrong: oklch(dark ? 0.62 : 0.45, C * 1.05, H),
    primarySoft: oklch(dark ? 0.42 : 0.85, C * 0.5, H),
    accent: oklch(dark ? 0.75 : 0.6, Math.min(C * 1.15, 0.19), aH),
    accentSoft: oklch(dark ? 0.45 : 0.88, C * 0.45, aH),
    text: dark ? oklch(0.93, 0.01, H) : oklch(0.25, 0.015, H),
    textMuted: dark ? oklch(0.7, 0.02, H) : oklch(0.5, 0.02, H),
    outline: dark ? oklch(0.38, 0.02, H) : oklch(0.82, 0.02, H),
  };
  const gradients = {
    // 明度と色相を同時にずらすと「デザインされた」グラデになる(単純な明暗より上質)
    primary: [oklch(dark ? 0.74 : 0.6, C, (H + 12) % 360), oklch(dark ? 0.58 : 0.44, C * 1.1, (H - 14 + 360) % 360)],
    accent: [oklch(dark ? 0.8 : 0.66, C, (aH + 10) % 360), oklch(dark ? 0.6 : 0.5, C * 1.1, (aH - 12 + 360) % 360)],
    bg: [palette.bg, palette.bgDeep],
  };
  return {
    mood, scheme,
    palette,
    gradients,
    contrast: {
      textOnBg: contrastRatio(palette.text, palette.bg),
      textOnSurface: contrastRatio(palette.text, palette.surface),
      mutedOnBg: contrastRatio(palette.textMuted, palette.bg),
      primaryOnBg: contrastRatio(palette.primary, palette.bg),
    },
    // フレーム数@60fps。M3 motion tokens準拠(tap≒100ms/enter≒450ms/exit≒250ms)
    motion: {
      fps: 60,
      durations: { tap: 6, exit: 15, enter: 27, emphasis: 30, ambientCycleSec: 3.5 },
      easing: { enter: "emphasized-decel", exit: "emphasized-accel", move: "smooth", spring: "elastic-out", loop: "ease-in-out" },
      rule: "enter=decelerate, exit=accelerate, never linear on x/y/scale/rotation",
    },
    layout: {
      spacing: [4, 8, 12, 16, 24, 32, 48, 64],
      radius: { s: 6, m: 12, l: 20, pill: 999 },
      strokeWidth: { hairline: 1.5, regular: 2.5, bold: 4 },
    },
    type: { sizes: { caption: 13, body: 16, subtitle: 20, title: 28, display: 44 } },
    usage:
      "Use ONLY these values in the scene spec. bg/bgDeep for backdrop (prefer gradients.bg), " +
      "surface for cards, primary for the hero element, accent sparingly (<=15% of area), " +
      "text/textMuted for typography. Pick sizes/spacing/radius from layout.*.",
  };
}
