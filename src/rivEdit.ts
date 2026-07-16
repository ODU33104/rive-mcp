// 既存 .riv の編集（無損失 roundtrip ベース）
// set: プロパティ変更/追加、setText: 名前付きテキストラン変更、delete: サブツリー削除+参照再マップ
import { readRiv, writeRawRiv, propInfo, fieldTypeOf, type RivObject, type RawProp } from "./rivBinary.js";
import { parseColor } from "./rivWriter.js";

export interface EditOp {
  op: "set" | "setText" | "delete";
  // 対象指定: index（riv_dump のグローバルindex）または name（+type で絞り込み）
  index?: number;
  name?: string;
  type?: string;
  set?: Record<string, unknown>; // op=set: プロパティ名→値（色は "#RRGGBB" 可）
  text?: string; // op=setText
}

// アートボード内ローカルindexを参照するプロパティキー（削除時の再マップ対象）
const REF_PROPS: Array<[string, string]> = [
  ["Component", "parentId"],
  ["KeyedObject", "objectId"],
  ["InterpolatingKeyFrame", "interpolatorId"],
  ["TargetedConstraint", "targetId"],
  ["StateMachineListener", "targetId"],
  ["Tendon", "boneId"],
  ["StateMachineFireEvent", "eventId"],
  ["ClippingShape", "sourceId"],
];

// 削除禁止の型（順序ベース参照 animationId/inputId/stateToId を壊すため）
const DELETE_FORBIDDEN = new Set([
  "Artboard", "Backboard", "LinearAnimation", "StateMachine", "StateMachineLayer",
  "StateMachineBool", "StateMachineNumber", "StateMachineTrigger",
  "AnimationState", "EntryState", "AnyState", "ExitState", "StateTransition",
  "ImageAsset", "FontAsset", "FileAssetContents",
]);

function refKeys(): Set<number> {
  const keys = new Set<number>();
  for (const [, prop] of REF_PROPS) void prop;
  // defs から動的解決
  for (const [type, prop] of REF_PROPS) {
    try {
      // resolveProp相当: propInfoは key→info なので逆引きが要る。ここでは既知の型から直接キーを引く
      const { key } = requireProp(type, prop);
      keys.add(key);
    } catch {
      /* defs に無ければスキップ */
    }
  }
  return keys;
}

// rivWriter の resolveProp を再利用したいが循環依存を避けて簡易実装
import { loadDefs } from "./rivBinary.js";
function requireProp(typeName: string, propName: string): { key: number; type: string } {
  const d = loadDefs();
  if (!d) throw new Error("defs.json not loaded");
  const fileToName = new Map<string, string>();
  for (const [name, t] of Object.entries(d.types)) fileToName.set(t.file.split("/").pop()!, name);
  let cur: string | null = typeName;
  while (cur) {
    const t: (typeof d.types)[string] | undefined = d.types[cur];
    if (!t) break;
    const p = t.properties[propName];
    if (p) return p;
    cur = t.extends ? (fileToName.get(t.extends.split("/").pop()!) ?? null) : null;
  }
  throw new Error(`Property ${propName} not found on ${typeName}`);
}

