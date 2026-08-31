// SVG（Figma / Illustrator のエクスポート）→ UiElement ツリー。
// スクリーンショット経路（pageScript.ts + uiDetect.ts）が「写真かパネルか」を画素から
// **推定**するのに対し、こちらは元データに答えが書いてあるので推定を一切しない。
// 矩形の座標・塗り・角丸は SVG の属性値に変換行列を掛けただけの値で、親子関係は
// <g> の入れ子そのもの（bbox の包含からの推定＝buildTree は通さない）。
//
// 正本: .claude/PLAN-vector-prototype.md（M1+M2 の範囲 + M3 のテキスト/画像）
import { importSvg } from "./svgImport.js";
import type { SvgNodeMeta, SvgLayerMeta, SvgTextMeta, SvgImageMeta } from "./svgImport.js";
import type { UiElement, RawRegion } from "./uiDetect.js";
import type { ShapeSpec } from "./rivWriter.js";
import { readFontMetrics, glyphCoverage, type FontMetrics } from "./fontSubset.js";

/** 呼び出し側が読んで渡すフォント。family を持たないものは「どの font-family にも使う既定」 */
export interface VectorFont {
  /** 警告に出す名前（ファイル名など）。人が読む用 */
  label: string;
  bytes: Uint8Array;
  /** SVG の font-family と突き合わせる名前。正規化（クォート除去・小文字化）済みでなくてよい */
  family?: string;
}

export interface VectorSceneOptions {
  maxElements?: number;
  /** riv_ui_prototype の fonts[]。先頭から順にマッチを試す */
  fonts?: VectorFont[];
  /** どれにも当たらなかったときの同梱フォント（assets/inter.ttf）。
   *  渡さなければテキストは全部ラスタへ降格する */
  fallbackFont?: VectorFont;
  /** `<image href>` の相対パス解決（fs をこのモジュールに持ち込まないための注入点） */
  resolveHref?: (href: string) => Uint8Array | null;
}

