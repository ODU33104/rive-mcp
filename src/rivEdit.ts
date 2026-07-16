// 既存 .riv の編集（無損失 roundtrip ベース）
// set: プロパティ変更/追加、setText: 名前付きテキストラン変更、delete: サブツリー削除+参照再マップ、
// setKeyframes: 既存アニメーションのキーフレーム置換/追加/削除
import { readRiv, writeRawRiv, propInfo, fieldTypeOf, type RivObject, type RawProp } from "./rivBinary.js";
import { parseColor, EASING_BEZIER, type EasingName } from "./rivWriter.js";

export interface KeyframeEditSpec {
  frame: number;
  value?: number;
  easing?: EasingName;
}

export interface EditOp {
  op: "set" | "setText" | "delete" | "setKeyframes";
  // 対象指定: index（riv_dump のグローバルindex）または name（+type で絞り込み）
  index?: number;
  name?: string;
  type?: string;
  set?: Record<string, unknown>; // op=set: プロパティ名→値（色は "#RRGGBB" 可）
  text?: string; // op=setText
  // op=setKeyframes: index/name はアニメート対象オブジェクトを指す
  animation?: string; // LinearAnimation名
  property?: "x" | "y" | "rotation" | "scaleX" | "scaleY" | "opacity" | "width" | "height";
  keyframes?: KeyframeEditSpec[];
  mode?: "replace" | "add" | "remove"; // 既定 replace。remove は keyframes[].frame のみ参照
}

// setKeyframes 用: rivWriter.ts の PROP_KEYS (数値プロパティのみ・同期を保つこと)
const KEYFRAME_PROP_MAP: Record<string, { type: string; prop: string }> = {
  x: { type: "Node", prop: "x" },
  y: { type: "Node", prop: "y" },
  rotation: { type: "TransformComponent", prop: "rotation" },
  scaleX: { type: "TransformComponent", prop: "scaleX" },
  scaleY: { type: "TransformComponent", prop: "scaleY" },
  opacity: { type: "WorldTransformComponent", prop: "opacity" },
  width: { type: "LayoutComponent", prop: "width" },
  height: { type: "LayoutComponent", prop: "height" },
};

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

// ---- setKeyframes 用ヘルパ ------------------------------------------------
function typeKeyOf(typeName: string): number {
  const d = loadDefs();
  const t = d?.types[typeName];
  if (!t || t.typeKey == null) throw new Error(`Unknown type: ${typeName}`);
  return t.typeKey;
}

function buildRivObj(type: string, props: Record<string, unknown>): RivObject {
  const raw: RawProp[] = [];
  for (const [propName, value] of Object.entries(props)) {
    if (value === undefined) continue;
    const p = requireProp(type, propName);
    const ft = fieldTypeOf(p.type);
    const bits = ft === "double" ? 2 : ft === "string" ? 1 : ft === "color" ? 3 : 0;
    raw.push({ key: p.key, fieldType: bits, value: value as number | string | Uint8Array });
  }
  return { index: -1, typeKey: typeKeyOf(type), typeName: type, properties: {}, unknownProps: [], raw };
}

// pos を含むアートボードの [開始position, 終了position) を配列位置で返す（.index の欠番に依存しない）
function artboardBoundsForPosition(objects: RivObject[], pos: number): { abStartPos: number; abEndPos: number } {
  const artboardPositions: number[] = [];
  objects.forEach((o, i) => {
    if (o.typeName === "Artboard") artboardPositions.push(i);
  });
  let abStartPos = -1;
  for (const p of artboardPositions) {
    if (p <= pos) abStartPos = p;
    else break;
  }
  if (abStartPos === -1) throw new Error(`Object at position ${pos} is not inside any artboard`);
  const idx = artboardPositions.indexOf(abStartPos);
  const abEndPos = artboardPositions[idx + 1] ?? objects.length;
  return { abStartPos, abEndPos };
}

