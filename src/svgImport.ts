// SVG → SceneSpec フラグメント変換（依存なし）
// 「LLMに座標暗算でベジェを描かせない」ための素材供給パイプライン。
// Figma/Illustrator出力・Iconify等のプロが描いたベクターをそのままRiveパスにする。
// 対応: path(M/L/H/V/C/S/Q/T/A/Z) rect circle ellipse polygon polyline line g,
//       transform(translate/scale/rotate/matrix), fill/stroke/opacity(属性+style),
//       linearGradient/radialGradient(userSpaceOnUse/objectBoundingBox)
import type { ShapeSpec, GroupSpec, GradientSpec } from "./rivWriter.js";

export interface SvgImportResult {
  width: number;
  height: number;
  shapes: ShapeSpec[];
  warnings: string[];
}

// ---- 最小XMLパーサ --------------------------------------------------------
interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

function parseXml(src: string): XmlNode {
  // コメント・宣言・CDATA・DOCTYPE を除去
  src = src
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const root: XmlNode = { tag: "#root", attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  const tagRe = /<\/?([a-zA-Z_][\w:-]*)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(src))) {
    const [full, tag, attrStr, selfClose] = m;
    if (full.startsWith("</")) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    const attrRe = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(attrStr))) attrs[am[1]] = am[2] ?? am[3] ?? "";
    const node: XmlNode = { tag, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}

