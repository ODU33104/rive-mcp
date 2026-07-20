// Lottie (bodymovin) JSON → riv_create シーン仕様変換（実用サブセット）
// LottieFiles の膨大な無料プロ製アニメーション（形状だけでなく "タイミング・振付・
// イージング" まで作り込まれた完成品）を Rive 生成の素材として取り込むための変換器。
// rivDecompile.ts に倣い、対応外の機能は隠さず coverage.skipped / warnings に積む。
//
// 座標系の対応関係（重要）:
//   Lottie の各レイヤー/シェイプグループは anchor point(a) を中心に rotate/scale し、
//   position(p) がその anchor の親空間での位置になる: parent = p + R*S*(local - a)
//   Rive の Node は自分の (x,y) を原点として子のローカル座標をそのまま rotate/scale する:
//   parent = (x,y) + R*S*local
//   そのため anchor が非ゼロの場合は「OuterGroup(x=p,y=p, rotation/scale/opacity)」の下に
//   「InnerGroup(x=-ax,y=-ay)」を挟み、実コンテンツは InnerGroup の子として配置する。
//   これで parent = p + R*S*(-a + local) = p + R*S*(local-a) と一致する。
import type {
  ShapeSpec,
  GroupSpec,
  AnimationSpec,
  TrackSpec,
  KeyframeSpec,
} from "./rivWriter.js";

export interface LottieImportResult {
  width: number;
  height: number;
  fps: number;
  durationFrames: number;
  groups: GroupSpec[];
  shapes: ShapeSpec[];
  animations: AnimationSpec[];
  warnings: string[];
  coverage: { decompiled: number; skipped: Record<string, number>; warnings: string[] };
}

// ---- 変換コンテキスト -------------------------------------------------------
interface Ctx {
  frameOffset: number; // このスコープの t 値に足すと最終出力フレーム番号になる
  depth: number; // precomp インライン展開の深さ（6階層まで）
  precompStack: string[]; // 循環参照ガード (refIdのスタック)
  prefix: string;
  warnings: string[];
  groups: GroupSpec[];
  shapes: ShapeSpec[];
  tracks: TrackSpec[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assetsById: Map<string, any>;
  skip: (typeName: string) => void;
  layerTag: string;
  autoId: number;
  zCounter: number; // 単調減少。先に処理したレイヤー(配列先頭)ほど大きい値=前面
}

const newId = (ctx: Ctx, kind: string): string => `${ctx.prefix}${ctx.layerTag}_${kind}${ctx.autoId++}`;
const nextZ = (ctx: Ctx): number => ctx.zCounter--;

// ---- 汎用ヘルパ -------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const num = (v: any, d = 0): number => (typeof v === "number" ? v : d);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const arr = (v: any): number[] => (Array.isArray(v) ? v.map((x) => num(x)) : typeof v === "number" ? [v] : []);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

// Lottie の "animatable property" が実際にキーフレーム配列かどうか判定
// (a:1 フラグより k[0] の形状で判定する方が壊れたファイルにも頑健)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function kIsKeyframed(prop: any): boolean {
  return (
    !!prop &&
    Array.isArray(prop.k) &&
    prop.k.length > 0 &&
    typeof prop.k[0] === "object" &&
    prop.k[0] !== null &&
    !Array.isArray(prop.k[0]) &&
    "t" in prop.k[0]
  );
}
// 値(数値 or 配列)から成分を1つ取り出す。idx省略/範囲外は先頭成分にフォールバック
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function comp(v: any, idx: number): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) return typeof v[idx] === "number" ? v[idx] : typeof v[0] === "number" ? v[0] : undefined;
  return typeof v === "number" ? v : undefined;
}
// animatable property の「代表値」(静的値 or 先頭キーフレームの値)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function staticNum(prop: any, idx: number, d: number): number {
  if (!prop) return d;
  if (kIsKeyframed(prop)) {
    const v = comp(prop.k[0]?.s, idx);
    return v !== undefined ? v : d;
  }
  const v = comp(prop.k, idx);
  return v !== undefined ? v : d;
}

// Lottie の out-tangent(prev.o) / in-tangent(kf.i) から3次ベジェイージング [x1,y1,x2,y2] を作る。
// x(時間方向)は0-1にクランプ。実質 linear(0,0)-(1,1) は undefined を返す(通常のlinear扱い)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bezierFromTangents(o: any, i: any, idx: number): [number, number, number, number] | undefined {
  if (!o || !i) return undefined;
  const x1 = comp(o.x, idx), y1 = comp(o.y, idx), x2 = comp(i.x, idx), y2 = comp(i.y, idx);
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return undefined;
  if (Number.isNaN(x1) || Number.isNaN(y1) || Number.isNaN(x2) || Number.isNaN(y2)) return undefined;
  if (Math.abs(x1) < 1e-3 && Math.abs(y1) < 1e-3 && Math.abs(x2 - 1) < 1e-3 && Math.abs(y2 - 1) < 1e-3) return undefined;
  return [clamp01(x1), y1, clamp01(x2), y2];
}

