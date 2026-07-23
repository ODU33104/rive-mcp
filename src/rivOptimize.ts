// .riv 最適化（無損失 roundtrip ベース）
// 1) 未参照オブジェクト除去: どこからも参照されないinterpolator/event、キーフレームの無い空トラック
// 2) キーフレーム間引き: linear補間のみで連続する区間をDouglas-Peucker(hlapi.tsのsimplifyを流用)で疎に圧縮
//    CLAUDE.md落とし穴6(KeyFrameのinterpolationType/interpolatorIdは「次区間への」補間)を壊さないため、
//    hold/cubicが混じる区間には触れず、純粋にlinearが連続する区間の中間点のみを対象にする
//    (区間の両端は常に interpolationType===1 のまま残るため、easingのシフトは発生しない)
// 参照semantics/削除時の再マップは rivEdit.ts の removeAtPositions と同一ロジックを再利用する
import { readRiv, writeRawRiv, propInfo, type RivObject } from "./rivBinary.js";
import { removeAtPositions } from "./rivEdit.js";
import { simplify } from "./hlapi.js";

export interface OptimizeOptions {
  removeUnreferenced?: boolean; // 既定 true
  thinKeyframes?: boolean; // 既定 true
  tolerance?: number; // 各トラックの値域に対する比率。既定 0.01 (=1%)
  dryRun?: boolean; // 既定 false。true なら計画のみ返し、返却バイト列は変更しない
}

export interface RemovalEntry {
  index: number;
  typeName: string;
  reason: "unused-interpolator" | "unused-event" | "empty-track" | "redundant-keyframe";
}

export interface ThinEntry {
  animation: string;
  objectId: number;
  property: string;
  before: number;
  after: number;
}

export interface OptimizeStats {
  bytes: number;
  objectCount: number;
  keyframeCount: number;
}

export interface OptimizeReport {
  before: OptimizeStats;
  after: OptimizeStats;
  removed: RemovalEntry[];
  thinned: ThinEntry[];
  dryRun: boolean;
}

const KEYFRAME_TYPES = new Set(["KeyFrameDouble", "KeyFrameColor", "KeyFrameId"]);
const INTERPOLATOR_TYPES = new Set(["CubicEaseInterpolator", "ElasticInterpolator"]);
const EVENT_TYPES = new Set(["Event", "OpenUrlEvent"]);

function countKeyframes(objects: RivObject[]): number {
  return objects.filter((o) => KEYFRAME_TYPES.has(o.typeName)).length;
}

function artboardStarts(objects: RivObject[]): number[] {
  const starts: number[] = [];
  objects.forEach((o, i) => {
    if (o.typeName === "Artboard") starts.push(i);
  });
  return starts;
}

// ---- 未参照オブジェクト検出 -------------------------------------------------
// interpolatorId / eventId はアートボード内ローカルindex(docs/riv-format.md)なのでアートボード単位で判定する
function planUnreferencedRemoval(objects: RivObject[]): Map<number, RemovalEntry> {
  const doomed = new Map<number, RemovalEntry>();
  const abStarts = artboardStarts(objects);

  abStarts.forEach((abStart, ai) => {
    const abEnd = abStarts[ai + 1] ?? objects.length;

    const usedInterp = new Set<number>();
    const usedEvent = new Set<number>();
    for (let i = abStart; i < abEnd; i++) {
      const o = objects[i];
      if (KEYFRAME_TYPES.has(o.typeName) && typeof o.properties.interpolatorId === "number") {
        usedInterp.add(abStart + (o.properties.interpolatorId as number));
      }
      if (o.typeName === "StateMachineFireEvent" && typeof o.properties.eventId === "number") {
        usedEvent.add(abStart + (o.properties.eventId as number));
      }
    }

    for (let i = abStart; i < abEnd; i++) {
      const o = objects[i];
      if (INTERPOLATOR_TYPES.has(o.typeName) && !usedInterp.has(i)) {
        doomed.set(i, { index: o.index, typeName: o.typeName, reason: "unused-interpolator" });
      } else if (EVENT_TYPES.has(o.typeName) && !usedEvent.has(i)) {
        doomed.set(i, { index: o.index, typeName: o.typeName, reason: "unused-event" });
      }
    }

    // 空トラック: KeyedObject直後のKeyedPropertyにKeyFrameが1つも続かない(過去の編集の残骸等)
    for (let i = abStart; i < abEnd; i++) {
      if (objects[i].typeName !== "KeyedObject") continue;
      const kpPos = i + 1;
      const kp = kpPos < abEnd ? objects[kpPos] : undefined;
      if (!kp || kp.typeName !== "KeyedProperty") continue;
      let j = kpPos + 1;
      let kfCount = 0;
      while (j < abEnd && KEYFRAME_TYPES.has(objects[j].typeName)) {
        kfCount++;
        j++;
      }
      if (kfCount === 0) {
        doomed.set(i, { index: objects[i].index, typeName: "KeyedObject", reason: "empty-track" });
        doomed.set(kpPos, { index: kp.index, typeName: "KeyedProperty", reason: "empty-track" });
      }
    }
  });

  return doomed;
}

// ---- キーフレーム間引き ----------------------------------------------------
interface KfPoint {
  pos: number;
  frame: number;
  value: number;
  interp: number;
}

