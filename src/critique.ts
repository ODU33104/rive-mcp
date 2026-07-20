// riv_critique 用の決定論的メトリクス計算
// レンダ画像(VLM側で見る)+ここで数えられる客観指標+固定チェックリストを1回のツール呼び出しで
// 返し、「見て→採点して→直す」ループを最小トークンで回せるようにする。
import { deflateSync } from "node:zlib";
import { readRiv, loadDefs } from "./rivBinary.js";
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
export const CRITIQUE_CHECKLIST = `Score each axis 1-5 by LOOKING at the attached images (3=acceptable, 4=professional). The FILMSTRIP reads left→right in time; the ONION SKIN overlays all frames so trajectories appear as ghost trails. If any axis < 4, fix and re-run riv_critique. Iterate at least twice before delivering.
1. Silhouette & composition — clear focal point, balanced negative space, aligned elements
2. Color — harmonious palette (see metrics.color: oversaturated/pureBlackOrWhite should be empty; prefer gradients on hero shapes)
3. Depth & polish — gradients/overlap/scale variation create depth; no flat "placeholder" look
4. Motion physicality — eased arrivals/departures (metrics.motion.easingDistribution.linear should be small for transforms), overshoot/spring where playful
5. Timing — staggered entrances, varied durations, nothing teleports (check lint motion-* findings)
6. Shape quality — organic forms use bezier paths (metrics.vector.pathRatio near 1 for illustrations; primitives only for genuinely geometric UI)
7. Spatial & directional coherence — the scene's viewpoint must be ONE consistent perspective: artwork drawn isometric/three-quarter must not sit on a flat side-view ground (and vice versa). Every mover's travel direction (see MOTION REPORT vectors + onion-skin trails) must match the direction the artwork visually faces — a vehicle/character/rocket must move toward its own front, never sideways or backwards. Shadows and ground contact must agree with the same viewpoint.`;

// ---- 動きを「見える化」する合成画像 -------------------------------------
// 静止画しか見られないVLMのために、時間方向をフィルムストリップ(横連結)と
// オニオンスキン(軌跡の重ね焼き)へ射影する。

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