function colorHex(rgb: [number, number, number], alpha01: number): string {
  const toHex = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0");
  const a = toHex(alpha01);
  return "#" + a + toHex(rgb[0]) + toHex(rgb[1]) + toHex(rgb[2]);
}

// キーフレーム配列(prop.k, a:1)から数値トラックを作る。channelIdx: ベクトル値の何番目の成分を読むか
function buildTrack(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kfs: any[],
  target: string,
  property: TrackSpec["property"],
  channelIdx: number,
  transform: (n: number) => number,
  ctx: Ctx,
  label: string
): TrackSpec {
  const keyframes: KeyframeSpec[] = [];
  let lastComp = 0;
  for (let idx = 0; idx < kfs.length; idx++) {
    const kf = kfs[idx];
    const frame = Math.max(0, Math.round(num(kf.t) + ctx.frameOffset));
    let raw = comp(kf.s, channelIdx);
    if (raw === undefined) {
      const prev = kfs[idx - 1];
      raw = prev ? comp(prev.e, channelIdx) ?? comp(prev.s, channelIdx) : undefined;
      if (raw === undefined) raw = lastComp;
      ctx.warnings.push(`${label}: keyframe ${idx} missing 's' — used fallback value`);
    }
    lastComp = raw;
    const kfSpec: KeyframeSpec = { frame, value: transform(raw) };
    if (idx > 0) {
      const prev = kfs[idx - 1];
      if (prev.h === 1) {
        kfSpec.easing = "hold";
      } else {
        const ez = bezierFromTangents(prev.o, kf.i, channelIdx);
        if (ez) kfSpec.easing = ez;
      }
    }
    keyframes.push(kfSpec);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (kfs.some((k: any) => k.ti || k.to)) {
    ctx.warnings.push(`${label}: spatial bezier tangents (ti/to) ignored — using straight-line interpolation between keyframe values`);
  }
  return { target, property, keyframes };
}

// fillColor 用(値が色)のトラック
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildColorTrack(kfs: any[], target: string, alpha: number, ctx: Ctx, label: string): TrackSpec {
  const keyframes: KeyframeSpec[] = [];
  for (let idx = 0; idx < kfs.length; idx++) {
    const kf = kfs[idx];
    const frame = Math.max(0, Math.round(num(kf.t) + ctx.frameOffset));
    const s = kf.s ?? kfs[idx - 1]?.e;
    const rgb: [number, number, number] = [comp(s, 0) ?? 0, comp(s, 1) ?? 0, comp(s, 2) ?? 0];
    const kfSpec: KeyframeSpec = { frame, color: colorHex(rgb, alpha) };
    if (idx > 0) {
      const prev = kfs[idx - 1];
      if (prev.h === 1) kfSpec.easing = "hold";
      else {
        const ez = bezierFromTangents(prev.o, kf.i, 0);
        if (ez) kfSpec.easing = ez;
      }
    }
    keyframes.push(kfSpec);
  }
  return { target, property: "fillColor", keyframes };
}

// レイヤー ks / シェイプグループ tr の共通トランスフォーム変換
interface TransformResult { x: number; y: number; rotation: number; scaleX: number; scaleY: number; opacity: number; ax: number; ay: number }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processTransform(ksIn: any, id: string, ctx: Ctx): TransformResult {
  const ks = ksIn ?? {};
  let x = 0, y = 0;
  const p = ks.p;
  if (p) {
    if (p.s) {
      // 分離X/Y形式 { s:true, x:{...}, y:{...} }
      x = staticNum(p.x, 0, 0);
      y = staticNum(p.y, 0, 0);
      if (kIsKeyframed(p.x)) ctx.tracks.push(buildTrack(p.x.k, id, "x", 0, (n) => n, ctx, `${id}.position.x`));
      if (kIsKeyframed(p.y)) ctx.tracks.push(buildTrack(p.y.k, id, "y", 0, (n) => n, ctx, `${id}.position.y`));
    } else if (kIsKeyframed(p)) {
      x = comp(p.k[0]?.s, 0) ?? 0;
      y = comp(p.k[0]?.s, 1) ?? 0;
      ctx.tracks.push(buildTrack(p.k, id, "x", 0, (n) => n, ctx, `${id}.position`));
      ctx.tracks.push(buildTrack(p.k, id, "y", 1, (n) => n, ctx, `${id}.position`));
    } else {
      x = comp(p.k, 0) ?? 0;
      y = comp(p.k, 1) ?? 0;
    }
  }

  const rotation = staticNum(ks.r, 0, 0);
  if (kIsKeyframed(ks.r)) ctx.tracks.push(buildTrack(ks.r.k, id, "rotation", 0, (n) => n, ctx, `${id}.rotation`));

  let scaleX = 1, scaleY = 1;
  if (ks.s) {
    scaleX = staticNum(ks.s, 0, 100) / 100;
    scaleY = staticNum(ks.s, 1, 100) / 100;
    if (kIsKeyframed(ks.s)) {
      ctx.tracks.push(buildTrack(ks.s.k, id, "scaleX", 0, (n) => n / 100, ctx, `${id}.scale.x`));
      ctx.tracks.push(buildTrack(ks.s.k, id, "scaleY", 1, (n) => n / 100, ctx, `${id}.scale.y`));
    }
  }

  const opacity = staticNum(ks.o, 0, 100) / 100;
  if (kIsKeyframed(ks.o)) ctx.tracks.push(buildTrack(ks.o.k, id, "opacity", 0, (n) => n / 100, ctx, `${id}.opacity`));

  const ax = staticNum(ks.a, 0, 0);
  const ay = staticNum(ks.a, 1, 0);
  if (kIsKeyframed(ks.a)) ctx.warnings.push(`${id}: animated anchor point not supported — using first-keyframe value`);
  if (ks.sk || ks.sa) ctx.warnings.push(`${id}: skew (sk/sa) not supported`);
  if (typeof ks.p?.x === "string" || typeof ks.r?.x === "string" || typeof ks.o?.x === "string") {
    ctx.warnings.push(`${id}: expression-driven property detected — evaluated as its raw keyframe/static value`);
  }

  return { x, y, rotation, scaleX, scaleY, opacity, ax, ay };
}

// ---- ベジェパス変換 (sh) ----------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shToPoints(shProp: any, warnings: string[], label: string): { closed: boolean; points: NonNullable<ShapeSpec["points"]> } | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pathData: any;
  if (kIsKeyframed(shProp)) {
    warnings.push(`${label}: animated path (shape morph) not supported — frozen to first keyframe`);
    pathData = shProp.k[0]?.s?.[0];
  } else {
    pathData = shProp?.k;
  }
  if (!pathData || !Array.isArray(pathData.v)) return null;
  const closed = !!pathData.c;
  const v: number[][] = pathData.v, i: number[][] = pathData.i ?? [], o: number[][] = pathData.o ?? [];
  const points = v.map((pt, n) => {
    const [x, y] = pt;
    const inD = i[n] ?? [0, 0];
    const outD = o[n] ?? [0, 0];
    const inDist = Math.hypot(inD[0] ?? 0, inD[1] ?? 0);
    const outDist = Math.hypot(outD[0] ?? 0, outD[1] ?? 0);
    if (inDist < 1e-4 && outDist < 1e-4) return { x, y };
    return {
      x, y,
      cubic: {
        rotation: (Math.atan2(outD[1] ?? 0, outD[0] ?? 0) * 180) / Math.PI,
        inRotation: (Math.atan2(inD[1] ?? 0, inD[0] ?? 0) * 180) / Math.PI,
        inDistance: inDist,
        outDistance: outDist,
      },
    };
  });
  return { closed, points: points as NonNullable<ShapeSpec["points"]> };
}