function thinRun(
  objects: RivObject[],
  positions: number[],
  animName: string,
  objectId: number,
  propName: string,
  toleranceRatio: number,
  doomed: Map<number, RemovalEntry>,
  thinned: ThinEntry[]
): void {
  const kfs: KfPoint[] = positions
    .map((pos) => ({
      pos,
      frame: typeof objects[pos].properties.frame === "number" ? (objects[pos].properties.frame as number) : 0,
      value: typeof objects[pos].properties.value === "number" ? (objects[pos].properties.value as number) : 0,
      interp:
        typeof objects[pos].properties.interpolationType === "number"
          ? (objects[pos].properties.interpolationType as number)
          : 1,
    }))
    .sort((a, b) => a.frame - b.frame);

  // 連続linear区間(run)に分割: kfs[i]→kfs[i+1] の補間は kfs[i].interp が決める(区間は出発側キーフレームに帰属)
  const runs: number[][] = [[0]];
  for (let i = 1; i < kfs.length; i++) {
    if (kfs[i - 1].interp === 1) {
      runs[runs.length - 1].push(i);
    } else {
      runs.push([i]);
    }
  }

  for (const run of runs) {
    if (run.length < 3) continue; // 端点2つ以下では間引く余地が無い
    const runKfs = run.map((ri) => kfs[ri]);
    const points: Array<[number, number]> = runKfs.map((k) => [k.frame, k.value]);
    const values = points.map((p) => p[1]);
    const range = Math.max(...values) - Math.min(...values);
    const eps = Math.max(range * toleranceRatio, 1e-4);
    const simplified = simplify(points, eps);
    if (simplified.length >= points.length) continue;
    // simplify() は入力配列の要素をそのまま(参照として)返すため、参照の集合で保持判定できる
    const kept = new Set(simplified);
    let removedCount = 0;
    for (let idx = 0; idx < runKfs.length; idx++) {
      if (!kept.has(points[idx])) {
        doomed.set(runKfs[idx].pos, {
          index: objects[runKfs[idx].pos].index,
          typeName: "KeyFrameDouble",
          reason: "redundant-keyframe",
        });
        removedCount++;
      }
    }
    if (removedCount > 0) {
      thinned.push({ animation: animName, objectId, property: propName, before: points.length, after: simplified.length });
    }
  }
}

function planKeyframeThinning(
  objects: RivObject[],
  toleranceRatio: number
): { doomed: Map<number, RemovalEntry>; thinned: ThinEntry[] } {
  const doomed = new Map<number, RemovalEntry>();
  const thinned: ThinEntry[] = [];

  let animName = "";
  let objectId = -1;
  let propName = "";
  let positions: number[] = [];

  const flush = () => {
    if (positions.length >= 3) {
      thinRun(objects, positions, animName, objectId, propName, toleranceRatio, doomed, thinned);
    }
    positions = [];
  };

  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    switch (o.typeName) {
      case "Artboard":
      case "Backboard":
      case "StateMachine":
        flush();
        animName = "";
        objectId = -1;
        propName = "";
        continue;
      case "LinearAnimation":
        flush();
        animName = typeof o.properties.name === "string" ? (o.properties.name as string) : "?";
        continue;
      case "KeyedObject":
        flush();
        objectId = typeof o.properties.objectId === "number" ? (o.properties.objectId as number) : -1;
        continue;
      case "KeyedProperty": {
        flush();
        const info = typeof o.properties.propertyKey === "number" ? propInfo(o.properties.propertyKey as number) : null;
        propName = info?.name ?? "?";
        continue;
      }
      case "KeyFrameDouble":
        positions.push(i);
        continue;
      default:
        flush();
        continue;
    }
  }
  flush();

  return { doomed, thinned };
}

// ---- 適用 -----------------------------------------------------------------
export function optimizeRiv(bytes: Uint8Array, opts: OptimizeOptions = {}): { bytes: Uint8Array; report: OptimizeReport } {
  const removeUnreferenced = opts.removeUnreferenced ?? true;
  const thinKeyframes = opts.thinKeyframes ?? true;
  const toleranceRatio = opts.tolerance ?? 0.01;
  const dryRun = opts.dryRun ?? false;

  const dump = readRiv(bytes);
  if (dump.error) throw new Error(`Parse error: ${dump.error}`);
  const originalObjects = dump.objects;

  const before: OptimizeStats = {
    bytes: bytes.length,
    objectCount: originalObjects.length,
    keyframeCount: countKeyframes(originalObjects),
  };

  // 検出は必ず元のオブジェクト列(index===position)に対して行う
  const doomed = new Map<number, RemovalEntry>();
  if (removeUnreferenced) {
    for (const [pos, entry] of planUnreferencedRemoval(originalObjects)) doomed.set(pos, entry);
  }
  let thinned: ThinEntry[] = [];
  if (thinKeyframes) {
    const plan = planKeyframeThinning(originalObjects, toleranceRatio);
    for (const [pos, entry] of plan.doomed) doomed.set(pos, entry);
    thinned = plan.thinned;
  }

  // 適用: アートボードを末尾から処理(まだ処理していない前方の位置を壊さないため)
  let objects = originalObjects;
  if (doomed.size > 0) {
    const abStarts = artboardStarts(objects);
    for (let ai = abStarts.length - 1; ai >= 0; ai--) {
      const abStart = abStarts[ai];
      const abEnd = abStarts[ai + 1] ?? objects.length;
      const removeSet = new Set<number>();
      for (const pos of doomed.keys()) {
        if (pos >= abStart && pos < abEnd) removeSet.add(pos);
      }
      if (removeSet.size > 0) objects = removeAtPositions(objects, abStart, abEnd, removeSet);
    }
  }

  const removedList = [...doomed.values()].sort((a, b) => a.index - b.index);
  const outBytes = writeRawRiv({ major: dump.major, minor: dump.minor, fileId: dump.fileId, objects });
  const after: OptimizeStats = {
    bytes: outBytes.length,
    objectCount: objects.length,
    keyframeCount: countKeyframes(objects),
  };

  return {
    bytes: dryRun ? bytes : outBytes,
    report: { before, after, removed: removedList, thinned, dryRun },
  };
}
