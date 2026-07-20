// TrueType(glyf)フォントの最小サブセッター（依存なし）
// 目的: .riv に全グリフを埋め込むと Inter で 806KB になる問題の解決。
// 使用文字 + 合成グリフ依存だけ残し、cmap(format4) / glyf / loca / hmtx を再構築、
// その他の必須テーブルはコピーする。CFF(.otf)系は対象外（呼び出し側でフォールバック）。
// 制約: GSUB/GPOS等のシェーピングテーブルは落とす（リガチャ・カーニングは失われる。
// 基本ラテン+数字+記号のUIテキスト用途では実害が小さい）。

interface Table { tag: string; offset: number; length: number }

function u16(b: Uint8Array, o: number): number { return (b[o] << 8) | b[o + 1]; }
function i16(b: Uint8Array, o: number): number { const v = u16(b, o); return v >= 0x8000 ? v - 0x10000 : v; }
function u32(b: Uint8Array, o: number): number { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }

class W {
  private a: number[] = [];
  u8(v: number) { this.a.push(v & 0xff); }
  u16(v: number) { this.a.push((v >> 8) & 0xff, v & 0xff); }
  u32(v: number) { this.a.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff); }
  raw(b: Uint8Array) { for (const x of b) this.a.push(x); }
  pad4() { while (this.a.length % 4) this.a.push(0); }
  get length() { return this.a.length; }
  bytes() { return new Uint8Array(this.a); }
}

