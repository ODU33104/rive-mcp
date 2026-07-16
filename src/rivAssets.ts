// .riv 内の埋め込みアセット(Image/Font)抽出
// docs/riv-format.md: アセットは Backboard 直後・Artboard 前に <Asset>+FileAssetContents のペアで並ぶ
import { readRiv, propInfo } from "./rivBinary.js";

export interface ExtractedAsset {
  name: string;
  typeName: string; // ImageAsset | FontAsset | AudioAsset 等
  ext: string;
  bytes: Uint8Array;
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
    out.push({ name, typeName: obj.typeName, ext: detectExt(assetBytes), bytes: assetBytes });
  }
  return out;
}
