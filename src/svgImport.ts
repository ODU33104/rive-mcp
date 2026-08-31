// SVG → SceneSpec フラグメント変換（依存なし）
// 「LLMに座標暗算でベジェを描かせない」ための素材供給パイプライン。
// Figma/Illustrator出力・Iconify等のプロが描いたベクターをそのままRiveパスにする。
// 対応: path(M/L/H/V/C/S/Q/T/A/Z) rect circle ellipse polygon polyline line g,
//       transform(translate/scale/rotate/matrix), fill/stroke/opacity(属性+style),
//       linearGradient/radialGradient(userSpaceOnUse/objectBoundingBox)
import type { ShapeSpec, GroupSpec, GradientSpec } from "./rivWriter.js";

/** <g> ひとつぶんの素性。Figma のフレーム/レイヤーがそのままここに落ちてくる */
export interface SvgLayerMeta {
  /** 文書順に振る安定キー。同じ SVG なら常に同じ値になる（下流の id の決定性はこれに依る） */
  key: number;
  tag: string;
  /** レイヤー名の候補。Figma は id / data-name / aria-label のどれかにレイヤー名を残す */
  names: string[];
}

/** shapes[] と同じ添字で並ぶ、そのシェイプが SVG のどこから来たかの記録。
 *  形状そのもの（塗り・不透明度・ストローク）は ShapeSpec 側にあるので二重に持たない。 */
export interface SvgNodeMeta extends SvgLayerMeta {
  /** 祖先 <g>（外側→内側）。<svg> 直下なら空 */
  ancestors: SvgLayerMeta[];
  /** 変換適用後（ルート座標）のアンカー bbox [x, y, w, h]。
   *  制御点とストロークの太さは含まないので、曲線は実際の描画より数 px 小さく出る */
  bbox: [number, number, number, number];
  /** 軸平行の矩形として厳密に表せるときだけ入る。**属性値に変換行列を掛けただけで推定はしていない**
   *  ので、変換が恒等なら SVG の属性値そのもの（浮動小数の演算誤差も入らない）。 */
  rect?: { x: number; y: number; width: number; height: number; cornerRadius: number };
}

/** `<text>` / `<tspan>` の 1 行。**折り返しは再現しない** — SVG に書いてある改行位置が正で、
 *  Rive 側の折り返しに任せるとフォント差で行が変わる（.claude/PLAN-vector-prototype.md M3 §1）。 */
export interface SvgTextMeta extends SvgLayerMeta {
  ancestors: SvgLayerMeta[];
  /** ルート座標。**y はベースライン**（Rive のテキストボックスは上端原点なので変換が要る） */
  x: number;
  y: number;
  content: string;
  /** 変換後の px */
  fontSize: number;
  color: string;
  anchor: "start" | "middle" | "end";
  /** font-family の先頭（クォート除去・小文字化）。指定が無ければ undefined */
  family?: string;
  /** 指定されていた font-weight。合成太字はしないので**選定にしか使わない** */
  weight?: string;
  /** 指定されていた letter-spacing（px）。Rive の TextSpec に対応物が無いので捨てる */
  letterSpacing?: number;
  /** 変換に回転/スキューが入っている。Rive の Text は回転して置けるが、
   *  ここでは行ごとの回転を再現しないのでラスタへ降格する印として持つ */
  rotated: boolean;
  /** この 1 行だけを元と同じ見た目で描く自己完結 SVG。ラスタ降格時にこれをラスタライズする */
  fragment: string;
}

export interface SvgImageMeta extends SvgLayerMeta {
  ancestors: SvgLayerMeta[];
  /** ルート座標の配置矩形 */
  rect: { x: number; y: number; width: number; height: number };
  /** data URI か、resolveHref で読めた相対パスの中身 */
  bytes: Uint8Array;
}

export interface SvgImportResult {
  width: number;
  height: number;
  shapes: ShapeSpec[];
  /** shapes[] と同じ長さ・同じ順序 */
  nodes: SvgNodeMeta[];
  texts: SvgTextMeta[];
  images: SvgImageMeta[];
  /** 取り込めずに捨てた要素の数。warnings の文面を数えるより確実に拾えるようにしてある */
  skipped: { text: number; image: number };
  warnings: string[];
}

