// .riv バイナリフォーマットのリーダー/ライター基盤
// 仕様正本: docs/riv-format.md（rive.app/docs/runtimes/advanced-topic/format 由来）
// 型定義正本: vendor/rive-defs/defs.json（rive-runtime dev/defs 由来）
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// ---- 型定義レジストリ ---------------------------------------------------
export interface DefProperty {
  key: number;
  type: string; // uint | double | string | color | bool | bytes | callback
}
export interface DefType {
  typeKey: number | null;
  extends: string | null;
  file: string;
  abstract: boolean;
  properties: Record<string, DefProperty>;
}
export interface Defs {
  types: Record<string, DefType>;
}

let cachedDefs: Defs | null = null;
let propIndex: Map<number, { name: string; type: string; owner: string }> | null = null;
let typeIndex: Map<number, string> | null = null;

export function loadDefs(): Defs | null {
  if (cachedDefs) return cachedDefs;
  const p = join(ROOT, "vendor", "rive-defs", "defs.json");
  if (!existsSync(p)) return null;
  cachedDefs = JSON.parse(readFileSync(p, "utf8")) as Defs;
  propIndex = new Map();
  typeIndex = new Map();
  for (const [name, t] of Object.entries(cachedDefs.types)) {
    if (t.typeKey != null) typeIndex.set(t.typeKey, name);
    for (const [propName, prop] of Object.entries(t.properties)) {
      propIndex.set(prop.key, { name: propName, type: prop.type, owner: name });
    }
  }
  return cachedDefs;
}

export function typeName(typeKey: number): string {
  loadDefs();
  return typeIndex?.get(typeKey) ?? `type#${typeKey}`;
}

export function propInfo(key: number): { name: string; type: string; owner: string } | null {
  loadDefs();
  return propIndex?.get(key) ?? null;
}

// defs の type 文字列 → バイナリフィールドタイプ
// uint/bool → varuint系, double → float32, string/bytes → 長さ+データ, color → uint32
export function fieldTypeOf(defType: string): "uint" | "string" | "double" | "color" {
  switch (defType.toLowerCase()) {
    case "double":
      return "double";
    case "string":
    case "bytes":
      return "string";
    case "color":
      return "color";
    default:
      return "uint"; // uint / bool / callback / Id 等
  }
}

// ---- リーダー -----------------------------------------------------------
export interface RawProp {
  key: number;
  fieldType: number; // 0=uint 1=string/bytes 2=double 3=color
  value: number | string | Uint8Array;
}

export interface RivObject {
  index: number;
  typeKey: number;
  typeName: string;
  properties: Record<string, unknown>;
  unknownProps: Array<{ key: number; value: unknown }>;
  raw: RawProp[]; // 無損失 roundtrip 用の生プロパティ列
}

export interface RivDump {
  major: number;
  minor: number;
  fileId: number;
  toc: Array<{ key: number; fieldType: number; name: string }>;
  objects: RivObject[];
}

