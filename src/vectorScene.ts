// SVG（Figma / Illustrator のエクスポート）→ UiElement ツリー。
// スクリーンショット経路（pageScript.ts + uiDetect.ts）が「写真かパネルか」を画素から
// **推定**するのに対し、こちらは元データに答えが書いてあるので推定を一切しない。
// 矩形の座標・塗り・角丸は SVG の属性値に変換行列を掛けただけの値で、親子関係は
// <g> の入れ子そのもの（bbox の包含からの推定＝buildTree は通さない）。
//
// 正本: .claude/PLAN-vector-prototype.md（このファイルは M1+M2 の範囲）
// <text> と <image> はまだ取り込めない。黙って落とさず必ず warnings に積む。
import { importSvg } from "./svgImport.js";
import type { SvgNodeMeta } from "./svgImport.js";
import type { UiElement, RawRegion } from "./uiDetect.js";
import type { ShapeSpec } from "./rivWriter.js";

export interface VectorSceneResult {
  width: number;
  height: number;
  elements: UiElement[];
  /** maxElements で切り落としたシェイプの数 */
  dropped: number;
  warnings: string[];
}

/** レイヤー名の語 → ロール候補。Figma のレイヤー名は人が付けた唯一の意味情報なので拾う。
 *  自動生成名（"Frame 123" / "Group 5" / "Vector"）は語彙に入れない — 拾っても
 *  既定ロール(panel)と同じ結果にしかならず、「名前から読めた」という誤った印象だけが残る。 */
const ROLE_WORDS: Record<string, string> = {
  background: "background", bg: "background", backdrop: "background",
  nav: "nav", navbar: "nav", navigation: "nav", sidebar: "nav", menu: "nav", tabbar: "nav",
  header: "header", topbar: "header", appbar: "header",
  card: "card", tile: "card",
  panel: "panel", section: "panel",
  button: "button", btn: "button", cta: "button",
  fab: "fab",
  text: "text", label: "text", title: "text", heading: "text", caption: "text", paragraph: "text",
  icon: "icon", glyph: "icon", logo: "icon",
  image: "image", img: "image", photo: "image", picture: "image", thumbnail: "image", thumb: "image",
  chart: "chart", graph: "chart", plot: "chart",
  item: "list-item", row: "list-item", listitem: "list-item", cell: "list-item",
  badge: "badge", chip: "badge", tag: "badge", pill: "badge",
  divider: "divider", separator: "divider", rule: "divider",
  avatar: "avatar", profile: "avatar",
  input: "input", field: "input", textfield: "input", search: "input", searchbar: "input",
};

/** "ButtonPrimary" / "btn-primary" / "nav_bar" をすべて同じ語の並びにする */
function tokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function roleFromNames(names: string[]): string | undefined {
  for (const name of names) {
    for (const t of tokens(name)) {
      if (ROLE_WORDS[t]) return ROLE_WORDS[t];
    }
  }
  return undefined;
}

type Rect = [number, number, number, number];
const areaOf = (r: Rect) => r[2] * r[3];

interface Node {
  key: number;
  parentKey: number | null;
  names: string[];
  /** シェイプ由来のときだけ。グループは undefined（＝中身を包むだけのコンテナ） */
  shape?: { spec: ShapeSpec; meta: SvgNodeMeta };
  rect: Rect;
}

