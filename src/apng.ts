// APNG エンコーダ（純Node・依存なし）
// 各フレームPNGを画像デコードせずチャンクレベルで再利用する:
//   PNG署名 + IHDR(+先頭フレームの補助チャンク) + acTL + fcTL#0 + 先頭IDAT列
//   + [fcTL#n + fdAT(=4Bシーケンス番号+IDATデータ)]... + IEND
// 全フレームは同一 IHDR（同サイズ・同フォーマット）前提。違えばエラー。

const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ---- CRC32（テーブル方式・自前実装） --------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(...parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      c = CRC_TABLE[(c ^ part[i]) & 0xff] ^ (c >>> 8);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ---- チャンク走査 -----------------------------------------------------------
interface PngChunk {
  type: string;
  data: Uint8Array;
}

function parseChunks(png: Uint8Array): PngChunk[] {
  if (png.length < 8 || !PNG_SIG.every((b, i) => png[i] === b)) {
    throw new Error("Not a PNG (bad signature)");
  }
  const chunks: PngChunk[] = [];
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let pos = 8;
  while (pos + 8 <= png.length) {
    const length = dv.getUint32(pos, false);
    const type = String.fromCharCode(png[pos + 4], png[pos + 5], png[pos + 6], png[pos + 7]);
    const dataStart = pos + 8;
    if (dataStart + length + 4 > png.length) throw new Error(`Truncated PNG chunk '${type}'`);
    chunks.push({ type, data: png.subarray(dataStart, dataStart + length) });
    pos = dataStart + length + 4; // + CRC
    if (type === "IEND") break;
  }
  return chunks;
}

// ---- チャンク書き出し --------------------------------------------------------
function typeBytes(type: string): Uint8Array {
  return new Uint8Array([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)]);
}

function writeChunk(out: number[], type: string, data: Uint8Array): void {
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, data.length, false);
  const t = typeBytes(type);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(t, data), false);
  for (const b of len) out.push(b);
  for (const b of t) out.push(b);
  for (const b of data) out.push(b);
  for (const b of crc) out.push(b);
}

function u32be(v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v >>> 0, false);
  return b;
}

function u16be(v: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, v & 0xffff, false);
  return b;
}

// fcTL: sequence(4) width(4) height(4) x(4) y(4) delay_num(2) delay_den(2) dispose(1) blend(1)
function buildFctl(seq: number, width: number, height: number, delayNum: number, delayDen: number): Uint8Array {
  const data = new Uint8Array(26);
  data.set(u32be(seq), 0);
  data.set(u32be(width), 4);
  data.set(u32be(height), 8);
  data.set(u32be(0), 12);
  data.set(u32be(0), 16);
  data.set(u16be(delayNum), 20);
  data.set(u16be(delayDen), 22);
  data[24] = 0; // dispose_op: none（全面フレームで上書きするため）
  data[25] = 0; // blend_op: source
  return data;
}

/**
 * PNGフレーム列からAPNGを組み立てる。
 * @param frames 同一サイズ・同一フォーマットのPNGバイト列（先頭フレームの補助チャンクを継承）
 * @param opts.delayMs フレーム間隔ミリ秒（既定 100）
 * @param opts.loops ループ回数（0 = 無限。既定 0）
 */
export function encodeApng(frames: Uint8Array[], opts: { delayMs?: number; loops?: number } = {}): Uint8Array {
  if (frames.length === 0) throw new Error("encodeApng needs at least 1 frame");
  const delayMs = Math.max(1, Math.round(opts.delayMs ?? 100));
  const loops = opts.loops ?? 0;

  const parsed = frames.map(parseChunks);
  const ihdr = parsed[0].find((c) => c.type === "IHDR");
  if (!ihdr || ihdr.data.length !== 13) throw new Error("First frame has no valid IHDR");
  for (let i = 1; i < parsed.length; i++) {
    const h = parsed[i].find((c) => c.type === "IHDR");
    if (!h || h.data.length !== 13 || !h.data.every((b, j) => b === ihdr.data[j])) {
      throw new Error(`Frame ${i} IHDR differs from frame 0 (all frames must share size/format)`);
    }
  }
  const dv = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, 13);
  const width = dv.getUint32(0, false);
  const height = dv.getUint32(4, false);

  const out: number[] = [];
  for (const b of PNG_SIG) out.push(b);

  // IHDR + 先頭フレームの IDAT より前の補助チャンク（sRGB/gAMA/PLTE等）
  writeChunk(out, "IHDR", ihdr.data);
  for (const c of parsed[0]) {
    if (c.type === "IHDR" || c.type === "IDAT" || c.type === "IEND") continue;
    const firstIdat = parsed[0].findIndex((x) => x.type === "IDAT");
    const selfIndex = parsed[0].indexOf(c);
    if (firstIdat >= 0 && selfIndex > firstIdat) continue; // IDAT以降の補助チャンクは捨てる
    writeChunk(out, c.type, c.data);
  }

  // acTL: num_frames(4) + num_plays(4)
  const actl = new Uint8Array(8);
  actl.set(u32be(frames.length), 0);
  actl.set(u32be(loops), 4);
  writeChunk(out, "acTL", actl);

  let seq = 0;
  // 先頭フレーム: fcTL + IDAT（そのまま）
  writeChunk(out, "fcTL", buildFctl(seq++, width, height, delayMs, 1000));
  for (const c of parsed[0]) {
    if (c.type === "IDAT") writeChunk(out, "IDAT", c.data);
  }

  // 以降のフレーム: fcTL + fdAT（IDATごとに個別fdAT化。fdAT = 4Bシーケンス番号 + IDATデータ）
  for (let i = 1; i < parsed.length; i++) {
    writeChunk(out, "fcTL", buildFctl(seq++, width, height, delayMs, 1000));
    for (const c of parsed[i]) {
      if (c.type !== "IDAT") continue;
      const fdat = new Uint8Array(4 + c.data.length);
      fdat.set(u32be(seq++), 0);
      fdat.set(c.data, 4);
      writeChunk(out, "fdAT", fdat);
    }
  }

  writeChunk(out, "IEND", new Uint8Array(0));
  return new Uint8Array(out);
}