// removePositions（アートボード内の配列position集合）を除去し、残存オブジェクトのローカル参照値を再マップする。
// KeyedObject/KeyedProperty/KeyFrame* は他オブジェクトから参照されないため、除去自体に参照の巻き添えは無い。
function removeAtPositions(
  objects: RivObject[],
  abStartPos: number,
  abEndPos: number,
  removePositions: Set<number>
): RivObject[] {
  if (removePositions.size === 0) return objects;
  const removedSorted = [...removePositions].sort((a, b) => a - b);
  const shiftFor = (absPos: number): number => {
    let lo = 0, hi = removedSorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (removedSorted[mid] < absPos) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const refs = refKeys();
  for (let i = abStartPos; i < abEndPos; i++) {
    if (removePositions.has(i)) continue;
    for (const r of objects[i].raw) {
      if (refs.has(r.key) && typeof r.value === "number") {
        const absPos = abStartPos + r.value;
        const shift = shiftFor(absPos);
        if (shift > 0) r.value = r.value - shift;
      }
    }
  }
  return objects.filter((_, i) => !removePositions.has(i));
}

// atPos（配列position）に newObjs を挿入し、以降のローカル参照値を +newObjs.length する
function insertAt(
  objects: RivObject[],
  abStartPos: number,
  abEndPos: number,
  atPos: number,
  newObjs: RivObject[]
): RivObject[] {
  if (newObjs.length === 0) return objects;
  const localThreshold = atPos - abStartPos;
  const refs = refKeys();
  for (let i = abStartPos; i < abEndPos; i++) {
    for (const r of objects[i].raw) {
      if (refs.has(r.key) && typeof r.value === "number" && r.value >= localThreshold) {
        r.value = r.value + newObjs.length;
      }
    }
  }
  return [...objects.slice(0, atPos), ...newObjs, ...objects.slice(atPos)];
}

const KEYFRAME_TYPES = new Set(["KeyFrameDouble", "KeyFrameColor", "KeyFrameId"]);

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
    } else if (e.op === "setKeyframes") {
      if (!e.animation) throw new Error("setKeyframes needs 'animation'");
      const property = e.property;
      if (!property || !(property in KEYFRAME_PROP_MAP)) {
        throw new Error(`setKeyframes 'property' must be one of: ${Object.keys(KEYFRAME_PROP_MAP).join(", ")}`);
      }
      const mode = e.mode ?? "replace";
      const kfs = e.keyframes ?? [];
      if (mode !== "remove" && kfs.length === 0) throw new Error("setKeyframes needs a non-empty 'keyframes' array");

      const animPos = objects.findIndex((o) => o.typeName === "LinearAnimation" && o.properties.name === e.animation);
      if (animPos === -1) throw new Error(`Animation '${e.animation}' not found`);
      const { abStartPos, abEndPos: abEndPosOrig } = artboardBoundsForPosition(objects, animPos);
      let abEndPos = abEndPosOrig;

      let targetPos = -1;
      if (e.index !== undefined) {
        targetPos = objects.findIndex((o) => o.index === e.index);
        if (targetPos === -1 || targetPos < abStartPos || targetPos >= abEndPos) {
          throw new Error(`Object index ${e.index} not found in the artboard of animation '${e.animation}'`);
        }
      } else if (e.name !== undefined) {
        for (let i = abStartPos; i < abEndPos; i++) {
          const o = objects[i];
          if (o.properties.name === e.name && (e.type === undefined || o.typeName === e.type)) {
            targetPos = i;
            break;
          }
        }
        if (targetPos === -1) throw new Error(`Object named '${e.name}' not found in artboard of animation '${e.animation}'`);
      } else {
        throw new Error("setKeyframes needs 'index' or 'name' to locate the target object");
      }
      const targetLocal = targetPos - abStartPos;

      // このアニメーションのブロック境界（次の LinearAnimation/StateMachine の手前まで）
      let blockEndPos = abEndPos;
      for (let i = animPos + 1; i < abEndPos; i++) {
        if (objects[i].typeName === "LinearAnimation" || objects[i].typeName === "StateMachine") {
          blockEndPos = i;
          break;
        }
      }

      const propRef = KEYFRAME_PROP_MAP[property];
      const propKeyInfo = requireProp(propRef.type, propRef.prop);
      const objectIdKey = requireProp("KeyedObject", "objectId").key;
      const propertyKeyKey = requireProp("KeyedProperty", "propertyKey").key;

      // 既存トラック（KeyedObject(objectId=target) 直後に KeyedProperty(propertyKey=対象)) を探す
      let groupPos = -1, kfStartPos = -1, kfEndPos = -1;
      for (let i = animPos + 1; i < blockEndPos; i++) {
        const o = objects[i];
        if (o.typeName !== "KeyedObject") continue;
        const oid = o.raw.find((r) => r.key === objectIdKey)?.value;
        const kp = objects[i + 1];
        if (oid !== targetLocal || !kp || kp.typeName !== "KeyedProperty") continue;
        const pk = kp.raw.find((r) => r.key === propertyKeyKey)?.value;
        if (pk !== propKeyInfo.key) continue;
        groupPos = i;
        kfStartPos = i + 2;
        let j = kfStartPos;
        while (j < blockEndPos && KEYFRAME_TYPES.has(objects[j].typeName)) j++;
        kfEndPos = j;
        break;
      }

      if (mode === "remove") {
        if (groupPos === -1) {
          log.push(`setKeyframes: no track found for ${e.animation}/${property} (nothing to remove)`);
        } else {
          const frameKeyInfo = requireProp("KeyFrame", "frame");
          const frames = new Set(kfs.map((k) => k.frame ?? 0));
          const removeSet = new Set<number>();
          for (let i = kfStartPos; i < kfEndPos; i++) {
            const fRaw = objects[i].raw.find((r) => r.key === frameKeyInfo.key)?.value;
            const f = typeof fRaw === "number" ? fRaw : 0;
            if (frames.has(f)) removeSet.add(i);
          }
          const remaining = kfEndPos - kfStartPos - removeSet.size;
          if (remaining <= 0) {
            removeSet.add(groupPos);
            removeSet.add(groupPos + 1);
          }
          objects = removeAtPositions(objects, abStartPos, abEndPos, removeSet);
          log.push(
            `setKeyframes remove: ${removeSet.size} object(s) removed for ${e.animation}/${property}` +
              (remaining <= 0 ? " (track emptied and removed)" : "")
          );
        }
      } else {
        // replace / add: 必要なイージング補間器（新規のみ）+ 新規キーフレームを1バッチで挿入
        let removeCount: number, insertPos: number;
        if (mode === "add") {
          removeCount = 0;
          insertPos = groupPos === -1 ? animPos + 1 : kfEndPos;
        } else if (groupPos === -1) {
          removeCount = 0;
          insertPos = animPos + 1;
        } else {
          removeCount = kfEndPos - kfStartPos;
          insertPos = kfStartPos;
        }

        const interpKeys = ["x1", "y1", "x2", "y2"].map((p) => requireProp("CubicEaseInterpolator", p).key);
        const findInterpolator = (bez: [number, number, number, number]): number | null => {
          for (let i = abStartPos; i < abEndPos; i++) {
            const o = objects[i];
            if (o.typeName !== "CubicEaseInterpolator") continue;
            const vals = interpKeys.map((k) => o.raw.find((r) => r.key === k)?.value as number | undefined);
            if (vals.every((v, idx) => v !== undefined && Math.abs(v - bez[idx]) < 1e-4)) return i - abStartPos;
          }
          return null;
        };

        const neededEasings = new Set<string>();
        for (const k of kfs) {
          if (k.easing && EASING_BEZIER[k.easing]) neededEasings.add(k.easing);
        }
        const interpolatorLocal = new Map<string, number>();
        const newInterpObjs: RivObject[] = [];
        let cursor = insertPos - abStartPos;
        for (const name of neededEasings) {
          const existing = findInterpolator(EASING_BEZIER[name]!);
          if (existing !== null) {
            interpolatorLocal.set(name, existing);
            continue;
          }
          const [x1, y1, x2, y2] = EASING_BEZIER[name]!;
          newInterpObjs.push(buildRivObj("CubicEaseInterpolator", { x1, y1, x2, y2 }));
          interpolatorLocal.set(name, cursor);
          cursor++;
        }

        const kfObjs = kfs.map((k) => {
          const easing = k.easing ?? "linear";
          const interpolationType = easing === "hold" ? 0 : easing === "linear" ? 1 : 2;
          const props: Record<string, unknown> = { interpolationType };
          if (k.frame) props.frame = k.frame;
          if (interpolationType === 2) props.interpolatorId = interpolatorLocal.get(easing);
          let v = k.value ?? 0;
          if (property === "rotation") v = (v * Math.PI) / 180;
          props.value = v;
          return buildRivObj("KeyFrameDouble", props);
        });

        const insertBatch =
          groupPos === -1
            ? [...newInterpObjs, buildRivObj("KeyedObject", { objectId: targetLocal }), buildRivObj("KeyedProperty", { propertyKey: propKeyInfo.key }), ...kfObjs]
            : [...newInterpObjs, ...kfObjs];

        if (removeCount > 0) {
          const removeSet = new Set<number>();
          for (let i = insertPos; i < insertPos + removeCount; i++) removeSet.add(i);
          objects = removeAtPositions(objects, abStartPos, abEndPos, removeSet);
          abEndPos -= removeCount;
        }
        objects = insertAt(objects, abStartPos, abEndPos, insertPos, insertBatch);
        log.push(
          `setKeyframes ${mode}: ${kfObjs.length} keyframe(s) (+${newInterpObjs.length} interpolator(s)) for ${e.animation}/${property}` +
            (groupPos === -1 ? " (new track)" : "")
        );
      }
    } else {
      throw new Error(`Unknown op '${(e as EditOp).op}'`);
    }
  }

  return { bytes: writeRawRiv({ major: dump.major, minor: dump.minor, fileId: dump.fileId, objects }), log };
}