export function editRiv(bytes: Uint8Array, edits: EditOp[]): { bytes: Uint8Array; log: string[] } {
  const dump = readRiv(bytes);
  if (dump.error) throw new Error(`Parse error: ${dump.error}`);
  const log: string[] = [];
  let objects = dump.objects;

  const findTargets = (e: EditOp): RivObject[] => {
    if (e.index !== undefined) {
      const o = objects.find((x) => x.index === e.index);
      if (!o) throw new Error(`Object index ${e.index} not found`);
      return [o];
    }
    if (e.name !== undefined) {
      const hits = objects.filter(
        (x) => x.properties.name === e.name && (e.type === undefined || x.typeName === e.type)
      );
      if (hits.length === 0) throw new Error(`Object named '${e.name}' not found`);
      return hits;
    }
    throw new Error("Edit needs index or name");
  };

  for (const e of edits) {
    if (e.op === "set" || e.op === "setText") {
      const setProps = e.op === "setText" ? { text: e.text } : e.set ?? {};
      const targets = e.op === "setText"
        ? objects.filter((x) => x.typeName === "TextValueRun" && x.properties.name === e.name)
        : findTargets(e);
      if (e.op === "setText" && targets.length === 0) {
        throw new Error(`Named text run '${e.name}' not found (runs need a name to be editable)`);
      }
      for (const obj of targets) {
        for (const [propName, rawValue] of Object.entries(setProps)) {
          if (rawValue === undefined) continue;
          const p = requireProp(obj.typeName, propName);
          const ft = fieldTypeOf(p.type);
          let value: number | string | Uint8Array;
          if (ft === "color") {
            value = typeof rawValue === "string" ? parseColor(rawValue) : (rawValue as number);
          } else if (ft === "double") {
            value = Number(rawValue);
          } else if (ft === "string") {
            value = String(rawValue);
          } else {
            value = typeof rawValue === "boolean" ? (rawValue ? 1 : 0) : Number(rawValue);
          }
          const ftBits = ft === "double" ? 2 : ft === "string" ? 1 : ft === "color" ? 3 : 0;
          const existing = obj.raw.find((r) => r.key === p.key);
          if (existing) existing.value = value;
          else obj.raw.push({ key: p.key, fieldType: ftBits, value } as RawProp);
          log.push(`set #${obj.index} ${obj.typeName}.${propName}`);
        }
      }
    } else if (e.op === "delete") {
      const targets = findTargets(e);
      for (const target of targets) {
        if (DELETE_FORBIDDEN.has(target.typeName)) {
          throw new Error(`Deleting ${target.typeName} is not supported (order-based references would break)`);
        }
        // アートボード境界を特定
        const abIndex = objects.filter((o) => o.typeName === "Artboard" && o.index < target.index).length - 1;
        const abStarts = objects.filter((o) => o.typeName === "Artboard").map((o) => o.index);
        const abStart = abStarts[abIndex];
        const abEnd = abStarts[abIndex + 1] ?? Infinity;
        const localOf = (globalIdx: number) => globalIdx - abStart;
        // サブツリー収集（parentId 子孫）
        const parentKey = requireProp("Component", "parentId").key;
        const doomed = new Set<number>([target.index]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const o of objects) {
            if (o.index <= abStart || o.index >= abEnd || doomed.has(o.index)) continue;
            const pid = o.raw.find((r) => r.key === parentKey);
            if (pid && doomed.has(abStart + (pid.value as number))) {
              doomed.add(o.index);
              grew = true;
            }
          }
        }
        // 削除対象を参照している他オブジェクト（KeyedObject等）も巻き添え削除
        const refs = refKeys();
        for (const o of objects) {
          if (o.index <= abStart || o.index >= abEnd || doomed.has(o.index)) continue;
          for (const r of o.raw) {
            if (refs.has(r.key) && r.key !== parentKey && doomed.has(abStart + (r.value as number))) {
              doomed.add(o.index);
            }
          }
        }
        // KeyedObject を消した場合、その後続の KeyedProperty/KeyFrame も positional なので巻き添え
        const sorted = [...objects];
        for (let i = 0; i < sorted.length; i++) {
          const o = sorted[i];
          if (!doomed.has(o.index) || o.typeName !== "KeyedObject") continue;
          for (let j = i + 1; j < sorted.length; j++) {
            const nx = sorted[j];
            if (["KeyedProperty", "KeyFrameDouble", "KeyFrameColor", "KeyFrameId", "CubicInterpolatorComponent"].includes(nx.typeName)) {
              doomed.add(nx.index);
            } else break;
          }
        }
        // 再マップ表: 旧ローカルindex → 新ローカルindex
        const removedLocals = [...doomed].map(localOf).filter((l) => l > 0).sort((a, b) => a - b);
        const remap = (oldLocal: number): number => {
          let shift = 0;
          for (const rl of removedLocals) if (rl <= oldLocal) shift++;
          return oldLocal - shift;
        };
        // 参照更新（同一アートボード内のみ）
        for (const o of objects) {
          if (o.index <= abStart || o.index >= abEnd || doomed.has(o.index)) continue;
          for (const r of o.raw) {
            if (refs.has(r.key)) r.value = remap(r.value as number);
          }
        }
        objects = objects.filter((o) => !doomed.has(o.index));
        log.push(`deleted #${target.index} ${target.typeName} (+${doomed.size - 1} descendants/refs)`);
      }
    } else {
      throw new Error(`Unknown op '${(e as EditOp).op}'`);
    }
  }

  return { bytes: writeRawRiv({ major: dump.major, minor: dump.minor, fileId: dump.fileId, objects }), log };
}