// ---- star/polygon (sr) → 静的polygon --------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function starPoints(item: any, warnings: string[], label: string): Array<{ x: number; y: number }> {
  const sy = num(item.sy, 1); // 1=star, 2=polygon
  const ptCount = Math.max(3, Math.round(staticNum(item.pt, 0, 5)));
  const orR = staticNum(item.or, 0, 50);
  const rotDeg = staticNum(item.r, 0, 0);
  const pts: Array<{ x: number; y: number }> = [];
  if (sy === 2) {
    for (let n = 0; n < ptCount; n++) {
      const a = ((rotDeg - 90 + (360 * n) / ptCount) * Math.PI) / 180;
      pts.push({ x: orR * Math.cos(a), y: orR * Math.sin(a) });
    }
  } else {
    const irR = staticNum(item.ir, 0, orR / 2);
    for (let n = 0; n < ptCount * 2; n++) {
      const r = n % 2 === 0 ? orR : irR;
      const a = ((rotDeg - 90 + (180 * n) / ptCount) * Math.PI) / 180;
      pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
    }
  }
  if (kIsKeyframed(item.pt) || kIsKeyframed(item.or) || kIsKeyframed(item.ir) || kIsKeyframed(item.r) || kIsKeyframed(item.p)) {
    warnings.push(`${label}: animated star/polygon parameters not supported — frozen to first keyframe`);
  }
  if (staticNum(item.is, 0, 0) !== 0 || staticNum(item.os, 0, 0) !== 0) {
    warnings.push(`${label}: star corner roundness (is/os) not supported — sharp corners used`);
  }
  const cx = staticNum(item.p, 0, 0), cy = staticNum(item.p, 1, 0);
  return pts.map((pt) => ({ x: pt.x + cx, y: pt.y + cy }));
}