export interface VectorSceneResult {
  width: number;
  height: number;
  elements: UiElement[];
  /** maxElements で切り落とした要素の数 */
  dropped: number;
  /** .riv に埋め込むフォント。**実際に使われたものだけ** */
  fonts: Array<{ id: string; bytes: Uint8Array }>;
  /** テキストの内訳。「何行がテキストのまま入り、何行が絵になったか」を数字で返す */
  textStats: { total: number; asText: number; rasterized: number };
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

/** ツリーに載る 1 件。シェイプ・テキスト・画像を同じ形に均してから並べる */
type Item =
  | { kind: "shape"; key: number; names: string[]; ancestors: SvgLayerMeta[]; rect: Rect; spec: ShapeSpec; meta: SvgNodeMeta }
  | { kind: "text"; key: number; names: string[]; ancestors: SvgLayerMeta[]; rect: Rect; text: SvgTextMeta; placed: PlacedText }
  | { kind: "image"; key: number; names: string[]; ancestors: SvgLayerMeta[]; rect: Rect; image: SvgImageMeta };

interface Node {
  key: number;
  parentKey: number | null;
  names: string[];
  /** 描画物由来のときだけ。グループは undefined（＝中身を包むだけのコンテナ） */
  item?: Item;
  rect: Rect;
}

/** フォント解決とベースライン変換の結果 */
interface PlacedText {
  /** テキストボックス左上（Rive の Text 原点） */
  x: number;
  y: number;
  width: number;
  height: number;
  /** cmap+hmtx から出した advance 幅の合計（px）。**canvas 計測はしない** */
  advanceWidth: number;
  /** テキストのまま入れられないときは undefined（呼び出し側はラスタへ降格する） */
  fontId?: string;
  /** 降格の理由。警告の文面に使う */
  demotion?: string;
}

export function parseVectorScene(svgText: string, opts?: VectorSceneOptions): VectorSceneResult {
  const im = importSvg(svgText, { resolveHref: opts?.resolveHref });
  const maxElements = opts?.maxElements ?? 300;
  const warnings: string[] = [];

  // ---- フォントの 3 段はしご（PLAN M3 §2）--------------------------------
  // 1) fonts[] に family が一致するもの 2) 同梱 Inter へ代替（警告）
  // 3) cmap に無い文字が 1 つでもあればテキスト化を諦めてラスタへ（警告）
  const metricsCache = new Map<VectorFont, FontMetrics | null>();
  const metricsOf = (f: VectorFont): FontMetrics | null => {
    if (!metricsCache.has(f)) {
      try {
        metricsCache.set(f, readFontMetrics(f.bytes));
      } catch (e) {
        warnings.push(`font '${f.label}' could not be read (${e instanceof Error ? e.message : e}) — not used`);
        metricsCache.set(f, null);
      }
    }
    return metricsCache.get(f)!;
  };
  const norm = (s: string) => s.split(",")[0].replace(/["']/g, "").trim().toLowerCase();
  const userFonts = opts?.fonts ?? [];
  const missedFamilies = new Set<string>();
  const pickFont = (family: string | undefined): VectorFont | undefined => {
    if (family) {
      const hit = userFonts.find((f) => f.family && norm(f.family) === family);
      if (hit) return hit;
    }
    // family 指定の無いエントリは「全部これで描く」の意味
    const wildcard = userFonts.find((f) => !f.family);
    if (wildcard) return wildcard;
    const fb = opts?.fallbackFont;
    // 同梱フォントが求められた family そのものなら代替ではない（警告する理由が無い）
    if (family && fb && !(fb.family && norm(fb.family) === family)) missedFamilies.add(family);
    return fb;
  };

  const usedFonts = new Map<VectorFont, string>();
  const idFor = (f: VectorFont): string => {
    let id = usedFonts.get(f);
    if (id === undefined) {
      id = `font${usedFonts.size + 1}`;
      usedFonts.set(f, id);
    }
    return id;
  };

  /** グリフが無い文字の幅は測れない。切り抜き枠にしか使わないので、
   *  足りずに文字が切れるより余白が入るほうを選ぶ（CJK/かな/ハングルは全角と見なす） */
  const guessAdvance = (cp: number, fontSize: number) => (cp >= 0x1100 ? fontSize : fontSize * 0.6);

  const placeText = (t: SvgTextMeta): PlacedText => {
    const font = pickFont(t.family);
    const m = font ? metricsOf(font) : null;
    let demotion: string | undefined;
    if (!font || !m) demotion = "no usable font";
    else if (t.rotated) demotion = "the text is rotated or skewed";
    else {
      const { missing } = glyphCoverage(font.bytes, t.content);
      if (missing.length) {
        demotion = `${font.label} has no glyph for ${missing.slice(0, 6).map((c) => `'${c}'`).join(", ")}` +
          (missing.length > 6 ? ` and ${missing.length - 6} more` : "");
      }
    }

    if (m && !demotion && font) {
      // ベースライン変換: SVG の y はベースライン、Rive の Text は上端原点。
      // ascent は hhea から読む（canvas 計測を使わないのは、同じ入力から同じ .riv が
      // 出ることを実行環境に依存させないため）
      const s = t.fontSize / m.unitsPerEm;
      let advance = 0;
      for (const ch of t.content) advance += m.advanceOf(ch.codePointAt(0)!) ?? 0;
      const width = advance * s;
      // text-anchor は「width を決めて Rive の align に任せる」より x を平行移動するほうが単純。
      // auto サイズの Text は中身の幅にぴったり張り付くので、align は効かない
      const x = t.anchor === "middle" ? t.x - width / 2 : t.anchor === "end" ? t.x - width : t.x;
      return {
        x, y: t.y - m.ascent * s,
        width, height: (m.ascent - m.descent) * s,
        advanceWidth: width,
        fontId: idFor(font),
      };
    }

    // ラスタ降格。枠は広めに取る（この矩形は切り抜きの範囲そのもの）
    let est = 0;
    for (const ch of t.content) {
      const cp = ch.codePointAt(0)!;
      const a = m?.advanceOf(cp);
      est += a !== undefined ? (a * t.fontSize) / m!.unitsPerEm : guessAdvance(cp, t.fontSize);
    }
    const pad = t.fontSize * 0.3;
    const left = t.anchor === "middle" ? t.x - est / 2 : t.anchor === "end" ? t.x - est : t.x;
    return {
      x: left - pad, y: t.y - t.fontSize * 1.15,
      width: est + pad * 2, height: t.fontSize * 1.55,
      advanceWidth: est,
      demotion,
    };
  };

  // ---- 1) 描画物を集めて上限で切る --------------------------------------
  const items: Item[] = [
    ...im.shapes.map((spec, i): Item => ({
      kind: "shape", key: im.nodes[i].key, names: im.nodes[i].names,
      ancestors: im.nodes[i].ancestors, rect: bboxOf(im.nodes[i]), spec, meta: im.nodes[i],
    })),
    ...im.texts.map((t): Item => {
      const placed = placeText(t);
      return {
        kind: "text", key: t.key, names: t.names, ancestors: t.ancestors,
        rect: [placed.x, placed.y, placed.width, placed.height], text: t, placed,
      };
    }),
    ...im.images.map((g): Item => ({
      kind: "image", key: g.key, names: g.names, ancestors: g.ancestors,
      rect: [g.rect.x, g.rect.y, g.rect.width, g.rect.height], image: g,
    })),
  ].sort((a, b) => a.key - b.key);

  let picked = items;
  let dropped = 0;
  if (maxElements > 0 && picked.length > maxElements) {
    const rank = [...picked].sort((a, b) => {
      const d = areaOf(b.rect) - areaOf(a.rect);
      return d !== 0 ? d : a.key - b.key; // 同面積での順序も決定的に
    });
    const keep = new Set(rank.slice(0, maxElements).map((s) => s.key));
    dropped = picked.length - keep.size;
    picked = picked.filter((s) => keep.has(s.key));
  }

  // ---- 2) 残った描画物の祖先 <g> だけをコンテナ要素にする ----------------
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
    for (const g of s.ancestors) {
      if (!byKey.has(g.key)) {
        byKey.set(g.key, { key: g.key, parentKey, names: g.names, rect: [0, 0, 0, 0] });
        link(g.key, parentKey);
      }
      parentKey = g.key;
    }
    byKey.set(s.key, { key: s.key, parentKey, names: s.names, item: s, rect: s.rect });
    link(s.key, parentKey);
  }

  // ---- 3) グループの矩形は子孫の合併 -------------------------------------
  // key の昇順が文書順なので、後ろから畳めば深い入れ子でも 1 パスで下から上へ伝わる
  const ordered = [...byKey.values()].sort((a, b) => a.key - b.key);
  for (let i = ordered.length - 1; i >= 0; i--) {
    const n = ordered[i];
    if (n.item) continue;
    const kids = (childKeys.get(n.key) ?? []).map((k) => byKey.get(k)!);
    n.rect = unionOf(kids.map((k) => k.rect));
  }

  // ---- 4) id は文書順（= key の昇順）------------------------------------
  // 親は必ず子より前に来るので、id は常に親 < 子になり、親子グラフは構造的に非巡回。
  // z も文書順＝SVG の描画順になる（buildPrototypeScene は zIndex を持つ要素を
  // zIndex 順に並べてから深さ優先で z を振る）
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
    if (!n.item) return el; // グループ: 塗りを持たない容れ物。可視要素は生まない

    if (n.item.kind === "text") {
      const { text, placed } = n.item;
      el.semanticHint = "text";
      el.fontSizePx = text.fontSize;
      if (placed.fontId) {
        el.renderMode = "vector-text";
        el.textRun = {
          content: text.content, x: placed.x, y: placed.y,
          fontSize: text.fontSize, color: text.color, font: placed.fontId,
          advanceWidth: placed.advanceWidth,
        };
      } else {
        // 豆腐を .riv に焼き込むより、見た目そのままの絵にして編集性だけを失うほうがまし。
        // 切り抜きは「この 1 行だけを描いた透明な SVG」から取るので、背景は焼き付かない
        el.renderMode = "raster";
        el.svgFragment = text.fragment;
        el.ownPixels = true;
      }
      if (!roleHint) el.roleHint = "text";
      return el;
    }

    if (n.item.kind === "image") {
      const g = n.item.image;
      el.renderMode = "raster";
      el.semanticHint = "image";
      el.imageBytes = g.bytes;
      el.ownPixels = true;
      // Rive の画像は「自然サイズ × scale」で描かれる。SVG の width/height と
      // 元ビットマップの画素数が違うのが普通なので、ここで合わせないと拡大率が狂う
      const px = pixelSize(g.bytes);
      if (px) {
        el.imageScale = g.rect.width / px.width;
        const aspect = (g.rect.width / g.rect.height) / (px.width / px.height);
        if (Math.abs(aspect - 1) > 0.01) {
          warnings.push(
            `<image>${g.names[0] ? ` "${g.names[0]}"` : ""} is placed at ${g.rect.width}x${g.rect.height} ` +
              `but the bitmap is ${px.width}x${px.height} — Rive scales images uniformly, so the height was ` +
              `matched to the width instead of being stretched.`
          );
        }
      } else {
        warnings.push(
          `<image>${g.names[0] ? ` "${g.names[0]}"` : ""} is in a format whose size could not be read ` +
            `(PNG/JPEG/GIF are) — it is drawn at its natural size.`
        );
      }
      if (!roleHint) el.roleHint = "image";
      return el;
    }

    const { spec, meta } = n.item;
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

  // ---- 5) 警告 -----------------------------------------------------------
  // 「黙って変えない」がこの機能の仕様。代替も降格も必ず 1 件は警告に出す
  for (const family of [...missedFamilies].sort()) {
    warnings.push(
      `font-family '${family}' is not in fonts[] — ${opts!.fallbackFont!.label} is used instead. ` +
        `Letterforms and line widths will not match the design. Pass fonts:[{family:"${family}",path:"..."}] to fix it.`
    );
  }
  const demoted = im.texts
    .map((t) => ({ t, placed: placeTextCached(t) }))
    .filter((r) => r.placed.demotion);
  for (const { t, placed } of demoted) {
    warnings.push(
      `text "${t.content.slice(0, 24)}" was baked as a picture instead of editable text: ${placed.demotion}. ` +
        `It looks right but cannot be re-typed at runtime.`
    );
  }
  const spaced = im.texts.filter((t) => t.letterSpacing !== undefined);
  if (spaced.length) {
    warnings.push(
      `letter-spacing on ${spaced.length} text ${spaced.length === 1 ? "run" : "runs"} was dropped ` +
        `(Rive text has no letter spacing) — the runs will be slightly narrower than the design.`
    );
  }
  const weighted = im.texts.filter((t) => t.weight && !/^(400|normal)$/i.test(t.weight));
  if (weighted.length) {
    warnings.push(
      `font-weight (${[...new Set(weighted.map((t) => t.weight))].join(", ")}) is not synthesised — ` +
        `the weight of the font file itself is used. Pass that weight's file in fonts[] if it matters.`
    );
  }
  if (im.skipped.text > 0) {
    warnings.push(`${im.skipped.text} <text> element(s) could not be imported (see the warnings above).`);
  }
  if (im.skipped.image > 0) {
    warnings.push(`${im.skipped.image} <image> element(s) could not be imported (see the warnings above).`);
  }
  if (dropped > 0) {
    warnings.push(`${dropped} smaller elements were dropped by the maxElements cap (${maxElements}).`);
  }
  // importSvg 側の警告（未対応のパスコマンド・見つからない gradient・頂点数）は
  // 同じ文面が繰り返し積まれるので、件数に畳んでから渡す
  const rest = new Map<string, number>();
  for (const w of im.warnings) rest.set(w, (rest.get(w) ?? 0) + 1);
  for (const [w, n] of rest) warnings.push(n > 1 ? `${w} (x${n})` : w);

  const asText = elements.filter((e) => e.renderMode === "vector-text").length;
  return {
    width: im.width, height: im.height, elements, dropped,
    fonts: [...usedFonts].map(([f, id]) => ({ id, bytes: f.bytes })),
    textStats: { total: im.texts.length, asText, rasterized: im.texts.length - asText },
    warnings,
  };

  // placeText は idFor で副作用（フォントの採用登録）を持つので、警告用に二度呼ばない
  function placeTextCached(t: SvgTextMeta): PlacedText {
    const hit = items.find((i) => i.kind === "text" && i.text === t);
    return hit && hit.kind === "text" ? hit.placed : placeText(t);
  }
}

/** ヘッダだけを読んでビットマップの画素数を返す。デコーダは持ち込まない（PNG/JPEG/GIF のみ）。 */
function pixelSize(b: Uint8Array): { width: number; height: number } | null {
  const u16 = (o: number) => (b[o] << 8) | b[o + 1];
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { width: u32(16), height: u32(20) }; // IHDR
  }
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) }; // GIF は little endian
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let p = 2;
    while (p + 9 < b.length) {
      if (b[p] !== 0xff) { p++; continue; }
      const marker = b[p + 1];
      // SOF0-3 / 5-7 / 9-11 / 13-15 が寸法を持つ。DHT(c4)/JPG(c8)/DAC(cc) は違う
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: u16(p + 5), width: u16(p + 7) };
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { p += 2; continue; }
      p += 2 + u16(p + 2);
    }
  }
  return null;
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

