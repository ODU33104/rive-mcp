// riv_critique 用の決定論的メトリクス計算
// レンダ画像(VLM側で見る)+ここで数えられる客観指標+固定チェックリストを1回のツール呼び出しで
// 返し、「見て→採点して→直す」ループを最小トークンで回せるようにする。
import { readRiv } from "./rivBinary.js";
import { lintRiv, type LintFinding } from "./rivLint.js";

export interface CritiqueMetrics {
  vector: { bezierPaths: number; cubicVertices: number; straightVertices: number; primitives: number; pathRatio: number };
  color: {
    distinctFills: number;
    palette: string[]; // 使用頻度順、最大12
    gradientFills: number;
    solidFills: number;
    oversaturated: string[]; // OKLCH chroma > 0.23 の原色系
    pureBlackOrWhite: string[];
  };
  motion: {
    keyframes: number;
    animations: number;
    easingDistribution: { hold: number; linear: number; cubic: number };
    elasticInterpolators: number;
  };
  structure: { bones: number; constraints: number; stateMachines: number; listeners: number; nestedArtboards: number };
  lint: LintFinding[];
}

// リーダーは colorValue を "#aarrggbb" 文字列で返す(数値のままの場合にも対応)
function argbToHex(v: unknown): string | null {
  if (typeof v === "number") return "#" + (v & 0xffffff).toString(16).padStart(6, "0");
  if (typeof v === "string" && /^#[0-9a-f]{8}$/i.test(v)) return "#" + v.slice(3).toLowerCase();
  if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  return null;
}

// designTokens.ts の逆変換を再利用せず軽量に: sRGB→OKLCh chroma 近似判定用
function chromaOf(hex: string): number {
  const n = hex.replace("#", "");
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const r = lin(parseInt(n.slice(0, 2), 16) / 255);
  const g = lin(parseInt(n.slice(2, 4), 16) / 255);
  const b = lin(parseInt(n.slice(4, 6), 16) / 255);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  return Math.hypot(A, B);
}

export function computeMetrics(bytes: Uint8Array): CritiqueMetrics {
  const dump = readRiv(bytes, { tolerant: true });
  const count = new Map<string, number>();
  const fillColors = new Map<string, number>();
  let holdK = 0, linearK = 0, cubicK = 0;

  for (const o of dump.objects) {
    count.set(o.typeName, (count.get(o.typeName) ?? 0) + 1);
    if (o.typeName === "SolidColor" || o.typeName === "GradientStop") {
      const hex = argbToHex(o.properties.colorValue);
      if (hex) fillColors.set(hex, (fillColors.get(hex) ?? 0) + 1);
    }
    if (o.typeName.startsWith("KeyFrame")) {
      const it = (o.properties.interpolationType as number) ?? 1;
      if (it === 0) holdK++;
      else if (it === 1) linearK++;
      else cubicK++;
    }
  }
  const c = (n: string) => count.get(n) ?? 0;
  const primitives = c("Rectangle") + c("Ellipse");
  const bezier = c("PointsPath");
  const palette = [...fillColors.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
  const oversaturated = palette.filter((h) => chromaOf(h) > 0.23);
  const bw = palette.filter((h) => h === "#000000" || h === "#ffffff");

  return {
    vector: {
      bezierPaths: bezier,
      cubicVertices: c("CubicMirroredVertex") + c("CubicAsymmetricVertex") + c("CubicDetachedVertex"),
      straightVertices: c("StraightVertex"),
      primitives,
      pathRatio: Math.round((bezier / Math.max(1, bezier + primitives)) * 100) / 100,
    },
    color: {
      distinctFills: palette.length,
      palette: palette.slice(0, 12),
      gradientFills: c("LinearGradient") + c("RadialGradient"),
      solidFills: c("SolidColor"),
      oversaturated,
      pureBlackOrWhite: bw,
    },
    motion: {
      keyframes: holdK + linearK + cubicK,
      animations: c("LinearAnimation"),
      easingDistribution: { hold: holdK, linear: linearK, cubic: cubicK },
      elasticInterpolators: c("ElasticInterpolator"),
    },
    structure: {
      bones: c("RootBone") + c("Bone"),
      constraints: c("IKConstraint") + c("TransformConstraint") + c("DistanceConstraint"),
      stateMachines: c("StateMachine"),
      listeners: c("StateMachineListenerSingle"),
      nestedArtboards: c("NestedArtboard"),
    },
    lint: lintRiv(bytes),
  };
}

// クライアント(VLM)が添付フレームを見て採点するための固定チェックリスト。
// 自由記述より checklist 採点の方が専門家一致率が高い(ArtifactsBench)。短く保つこと。
export const CRITIQUE_CHECKLIST = `Score each axis 1-5 by LOOKING at the attached frames (3=acceptable, 4=professional). If any axis < 4, fix and re-run riv_critique. Iterate at least twice before delivering.
1. Silhouette & composition — clear focal point, balanced negative space, aligned elements
2. Color — harmonious palette (see metrics.color: oversaturated/pureBlackOrWhite should be empty; prefer gradients on hero shapes)
3. Depth & polish — gradients/overlap/scale variation create depth; no flat "placeholder" look
4. Motion physicality — eased arrivals/departures (metrics.motion.easingDistribution.linear should be small for transforms), overshoot/spring where playful
5. Timing — staggered entrances, varied durations, nothing teleports (check lint motion-* findings)
6. Shape quality — organic forms use bezier paths (metrics.vector.pathRatio near 1 for illustrations; primitives only for genuinely geometric UI)`;