// 混在ジオメトリのフォールバック用: ellipse/rect を4頂点ベジェで近似
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ellipseSubpath(item: any): { closed: boolean; points: NonNullable<ShapeSpec["points"]> } {
  const cx = staticNum(item.p, 0, 0), cy = staticNum(item.p, 1, 0);
  const rx = Math.abs(staticNum(item.s, 0, 100)) / 2, ry = Math.abs(staticNum(item.s, 1, 100)) / 2;
  const k = 0.5522847498;
  return {
    closed: true,
    points: [
      { x: cx, y: cy - ry, cubic: { rotation: 0, inRotation: 180, distance: k * rx } },
      { x: cx + rx, y: cy, cubic: { rotation: 90, inRotation: -90, distance: k * ry } },
      { x: cx, y: cy + ry, cubic: { rotation: 180, inRotation: 0, distance: k * rx } },
      { x: cx - rx, y: cy, cubic: { rotation: -90, inRotation: 90, distance: k * ry } },
    ],
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rectSubpath(item: any): { closed: boolean; points: NonNullable<ShapeSpec["points"]> } {
  const cx = staticNum(item.p, 0, 0), cy = staticNum(item.p, 1, 0);
  const w = Math.abs(staticNum(item.s, 0, 100)), h = Math.abs(staticNum(item.s, 1, 100));
  const r = Math.max(0, staticNum(item.r, 0, 0));
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  const mk = (x: number, y: number) => (r > 0 ? { x, y, radius: r } : { x, y });
  return { closed: true, points: [mk(x0, y0), mk(x1, y0), mk(x1, y1), mk(x0, y1)] };
}

// ---- 単独ジオメトリ → ネイティブ ellipse/rect ShapeSpec (トラック対応) --------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildEllipseShape(item: any, parentId: string, ctx: Ctx, label: string): ShapeSpec {
  const id = newId(ctx, "el");
  const px = staticNum(item.p, 0, 0), py = staticNum(item.p, 1, 0);
  const sw = Math.abs(staticNum(item.s, 0, 100)), sh = Math.abs(staticNum(item.s, 1, 100));
  const shape: ShapeSpec = { id, type: "ellipse", x: px, y: py, width: sw, height: sh, parent: parentId, z: nextZ(ctx) };
  if (kIsKeyframed(item.p)) {
    ctx.tracks.push(buildTrack(item.p.k, id, "x", 0, (n) => n, ctx, `${label}.p.x`));
    ctx.tracks.push(buildTrack(item.p.k, id, "y", 1, (n) => n, ctx, `${label}.p.y`));
  }
  if (kIsKeyframed(item.s)) {
    ctx.tracks.push(buildTrack(item.s.k, id, "width", 0, (n) => Math.abs(n), ctx, `${label}.s.w`));
    ctx.tracks.push(buildTrack(item.s.k, id, "height", 1, (n) => Math.abs(n), ctx, `${label}.s.h`));
  }
  return shape;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildRectShape(item: any, parentId: string, ctx: Ctx, label: string): ShapeSpec {
  const id = newId(ctx, "rc");
  const px = staticNum(item.p, 0, 0), py = staticNum(item.p, 1, 0);
  const sw = Math.abs(staticNum(item.s, 0, 100)), sh = Math.abs(staticNum(item.s, 1, 100));
  const shape: ShapeSpec = { id, type: "rect", x: px, y: py, width: sw, height: sh, parent: parentId, z: nextZ(ctx) };
  const r = staticNum(item.r, 0, 0);
  if (r) shape.cornerRadius = r;
  if (kIsKeyframed(item.r)) ctx.warnings.push(`${label}: animated rect corner radius not supported — using first value`);
  if (kIsKeyframed(item.p)) {
    ctx.tracks.push(buildTrack(item.p.k, id, "x", 0, (n) => n, ctx, `${label}.p.x`));
    ctx.tracks.push(buildTrack(item.p.k, id, "y", 1, (n) => n, ctx, `${label}.p.y`));
  }
  if (kIsKeyframed(item.s)) {
    ctx.tracks.push(buildTrack(item.s.k, id, "width", 0, (n) => Math.abs(n), ctx, `${label}.s.w`));
    ctx.tracks.push(buildTrack(item.s.k, id, "height", 1, (n) => Math.abs(n), ctx, `${label}.s.h`));
  }
  return shape;
}

interface GeomItem { kind: "sh" | "el" | "rc" | "sr"; /* eslint-disable-next-line @typescript-eslint/no-explicit-any */ item: any }
function buildPolygonShape(geomItems: GeomItem[], parentId: string, ctx: Ctx, label: string): ShapeSpec | null {
  const subpaths: Array<{ closed?: boolean; points: NonNullable<ShapeSpec["points"]> }> = [];
  for (const g of geomItems) {
    if (g.kind === "sh") {
      const r = shToPoints(g.item.ks, ctx.warnings, label);
      if (r && r.points.length >= 2) subpaths.push(r);
    } else if (g.kind === "sr") {
      const pts = starPoints(g.item, ctx.warnings, label);
      if (pts.length >= 3) subpaths.push({ closed: true, points: pts });
    } else if (g.kind === "el") {
      ctx.warnings.push(`${label}: ellipse combined with other geometry under one paint — approximated as bezier`);
      subpaths.push(ellipseSubpath(g.item));
    } else if (g.kind === "rc") {
      ctx.warnings.push(`${label}: rect combined with other geometry under one paint — approximated as bezier`);
      subpaths.push(rectSubpath(g.item));
    }
  }
  if (!subpaths.length) return null;
  const id = newId(ctx, "p");
  return { id, type: "polygon", x: 0, y: 0, parent: parentId, z: nextZ(ctx), subpaths };
}

// ---- 塗り/線 ------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applySolidFill(shape: ShapeSpec, item: any, ctx: Ctx, label: string): void {
  const alpha = staticNum(item.o, 0, 100) / 100;
  if (kIsKeyframed(item.o)) ctx.warnings.push(`${label}: fill opacity animation approximated using its first value`);
  const rgb: [number, number, number] = [staticNum(item.c, 0, 0), staticNum(item.c, 1, 0), staticNum(item.c, 2, 0)];
  shape.fill = { color: colorHex(rgb, alpha) };
  if (kIsKeyframed(item.c)) ctx.tracks.push(buildColorTrack(item.c.k, shape.id, alpha, ctx, `${label}.c`));
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyGradientFill(shape: ShapeSpec, item: any, ctx: Ctx, label: string): void {
  const stops = gradientStops(item.g, ctx.warnings, label);
  const sx = staticNum(item.s, 0, 0), sy = staticNum(item.s, 1, 0);
  const ex = staticNum(item.e, 0, 0), ey = staticNum(item.e, 1, 0);
  if (kIsKeyframed(item.s) || kIsKeyframed(item.e)) ctx.warnings.push(`${label}: animated gradient position not supported — frozen to first value`);
  shape.fill = { gradient: { type: item.t === 2 ? "radial" : "linear", stops, start: { x: sx, y: sy }, end: { x: ex, y: ey } } };
}
const CAP_MAP: Record<number, NonNullable<ShapeSpec["stroke"]>["cap"]> = { 1: "butt", 2: "round", 3: "square" };
const JOIN_MAP: Record<number, NonNullable<ShapeSpec["stroke"]>["join"]> = { 1: "miter", 2: "round", 3: "bevel" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applySolidStroke(shape: ShapeSpec, item: any, ctx: Ctx, label: string): void {
  const alpha = staticNum(item.o, 0, 100) / 100;
  if (kIsKeyframed(item.o)) ctx.warnings.push(`${label}: stroke opacity animation approximated using its first value`);
  const rgb: [number, number, number] = [staticNum(item.c, 0, 0), staticNum(item.c, 1, 0), staticNum(item.c, 2, 0)];
  const thickness = staticNum(item.w, 0, 1);
  if (kIsKeyframed(item.w)) ctx.warnings.push(`${label}: animated stroke width not supported — using first value`);
  if (kIsKeyframed(item.c)) ctx.warnings.push(`${label}: animated stroke color not supported — using first value`);
  shape.stroke = { color: colorHex(rgb, alpha), thickness };
  if (CAP_MAP[item.lc]) shape.stroke.cap = CAP_MAP[item.lc];
  if (JOIN_MAP[item.lj]) shape.stroke.join = JOIN_MAP[item.lj];
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyGradientStrokeApprox(shape: ShapeSpec, item: any, ctx: Ctx, label: string): void {
  const stops = gradientStops(item.g, ctx.warnings, label);
  const thickness = staticNum(item.w, 0, 1);
  if (kIsKeyframed(item.w)) ctx.warnings.push(`${label}: animated stroke width not supported — using first value`);
  ctx.warnings.push(`${label}: gradient stroke not supported by the writer — approximated as solid color (first stop)`);
  shape.stroke = { color: stops[0]?.color ?? "#888888", thickness };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function gradientStops(gProp: any, warnings: string[], label: string): Array<{ color: string; position: number }> {
  const numStops = num(gProp?.p, 0);
  const gk = gProp?.k;
  let flat: number[];
  if (kIsKeyframed(gk)) {
    warnings.push(`${label}: animated gradient stops not supported — frozen to first keyframe`);
    flat = arr(gk.k[0]?.s);
  } else {
    flat = arr(gk?.k ?? gk);
  }
  const stops: Array<{ color: string; position: number }> = [];
  for (let s = 0; s < numStops; s++) {
    const base = s * 4;
    if (base + 3 >= flat.length) break;
    stops.push({ position: flat[base], color: colorHex([flat[base + 1], flat[base + 2], flat[base + 3]], 1) });
  }
  return stops.length ? stops : [{ color: "#888888", position: 0 }];
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyTrim(tmItem: any, shapeId: string, ctx: Ctx, label: string): NonNullable<ShapeSpec["stroke"]>["trim"] {
  const s = staticNum(tmItem.s, 0, 0) / 100;
  const e = staticNum(tmItem.e, 0, 100) / 100;
  const o = staticNum(tmItem.o, 0, 0) / 360;
  if (kIsKeyframed(tmItem.s)) ctx.tracks.push(buildTrack(tmItem.s.k, shapeId, "trimStart", 0, (n) => n / 100, ctx, `${label}.tm.s`));
  if (kIsKeyframed(tmItem.e)) ctx.tracks.push(buildTrack(tmItem.e.k, shapeId, "trimEnd", 0, (n) => n / 100, ctx, `${label}.tm.e`));
  if (kIsKeyframed(tmItem.o)) ctx.tracks.push(buildTrack(tmItem.o.k, shapeId, "trimOffset", 0, (n) => n / 360, ctx, `${label}.tm.o`));
  return { start: s, end: e, offset: o };
}

// ---- シェイプグループの1レベル分の items[] を処理 -----------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processGroupLevel(items: any[], parentId: string, ctx: Ctx, label: string): void {
  const geomItems: GeomItem[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fl: any = null, st: any = null, gf: any = null, gs: any = null, tm: any = null;
  let flCount = 0, stCount = 0;
  for (const item of items ?? []) {
    if (item.hd) continue; // 非表示アイテム
    switch (item.ty) {
      case "gr":
        handleGroupItem(item, parentId, ctx);
        break;
      case "sh":
        geomItems.push({ kind: "sh", item });
        break;
      case "el":
        geomItems.push({ kind: "el", item });
        break;
      case "rc":
        geomItems.push({ kind: "rc", item });
        break;
      case "sr":
        geomItems.push({ kind: "sr", item });
        break;
      case "fl":
        fl = item; flCount++;
        break;
      case "st":
        st = item; stCount++;
        break;
      case "gf":
        gf = item; flCount++;
        break;
      case "gs":
        gs = item; stCount++;
        break;
      case "tm":
        tm = item;
        break;
      case "tr":
        break; // gr の transform は handleGroupItem 側で処理済み
      case "rp":
        ctx.skip("rp");
        ctx.warnings.push(`${label}: repeater (rp) not supported`);
        break;
      case "mm":
        ctx.skip("mm");
        ctx.warnings.push(`${label}: merge paths (mm) not supported`);
        break;
      default:
        ctx.skip(item.ty ?? "unknown-shape-item");
    }
  }
  if (flCount > 1) ctx.warnings.push(`${label}: multiple fills in one group — only the last is applied`);
  if (stCount > 1) ctx.warnings.push(`${label}: multiple strokes in one group — only the last is applied`);
  if (!geomItems.length) return;
  if (!fl && !st && !gf && !gs) {
    ctx.warnings.push(`${label}: geometry with no fill/stroke — skipped`);
    return;
  }

  let shape: ShapeSpec | null;
  if (geomItems.length === 1 && geomItems[0].kind === "el") shape = buildEllipseShape(geomItems[0].item, parentId, ctx, label);
  else if (geomItems.length === 1 && geomItems[0].kind === "rc") shape = buildRectShape(geomItems[0].item, parentId, ctx, label);
  else shape = buildPolygonShape(geomItems, parentId, ctx, label);
  if (!shape) return;

  if (gf) applyGradientFill(shape, gf, ctx, label);
  else if (fl) applySolidFill(shape, fl, ctx, label);
  if (gs) applyGradientStrokeApprox(shape, gs, ctx, label);
  else if (st) applySolidStroke(shape, st, ctx, label);
  if (tm) {
    if (shape.stroke) shape.stroke.trim = applyTrim(tm, shape.id, ctx, label);
    else ctx.warnings.push(`${label}: trim path (tm) without a stroke is not supported`);
  }
  ctx.shapes.push(shape);
}

// ネストした 'gr' グループ: tr(transform) を Node へ、他の items を再帰処理
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleGroupItem(item: any, parentId: string, ctx: Ctx): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trItem = (item.it ?? []).find((x: any) => x.ty === "tr");
  const gid = newId(ctx, "g");
  const t = trItem ? processTransform(trItem, gid, ctx) : { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, ax: 0, ay: 0 };
  const outer: GroupSpec = { id: gid, x: t.x, y: t.y, parent: parentId };
  if (t.rotation) outer.rotation = t.rotation;
  if (t.opacity !== 1) outer.opacity = t.opacity;
  if (t.scaleX !== 1) outer.scaleX = t.scaleX;
  if (t.scaleY !== 1) outer.scaleY = t.scaleY;
  ctx.groups.push(outer);

  let childParent = gid;
  if (Math.abs(t.ax) > 1e-6 || Math.abs(t.ay) > 1e-6) {
    const innerId = `${gid}_a`;
    ctx.groups.push({ id: innerId, x: -t.ax, y: -t.ay, parent: gid });
    childParent = innerId;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const childItems = (item.it ?? []).filter((x: any) => x.ty !== "tr");
  processGroupLevel(childItems, childParent, ctx, `${item.nm ?? gid}`);
}

// ---- レイヤーの可視範囲 (ip/op) がコンポジションより狭い場合の opacity hold ----
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyVisibilityWindow(layer: any, outer: GroupSpec, compIp: number, compOp: number, ctx: Ctx): void {
  const layerIp = num(layer.ip, compIp);
  const layerOp = num(layer.op, compOp);
  const startsLate = layerIp > compIp + 0.01;
  const endsEarly = layerOp < compOp - 0.01;
  if (!startsLate && !endsEarly) return;
  if (kIsKeyframed(layer.ks?.o)) {
    ctx.warnings.push(`${ctx.layerTag}: layer has both a narrower in/out range and animated opacity — visibility window not applied`);
    return;
  }
  const baseOpacity = outer.opacity ?? 1;
  const outIp = Math.max(0, Math.round(layerIp + ctx.frameOffset));
  const outOp = Math.max(0, Math.round(layerOp + ctx.frameOffset));
  const outCompStart = Math.max(0, Math.round(compIp + ctx.frameOffset));
  const kfs: KeyframeSpec[] = [];
  if (startsLate) {
    kfs.push({ frame: outCompStart, value: 0 });
    kfs.push({ frame: outIp, value: baseOpacity, easing: "hold" });
  } else {
    kfs.push({ frame: outIp, value: baseOpacity });
  }
  if (endsEarly) kfs.push({ frame: outOp, value: 0, easing: "hold" });
  if (kfs.length > 1) ctx.tracks.push({ target: outer.id, property: "opacity", keyframes: kfs });
}

// ---- レイヤー配列を処理 (ルート or precomp インライン展開の再帰呼び出し) --------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processLayers(layers: any[], parentGroupId: string | undefined, ctx: Ctx, compIp: number, compOp: number): void {
  interface Rec {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    layer: any;
    outer: GroupSpec;
    inner?: GroupSpec;
    tag: string;
  }
  const idOf = new Map<number, string>(); // layer.ind → parenting先グループid (anchor補正込み)
  const records: Rec[] = [];

  // パス1: 各レイヤーのトランスフォームからグループを作る（親付けはまだ）
  layers.forEach((layer, arrIdx) => {
    const indKey: number = typeof layer.ind === "number" ? layer.ind : -1_000_000 - arrIdx;
    const tag = `l${typeof layer.ind === "number" ? layer.ind : arrIdx}`;
    if (layer.hd) return; // 非表示レイヤー
    if (layer.ty === 5) {
      ctx.skip("text-layer");
      ctx.warnings.push(`${tag}: text layers (ty=5) are not supported — skipped`);
      return;
    }
    ctx.layerTag = tag;
    const gid = newId(ctx, "grp");
    const t = processTransform(layer.ks, gid, ctx);
    const outer: GroupSpec = { id: gid, x: t.x, y: t.y };
    if (t.rotation) outer.rotation = t.rotation;
    if (t.opacity !== 1) outer.opacity = t.opacity;
    if (t.scaleX !== 1) outer.scaleX = t.scaleX;
    if (t.scaleY !== 1) outer.scaleY = t.scaleY;
    ctx.groups.push(outer);

    let inner: GroupSpec | undefined;
    if (Math.abs(t.ax) > 1e-6 || Math.abs(t.ay) > 1e-6) {
      inner = { id: `${gid}_a`, x: -t.ax, y: -t.ay, parent: gid };
      ctx.groups.push(inner);
    }
    idOf.set(indKey, (inner ?? outer).id);
    records.push({ layer, outer, inner, tag });
  });

  // パス2: 親付け解決 + 可視範囲 + コンテンツ生成
  for (const rec of records) {
    const { layer, outer, inner, tag } = rec;
    ctx.layerTag = tag;
    outer.parent = typeof layer.parent === "number" && idOf.has(layer.parent) ? idOf.get(layer.parent) : parentGroupId;
    if (layer.masksProperties?.length) {
      ctx.skip("mask");
      ctx.warnings.push(`${tag}: masks (masksProperties) not supported`);
    }
    if (layer.tt) {
      ctx.skip("matte");
      ctx.warnings.push(`${tag}: track matte (tt) not supported`);
    }
    applyVisibilityWindow(layer, outer, compIp, compOp, ctx);
    const contentParent = (inner ?? outer).id;

    switch (layer.ty) {
      case 4: // shape
        processGroupLevel(layer.shapes ?? [], contentParent, ctx, tag);
        break;
      case 3: // null
        break;
      case 1: { // solid
        const w = num(layer.sw, 100), h = num(layer.sh, 100);
        const color = typeof layer.sc === "string" ? layer.sc : "#888888";
        const id = newId(ctx, "solid");
        ctx.shapes.push({ id, type: "rect", x: w / 2, y: h / 2, width: w, height: h, parent: contentParent, z: nextZ(ctx), fill: { color } });
        break;
      }
      case 0: { // precomp
        const asset = ctx.assetsById.get(layer.refId);
        if (!asset) {
          ctx.warnings.push(`${tag}: precomp asset '${layer.refId}' not found`);
          ctx.skip("precomp(missing-asset)");
          break;
        }
        if (layer.tm) {
          ctx.warnings.push(`${tag}: time remap (tm) not supported`);
          ctx.skip("precomp-timeRemap");
        }
        if (ctx.depth >= 6) {
          ctx.warnings.push(`${tag}: precomp nesting deeper than 6 levels is not inlined`);
          ctx.skip("precomp(depth)");
          break;
        }
        if (ctx.precompStack.includes(layer.refId)) {
          ctx.warnings.push(`${tag}: recursive precomp '${layer.refId}' skipped`);
          ctx.skip("precomp(cycle)");
          break;
        }
        const st = num(layer.st, 0);
        const savedOffset = ctx.frameOffset;
        ctx.frameOffset = ctx.frameOffset + st;
        ctx.depth++;
        ctx.precompStack.push(layer.refId);
        const childIp = num(asset.ip, 0);
        const childOp = num(asset.op, childIp + 1);
        processLayers(asset.layers ?? [], contentParent, ctx, childIp, childOp);
        ctx.precompStack.pop();
        ctx.depth--;
        ctx.frameOffset = savedOffset;
        break;
      }
      default:
        ctx.skip(`layer-ty-${layer.ty}`);
        ctx.warnings.push(`${tag}: layer type ${layer.ty} not supported`);
    }
    ctx.layerTag = tag;
  }
}

// ---- エントリポイント -------------------------------------------------------
export function importLottie(json: string | object, opts?: { idPrefix?: string }): LottieImportResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = typeof json === "string" ? JSON.parse(json) : json;
  if (!data || !Array.isArray(data.layers)) throw new Error("Invalid Lottie JSON: missing 'layers' array");

  const warnings: string[] = [];
  const skipped: Record<string, number> = {};
  const skip = (t: string) => { skipped[t] = (skipped[t] ?? 0) + 1; };

  const width = num(data.w, 512);
  const height = num(data.h, 512);
  const fps = num(data.fr, 30) || 30;
  const rootIp = num(data.ip, 0);
  const rootOp = num(data.op, rootIp + fps);
  const durationFrames = Math.max(1, Math.round(rootOp - rootIp));
  const name = typeof data.nm === "string" && data.nm ? data.nm : "lottie";

  const ctx: Ctx = {
    frameOffset: -rootIp,
    depth: 0,
    precompStack: [],
    prefix: opts?.idPrefix ?? "",
    warnings,
    groups: [],
    shapes: [],
    tracks: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assetsById: new Map(
      (Array.isArray(data.assets) ? data.assets : [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((a: any) => Array.isArray(a.layers))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((a: any) => [a.id, a])
    ),
    skip,
    layerTag: "l0",
    autoId: 0,
    zCounter: 10_000_000,
  };

  processLayers(data.layers, undefined, ctx, rootIp, rootOp);

  // レイヤー親子(parent)は配列順と無関係に前方参照し得るため、
  // ライターの「親は先に定義」制約に合わせてトポロジカルソートする
  {
    const byId = new Map(ctx.groups.map((g) => [g.id, g]));
    const emitted = new Set<string>();
    const sorted: typeof ctx.groups = [];
    const visit = (g: (typeof ctx.groups)[number], stack: Set<string>) => {
      if (emitted.has(g.id) || stack.has(g.id)) return;
      stack.add(g.id);
      const par = g.parent ? byId.get(g.parent) : undefined;
      if (par) visit(par, stack);
      stack.delete(g.id);
      if (!emitted.has(g.id)) { emitted.add(g.id); sorted.push(g); }
    };
    for (const g of ctx.groups) visit(g, new Set());
    ctx.groups = sorted;
  }

  const decompiled = ctx.groups.length + ctx.shapes.length;
  const animations: AnimationSpec[] = ctx.tracks.length
    ? [{ name, fps, duration: durationFrames, loop: "loop", tracks: ctx.tracks }]
    : [];

  return {
    width,
    height,
    fps,
    durationFrames,
    groups: ctx.groups,
    shapes: ctx.shapes,
    animations,
    warnings,
    coverage: { decompiled, skipped, warnings },
  };
}