export class BinaryReader {
  private view: DataView;
  pos = 0;
  constructor(public bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get eof(): boolean {
    return this.pos >= this.bytes.length;
  }
  varuint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const b = this.bytes[this.pos++];
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result >>> 0;
      shift += 7;
    }
  }
  float32(): number {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  uint32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  string(): string {
    const len = this.varuint();
    const s = new TextDecoder().decode(this.bytes.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }
  bytes_(len: number): Uint8Array {
    const b = this.bytes.subarray(this.pos, this.pos + len);
    this.pos += len;
    return b;
  }
}

const FIELD_UINT = 0;
const FIELD_STRING = 1;
const FIELD_DOUBLE = 2;
const FIELD_COLOR = 3;

export function readRiv(bytes: Uint8Array, opts?: { tolerant?: boolean }): RivDump & { error?: string } {
  const r = new BinaryReader(bytes);
  const magic = new TextDecoder().decode(r.bytes_(4));
  if (magic !== "RIVE") throw new Error("Not a RIVE file");
  const major = r.varuint();
  const minor = r.varuint();
  const fileId = r.varuint();

  // ToC: 0終端の propertyKey 列
  const tocKeys: number[] = [];
  for (;;) {
    const k = r.varuint();
    if (k === 0) break;
    tocKeys.push(k);
  }
  // フィールドタイプビットマップ: uint32 1つにつき4プロパティ（下位8bitのみ、2bitずつLSBから）
  // rive-runtime RuntimeHeader::read と同一の読み方（vehicles.riv で検証済み）
  const fieldTypes = new Map<number, number>();
  const words = Math.ceil(tocKeys.length / 4);
  const bits: number[] = [];
  for (let w = 0; w < words; w++) {
    const word = r.uint32();
    for (let i = 0; i < 4; i++) bits.push((word >>> (i * 2)) & 0b11);
  }
  tocKeys.forEach((k, i) => fieldTypes.set(k, bits[i]));

  const toc = tocKeys.map((k) => ({
    key: k,
    fieldType: fieldTypes.get(k)!,
    name: propInfo(k)?.name ?? `prop#${k}`,
  }));

  // オブジェクトストリーム
  const objects: RivObject[] = [];
  let index = 0;
  let error: string | undefined;
  objectLoop: while (!r.eof) {
    const typeKey = r.varuint();
    if (typeKey === 0) continue; // 念のため
    const obj: RivObject = {
      index: index++,
      typeKey,
      typeName: typeName(typeKey),
      properties: {},
      unknownProps: [],
      raw: [],
    };
    for (;;) {
      const propKey = r.varuint();
      if (propKey === 0) break;
      const info = propInfo(propKey);
      let ft: number;
      if (info) {
        const t = fieldTypeOf(info.type);
        ft = t === "double" ? FIELD_DOUBLE : t === "string" ? FIELD_STRING : t === "color" ? FIELD_COLOR : FIELD_UINT;
      } else if (fieldTypes.has(propKey)) {
        ft = fieldTypes.get(propKey)!;
      } else {
        error = `Unknown property key ${propKey} at byte ${r.pos} (object #${obj.index} ${obj.typeName})`;
        if (opts?.tolerant) {
          objects.push(obj);
          break objectLoop;
        }
        throw new Error(error);
      }
      let value: unknown;
      let rawValue: number | string | Uint8Array;
      switch (ft) {
        case FIELD_DOUBLE:
          rawValue = value = r.float32();
          break;
        case FIELD_STRING:
          if (info && info.type.toLowerCase() === "bytes") {
            const len = r.varuint();
            rawValue = r.bytes_(len).slice();
            value = `<bytes:${len}>`;
          } else {
            rawValue = value = r.string();
          }
          break;
        case FIELD_COLOR:
          rawValue = r.uint32();
          value = "#" + (rawValue as number).toString(16).padStart(8, "0");
          break;
        default:
          rawValue = value = r.varuint();
      }
      obj.raw.push({ key: propKey, fieldType: ft, value: rawValue });
      if (info) obj.properties[info.name] = value;
      else obj.unknownProps.push({ key: propKey, value });
    }
    objects.push(obj);
  }
  return { major, minor, fileId, toc, objects, error };
}

// ---- 無損失ライトバック（roundtrip / 編集用） -----------------------------
export function writeRawRiv(dump: {
  major: number;
  minor: number;
  fileId: number;
  objects: Array<{ typeKey: number; raw: RawProp[] }>;
}): Uint8Array {
  const chunks: number[] = [];
  const varuint = (v: number) => {
    do {
      let b = v & 0x7f;
      v >>>= 7;
      if (v) b |= 0x80;
      chunks.push(b);
    } while (v);
  };
  const uint32 = (v: number) => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setUint32(0, v >>> 0, true);
    chunks.push(...new Uint8Array(buf));
  };
  const float32 = (v: number) => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, v, true);
    chunks.push(...new Uint8Array(buf));
  };

  chunks.push(0x52, 0x49, 0x56, 0x45);
  varuint(dump.major);
  varuint(dump.minor);
  varuint(dump.fileId);

  // ToC: 全使用キー
  const used = new Map<number, number>(); // key -> fieldType
  for (const o of dump.objects) for (const p of o.raw) used.set(p.key, p.fieldType);
  const keys = [...used.keys()];
  for (const k of keys) varuint(k);
  varuint(0);
  for (let i = 0; i < keys.length; i += 4) {
    let word = 0;
    for (let j = 0; j < 4 && i + j < keys.length; j++) word |= used.get(keys[i + j])! << (j * 2);
    uint32(word);
  }

  for (const o of dump.objects) {
    varuint(o.typeKey);
    for (const p of o.raw) {
      varuint(p.key);
      switch (p.fieldType) {
        case 2:
          float32(p.value as number);
          break;
        case 1:
          if (p.value instanceof Uint8Array) {
            varuint(p.value.length);
            for (const b of p.value) chunks.push(b);
          } else {
            const bytes = new TextEncoder().encode(String(p.value));
            varuint(bytes.length);
            for (const b of bytes) chunks.push(b);
          }
          break;
        case 3:
          uint32(p.value as number);
          break;
        default:
          varuint(p.value as number);
      }
    }
    varuint(0);
  }
  return new Uint8Array(chunks);
}