export function parseVectorScene(
  svgText: string,
  opts?: { maxElements?: number }
): VectorSceneResult {
  const im = importSvg(svgText);
  const maxElements = opts?.maxElements ?? 300;

  // 1) シェイプを選別。上限を超えたら bbox の大きい順に残す（同じ SVG なら常に同じ結果）
  let picked = im.shapes.map((spec, i) => ({ spec, meta: im.nodes[i] }));
  let dropped = 0;
  if (maxElements > 0 && picked.length > maxElements) {
    const rank = [...picked].sort((a, b) => {
      const d = areaOf(bboxOf(b.meta)) - areaOf(bboxOf(a.meta));
      return d !== 0 ? d : a.meta.key - b.meta.key; // 同面積での順序も決定的に
    });
    const keep = new Set(rank.slice(0, maxElements).map((s) => s.meta.key));
    dropped = picked.length - keep.size;
    picked = picked.filter((s) => keep.has(s.meta.key));
  }

  // 2) 残ったシェイプの祖先 <g> だけをコンテナ要素にする。
  //    中身が 1 つも残らなかったグループは要素にしない（空の枠を配っても役に立たない）
  const byKey = new Map<number, Node>();
  const childKeys = new Map<number, number[]>();
  const link = (key: number, parentKey: number | null) => {
    if (parentKey === null) return;
    const list = childKeys.get(parentKey) ?? [];
    if (!list.includes(key)) list.push(key);
    childKeys.set(parentKey, list);
  };
  for (const s of picked) {
    let parentKey: number | null = null;
    for (const g of s.meta.ancestors) {
      if (!byKey.has(g.key)) {
        byKey.set(g.key, { key: g.key, parentKey, names: g.names, rect: [0, 0, 0, 0] });
        link(g.key, parentKey);
      }
      parentKey = g.key;
    }
    byKey.set(s.meta.key, {
      key: s.meta.key, parentKey, names: s.meta.names, shape: s, rect: bboxOf(s.meta),
    });
    link(s.meta.key, parentKey);
  }

  // 3) グループの矩形は子孫シェイプの合併。key の昇順が文書順なので、後ろから畳めば
  //    深い入れ子でも 1 パスで下から上へ伝わる
  const ordered = [...byKey.values()].sort((a, b) => a.key - b.key);
  for (let i = ordered.length - 1; i >= 0; i--) {
    const n = ordered[i];
    if (n.shape) continue;
    const kids = (childKeys.get(n.key) ?? []).map((k) => byKey.get(k)!);
    n.rect = unionOf(kids.map((k) => k.rect));
  }

  // 4) id は文書順（= key の昇順）。親は必ず子より前に来るので、id は常に親 < 子になり、
  //    親子グラフは構造的に非巡回。z も文書順＝SVG の描画順になる（buildPrototypeScene は
  //    zIndex を持つ要素を zIndex 順に並べてから深さ優先で z を振る）
  const idOf = new Map<number, number>(ordered.map((n, i) => [n.key, i + 1]));
  const elements: UiElement[] = ordered.map((n) => {
    const id = idOf.get(n.key)!;
    const layerName = n.names[0];
    // 名前を持たないシェイプ（Figma の "Vector"）には、名前を持つ最も近い祖先の
    // ヒントを引き継がせる。ボタンの箱に名前が付くのではなく、箱を包むフレームに
    // "Button" と付くのが Figma の普通の形なので、引き継がないとヒントが
    // 「動かせない容れ物」の側にしか出ない。
    let roleHint = roleFromNames(n.names);
    for (let p = n.parentKey; roleHint === undefined && p !== null; p = byKey.get(p)!.parentKey) {
      roleHint = roleFromNames(byKey.get(p)!.names);
    }
    const base: RawRegion & { zIndex: number } = {
      renderMode: "vector-panel",
      semanticHint: "panel",
      rect: n.rect,
      zIndex: n.key,
    };
    const el: UiElement = {
      ...base,
      id,
      parent: n.parentKey === null ? null : idOf.get(n.parentKey)!,
      children: (childKeys.get(n.key) ?? []).map((k) => idOf.get(k)!),
      ...(layerName ? { layerName } : {}),
      ...(roleHint ? { roleHint } : {}),
    };
    if (!n.shape) return el; // グループ: 塗りを持たない容れ物。可視要素は生まない

    const { spec, meta } = n.shape;
    const solidFill = spec.fill?.color;
    // 矩形として厳密に表せて、単色で、シェイプ全体の不透明度が掛かっていないものだけが
    // vector-panel（= 編集可能な角丸矩形）になれる。グラデーション・不透明度・非矩形は
    // ベジェのまま vector-shape で持つ — どちらも編集可能で、見た目は SVG と同一。
    if (meta.rect && solidFill && spec.opacity === undefined) {
      el.rect = [meta.rect.x, meta.rect.y, meta.rect.width, meta.rect.height];
      el.fill = solidFill;
      if (meta.rect.cornerRadius > 0) el.cornerRadius = meta.rect.cornerRadius;
      if (spec.stroke) el.stroke = { color: spec.stroke.color, width: spec.stroke.thickness };
      return el;
    }
    el.renderMode = "vector-shape";
    el.semanticHint = spec.fill ? "panel" : "line";
    el.shapes = [spec];
    return el;
  });

  const warnings: string[] = [];
  if (im.skipped.text > 0) {
    warnings.push(
      `${im.skipped.text} <text> element(s) are missing from the scene — text is not imported yet, ` +
        `so their labels will not appear in the .riv. Outline the text in the design tool to get it as paths.`
    );
  }
  if (im.skipped.image > 0) {
    warnings.push(
      `${im.skipped.image} <image> element(s) are missing from the scene — embedded bitmaps are not imported yet.`
    );
  }
  if (dropped > 0) {
    warnings.push(`${dropped} smaller shapes were dropped by the maxElements cap (${maxElements}).`);
  }
  // importSvg 側の警告（未対応のパスコマンド・見つからない gradient・頂点数）は
  // 同じ文面が繰り返し積まれるので、件数に畳んでから渡す
  const rest = new Map<string, number>();
  for (const w of im.warnings) {
    if (w.startsWith("<text>") || w.startsWith("<image>")) continue;
    rest.set(w, (rest.get(w) ?? 0) + 1);
  }
  for (const [w, n] of rest) warnings.push(n > 1 ? `${w} (x${n})` : w);

  return { width: im.width, height: im.height, elements, dropped, warnings };
}

function bboxOf(meta: SvgNodeMeta): Rect {
  // 矩形として読めたならそちらが正（ベジェのアンカー bbox は角丸のぶんだけ内側に来る…
  // ということはなく一致するが、属性値そのままの数字を使うほうが丸め誤差が入らない）
  if (meta.rect) return [meta.rect.x, meta.rect.y, meta.rect.width, meta.rect.height];
  return meta.bbox;
}

function unionOf(rects: Rect[]): Rect {
  if (!rects.length) return [0, 0, 0, 0];
  const x0 = Math.min(...rects.map((r) => r[0]));
  const y0 = Math.min(...rects.map((r) => r[1]));
  const x1 = Math.max(...rects.map((r) => r[0] + r[2]));
  const y1 = Math.max(...rects.map((r) => r[1] + r[3]));
  return [x0, y0, x1 - x0, y1 - y0];
}

/** 編集可能な要素の割合。ベクター入力では「切り抜きに落ちた」要素が無いことの確認に使う。
 *  塗りを持たない容れ物（グループ）は分母から外す — 動かせないものを
 *  「編集可能」に数えると比率が意味を失う。 */
export function editableRatio(elements: UiElement[]): { editable: number; total: number; ratio: number } {
  const visible = elements.filter((e) => e.renderMode !== "vector-panel" || e.fill);
  const editable = visible.filter(
    (e) => e.renderMode === "vector-shape" || (e.renderMode === "vector-panel" && e.fill) || e.semanticHint === "text"
  );
  return {
    editable: editable.length,
    total: visible.length,
    ratio: visible.length ? editable.length / visible.length : 1,
  };
}
