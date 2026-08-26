// スクリーンショット検出結果の型と、bbox の包含関係から親子ツリーを組む純関数。
// ピクセル処理は pageScript.ts 側（canvas が要るため）。ここは Node 単体でテストできる。

// 「どう描くか」(renderMode)と「意味的に何か」(semanticHint)は独立した問いなので分けて持つ。
// 誤ってvector化すると見た目そのものが壊れる(非矩形の絵やグラデーションを直線パスに潰す)一方、
// 誤ってraster化しても見た目は正しいまま編集性を失うだけ、という失敗コストの非対称性があるため、
// renderModeの判定は将来「迷ったらraster」に寄せる余地を残す必要がある。semanticHintと1本の
// kindに統合すると、その判定基準の変更がロール付け(panel/text/image/lineの意味)まで
// 巻き込んでしまい、両者を同時に動かさざるを得なくなる。
export type RenderMode = "vector-panel" | "raster";
export type SemanticHint = "panel" | "text" | "image" | "line";

export interface RawRegion {
  /** vector-panel は「ベクター化の資格がある」の意味であり「必ずベクター化される」ではない。
   *  実際にベクター化されるかは fill の有無など下流(uiPrototype.ts)の条件次第 */
  renderMode: RenderMode;
  semanticHint: SemanticHint;
  /** [x, y, w, h] 元解像度のピクセル座標 */
  rect: [number, number, number, number];
  cornerRadius?: number;
  fill?: string;
  stroke?: { color: string; width: number };
  fontSizePx?: number;
  /** テキストを背景から切り離して独立に動かせるか。**semanticHint とは独立に決まる。**
   *  写真や模様が「テキスト行」として誤検出されても、色直線モデルに乗らなければ false。
   *  false のときは矩形ラスタのまま扱い、動かし方も fade だけに落とす(uiPrototype.ts)。 */
  matteEligible?: boolean;
  /** 動かし方を決めるための総合信頼度(0〜1) = 当てはまり × alpha の2峰性。
   *  アンチエイリアスの縁が必ず中間 alpha になるので 1 には到達しない。
   *  実測(2026-08-21): 本物のテキストで 0.6〜0.8、写真の誤検出で 0.0〜0.24。 */
  matteConfidence?: number;
  /** vector-panel の資格が「内側のテキスト行が穴を覆う」ことに依っている印。
   *  この行が落ちるとラベルの消えたボタンになるので、buildTree は行をパネルと一緒に残す */
  coveredByText?: boolean;
  /** 色直線モデルの当てはまり(0〜1)。**これだけでは写真と分離できない** —
   *  彩度の低い写真は色空間でほぼ1次元なので本当によく当てはまる(実測 0.84)。 */
  matteFit?: number;
  /** alpha が 0.2〜0.8 に入る画素の割合。テキストは2峰性なので小さい(中央 0.246)、
   *  写真は全域に散るので大きい(中央 0.319)。fit と併せて初めて分離できる。 */
  matteMidAlpha?: number;
  /** eligible のときだけ入る。sliceImage がこの2色で alpha を作る。 */
  matte?: { fg: string; bg: string; space: "srgb" | "linear" };
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
  // 面積上位を残す。ただし「文字で覆われた穴」を根拠にベクター化したパネル
  // (coveredByText) は、内側のテキスト行と**一緒にしか**残さない。行は小さいので
  // 素直に面積順に切ると真っ先に落ち、平坦に塗ったパネルからラベルだけが消える。
  //
  // 行を無条件にパネルの上へ繰り上げる案は取り下げた: 画面全体の背景が promote されると
  // その内側の行（＝ページ上のほぼ全行）が上限を占有し、本物のボタンが 1 件も残らなくなった
  // （実測 2026-08-26: photo-hero の幾何 recall 1.0 → 0.0）。
  // ここでは面積順に見ていき、パネルと未確保の行が枠に収まるなら行の席を予約し、
  // 収まらないならパネルの方をラスタに落とす（promote 前と同じ状態に戻す）。
  const byArea = [...regions].sort((a, b) => area(b) - area(a));
  // 残す優先順位。面積だけで切ると、テキスト行が正しく細かく分かれた画面ほど
  // 小さなボタンが押し出される（実測 2026-08-26: photo-hero の 39x22 のボタン 2 件が
  // 面積順 121/122 位で落ち、幾何 recall 1.0 → 0.5）。
  //   1. 編集できるもの — vector-panel と、色直線モデルに乗った本物のテキスト行
  //   2. ラスタの絵（image）
  //   3. モデルに乗らない「テキスト行」— 写真の粒子などの誤検出が大半で、動かし方も fade のみ
  // 同じ段の中では面積順。id の付与（z 順・親子）は選別後に面積順でやり直す。
  const tier = (r: RawRegion) =>
    r.renderMode === "vector-panel" || (r.semanticHint === "text" && r.matteEligible) ? 0
      : r.semanticHint === "text" ? 2 : 1;
  const byPriority = [...byArea].sort((a, b) => tier(a) - tier(b) || area(b) - area(a));
  const textsIn = (p: RawRegion) =>
    regions.filter((t) => t.semanticHint === "text" && contains(p, t));
  const reserved = new Set<RawRegion>();
  const keptSet = new Set<RawRegion>();
  let slots = 0;
  const demoted = new Map<RawRegion, RawRegion>();
  for (const r of byPriority) {
    if (reserved.has(r)) { keptSet.add(r); continue; }
    if (slots >= maxElements) continue;
    let region = r;
    if (r.coveredByText && r.renderMode === "vector-panel") {
      const need = textsIn(r).filter((t) => !reserved.has(t) && !keptSet.has(t));
      if (slots + 1 + need.length <= maxElements) {
        for (const t of need) reserved.add(t);
        slots += need.length;
      } else {
        const { coveredByText: _c, ...rest } = r;
        region = { ...rest, renderMode: "raster", semanticHint: "image", cornerRadius: 0 };
        demoted.set(r, region);
      }
    }
    keptSet.add(r);
    slots++;
  }
  const kept = byArea.filter((r) => keptSet.has(r)).map((r) => demoted.get(r) ?? r);
  const dropped = regions.length - kept.length;
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