export function subsetTtf(font: Uint8Array, text: string): Uint8Array {
  const sfnt = u32(font, 0);
  if (sfnt !== 0x00010000 && sfnt !== 0x74727565) {
    throw new Error("not a TrueType(glyf) font (CFF/.otf is not supported)");
  }
  const numTables = u16(font, 4);
  const tables = new Map<string, Table>();
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(font[o], font[o + 1], font[o + 2], font[o + 3]);
    tables.set(tag, { tag, offset: u32(font, o + 8), length: u32(font, o + 12) });
  }
  const need = (t: string): Table => {
    const x = tables.get(t);
    if (!x) throw new Error(`missing table ${t}`);
    return x;
  };
  const head = need("head"), maxp = need("maxp"), locaT = need("loca"), glyfT = need("glyf"),
    cmapT = need("cmap"), hheaT = need("hhea"), hmtxT = need("hmtx");

  const numGlyphs = u16(font, maxp.offset + 4);
  const indexToLocFormat = u16(font, head.offset + 50);
  const numHMetrics = u16(font, hheaT.offset + 34);

  // loca 読み
  const locaOf = (gid: number): [number, number] => {
    if (indexToLocFormat === 0) {
      return [u16(font, locaT.offset + gid * 2) * 2, u16(font, locaT.offset + (gid + 1) * 2) * 2];
    }
    return [u32(font, locaT.offset + gid * 4), u32(font, locaT.offset + (gid + 1) * 4)];
  };

  // cmap: unicode→gid（format 4 / 12 対応）
  const cmapMap = readCmap(font, cmapT.offset);

  // 必要グリフ集合: .notdef(0) + 使用文字 + 合成依存の再帰
  const wanted = new Set<number>([0]);
  for (const ch of new Set(text)) {
    const gid = cmapMap.get(ch.codePointAt(0)!);
    if (gid !== undefined) wanted.add(gid);
  }
  const stack = [...wanted];
  while (stack.length) {
    const gid = stack.pop()!;
    const [s, e] = locaOf(gid);
    if (e <= s) continue;
    const go = glyfT.offset + s;
    const numContours = i16(font, go);
    if (numContours >= 0) continue;
    // 合成グリフ: コンポーネントgidを辿る
    let p = go + 10;
    for (;;) {
      const flags = u16(font, p);
      const compGid = u16(font, p + 2);
      if (!wanted.has(compGid)) { wanted.add(compGid); stack.push(compGid); }
      p += 4;
      p += flags & 0x0001 ? 4 : 2; // ARG_1_AND_2_ARE_WORDS
      if (flags & 0x0008) p += 2; // WE_HAVE_A_SCALE
      else if (flags & 0x0040) p += 4; // X_AND_Y_SCALE
      else if (flags & 0x0080) p += 8; // 2x2
      if (!(flags & 0x0020)) break; // MORE_COMPONENTS
    }
  }

  // 旧gid→新gid（昇順で詰める。composite内のgid参照を書き換える必要がある）
  const oldGids = [...wanted].sort((a, b) => a - b);
  const newGidOf = new Map<number, number>();
  oldGids.forEach((g, i) => newGidOf.set(g, i));

  // glyf/loca 再構築
  const glyfW = new W();
  const locaOffsets: number[] = [0];
  for (const gid of oldGids) {
    const [s, e] = locaOf(gid);
    if (e > s) {
      const data = font.slice(glyfT.offset + s, glyfT.offset + e);
      const numContours = i16(data, 0);
      if (numContours < 0) {
        // composite: コンポーネントgidを新gidへ書き換え
        let p = 10;
        for (;;) {
          const flags = u16(data, p);
          const compGid = u16(data, p + 2);
          const ng = newGidOf.get(compGid)!;
          data[p + 2] = (ng >> 8) & 0xff; data[p + 3] = ng & 0xff;
          p += 4;
          p += flags & 0x0001 ? 4 : 2;
          if (flags & 0x0008) p += 2;
          else if (flags & 0x0040) p += 4;
          else if (flags & 0x0080) p += 8;
          if (!(flags & 0x0020)) break;
        }
      }
      glyfW.raw(data);
      while (glyfW.length % 4) glyfW.u8(0); // グリフ境界4バイト整列（loca format1で安全）
    }
    locaOffsets.push(glyfW.length);
  }
  const locaW = new W();
  for (const o of locaOffsets) locaW.u32(o); // 常に long format
  const glyfBytes = glyfW.bytes();

  // hmtx 再構築（全グリフに advance/lsb を明示 → numHMetrics = glyph数）
  const hmtxW = new W();
  const readHM = (gid: number): [number, number] => {
    if (gid < numHMetrics) {
      return [u16(font, hmtxT.offset + gid * 4), i16(font, hmtxT.offset + gid * 4 + 2)];
    }
    const adv = u16(font, hmtxT.offset + (numHMetrics - 1) * 4);
    const lsbOff = hmtxT.offset + numHMetrics * 4 + (gid - numHMetrics) * 2;
    return [adv, i16(font, lsbOff)];
  };
  for (const gid of oldGids) {
    const [adv, lsb] = readHM(gid);
    hmtxW.u16(adv); hmtxW.u16(lsb & 0xffff);
  }

  // cmap format 4 再構築（BMP内。BMP外の文字は落ちる）
  const pairs: Array<[number, number]> = [];
  for (const ch of new Set(text)) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0xffff) continue;
    const gid = cmapMap.get(cp);
    if (gid !== undefined) pairs.push([cp, newGidOf.get(gid)!]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const segments: Array<{ start: number; end: number; gids: number[] }> = [];
  for (const [cp, gid] of pairs) {
    const last = segments[segments.length - 1];
    if (last && cp === last.end + 1) { last.end = cp; last.gids.push(gid); }
    else segments.push({ start: cp, end: cp, gids: [gid] });
  }
  segments.push({ start: 0xffff, end: 0xffff, gids: [0] });
  const segCount = segments.length;
  const cmapSub = new W();
  cmapSub.u16(4); // format
  const glyphIdArray: number[] = [];
  // 全セグメントを idRangeOffset 経由の glyphIdArray 方式で書く（idDelta計算不要で単純）
  cmapSub.u16(0); // length 後で
  cmapSub.u16(0); // language
  const seg2 = segCount * 2;
  const searchRange = 2 ** Math.floor(Math.log2(segCount)) * 2;
  cmapSub.u16(seg2); cmapSub.u16(searchRange);
  cmapSub.u16(Math.floor(Math.log2(segCount))); cmapSub.u16(seg2 - searchRange);
  for (const s of segments) cmapSub.u16(s.end);
  cmapSub.u16(0); // reserved
  for (const s of segments) cmapSub.u16(s.start);
  for (let i = 0; i < segCount; i++) {
    // 最終セグメント(0xffff)は idDelta=1/idRangeOffset=0 の慣例
    cmapSub.u16(i === segCount - 1 ? 1 : 0);
  }
  let gidCursor = 0;
  for (let i = 0; i < segCount; i++) {
    if (i === segCount - 1) { cmapSub.u16(0); continue; }
    // idRangeOffset: この位置から glyphIdArray 内エントリまでのバイト距離
    const remainingSegs = segCount - i;
    cmapSub.u16(remainingSegs * 2 + gidCursor * 2);
    glyphIdArray.push(...segments[i].gids);
    gidCursor += segments[i].gids.length;
  }
  for (const g of glyphIdArray) cmapSub.u16(g);
  const cmapSubBytes = cmapSub.bytes();
  // length 埋め
  cmapSubBytes[2] = (cmapSubBytes.length >> 8) & 0xff;
  cmapSubBytes[3] = cmapSubBytes.length & 0xff;
  const cmapW = new W();
  cmapW.u16(0); // version
  cmapW.u16(2); // 2 encodings (0,3) と (3,1) が同じサブテーブルを指す
  cmapW.u16(0); cmapW.u16(3); cmapW.u32(4 + 2 * 8);
  cmapW.u16(3); cmapW.u16(1); cmapW.u32(4 + 2 * 8);
  cmapW.raw(cmapSubBytes);

  // head / maxp / hhea 複製+パッチ
  const headB = font.slice(head.offset, head.offset + head.length);
  headB[50] = 0; headB[51] = 1; // indexToLocFormat = 1 (long)
  headB[8] = headB[9] = headB[10] = headB[11] = 0; // checkSumAdjustment=0
  const maxpB = font.slice(maxp.offset, maxp.offset + maxp.length);
  maxpB[4] = (oldGids.length >> 8) & 0xff; maxpB[5] = oldGids.length & 0xff;
  const hheaB = font.slice(hheaT.offset, hheaT.offset + hheaT.length);
  hheaB[34] = (oldGids.length >> 8) & 0xff; hheaB[35] = oldGids.length & 0xff;

  // 出力テーブル群（存在すればコピーするもの含む）
  const out: Array<[string, Uint8Array]> = [
    ["cmap", cmapW.bytes()],
    ["glyf", glyfBytes],
    ["head", headB],
    ["hhea", hheaB],
    ["hmtx", hmtxW.bytes()],
    ["loca", locaW.bytes()],
    ["maxp", maxpB],
  ];
  for (const tag of ["name", "post", "OS/2", "cvt ", "fpgm", "prep", "gasp"]) {
    const t = tables.get(tag);
    if (t) out.push([tag, font.slice(t.offset, t.offset + t.length)]);
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : 1));

  // sfnt 組み立て
  const n = out.length;
  const w = new W();
  w.u32(0x00010000);
  w.u16(n);
  const sr = 2 ** Math.floor(Math.log2(n)) * 16;
  w.u16(sr); w.u16(Math.floor(Math.log2(n))); w.u16(n * 16 - sr);
  let offset = 12 + n * 16;
  const checksum = (b: Uint8Array): number => {
    let s = 0;
    for (let i = 0; i < b.length; i += 4) {
      s = (s + (((b[i] ?? 0) << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0))) >>> 0;
    }
    return s;
  };
  for (const [tag, data] of out) {
    for (const c of tag) w.u8(c.charCodeAt(0));
    w.u32(checksum(data));
    w.u32(offset);
    w.u32(data.length);
    offset += Math.ceil(data.length / 4) * 4;
  }
  for (const [, data] of out) {
    w.raw(data);
    w.pad4();
  }
  return w.bytes();
}

