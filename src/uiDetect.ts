// スクリーンショット検出結果の型と、bbox の包含関係から親子ツリーを組む純関数。
// ピクセル処理は pageScript.ts 側（canvas が要るため）。ここは Node 単体でテストできる。

export type UiKind = "panel" | "text" | "image" | "line";

export interface RawRegion {
  kind: UiKind;
  /** [x, y, w, h] 元解像度のピクセル座標 */
  rect: [number, number, number, number];
  cornerRadius?: number;
  fill?: string;
  stroke?: { color: string; width: number };
  fontSizePx?: number;
}

export interface UiElement extends RawRegion {
  id: number;
  parent: number | null;
  children: number[];
}

const area = (r: RawRegion) => r.rect[2] * r.rect[3];

/** a が b を 95% 以上含むか。閾値未満だと 1px のはみ出しで親子が切れる */
function contains(a: RawRegion, b: RawRegion): boolean {
  const [ax, ay, aw, ah] = a.rect;
  const [bx, by, bw, bh] = b.rect;
  const ix = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx));
  const iy = Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
  return area(b) > 0 && (ix * iy) / area(b) >= 0.95;
}

export function buildTree(
  regions: RawRegion[],
  maxElements: number
): { elements: UiElement[]; dropped: number } {
  const sorted = [...regions].sort((a, b) => area(b) - area(a));
  const dropped = Math.max(0, sorted.length - maxElements);
  const kept = sorted.slice(0, maxElements);

  const elements: UiElement[] = kept.map((r, i) => ({
    ...r,
    id: i + 1,
    parent: null,
    children: [],
  }));

  // EPSILON: 親候補は子より面積が2%より大きくないと「意味のある包含」とみなさない。
  // 検出器はカードの縁とわずかに内側にずれたパネルを別要素として二重検出することがあり、
  // その2枚は互いを95%以上「含む」。面積がほぼ同じ（=どちらが親でもおかしくない）ペアを
  // 親子と認めると、後段のロジックが「大きい方が親」という前提で作られていても実質
  // 同格の2枚を無理やり親子にしてしまう。2%は実測の検出ノイズ（数px四方のずれ）を
  // 吸収しつつ、意図的な入れ子（通常もっと大きな余白差がある）は弾かない値として選んだ。
  const EPSILON = 0.02;

  for (const child of elements) {
    let best: UiElement | null = null;
    for (const cand of elements) {
      // sorted は面積降順で並べてから id を振っているので、id が子より小さい候補は
      // 「面積が子以上（同着含む）」であることが id の割り当てだけから保証される。
      // 親候補をこの範囲に限定すると、parent は必ず自分より小さい id を指すことになり、
      // parent を辿るたびに id が単調に減少する（正の整数なので無限には減れない）。
      // 循環が起きるには id がどこかで増加して元に戻る必要があるが、この条件下ではそれが
      // 構造的に不可能なので、95%包含の判定が多少ブレても親子グラフは必ず非巡回になる。
      if (cand.id >= child.id) continue;
      if (!contains(cand, child)) continue;
      if (area(cand) <= area(child) * (1 + EPSILON)) continue;
      // 「含む最小の矩形」が親。同面積なら先に来たほう（= 面積降順で安定）
      if (!best || area(cand) < area(best)) best = cand;
    }
    if (best) {
      child.parent = best.id;
      best.children.push(child.id);
    }
  }

  // 同じ親の子は読み順（y → x）に並べる
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const e of elements) {
    e.children.sort((a, b) => {
      const ea = byId.get(a)!;
      const eb = byId.get(b)!;
      return ea.rect[1] - eb.rect[1] || ea.rect[0] - eb.rect[0];
    });
  }

  return { elements, dropped };
}