export function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const idat = deflateSync(raw);
  const chunks: Uint8Array[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    chunks.push(out);
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  chunk("IHDR", ihdr);
  chunk("IDAT", idat);
  chunk("IEND", new Uint8Array(0));
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export function composeFilmstrip(frames: Uint8Array[], w: number, h: number, gap = 2): { rgba: Uint8Array; width: number; height: number } {
  const width = frames.length * w + (frames.length - 1) * gap;
  const rgba = new Uint8Array(width * h * 4).fill(255);
  frames.forEach((f, i) => {
    const x0 = i * (w + gap);
    for (let y = 0; y < h; y++) {
      rgba.set(f.subarray(y * w * 4, (y + 1) * w * 4), (y * width + x0) * 4);
    }
  });
  return { rgba, width, height: h };
}

export function composeOnionSkin(frames: Uint8Array[], w: number, h: number): { rgba: Uint8Array; width: number; height: number } {
  // 最初のフレームを土台に、後続を半透明で順に重ねる(最後のフレームは濃く)。
  // 動くものは軌跡状の残像になり、静止物はそのまま残る。
  const acc = Float32Array.from(frames[0]);
  for (let i = 1; i < frames.length; i++) {
    const a = i === frames.length - 1 ? 0.85 : 0.45;
    const f = frames[i];
    for (let p = 0; p < acc.length; p++) acc[p] = acc[p] * (1 - a) + f[p] * a;
  }
  const rgba = new Uint8Array(acc.length);
  for (let p = 0; p < acc.length; p++) rgba[p] = Math.round(acc[p]);
  for (let p = 3; p < rgba.length; p += 4) rgba[p] = 255;
  return { rgba, width: w, height: h };
}

// ---- モーションベクトル解析 (データから直接。レンダ不要) -----------------
// 各アニメーションの「何がどっちへどれだけ動くか」をテキスト化する。
// 素材の向きと進行方向の照合(チェックリスト7)に使う。

export function motionReport(bytes: Uint8Array): string {
  const dump = readRiv(bytes, { tolerant: true });
  const objects = dump.objects;
  const defs = loadDefs();
  const keyOf = new Map<number, string>();
  if (defs) {
    for (const [tn, props] of [
      ["Node", { x: "x", y: "y" }],
      ["TransformComponent", { rotation: "rotation", scaleX: "scaleX", scaleY: "scaleY" }],
      ["WorldTransformComponent", { opacity: "opacity" }],
    ] as const) {
      const t = defs.types[tn];
      if (!t) continue;
      for (const [pn, label] of Object.entries(props)) {
        const k = t.properties[pn]?.key;
        if (k !== undefined) keyOf.set(k, label);
      }
    }
  }
  const lines: string[] = [];
  let abStart = -1;
  const names = new Map<number, string>();
  let animName = "";
  let objectLi = -1;
  let prop = "";
  let first: number | null = null, last: number | null = null;
  type Mv = { name: string; dx: number; dy: number; rot: number; scale: number };
  let movers = new Map<number, Mv>();

  const flushProp = () => {
    if (objectLi < 0 || first === null || last === null || !prop) { first = last = null; return; }
    const delta = last - first;
    if (Math.abs(delta) < (prop.startsWith("scale") ? 0.02 : 0.5)) { first = last = null; return; }
    let m = movers.get(objectLi);
    if (!m) { m = { name: names.get(objectLi) ?? `object#${objectLi}`, dx: 0, dy: 0, rot: 0, scale: 0 }; movers.set(objectLi, m); }
    if (prop === "x") m.dx = delta;
    else if (prop === "y") m.dy = delta;
    else if (prop === "rotation") m.rot = (delta * 180) / Math.PI;
    else if (prop.startsWith("scale")) m.scale = Math.max(m.scale, Math.abs(delta));
    first = last = null;
  };
  const flushAnim = () => {
    flushProp();
    if (!animName || !movers.size) { movers = new Map(); return; }
    const entries = [...movers.values()]
      .map((m) => ({ ...m, dist: Math.hypot(m.dx, m.dy) }))
      .sort((a, b) => b.dist - a.dist)
      .slice(0, 10);
    const dir = (m: { dx: number; dy: number }) => {
      const parts: string[] = [];
      if (Math.abs(m.dy) > 2) parts.push(m.dy < 0 ? "up" : "down");
      if (Math.abs(m.dx) > 2) parts.push(m.dx < 0 ? "left" : "right");
      return parts.length ? parts.join("-") : "in place";
    };
    lines.push(`animation "${animName}":`);
    for (const m of entries) {
      const bits: string[] = [];
      if (m.dist >= 2) bits.push(`moves ${dir(m)} (${Math.round(m.dx)}, ${Math.round(m.dy)})px`);
      if (Math.abs(m.rot) >= 2) bits.push(`rotates ${Math.round(m.rot)}°`);
      if (m.scale >= 0.02) bits.push(`scales ±${m.scale.toFixed(2)}`);
      if (bits.length) lines.push(`  - ${m.name}: ${bits.join(", ")}`);
    }
    movers = new Map();
  };

  for (let gi = 0; gi < objects.length; gi++) {
    const o = objects[gi];
    switch (o.typeName) {
      case "Artboard":
        flushAnim(); animName = "";
        abStart = gi;
        names.clear();
        break;
      case "LinearAnimation":
        flushAnim();
        animName = (o.properties.name as string) ?? "?";
        break;
      case "KeyedObject":
        flushProp();
        objectLi = (o.properties.objectId as number) ?? -1;
        break;
      case "KeyedProperty":
        flushProp();
        prop = keyOf.get((o.properties.propertyKey as number) ?? -1) ?? "";
        break;
      case "KeyFrameDouble":
        if (prop && animName) {
          const v = (o.properties.value as number) ?? 0;
          if (first === null) first = v;
          last = v;
        }
        break;
      default:
        if (abStart >= 0 && typeof o.properties.name === "string" && !animName) {
          names.set(gi - abStart, o.properties.name);
        }
    }
  }
  flushAnim();
  return lines.length
    ? `MOTION REPORT (net displacement per animation — verify each direction matches the artwork's facing):\n${lines.join("\n")}`
    : "MOTION REPORT: no transform motion found.";
}