function readCmap(font: Uint8Array, cmapOffset: number): Map<number, number> {
  const numSub = u16(font, cmapOffset + 2);
  let best = -1, bestScore = -1;
  for (let i = 0; i < numSub; i++) {
    const p = cmapOffset + 4 + i * 8;
    const platform = u16(font, p), encoding = u16(font, p + 2);
    const off = u32(font, p + 4);
    const format = u16(font, cmapOffset + off);
    let score = -1;
    if (platform === 3 && encoding === 10 && format === 12) score = 4;
    else if (platform === 0 && format === 12) score = 3;
    else if (platform === 3 && encoding === 1 && format === 4) score = 2;
    else if (platform === 0 && format === 4) score = 1;
    if (score > bestScore) { bestScore = score; best = cmapOffset + off; }
  }
  if (best < 0) throw new Error("no usable cmap subtable (format 4/12)");
  const map = new Map<number, number>();
  const format = u16(font, best);
  if (format === 4) {
    const segCount = u16(font, best + 6) / 2;
    const endO = best + 14, startO = endO + segCount * 2 + 2,
      deltaO = startO + segCount * 2, rangeO = deltaO + segCount * 2;
    for (let s = 0; s < segCount; s++) {
      const end = u16(font, endO + s * 2), start = u16(font, startO + s * 2);
      const delta = u16(font, deltaO + s * 2), range = u16(font, rangeO + s * 2);
      for (let cp = start; cp <= end && cp !== 0x10000; cp++) {
        let gid: number;
        if (range === 0) gid = (cp + delta) & 0xffff;
        else {
          const gi = rangeO + s * 2 + range + (cp - start) * 2;
          gid = u16(font, gi);
          if (gid !== 0) gid = (gid + delta) & 0xffff;
        }
        if (gid !== 0) map.set(cp, gid);
      }
    }
  } else if (format === 12) {
    const nGroups = u32(font, best + 12);
    for (let g = 0; g < nGroups; g++) {
      const p = best + 16 + g * 12;
      const start = u32(font, p), end = u32(font, p + 4), gid = u32(font, p + 8);
      for (let cp = start; cp <= end; cp++) map.set(cp, gid + (cp - start));
    }
  }
  return map;
}