// ---- 2D変換 ---------------------------------------------------------------
type M6 = [number, number, number, number, number, number]; // a b c d e f (SVG順)
const I: M6 = [1, 0, 0, 1, 0, 0];
const mul = (m: M6, n: M6): M6 => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: M6, x: number, y: number): [number, number] =>
  [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function parseTransform(s: string | undefined): M6 {
  let m: M6 = I;
  if (!s) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let t: RegExpExecArray | null;
  while ((t = re.exec(s))) {
    const a = t[2].split(/[\s,]+/).filter(Boolean).map(Number);
    switch (t[1]) {
      case "matrix": m = mul(m, [a[0], a[1], a[2], a[3], a[4], a[5]]); break;
      case "translate": m = mul(m, [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]); break;
      case "scale": m = mul(m, [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]); break;
      case "rotate": {
        const r = ((a[0] ?? 0) * Math.PI) / 180;
        const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
        m = mul(m, [1, 0, 0, 1, cx, cy]);
        m = mul(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
        m = mul(m, [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case "skewX": m = mul(m, [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0]); break;
      case "skewY": m = mul(m, [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]); break;
    }
  }
  return m;
}

// ---- パスデータ → ベジェセグメント列 ---------------------------------------
// 全て cubic に正規化した anchor 列 [{x,y,inX,inY,outX,outY}] のサブパス群にする
interface Anchor { x: number; y: number; inX: number; inY: number; outX: number; outY: number }
interface Subpath { closed: boolean; anchors: Anchor[] }

function parsePathData(d: string, warnings: string[]): Subpath[] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi) ?? [];
  let i = 0;
  const num = () => Number(tokens[i++]);
  const subpaths: Subpath[] = [];
  let cur: Subpath | null = null;
  let cx = 0, cy = 0; // 現在点
  let sx = 0, sy = 0; // サブパス開始点
  let prevCtrlX: number | null = null, prevCtrlY: number | null = null; // S/T用
  let cmd = "";

  const start = (x: number, y: number) => {
    cur = { closed: false, anchors: [{ x, y, inX: x, inY: y, outX: x, outY: y }] };
    subpaths.push(cur);
    cx = sx = x; cy = sy = y;
  };
  const last = () => cur!.anchors[cur!.anchors.length - 1];
  // cubic セグメント追加: 現在点 → (x,y)、制御点 c1,c2
  const cubicTo = (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) => {
    if (!cur) start(cx, cy);
    last().outX = c1x; last().outY = c1y;
    cur!.anchors.push({ x, y, inX: c2x, inY: c2y, outX: x, outY: y });
    cx = x; cy = y;
  };
  const lineTo = (x: number, y: number) => {
    // 直線は 1/3 位置ハンドルの cubic として厳密表現
    cubicTo(cx + (x - cx) / 3, cy + (y - cy) / 3, cx + (2 * (x - cx)) / 3, cy + (2 * (y - cy)) / 3, x, y);
  };
  // 楕円弧 → cubic 近似（≤90°分割）
  const arcTo = (rx: number, ry: number, rotDeg: number, laf: number, sf: number, x: number, y: number) => {
    if (rx === 0 || ry === 0 || (cx === x && cy === y)) { lineTo(x, y); return; }
    rx = Math.abs(rx); ry = Math.abs(ry);
    const phi = (rotDeg * Math.PI) / 180;
    const cosP = Math.cos(phi), sinP = Math.sin(phi);
    const dx2 = (cx - x) / 2, dy2 = (cy - y) / 2;
    const x1 = cosP * dx2 + sinP * dy2, y1 = -sinP * dx2 + cosP * dy2;
    let l = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (l > 1) { rx *= Math.sqrt(l); ry *= Math.sqrt(l); }
    const sign = laf === sf ? -1 : 1;
    const sq = Math.max(0, (rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1) / (rx * rx * y1 * y1 + ry * ry * x1 * x1));
    const coef = sign * Math.sqrt(sq);
    const cxp = (coef * rx * y1) / ry, cyp = (-coef * ry * x1) / rx;
    const ccx = cosP * cxp - sinP * cyp + (cx + x) / 2;
    const ccy = sinP * cxp + cosP * cyp + (cy + y) / 2;
    const ang = (ux: number, uy: number, vx: number, vy: number) => {
      const dot = ux * vx + uy * vy;
      const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
      let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
      if (ux * vy - uy * vx < 0) a = -a;
      return a;
    };
    const th1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
    let dth = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
    if (!sf && dth > 0) dth -= 2 * Math.PI;
    if (sf && dth < 0) dth += 2 * Math.PI;
    const segs = Math.ceil(Math.abs(dth) / (Math.PI / 2));
    const delta = dth / segs;
    const alpha = ((4 / 3) * Math.tan(delta / 4));
    let th = th1;
    for (let s = 0; s < segs; s++) {
      const p = (a: number): [number, number] => [
        ccx + rx * Math.cos(a) * cosP - ry * Math.sin(a) * sinP,
        ccy + rx * Math.cos(a) * sinP + ry * Math.sin(a) * cosP,
      ];
      const dp = (a: number): [number, number] => [
        -rx * Math.sin(a) * cosP - ry * Math.cos(a) * sinP,
        -rx * Math.sin(a) * sinP + ry * Math.cos(a) * cosP,
      ];
      const [p1x, p1y] = p(th), [p2x, p2y] = p(th + delta);
      const [d1x, d1y] = dp(th), [d2x, d2y] = dp(th + delta);
      cubicTo(p1x + alpha * d1x, p1y + alpha * d1y, p2x - alpha * d2x, p2y - alpha * d2y, p2x, p2y);
      th += delta;
    }
  };

  while (i < tokens.length) {
    const t = tokens[i];
    if (/[a-zA-Z]/.test(t)) { cmd = t; i++; }
    const rel = cmd === cmd.toLowerCase() && cmd !== "z" && cmd !== "Z";
    const X = (v: number) => (rel ? cx + v : v);
    const Y = (v: number) => (rel ? cy + v : v);
    switch (cmd.toUpperCase()) {
      case "M": {
        const x = X(num()), y = Y(num());
        start(x, y);
        cmd = rel ? "l" : "L"; // 後続座標は暗黙のlineto
        break;
      }
      case "L": lineTo(X(num()), Y(num())); prevCtrlX = null; break;
      case "H": lineTo(X(num()), cy); prevCtrlX = null; break;
      case "V": lineTo(cx, Y(num())); prevCtrlX = null; break;
      case "C": {
        const c1x = X(num()), c1y = Y(num()), c2x = X(num()), c2y = Y(num()), x = X(num()), y = Y(num());
        cubicTo(c1x, c1y, c2x, c2y, x, y);
        prevCtrlX = c2x; prevCtrlY = c2y;
        break;
      }
      case "S": {
        const c1x = prevCtrlX !== null ? 2 * cx - prevCtrlX : cx;
        const c1y = prevCtrlX !== null ? 2 * cy - prevCtrlY! : cy;
        const c2x = X(num()), c2y = Y(num()), x = X(num()), y = Y(num());
        cubicTo(c1x, c1y, c2x, c2y, x, y);
        prevCtrlX = c2x; prevCtrlY = c2y;
        break;
      }
      case "Q": {
        const qx = X(num()), qy = Y(num()), x = X(num()), y = Y(num());
        cubicTo(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y);
        prevCtrlX = qx; prevCtrlY = qy;
        break;
      }
      case "T": {
        const qx: number = prevCtrlX !== null ? 2 * cx - prevCtrlX : cx;
        const qy: number = prevCtrlX !== null ? 2 * cy - (prevCtrlY as number) : cy;
        const x = X(num()), y = Y(num());
        cubicTo(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y);
        prevCtrlX = qx; prevCtrlY = qy;
        break;
      }
      case "A": {
        const rx = num(), ry = num(), rot = num(), laf = num(), sf = num(), x = X(num()), y = Y(num());
        arcTo(rx, ry, rot, laf, sf, x, y);
        prevCtrlX = null;
        break;
      }
      case "Z": {
        const c = subpaths[subpaths.length - 1];
        if (c) {
          c.closed = true;
          const first = c.anchors[0];
          const lastA = c.anchors[c.anchors.length - 1];
          // 終点が始点と一致するなら終点anchorを始点にマージ
          if (Math.hypot(lastA.x - first.x, lastA.y - first.y) < 1e-3 && c.anchors.length > 1) {
            first.inX = lastA.inX; first.inY = lastA.inY;
            c.anchors.pop();
          }
          cx = sx; cy = sy;
        }
        prevCtrlX = null;
        break;
      }
      default:
        warnings.push(`unsupported path command '${cmd}'`);
        i++;
    }
  }
  return subpaths.filter((s) => s.anchors.length >= 2);
}

// ---- 色 -------------------------------------------------------------------
const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff",
  gray: "#808080", grey: "#808080", none: "", transparent: "",
  currentcolor: "#000000", currentColor: "#000000",
};
function parseSvgColor(v: string | undefined, warnings: string[]): string | null {
  if (!v) return null;
  v = v.trim();
  if (v === "none" || v === "transparent") return null;
  if (v.startsWith("#")) {
    if (v.length === 4) return "#" + [...v.slice(1)].map((c) => c + c).join("");
    return v.slice(0, 7);
  }
  const rgb = v.match(/^rgba?\(([^)]*)\)$/);
  if (rgb) {
    const p = rgb[1].split(/[\s,/]+/).filter(Boolean).map((x) => x.endsWith("%") ? (parseFloat(x) * 255) / 100 : parseFloat(x));
    return "#" + p.slice(0, 3).map((n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0")).join("");
  }
  if (v in NAMED) return NAMED[v] || null;
  warnings.push(`unknown color '${v}' → #888888`);
  return "#888888";
}

// ---- メイン ---------------------------------------------------------------
interface Ctx {
  m: M6;
  fill?: string; // raw値（url(#id)含む）
  stroke?: string;
  strokeWidth: number;
  opacity: number;
  fillOpacity: number;
  cap?: "butt" | "round" | "square";
  join?: "miter" | "round" | "bevel";
}

export function importSvg(svgText: string, opts?: { idPrefix?: string }): SvgImportResult {
  const warnings: string[] = [];
  const root = parseXml(svgText);
  const svg = findTag(root, "svg");
  if (!svg) throw new Error("no <svg> element found");

  // viewBox / width / height
  const vb = (svg.attrs.viewBox ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
  const width = vb.length === 4 ? vb[2] : parseFloat(svg.attrs.width ?? "100") || 100;
  const height = vb.length === 4 ? vb[3] : parseFloat(svg.attrs.height ?? "100") || 100;
  const originM: M6 = vb.length === 4 ? [1, 0, 0, 1, -vb[0], -vb[1]] : I;

  // グラデーション定義収集（defs内外問わず）
  const gradients = new Map<string, XmlNode>();
  (function collect(n: XmlNode) {
    if ((n.tag === "linearGradient" || n.tag === "radialGradient") && n.attrs.id) gradients.set(n.attrs.id, n);
    n.children.forEach(collect);
  })(root);
  // href 継承を解決して stop 配列を得る
  const stopsOf = (g: XmlNode): Array<{ color: string; position: number }> => {
    let node: XmlNode | undefined = g;
    for (let hop = 0; hop < 4 && node; hop++) {
      const stops = node.children.filter((c) => c.tag === "stop");
      if (stops.length) {
        return stops.map((s) => {
          const style = parseStyle(s.attrs.style);
          const color = parseSvgColor(s.attrs["stop-color"] ?? style["stop-color"] ?? "#000", warnings) ?? "#000000";
          const op = parseFloat(s.attrs["stop-opacity"] ?? style["stop-opacity"] ?? "1");
          const off = s.attrs.offset ?? "0";
          const position = off.endsWith("%") ? parseFloat(off) / 100 : parseFloat(off);
          const hex = op < 1 ? "#" + Math.round(op * 255).toString(16).padStart(2, "0") + color.slice(1) : color;
          return { color: hex, position: isNaN(position) ? 0 : position };
        });
      }
      const href: string | undefined = node.attrs.href ?? node.attrs["xlink:href"];
      node = href ? gradients.get(href.replace("#", "")) : undefined;
    }
    return [{ color: "#888888", position: 0 }];
  };

  const shapes: ShapeSpec[] = [];
  let autoId = 0;
  const prefix = opts?.idPrefix ?? "";

  const walk = (n: XmlNode, ctx: Ctx): void => {
    const style = parseStyle(n.attrs.style);
    const get = (k: string) => n.attrs[k] ?? style[k];
    const next: Ctx = {
      m: mul(ctx.m, parseTransform(n.attrs.transform)),
      fill: get("fill") ?? ctx.fill,
      stroke: get("stroke") ?? ctx.stroke,
      strokeWidth: get("stroke-width") !== undefined ? parseFloat(get("stroke-width")!) : ctx.strokeWidth,
      opacity: ctx.opacity * (get("opacity") !== undefined ? parseFloat(get("opacity")!) : 1),
      fillOpacity: ctx.fillOpacity * (get("fill-opacity") !== undefined ? parseFloat(get("fill-opacity")!) : 1),
      cap: (get("stroke-linecap") as Ctx["cap"]) ?? ctx.cap,
      join: (get("stroke-linejoin") as Ctx["join"]) ?? ctx.join,
    };
    if (n.tag === "defs" || n.tag === "clipPath" || n.tag === "mask" || n.tag === "symbol") return;

    let subpaths: Subpath[] | null = null;
    switch (n.tag) {
      case "path": subpaths = parsePathData(n.attrs.d ?? "", warnings); break;
      case "rect": {
        const x = pf(n.attrs.x), y = pf(n.attrs.y), w = pf(n.attrs.width), h = pf(n.attrs.height);
        let rx = n.attrs.rx !== undefined ? pf(n.attrs.rx) : (n.attrs.ry !== undefined ? pf(n.attrs.ry) : 0);
        rx = Math.min(rx, w / 2, h / 2);
        subpaths = parsePathData(
          rx > 0
            ? `M${x + rx},${y} h${w - 2 * rx} a${rx},${rx} 0 0 1 ${rx},${rx} v${h - 2 * rx} a${rx},${rx} 0 0 1 ${-rx},${rx} h${-(w - 2 * rx)} a${rx},${rx} 0 0 1 ${-rx},${-rx} v${-(h - 2 * rx)} a${rx},${rx} 0 0 1 ${rx},${-rx} Z`
            : `M${x},${y} h${w} v${h} h${-w} Z`,
          warnings
        );
        break;
      }
      case "circle": {
        const cx = pf(n.attrs.cx), cy = pf(n.attrs.cy), r = pf(n.attrs.r);
        subpaths = parsePathData(`M${cx - r},${cy} a${r},${r} 0 1 0 ${2 * r},0 a${r},${r} 0 1 0 ${-2 * r},0 Z`, warnings);
        break;
      }
      case "ellipse": {
        const cx = pf(n.attrs.cx), cy = pf(n.attrs.cy), rx = pf(n.attrs.rx), ry = pf(n.attrs.ry);
        subpaths = parsePathData(`M${cx - rx},${cy} a${rx},${ry} 0 1 0 ${2 * rx},0 a${rx},${ry} 0 1 0 ${-2 * rx},0 Z`, warnings);
        break;
      }
      case "polygon":
      case "polyline": {
        const pts = (n.attrs.points ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
        if (pts.length >= 4) {
          let d = `M${pts[0]},${pts[1]}`;
          for (let k = 2; k < pts.length; k += 2) d += ` L${pts[k]},${pts[k + 1]}`;
          if (n.tag === "polygon") d += " Z";
          subpaths = parsePathData(d, warnings);
        }
        break;
      }
      case "line":
        subpaths = parsePathData(`M${pf(n.attrs.x1)},${pf(n.attrs.y1)} L${pf(n.attrs.x2)},${pf(n.attrs.y2)}`, warnings);
        break;
      case "text":
        warnings.push("<text> is not imported (use rive-mcp texts[] with a font instead)");
        return;
      case "image":
        warnings.push("<image> is not imported (embed via riv_create images[])");
        return;
    }

    if (subpaths) {
      if (subpaths.length) emitShape(n, subpaths, next);
      return;
    }
    n.children.forEach((c) => walk(c, next));
  };

  const emitShape = (n: XmlNode, subpaths: Subpath[], ctx: Ctx): void => {
    // 変換をベイク
    const M = mul(originM, ctx.m);
    for (const sp of subpaths) {
      for (const a of sp.anchors) {
        [a.x, a.y] = apply(M, a.x, a.y);
        [a.inX, a.inY] = apply(M, a.inX, a.inY);
        [a.outX, a.outY] = apply(M, a.outX, a.outY);
      }
    }
    // bbox 中心をシェイプ原点に
    const xs = subpaths.flatMap((s) => s.anchors.flatMap((a) => [a.x]));
    const ys = subpaths.flatMap((s) => s.anchors.flatMap((a) => [a.y]));
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const bw = Math.max(1, Math.max(...xs) - Math.min(...xs));
    const bh = Math.max(1, Math.max(...ys) - Math.min(...ys));

    const toPoints = (sp: Subpath) =>
      sp.anchors.map((a) => {
        const inDx = a.inX - a.x, inDy = a.inY - a.y;
        const outDx = a.outX - a.x, outDy = a.outY - a.y;
        const inDistance = Math.hypot(inDx, inDy);
        const outDistance = Math.hypot(outDx, outDy);
        const x = a.x - cx, y = a.y - cy;
        if (inDistance < 1e-4 && outDistance < 1e-4) return { x, y };
        return {
          x, y,
          cubic: {
            rotation: (Math.atan2(outDy, outDx) * 180) / Math.PI,
            inRotation: (Math.atan2(inDy, inDx) * 180) / Math.PI,
            inDistance, outDistance,
          },
        };
      });

    const id = prefix + (n.attrs.id ?? `p${autoId++}`);
    const spec: ShapeSpec = {
      id, type: "polygon", x: cx, y: cy,
      subpaths: subpaths.map((sp) => ({ closed: sp.closed, points: toPoints(sp) })),
    };
    if (ctx.opacity < 1) spec.opacity = ctx.opacity;

    // fill
    const fillRaw = ctx.fill ?? "#000000"; // SVG既定fillはblack
    const urlM = fillRaw.match(/^url\(['"]?#([^'")]+)['"]?\)/);
    if (urlM) {
      const g = gradients.get(urlM[1]);
      if (g) {
        const grad = gradientSpec(g, stopsOf(g), M, cx, cy, bw, bh);
        spec.fill = { gradient: grad };
      } else {
        warnings.push(`gradient #${urlM[1]} not found → solid gray`);
        spec.fill = { color: "#888888" };
      }
    } else {
      const c = parseSvgColor(fillRaw, warnings);
      if (c) {
        const alpha = ctx.fillOpacity < 1 ? Math.round(ctx.fillOpacity * 255).toString(16).padStart(2, "0") : "";
        spec.fill = { color: alpha ? "#" + alpha + c.slice(1) : c };
      }
    }
    // stroke
    const sc = parseSvgColor(ctx.stroke, warnings);
    if (sc) {
      spec.stroke = { color: sc, thickness: ctx.strokeWidth || 1 };
      if (ctx.cap) spec.stroke.cap = ctx.cap;
      if (ctx.join) spec.stroke.join = ctx.join;
    }
    if (!spec.fill && !spec.stroke) return; // 完全不可視は捨てる
    shapes.push(spec);
  };

  const gradientSpec = (
    g: XmlNode, stops: Array<{ color: string; position: number }>,
    M: M6, cx: number, cy: number, bw: number, bh: number
  ): GradientSpec => {
    const user = g.attrs.gradientUnits === "userSpaceOnUse";
    const gm = mul(M, parseTransform(g.attrs.gradientTransform));
    const pt = (xa: string | undefined, ya: string | undefined, dx: number, dy: number): { x: number; y: number } => {
      const px = xa !== undefined ? pfp(xa, 1) : dx;
      const py = ya !== undefined ? pfp(ya, 1) : dy;
      if (user) {
        const [wx, wy] = apply(gm, px, py);
        return { x: wx - cx, y: wy - cy };
      }
      // objectBoundingBox: 0-1 → bbox ローカル
      return { x: (px - 0.5) * bw, y: (py - 0.5) * bh };
    };
    if (g.tag === "radialGradient") {
      const c = pt(g.attrs.cx, g.attrs.cy, user ? 0 : 0.5, user ? 0 : 0.5);
      const rAttr = g.attrs.r !== undefined ? pfp(g.attrs.r, 1) : 0.5;
      const r = user ? rAttr * Math.hypot(gm[0], gm[1]) : rAttr * Math.max(bw, bh);
      return { type: "radial", stops, start: c, end: { x: c.x + r, y: c.y } };
    }
    const s = pt(g.attrs.x1, g.attrs.y1, user ? 0 : 0, user ? 0 : 0);
    const e = pt(g.attrs.x2, g.attrs.y2, user ? 0 : 1, user ? 0 : 0);
    return { type: "linear", stops, start: s, end: e };
  };

  walk(svg, { m: I, strokeWidth: 1, opacity: 1, fillOpacity: 1 });
  const totalVerts = shapes.reduce((n, s) => n + (s.subpaths?.reduce((m, sp) => m + sp.points.length, 0) ?? 0), 0);
  if (totalVerts > 3000) warnings.push(`${totalVerts} vertices — consider simplifying the SVG (performance)`);
  return { width, height, shapes, warnings };
}

function findTag(n: XmlNode, tag: string): XmlNode | null {
  if (n.tag === tag) return n;
  for (const c of n.children) {
    const r = findTag(c, tag);
    if (r) return r;
  }
  return null;
}
function parseStyle(s: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s) return out;
  for (const part of s.split(";")) {
    const [k, v] = part.split(":").map((x) => x?.trim());
    if (k && v) out[k] = v;
  }
  return out;
}
const pf = (v: string | undefined): number => (v !== undefined ? parseFloat(v) || 0 : 0);
const pfp = (v: string, scale: number): number => (v.endsWith("%") ? (parseFloat(v) / 100) * scale : parseFloat(v));