/**
 * ラスタへ降格したテキストを、その 1 行だけを描いた透明な SVG から切り抜いて bytes にする。
 * **ブラウザが要る唯一の後処理**なので、シーン組み立て(buildPrototypeScene)の前に済ませて
 * 下流には bytes だけを渡す。切り抜きの背景が透明なので、動かしても元の位置に絵は残らない。
 */
export async function attachTextRasters(
  elements: UiElement[],
  host: {
    rasterize(svg: string): Promise<Buffer>;
    sliceImage(
      png: Buffer,
      regions: Array<{ name: string; polygon: Array<[number, number]> }>
    ): Promise<{ parts: Array<{ name: string; png: string }> }>;
  }
): Promise<number> {
  let done = 0;
  for (const el of elements) {
    if (!el.svgFragment || el.imageBytes) continue;
    const png = await host.rasterize(el.svgFragment);
    const [x, y, w, h] = el.rect;
    const sliced = await host.sliceImage(png, [
      { name: "text", polygon: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] },
    ]);
    const part = sliced.parts[0];
    if (!part) continue;
    el.imageBytes = new Uint8Array(Buffer.from(part.png, "base64"));
    done++;
  }
  return done;
}

/** 編集可能な要素の割合。ベクター入力では「切り抜きに落ちた」要素が無いことの確認に使う。
 *  塗りを持たない容れ物（グループ）は分母から外す — 動かせないものを
 *  「編集可能」に数えると比率が意味を失う。 */
export function editableRatio(elements: UiElement[]): { editable: number; total: number; ratio: number } {
  const visible = elements.filter(
    (e) => e.renderMode === "vector-shape" || e.renderMode === "vector-text" ||
      e.renderMode === "raster" || (e.renderMode === "vector-panel" && !!e.fill)
  );
  // raster はテキストのラスタ降格か埋め込みビットマップ。どちらも見た目は正しいが
  // 「中身を差し替えられる」ことは失っているので編集可能には数えない
  const editable = visible.filter((e) => e.renderMode !== "raster");
  return {
    editable: editable.length,
    total: visible.length,
    ratio: visible.length ? editable.length / visible.length : 1,
  };
}
