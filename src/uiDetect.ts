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

  for (const child of elements) {
    let best: UiElement | null = null;
    for (const cand of elements) {
      if (cand.id === child.id) continue;
      if (!contains(cand, child)) continue;
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
