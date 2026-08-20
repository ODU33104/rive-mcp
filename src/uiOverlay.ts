// 検出結果に通し番号を焼き込むための描画指示。
// 実際の描画は pageScript 側。ここは「どこに何番を書くか」を決めるだけなので単体でテストできる。
import type { UiElement } from "./uiDetect.js";

export interface OverlayLabel {
  id: number;
  box: [number, number, number, number];
  labelX: number;
  labelY: number;
  color: string;
}

// semanticHint(panel/text/image/line)で色分けする。オーバーレイは人間が要素にroleを
// 割り当てるための下見であり、見るべきは「これは意味的に何か」であって「どう描画されるか」
// (renderMode)ではないため
const SEMANTIC_COLOR: Record<string, string> = {
  panel: "#3D8BFD",
  text: "#22C55E",
  image: "#F59E0B",
  line: "#A78BFA",
};

export function overlayLabels(elements: UiElement[]): OverlayLabel[] {
  return elements.map((e) => {
    const [x, y, w, h] = e.rect;
    return {
      id: e.id,
      box: [x, y, w, h],
      // ラベルは枠の左上。画像の外にはみ出すときは内側へ寄せる
      labelX: x + 2,
      labelY: y < 16 ? y + 16 : y - 2,
      color: SEMANTIC_COLOR[e.semanticHint] ?? "#FFFFFF",
    };
  });
}
