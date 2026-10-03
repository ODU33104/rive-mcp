import { inflateSync } from "node:zlib";
import { sha256Bytes } from "../evidence/hash.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PIXELS = 16_777_216;

export interface NormalizedPngPixels {
  width: number;
  height: number;
  rgbaSha256: string;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function channelsFor(colorType: number): number {
  switch (colorType) {
    case 0: return 1;
    case 2: return 3;
    case 3: return 1;
    case 4: return 2;
    case 6: return 4;
    default: throw new Error(`unsupported PNG color type ${colorType}`);
  }
}

export function normalizePngPixels(bytes: Uint8Array): NormalizedPngPixels {
  const png = Buffer.from(bytes);
  if (png.length < 33 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("not a PNG file");
  }

  let width = 0;
  let height = 0;
  let bitDepth = -1;
  let colorType = -1;
  let interlace = -1;
  const idat: Buffer[] = [];
  let palette: Buffer | undefined;
  let transparency: Buffer | undefined;
  let sawIhdr = false;

  for (let offset = 8; offset + 12 <= png.length;) {
    const length = png.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const next = dataEnd + 4;
    if (dataEnd < dataStart || next > png.length) throw new Error("truncated PNG chunk");
    const type = png.toString("ascii", typeStart, typeStart + 4);
    const data = png.subarray(dataStart, dataEnd);

    if (type === "IHDR") {
      if (length !== 13) throw new Error("invalid PNG IHDR length");
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      if (data[10] !== 0 || data[11] !== 0) throw new Error("unsupported PNG compression/filter method");
      interlace = data[12]!;
      sawIhdr = true;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "tRNS") {
      transparency = data;
    } else if (type === "IEND") {
      break;
    }
    offset = next;
  }

  if (!sawIhdr || width <= 0 || height <= 0) throw new Error("PNG has no valid IHDR");
  if (width * height > MAX_PIXELS) throw new Error("PNG exceeds differential pixel limit");
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error("interlaced PNG is not supported for differential normalization");
  if (idat.length === 0) throw new Error("PNG has no IDAT data");

  const channels = channelsFor(colorType);
  const rowBytes = width * channels;
  const expectedInflated = (rowBytes + 1) * height;
  const inflated = inflateSync(Buffer.concat(idat), { maxOutputLength: expectedInflated + 1 });
  if (inflated.length !== expectedInflated) {
    throw new Error(`unexpected PNG payload size ${inflated.length}, expected ${expectedInflated}`);
  }

  const scanlines = Buffer.alloc(rowBytes * height);
  let sourceOffset = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated[sourceOffset++]!;
    const rowStart = y * rowBytes;
    const previousStart = rowStart - rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const raw = inflated[sourceOffset++]!;
      const left = x >= channels ? scanlines[rowStart + x - channels]! : 0;
      const up = y > 0 ? scanlines[previousStart + x]! : 0;
      const upLeft = y > 0 && x >= channels ? scanlines[previousStart + x - channels]! : 0;
      let value: number;
      switch (filter) {
        case 0: value = raw; break;
        case 1: value = raw + left; break;
        case 2: value = raw + up; break;
        case 3: value = raw + Math.floor((left + up) / 2); break;
        case 4: value = raw + paeth(left, up, upLeft); break;
        default: throw new Error(`unsupported PNG filter ${filter}`);
      }
      scanlines[rowStart + x] = value & 0xff;
    }
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const source = pixel * channels;
    const target = pixel * 4;
    switch (colorType) {
      case 0: {
        const gray = scanlines[source]!;
        rgba[target] = gray;
        rgba[target + 1] = gray;
        rgba[target + 2] = gray;
        rgba[target + 3] = 255;
        break;
      }
      case 2:
        rgba[target] = scanlines[source]!;
        rgba[target + 1] = scanlines[source + 1]!;
        rgba[target + 2] = scanlines[source + 2]!;
        rgba[target + 3] = 255;
        break;
      case 3: {
        const index = scanlines[source]!;
        const paletteOffset = index * 3;
        if (!palette || paletteOffset + 2 >= palette.length) throw new Error("PNG palette index is out of range");
        rgba[target] = palette[paletteOffset]!;
        rgba[target + 1] = palette[paletteOffset + 1]!;
        rgba[target + 2] = palette[paletteOffset + 2]!;
        rgba[target + 3] = transparency?.[index] ?? 255;
        break;
      }
      case 4: {
        const gray = scanlines[source]!;
        rgba[target] = gray;
        rgba[target + 1] = gray;
        rgba[target + 2] = gray;
        rgba[target + 3] = scanlines[source + 1]!;
        break;
      }
      case 6:
        rgba[target] = scanlines[source]!;
        rgba[target + 1] = scanlines[source + 1]!;
        rgba[target + 2] = scanlines[source + 2]!;
        rgba[target + 3] = scanlines[source + 3]!;
        break;
    }
  }

  return { width, height, rgbaSha256: sha256Bytes(rgba) };
}
