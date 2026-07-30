// .riv 内の埋め込みアセット(Image/Font)抽出・差し替え
// docs/riv-format.md: アセットは Backboard 直後・Artboard 前に <Asset>+FileAssetContents のペアで並ぶ
import { readRiv, writeRawRiv, propInfo } from "./rivBinary.js";

export interface ExtractedAsset {
  index: number; // アセットオブジェクトのグローバルindex（replaceAssetBytes の対象指定に使う）
  name: string;
  typeName: string; // ImageAsset | FontAsset | AudioAsset 等
  ext: string;
  bytes: Uint8Array;
  width?: number; // ImageAsset(DrawableAsset継承)のみ
  height?: number;
}

const ASSET_TYPES = new Set(["ImageAsset", "FontAsset", "AudioAsset"]);

// マジックバイトから拡張子を判定
function detectExt(bytes: Uint8Array): string {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return "webp";
  if (b.length >= 4 && b[0] === 0x00 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return "ttf";
  if (b.length >= 4 && b[0] === 0x4f && b[1] === 0x54 && b[2] === 0x54 && b[3] === 0x4f) return "otf"; // "OTTO"
  if (b.length >= 4 && b[0] === 0x74 && b[1] === 0x72 && b[2] === 0x75 && b[3] === 0x65) return "ttf"; // "true"
  if (b.length >= 4 && b[0] === 0x74 && b[1] === 0x74 && b[2] === 0x63 && b[3] === 0x66) return "ttc"; // "ttcf"
  if (b.length >= 4 && b[0] === 0x77 && b[1] === 0x4f && b[2] === 0x46 && b[3] === 0x46) return "woff"; // "wOFF"
  if (b.length >= 4 && b[0] === 0x77 && b[1] === 0x4f && b[2] === 0x46 && b[3] === 0x32) return "woff2"; // "wOF2"
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "gif";
  return "bin";
}

export function extractAssets(bytes: Uint8Array): ExtractedAsset[] {
  const dump = readRiv(bytes, { tolerant: true });
  const out: ExtractedAsset[] = [];
  for (let i = 0; i < dump.objects.length; i++) {
    const obj = dump.objects[i];
    if (!ASSET_TYPES.has(obj.typeName)) continue;
    const next = dump.objects[i + 1];
    if (!next || next.typeName !== "FileAssetContents") continue; // 外部参照アセット(未埋め込み)はスキップ
    const bytesProp = next.raw.find((r) => {
      const info = propInfo(r.key);
      return info && info.type.toLowerCase() === "bytes";
    });
    if (!bytesProp || !(bytesProp.value instanceof Uint8Array) || bytesProp.value.length === 0) continue;
    const assetBytes = bytesProp.value;
    const name = typeof obj.properties.name === "string" && obj.properties.name.length > 0
      ? obj.properties.name
      : `asset_${i}`;
    const width = typeof obj.properties.width === "number" ? obj.properties.width : undefined;
    const height = typeof obj.properties.height === "number" ? obj.properties.height : undefined;
    out.push({ index: obj.index, name, typeName: obj.typeName, ext: detectExt(assetBytes), bytes: assetBytes, width, height });
  }
  return out;
}

// PNG/JPEG/WebP のピクセルサイズをマジックバイトから読む（差し替え後の ImageAsset.width/height 更新用）
// 対応外/壊れたヘッダは null（呼び出し側はベストエフォートとして無視する）
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const b = bytes;
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { width: dv.getUint32(16, false), height: dv.getUint32(20, false) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let pos = 2;
    while (pos + 9 < b.length) {
      if (b[pos] !== 0xff) { pos++; continue; }
      const marker = b[pos + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
      if (marker === 0xd9) break; // EOI
      const segLen = (b[pos + 2] << 8) | b[pos + 3];
      const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSOF) {
        const height = (b[pos + 5] << 8) | b[pos + 6];
        const width = (b[pos + 7] << 8) | b[pos + 8];
        return { width, height };
      }
      pos += 2 + segLen;
    }
    return null;
  }
  if (
    b.length >= 30 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (fourcc === "VP8 ") {
      return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
    }
    if (fourcc === "VP8L" && b.length >= 25) {
      const b0 = b[21], b1 = b[22], b2 = b[23], b3 = b[24];
      return {
        width: 1 + (((b1 & 0x3f) << 8) | b0),
        height: 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
      };
    }
    if (fourcc === "VP8X") {
      return {
        width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
        height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
      };
    }
  }
  return null;
}

// 埋め込みアセット(ImageAsset等)のバイト列を無損失で差し替える。他オブジェクトは一切変更しない。
// assetIndex は ExtractedAsset.index（= readRiv のグローバルindex、アセット本体のオブジェクト）。
// LEB128長さフィールドの再計算は writeRawRiv の丸ごと書き戻し（バイト列は length-prefixed）が自動で行う。
export function replaceAssetBytes(
  bytes: Uint8Array,
  assetIndex: number,
  newBytes: Uint8Array
): { bytes: Uint8Array; log: string[] } {
  const dump = readRiv(bytes);
  if (dump.error) throw new Error(`Parse error: ${dump.error}`);
  const objects = dump.objects;
  const pos = objects.findIndex((o) => o.index === assetIndex);
  if (pos === -1) throw new Error(`Asset index ${assetIndex} not found`);
  const assetObj = objects[pos];
  if (!ASSET_TYPES.has(assetObj.typeName)) {
    throw new Error(`Object #${assetIndex} is a ${assetObj.typeName}, not an embeddable asset`);
  }
  const contentsObj = objects[pos + 1];
  if (!contentsObj || contentsObj.typeName !== "FileAssetContents") {
    throw new Error(`Asset #${assetIndex} (${assetObj.typeName}) has no embedded FileAssetContents (external/referenced assets can't be replaced this way)`);
  }
  const bytesProp = contentsObj.raw.find((r) => {
    const info = propInfo(r.key);
    return info && info.type.toLowerCase() === "bytes";
  });
  if (!bytesProp) throw new Error(`FileAssetContents for asset #${assetIndex} has no bytes property`);
  bytesProp.value = newBytes;

  const log = [
    `replaced asset #${assetIndex} (${assetObj.typeName} '${String(assetObj.properties.name ?? "")}'): ${newBytes.length} bytes`,
  ];

  // ベストエフォート: 新画像の実寸に DrawableAsset.width/height を追従させる（既存propの値を差し替えるのみ・新規追加はしない）
  if (assetObj.typeName === "ImageAsset") {
    const dims = imageSize(newBytes);
    if (dims) {
      for (const rp of assetObj.raw) {
        const info = propInfo(rp.key);
        if (!info) continue;
        if (info.name === "width") { rp.value = dims.width; log.push(`updated width -> ${dims.width}`); }
        else if (info.name === "height") { rp.value = dims.height; log.push(`updated height -> ${dims.height}`); }
      }
    }
  }

  return { bytes: writeRawRiv({ major: dump.major, minor: dump.minor, fileId: dump.fileId, objects }), log };
}