// ---- 最小XMLパーサ --------------------------------------------------------
interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** 直下の文字データ（子要素の中身は含まない）。<text>/<tspan> のためだけに拾う */
  text?: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const cp = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
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
  let cursor = 0;
  while ((m = tagRe.exec(src))) {
    const [full, tag, attrStr, selfClose] = m;
    // タグとタグの間の文字データを、いま開いている要素に積む
    const chunk = src.slice(cursor, m.index);
    cursor = tagRe.lastIndex;
    if (chunk) {
      const owner = stack[stack.length - 1];
      owner.text = (owner.text ?? "") + decodeEntities(chunk);
    }
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
  // テキスト系のプロパティは SVG では継承する。Figma は <text> に全部書くが、
  // Illustrator は <g> にまとめて書くことがあるので継承を通す
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  textAnchor?: string;
  letterSpacing?: number;
}

export function importSvg(
  svgText: string,
  opts?: {
    idPrefix?: string;
    /** `<image href>` が相対パスのときに中身を返す。返さなければ警告してスキップする。
     *  fs をここに持ち込まないための注入点（呼び出し側が svgPath 相対で解決する） */
    resolveHref?: (href: string) => Uint8Array | null;
  }
): SvgImportResult {
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
  const nodes: SvgNodeMeta[] = [];
  const texts: SvgTextMeta[] = [];
  const images: SvgImageMeta[] = [];
  const skipped = { text: 0, image: 0 };
  let autoId = 0;
  const prefix = opts?.idPrefix ?? "";

  // キーは「visit した順」に振る。walk は文書順の DFS なので、同じ SVG からは必ず同じ
  // キーが出る（vectorScene.ts の要素 id の決定性はこれだけに依っている）。
  let keyCounter = 0;
  const keyOf = new Map<XmlNode, number>();
  const layerMeta = (n: XmlNode): SvgLayerMeta => {
    let k = keyOf.get(n);
    if (k === undefined) { k = keyCounter++; keyOf.set(n, k); }
    return {
      key: k,
      tag: n.tag,
      names: ["id", "data-name", "aria-label"]
        .map((a) => n.attrs[a])
        .filter((v): v is string => !!v),
    };
  };

  const attrOf = (node: XmlNode, key: string): string | undefined =>
    node.attrs[key] ?? parseStyle(node.attrs.style)[key];
  /** px（と単位なし）だけ読む。em/%/rem は親の font-size に依存していて SVG 単体では確定しない */
  const lengthOf = (v: string | undefined, what: string): number | undefined => {
    if (v === undefined) return undefined;
    const t = v.trim();
    if (/^-?(?:\d+\.?\d*|\.\d+)(?:px)?$/.test(t)) return parseFloat(t);
    warnings.push(`${what} '${t}' is not a px length and was ignored`);
    return undefined;
  };
  const xmlEscape = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const walk = (n: XmlNode, ctx: Ctx, stack: SvgLayerMeta[]): void => {
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
      fontSize: lengthOf(get("font-size"), "font-size") ?? ctx.fontSize,
      fontFamily: get("font-family") ?? ctx.fontFamily,
      fontWeight: get("font-weight") ?? ctx.fontWeight,
      textAnchor: get("text-anchor") ?? ctx.textAnchor,
      letterSpacing: lengthOf(get("letter-spacing"), "letter-spacing") ?? ctx.letterSpacing,
    };
    if (n.tag === "defs" || n.tag === "clipPath" || n.tag === "mask" || n.tag === "symbol") return;

    let subpaths: Subpath[] | null = null;
    // <rect> の属性値そのもの（変換前）。emitShape で変換を掛けて SvgNodeMeta.rect にする。
    // ベジェに落としてから矩形を復元すると角丸が円弧からの逆算になるので、ここで持ち回す。
    let rectAttrs: { x: number; y: number; width: number; height: number; cornerRadius: number } | null = null;
    switch (n.tag) {
      case "path": subpaths = parsePathData(n.attrs.d ?? "", warnings); break;
      case "rect": {
        const x = pf(n.attrs.x), y = pf(n.attrs.y), w = pf(n.attrs.width), h = pf(n.attrs.height);
        let rx = n.attrs.rx !== undefined ? pf(n.attrs.rx) : (n.attrs.ry !== undefined ? pf(n.attrs.ry) : 0);
        rx = Math.min(rx, w / 2, h / 2);
        rectAttrs = { x, y, width: w, height: h, cornerRadius: rx };
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
        emitText(n, next, stack);
        return;
      case "image":
        emitImage(n, next, stack);
        return;
    }

    if (subpaths) {
      if (subpaths.length) emitShape(n, subpaths, next, stack, rectAttrs);
      return;
    }
    // <svg> 自身は「レイヤー」ではないので祖先に積まない（積むと全要素を包む
    // 中身の無いコンテナが 1 つ増えるだけになる）
    const childStack = n.tag === "svg" ? stack : [...stack, layerMeta(n)];
    n.children.forEach((c) => walk(c, next, childStack));
  };

  const emitShape = (
    n: XmlNode, subpaths: Subpath[], ctx: Ctx,
    stack: SvgLayerMeta[],
    rectAttrs: { x: number; y: number; width: number; height: number; cornerRadius: number } | null
  ): void => {
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

    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const meta: SvgNodeMeta = {
      ...layerMeta(n),
      ancestors: stack,
      bbox: [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0],
    };
    const rect = rectAttrs ? transformedRect(rectAttrs, M) : rectFromSubpaths(subpaths);
    if (rect) meta.rect = rect;
    nodes.push(meta);
  };

  /** <rect> の属性値に変換を掛ける。回転・スキューが入っている、または角丸が
   *  非等方スケールで楕円になる場合は「矩形として表せない」ので null（呼び出し側はベジェのまま扱う） */
  const transformedRect = (
    r: { x: number; y: number; width: number; height: number; cornerRadius: number },
    M: M6
  ): SvgNodeMeta["rect"] | null => {
    if (Math.abs(M[1]) > 1e-9 || Math.abs(M[2]) > 1e-9) return null;
    const [ax, ay] = apply(M, r.x, r.y);
    const [bx, by] = apply(M, r.x + r.width, r.y + r.height);
    const sx = Math.abs(M[0]), sy = Math.abs(M[3]);
    if (r.cornerRadius > 0 && Math.abs(sx - sy) > 1e-9) return null; // 角丸が楕円になる
    return {
      x: Math.min(ax, bx), y: Math.min(ay, by),
      width: Math.abs(bx - ax), height: Math.abs(by - ay),
      cornerRadius: r.cornerRadius * sx,
    };
  };

  /** `<text>` を 1 行 = 1 SvgTextMeta にほどく。折り返しはしない（M3 §1）。 */
  const emitText = (n: XmlNode, ctx: Ctx, stack: SvgLayerMeta[]): void => {
    const M = mul(originM, ctx.m);
    const rotated = Math.abs(M[1]) > 1e-9 || Math.abs(M[2]) > 1e-9;
    const scale = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) || 1;
    interface Line {
      x: number; y: number; content: string; fontSize: number;
      fill?: string; anchor: string; family?: string; weight?: string; spacing?: number;
      names: string[];
    }
    const flat = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
    const namesOf = (node: XmlNode) =>
      ["id", "data-name", "aria-label"].map((a) => node.attrs[a]).filter((v): v is string => !!v);
    const base: Line = {
      x: pf(n.attrs.x), y: pf(n.attrs.y),
      content: flat(n.text),
      fontSize: ctx.fontSize ?? 16,
      fill: ctx.fill, anchor: ctx.textAnchor ?? "start",
      family: ctx.fontFamily, weight: ctx.fontWeight, spacing: ctx.letterSpacing,
      names: namesOf(n),
    };
    if (ctx.fontSize === undefined) {
      warnings.push(`<text> "${base.content.slice(0, 20)}" has no font-size — 16px assumed`);
    }
    const lines: Line[] = [];
    if (base.content) lines.push(base);
    let cursorY = base.y;
    for (const sp of n.children.filter((c) => c.tag === "tspan")) {
      const content = flat(sp.text);
      if (!content) continue;
      const sy = sp.attrs.y !== undefined ? pf(sp.attrs.y) : cursorY + pf(sp.attrs.dy);
      cursorY = sy;
      lines.push({
        x: (sp.attrs.x !== undefined ? pf(sp.attrs.x) : base.x) + pf(sp.attrs.dx),
        y: sy,
        content,
        fontSize: lengthOf(attrOf(sp, "font-size"), "font-size") ?? base.fontSize,
        fill: attrOf(sp, "fill") ?? base.fill,
        anchor: attrOf(sp, "text-anchor") ?? base.anchor,
        family: attrOf(sp, "font-family") ?? base.family,
        weight: attrOf(sp, "font-weight") ?? base.weight,
        spacing: lengthOf(attrOf(sp, "letter-spacing"), "letter-spacing") ?? base.spacing,
        names: namesOf(sp).length ? namesOf(sp) : base.names,
      });
    }
    if (!lines.length) {
      skipped.text++;
      warnings.push("<text> has no character data and was skipped");
      return;
    }
    // 行はそれぞれ独立した要素になるので、キーも 1 行ずつ要る（同じキーを配ると
    // 下流の Map で行が潰れ、最後の 1 行だけが残る）
    const firstMeta = layerMeta(n);
    lines.forEach((ln, i) => {
      const color = parseSvgColor(ln.fill ?? "#000000", warnings);
      if (!color) {
        skipped.text++;
        warnings.push(`<text> "${ln.content.slice(0, 20)}" has fill:none and would not be visible — skipped`);
        return;
      }
      const anchor: SvgTextMeta["anchor"] =
        ln.anchor === "middle" ? "middle" : ln.anchor === "end" ? "end" : "start";
      const [wx, wy] = apply(M, ln.x, ln.y);
      const fragment =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
        `<g transform="matrix(${M.join(" ")})">` +
        `<text x="${ln.x}" y="${ln.y}" font-size="${ln.fontSize}" fill="${color}"` +
        (anchor !== "start" ? ` text-anchor="${anchor}"` : "") +
        (ln.family ? ` font-family="${xmlEscape(ln.family)}"` : "") +
        (ln.weight ? ` font-weight="${xmlEscape(ln.weight)}"` : "") +
        (ln.spacing !== undefined ? ` letter-spacing="${ln.spacing}"` : "") +
        `>${xmlEscape(ln.content)}</text></g></svg>`;
      texts.push({
        key: i === 0 ? firstMeta.key : keyCounter++,
        tag: "text",
        names: ln.names,
        ancestors: stack,
        x: wx, y: wy,
        content: ln.content,
        fontSize: ln.fontSize * scale,
        color,
        anchor,
        ...(ln.family ? { family: ln.family.split(",")[0].replace(/["']/g, "").trim().toLowerCase() } : {}),
        ...(ln.weight ? { weight: ln.weight } : {}),
        ...(ln.spacing !== undefined ? { letterSpacing: ln.spacing } : {}),
        rotated,
        fragment,
      });
    });
  };

  const emitImage = (n: XmlNode, ctx: Ctx, stack: SvgLayerMeta[]): void => {
    const href = (n.attrs.href ?? n.attrs["xlink:href"] ?? "").trim();
    if (!href) {
      skipped.image++;
      warnings.push("<image> has no href and was skipped");
      return;
    }
    if (/^https?:/i.test(href)) {
      // ローカル完結の原則。黙って空けるのではなく、何を取りに行かなかったかを出す
      skipped.image++;
      warnings.push(`<image> points at ${href} — nothing is fetched over the network, so it was skipped`);
      return;
    }
    let bytes: Uint8Array | null = null;
    if (href.startsWith("data:")) {
      const m = href.match(/^data:[^,]*;base64,([\s\S]*)$/);
      if (!m) {
        skipped.image++;
        warnings.push("<image> data URI is not base64 and was skipped");
        return;
      }
      bytes = new Uint8Array(Buffer.from(m[1].replace(/\s+/g, ""), "base64"));
    } else {
      bytes = opts?.resolveHref?.(href) ?? null;
      if (!bytes) {
        skipped.image++;
        warnings.push(`<image href="${href}"> could not be read next to the SVG and was skipped`);
        return;
      }
    }
    const M = mul(originM, ctx.m);
    const rect = transformedRect(
      { x: pf(n.attrs.x), y: pf(n.attrs.y), width: pf(n.attrs.width), height: pf(n.attrs.height), cornerRadius: 0 },
      M
    );
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      skipped.image++;
      warnings.push("<image> is rotated or has no width/height — only axis-aligned placements are imported");
      return;
    }
    images.push({
      ...layerMeta(n),
      ancestors: stack,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      bytes,
    });
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
    // objectBoundingBox の gradient は「単位正方形で定義してから bbox へ非等方に伸ばす」ので、
    // 正方形でない図形では等高線が gradient ベクトルに直交しなくなる。Rive の gradient は
    // 常に直交するため、**斜め方向と radial は原理的に一致しない**（軸平行の linear は一致する）。
    // 実測 2026-08-31（240x160 の矩形）: 斜め MAE 0.023 / radial 0.037、軸平行は 0.000000。
    const skewedBox = !user && Math.abs(bw - bh) > 1e-6;
    if (g.tag === "radialGradient") {
      const c = pt(g.attrs.cx, g.attrs.cy, user ? 0 : 0.5, user ? 0 : 0.5);
      const rAttr = g.attrs.r !== undefined ? pfp(g.attrs.r, 1) : 0.5;
      const r = user ? rAttr * Math.hypot(gm[0], gm[1]) : rAttr * Math.max(bw, bh);
      if (skewedBox) {
        warnings.push(
          `radialGradient #${g.attrs.id} is defined in objectBoundingBox units on a non-square shape — ` +
            `it becomes a circle instead of an ellipse (Rive gradients are not stretched with the shape)`
        );
      }
      return { type: "radial", stops, start: c, end: { x: c.x + r, y: c.y } };
    }
    const s = pt(g.attrs.x1, g.attrs.y1, user ? 0 : 0, user ? 0 : 0);
    const e = pt(g.attrs.x2, g.attrs.y2, user ? 0 : 1, user ? 0 : 0);
    if (skewedBox && Math.abs(e.x - s.x) > 1e-6 && Math.abs(e.y - s.y) > 1e-6) {
      warnings.push(
        `linearGradient #${g.attrs.id} runs diagonally in objectBoundingBox units on a non-square shape — ` +
          `its bands stay perpendicular to the gradient instead of shearing with the shape ` +
          `(use gradientUnits="userSpaceOnUse", or an axis-aligned gradient, for an exact match)`
      );
    }
    return { type: "linear", stops, start: s, end: e };
  };

  walk(svg, { m: I, strokeWidth: 1, opacity: 1, fillOpacity: 1 }, []);
  const totalVerts = shapes.reduce((n, s) => n + (s.subpaths?.reduce((m, sp) => m + sp.points.length, 0) ?? 0), 0);
  if (totalVerts > 3000) warnings.push(`${totalVerts} vertices — consider simplifying the SVG (performance)`);
  return { width, height, shapes, nodes, texts, images, skipped, warnings };
}

/** 直線だけでできた軸平行の四角形なら、その矩形を返す（Figma は矩形をパスで書き出すことがある）。
 *  cubic の制御点が線分上に乗っていることまで確かめるので、曲線を矩形と誤認しない。 */
function rectFromSubpaths(subpaths: Subpath[]): SvgNodeMeta["rect"] | null {
  if (subpaths.length !== 1) return null;
  const sp = subpaths[0];
  if (!sp.closed || sp.anchors.length !== 4) return null;
  const onSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number): boolean => {
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return Math.hypot(px - ax, py - ay) < 1e-6;
    return Math.abs((px - ax) * dy - (py - ay) * dx) / len < 1e-6;
  };
  for (let i = 0; i < 4; i++) {
    const a = sp.anchors[i], b = sp.anchors[(i + 1) % 4];
    if (!onSegment(a.outX, a.outY, a.x, a.y, b.x, b.y)) return null;
    if (!onSegment(b.inX, b.inY, a.x, a.y, b.x, b.y)) return null;
  }
  const eq = (u: number, v: number) => Math.abs(u - v) < 1e-6;
  const p = sp.anchors;
  const horizontalFirst = eq(p[0].y, p[1].y) && eq(p[1].x, p[2].x) && eq(p[2].y, p[3].y) && eq(p[3].x, p[0].x);
  const verticalFirst = eq(p[0].x, p[1].x) && eq(p[1].y, p[2].y) && eq(p[2].x, p[3].x) && eq(p[3].y, p[0].y);
  if (!horizontalFirst && !verticalFirst) return null;
  const xs = p.map((a) => a.x), ys = p.map((a) => a.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  const width = Math.max(...xs) - x, height = Math.max(...ys) - y;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height, cornerRadius: 0 };
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
