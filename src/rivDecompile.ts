// .riv → SceneSpec 逆コンパイラ（実用サブセット）
// 目的: プロが作った .riv を「編集可能なシーン仕様 + few-shot手本」に変換する。
// ライターが表現できる範囲を復元し、範囲外の型は coverage.skipped に集計して隠さない。
import { readRiv, loadDefs, type RivObject } from "./rivBinary.js";
import { EASING_BEZIER, type SceneSpec, type ArtboardSpec, type ShapeSpec, type GroupSpec, type AnimationSpec, type TrackSpec, type KeyframeSpec, type EasingName } from "./rivWriter.js";

export interface DecompileResult {
  scene: SceneSpec;
  coverage: { decompiled: number; skipped: Record<string, number>; warnings: string[] };
}

const deg = (rad: unknown): number => ((typeof rad === "number" ? rad : 0) * 180) / Math.PI;
const num = (v: unknown, d = 0): number => (typeof v === "number" ? v : d);

// colorValue はリーダーで "#aarrggbb" 文字列化される
function colorOf(v: unknown): string {
  if (typeof v === "string") return v.startsWith("#ff") && v.length === 9 ? "#" + v.slice(3) : v;
  return "#888888";
}

export function decompileRiv(bytes: Uint8Array): DecompileResult {
  const dump = readRiv(bytes, { tolerant: true });
  const objects = dump.objects;
  const warnings: string[] = [];
  if (dump.error) warnings.push(`parse: ${dump.error}`);
  const skipped: Record<string, number> = {};
  let decompiled = 0;
  const skip = (t: string) => { skipped[t] = (skipped[t] ?? 0) + 1; };

  // アートボード分割
  const abStarts = objects.map((o, i) => (o.typeName === "Artboard" ? i : -1)).filter((i) => i >= 0);
  const artboards: ArtboardSpec[] = [];

  for (let a = 0; a < abStarts.length; a++) {
    const start = abStarts[a];
    const end = abStarts[a + 1] ?? objects.length;
    const abObj = objects[start];
    const local = (gi: number) => gi - start; // ローカルindex（artboard=0）
    const objAt = (localIdx: number): RivObject | undefined => objects[start + localIdx];

    const ab: ArtboardSpec = {
      name: (abObj.properties.name as string) ?? `Artboard${a}`,
      width: num(abObj.properties.width, 400),
      height: num(abObj.properties.height, 300),
      groups: [], shapes: [], animations: [],
    };

    // id 割り当て: name があれば name、無ければ 型+ローカルindex
    const idOf = new Map<number, string>();
    const used = new Set<string>();
    const assignId = (li: number, o: RivObject): string => {
      let id = (o.properties.name as string) || `${o.typeName.toLowerCase()}${li}`;
      while (used.has(id)) id += "_";
      used.add(id);
      idOf.set(li, id);
      return id;
    };

    // 第1パス: コンポーネント復元
    interface ShapeCtx { spec: ShapeSpec; li: number }
    let curShape: ShapeCtx | null = null;
    let curPath: { closed?: boolean; points: NonNullable<ShapeSpec["points"]> } | null = null;
    let curPaint: { kind: "fill" | "stroke"; li: number } | null = null;
    let curGradient: { spec: NonNullable<ShapeSpec["fill"]>["gradient"] } | null = null;

    const flushShape = () => { curShape = null; curPath = null; curPaint = null; curGradient = null; };
    const parentIdStr = (o: RivObject): string | undefined => {
      const p = o.properties.parentId;
      if (typeof p !== "number" || p === 0) return undefined;
      return idOf.get(p);
    };

    for (let gi = start + 1; gi < end; gi++) {
      const o = objects[gi];
      const li = local(gi);
      switch (o.typeName) {
        case "Node": case "Solo": {
          flushShape();
          const g: GroupSpec = {
            id: assignId(li, o),
            x: num(o.properties.x), y: num(o.properties.y),
          };
          const par = parentIdStr(o);
          if (par) g.parent = par;
          if (o.properties.rotation !== undefined) g.rotation = deg(o.properties.rotation);
          if (o.properties.opacity !== undefined) g.opacity = num(o.properties.opacity, 1);
          if (o.properties.scaleX !== undefined) g.scaleX = num(o.properties.scaleX, 1);
          if (o.properties.scaleY !== undefined) g.scaleY = num(o.properties.scaleY, 1);
          if (o.typeName === "Solo") {
            g.solo = true;
            const act = o.properties.activeComponentId;
            if (typeof act === "number") g.active = idOf.get(act) ?? undefined;
          }
          ab.groups!.push(g);
          decompiled++;
          break;
        }
        case "Shape": {
          flushShape();
          const s: ShapeSpec = {
            id: assignId(li, o), type: "polygon",
            x: num(o.properties.x), y: num(o.properties.y),
            // .riv のストリーム順は「先に書いた drawable が前面」。writer の z（大=前面）に変換
            z: 100000 - li,
          };
          const par = parentIdStr(o);
          if (par) s.parent = par;
          if (o.properties.rotation !== undefined) s.rotation = deg(o.properties.rotation);
          if (o.properties.opacity !== undefined) s.opacity = num(o.properties.opacity, 1);
          ab.shapes!.push(s);
          curShape = { spec: s, li };
          decompiled++;
          break;
        }
        case "Rectangle":
          if (curShape) {
            curShape.spec.type = "rect";
            curShape.spec.width = num(o.properties.width, 100);
            curShape.spec.height = num(o.properties.height, 100);
            if (o.properties.cornerRadiusTL) curShape.spec.cornerRadius = num(o.properties.cornerRadiusTL);
            decompiled++;
          }
          break;
        case "Ellipse":
          if (curShape) {
            curShape.spec.type = "ellipse";
            curShape.spec.width = num(o.properties.width, 100);
            curShape.spec.height = num(o.properties.height, 100);
            decompiled++;
          }
          break;
        case "PointsPath":
          if (curShape) {
            curShape.spec.type = "polygon";
            curPath = { closed: o.properties.isClosed !== false && o.properties.isClosed !== 0, points: [] };
            curShape.spec.subpaths = curShape.spec.subpaths ?? [];
            curShape.spec.subpaths.push(curPath);
            decompiled++;
          }
          break;
        case "StraightVertex":
          if (curPath) {
            const p: NonNullable<ShapeSpec["points"]>[number] = { x: num(o.properties.x), y: num(o.properties.y) };
            if (o.properties.radius) p.radius = num(o.properties.radius);
            curPath.points.push(p);
            decompiled++;
          }
          break;
        case "CubicMirroredVertex":
          if (curPath) {
            curPath.points.push({
              x: num(o.properties.x), y: num(o.properties.y),
              cubic: { rotation: deg(o.properties.rotation), distance: num(o.properties.distance) },
            });
            decompiled++;
          }
          break;
        case "CubicAsymmetricVertex":
          if (curPath) {
            curPath.points.push({
              x: num(o.properties.x), y: num(o.properties.y),
              cubic: {
                rotation: deg(o.properties.rotation),
                inDistance: num(o.properties.inDistance), outDistance: num(o.properties.outDistance),
              },
            });
            decompiled++;
          }
          break;
        case "CubicDetachedVertex":
          if (curPath) {
            curPath.points.push({
              x: num(o.properties.x), y: num(o.properties.y),
              cubic: {
                rotation: deg(o.properties.outRotation), inRotation: deg(o.properties.inRotation),
                inDistance: num(o.properties.inDistance), outDistance: num(o.properties.outDistance),
              },
            });
            decompiled++;
          }
          break;
        case "Fill":
          if (curShape) { curPaint = { kind: "fill", li }; curShape.spec.fill = {}; decompiled++; }
          break;
        case "Stroke":
          if (curShape) {
            curPaint = { kind: "stroke", li };
            curShape.spec.stroke = { color: "#888888", thickness: num(o.properties.thickness, 1) };
            const cap = o.properties.cap, join = o.properties.join;
            if (cap === 1) curShape.spec.stroke.cap = "round"; else if (cap === 2) curShape.spec.stroke.cap = "square";
            if (join === 1) curShape.spec.stroke.join = "round"; else if (join === 2) curShape.spec.stroke.join = "bevel";
            decompiled++;
          }
          break;
        case "SolidColor":
          if (curShape && curPaint) {
            const c = colorOf(o.properties.colorValue);
            if (curPaint.kind === "fill") curShape.spec.fill = { color: c };
            else curShape.spec.stroke!.color = c;
            idOf.set(li, `${curShape.spec.id}#${curPaint.kind}Color`);
            decompiled++;
          }
          break;
        case "LinearGradient": case "RadialGradient":
          if (curShape && curPaint?.kind === "fill") {
            curGradient = {
              spec: {
                type: o.typeName === "RadialGradient" ? "radial" : "linear",
                stops: [],
                start: { x: num(o.properties.startX), y: num(o.properties.startY) },
                end: { x: num(o.properties.endX), y: num(o.properties.endY) },
              },
            };
            curShape.spec.fill = { gradient: curGradient.spec };
            decompiled++;
          } else skip(o.typeName);
          break;
        case "GradientStop":
          if (curGradient) {
            curGradient.spec!.stops.push({ color: colorOf(o.properties.colorValue), position: num(o.properties.position) });
            decompiled++;
          }
          break;
        case "TrimPath":
          if (curShape?.spec.stroke) {
            curShape.spec.stroke.trim = {
              start: num(o.properties.start), end: num(o.properties.end, 1), offset: num(o.properties.offset),
              mode: o.properties.modeValue === 2 ? "synchronized" : "sequential",
            };
            idOf.set(li, `${curShape.spec.id}#trim`);
            decompiled++;
          }
          break;
        case "ClippingShape": {
          const owner = idOf.get(num(o.properties.parentId, -1));
          const source = idOf.get(num(o.properties.sourceId, -1));
          if (owner && source) {
            const ownerShape = ab.shapes!.find((s) => s.id === owner);
            const ownerGroup = ab.groups!.find((g) => g.id === owner);
            if (ownerShape) ownerShape.clipBy = source;
            else if (ownerGroup) ownerGroup.clipBy = source;
            decompiled++;
          } else skip(o.typeName);
          break;
        }
        case "FollowPathConstraint": {
          const item = idOf.get(num(o.properties.parentId, -1));
          const path = idOf.get(num(o.properties.targetId, -1));
          if (item && path) {
            ab.constraints = ab.constraints ?? [];
            ab.constraints.push({
              type: "followPath", item, path,
              distance: num(o.properties.distance),
              orient: o.properties.orient !== false && o.properties.orient !== 0,
            });
            idOf.set(li, `${item}#follow`);
            decompiled++;
          } else skip(o.typeName);
          break;
        }
        case "LinearAnimation": case "StateMachine":
          flushShape();
          skip(o.typeName); // 第2パスで扱う（skipped集計からは後で除去）
          break;
        default:
          if (!o.typeName.startsWith("KeyFrame") && o.typeName !== "KeyedObject" && o.typeName !== "KeyedProperty"
              && !o.typeName.includes("Interpolator")) {
            skip(o.typeName);
          }
      }
    }
    delete skipped.LinearAnimation;
    delete skipped.StateMachine;

    // 第2パス: アニメーション
    const propNameOf = buildPropKeyMap();
    let curAnim: AnimationSpec | null = null;
    let curTrack: TrackSpec | null = null;
    let keyedTargetLi = -1;

    const easingOfInterpolator = (interpLi: number | undefined): EasingName | undefined => {
      if (interpLi === undefined) return undefined;
      const io = objAt(interpLi);
      if (!io) return undefined;
      if (io.typeName === "ElasticInterpolator") {
        const ev = io.properties.easingValue;
        return ev === 0 ? "elastic-in" : ev === 2 ? "elastic-in-out" : "elastic-out";
      }
      const [x1, y1, x2, y2] = [num(io.properties.x1), num(io.properties.y1), num(io.properties.x2, 1), num(io.properties.y2, 1)];
      let best: EasingName = "smooth";
      let bestD = Infinity;
      for (const [name, bez] of Object.entries(EASING_BEZIER)) {
        if (!bez) continue;
        const d = Math.hypot(bez[0] - x1, bez[1] - y1, bez[2] - x2, bez[3] - y2);
        if (d < bestD) { bestD = d; best = name as EasingName; }
      }
      if (bestD > 0.25) warnings.push(`custom curve (${x1.toFixed(2)},${y1.toFixed(2)},${x2.toFixed(2)},${y2.toFixed(2)}) → nearest '${best}'`);
      return best;
    };

    for (let gi = start + 1; gi < end; gi++) {
      const o = objects[gi];
      switch (o.typeName) {
        case "LinearAnimation":
          curAnim = {
            name: (o.properties.name as string) ?? `anim${ab.animations!.length}`,
            fps: num(o.properties.fps, 60),
            duration: num(o.properties.duration, 60),
            loop: o.properties.loopValue === 0 ? "oneShot" : o.properties.loopValue === 2 ? "pingPong" : "loop",
            tracks: [],
          };
          ab.animations!.push(curAnim);
          curTrack = null;
          decompiled++;
          break;
        case "KeyedObject":
          keyedTargetLi = num(o.properties.objectId, -1);
          curTrack = null;
          break;
        case "KeyedProperty": {
          if (!curAnim) break;
          const pk = num(o.properties.propertyKey, -1);
          const mapped = propNameOf(pk);
          const targetId = idOf.get(keyedTargetLi);
          if (!mapped || !targetId) {
            warnings.push(`animation "${curAnim.name}": unsupported keyed property ${pk} on local#${keyedTargetLi}`);
            curTrack = null;
            break;
          }
          // SolidColor/TrimPath はコンポーネント名 "<shape>#fillColor" 等で登録済み → 論理targetへ変換
          let logicalTarget = targetId;
          let property = mapped;
          if (targetId.endsWith("#fillColor") || targetId.endsWith("#strokeColor")) {
            logicalTarget = targetId.split("#")[0];
            property = "fillColor";
          } else if (targetId.endsWith("#trim") || targetId.endsWith("#follow")) {
            logicalTarget = targetId.split("#")[0];
          }
          curTrack = { target: logicalTarget, property: property as TrackSpec["property"], keyframes: [] };
          curAnim.tracks.push(curTrack);
          decompiled++;
          break;
        }
        case "KeyFrameDouble": case "KeyFrameColor": case "KeyFrameId": {
          if (!curTrack) break;
          const kf: KeyframeSpec = { frame: num(o.properties.frame) };
          if (o.typeName === "KeyFrameColor") kf.color = colorOf(o.properties.value);
          else if (o.typeName === "KeyFrameId") kf.ref = idOf.get(num(o.properties.value, -1)) ?? String(o.properties.value);
          else {
            kf.value = num(o.properties.value);
            if (curTrack.property === "rotation") kf.value = deg(o.properties.value);
          }
          // 到達easing表現へ変換: このKFのinterpolationは「次区間」→ 次のKFのeasingとして付ける
          const it = num(o.properties.interpolationType, 1);
          const easing: EasingName | undefined =
            it === 0 ? "hold" : it === 1 ? undefined : easingOfInterpolator(o.properties.interpolatorId as number | undefined);
          (kf as KeyframeSpec & { __outEasing?: EasingName }).__outEasing = easing;
          curTrack.keyframes.push(kf);
          decompiled++;
          break;
        }
      }
    }
    // __outEasing を次キーフレームの easing にシフト
    for (const anim of ab.animations!) {
      for (const t of anim.tracks) {
        for (let i = 0; i < t.keyframes.length; i++) {
          const cur = t.keyframes[i] as KeyframeSpec & { __outEasing?: EasingName };
          if (i + 1 < t.keyframes.length && cur.__outEasing) t.keyframes[i + 1].easing = cur.__outEasing;
          delete cur.__outEasing;
        }
      }
    }
    if (!ab.groups!.length) delete ab.groups;
    artboards.push(ab);
  }

  return {
    scene: artboards.length === 1
      ? { artboard: { name: artboards[0].name, width: artboards[0].width, height: artboards[0].height }, ...stripAbHeader(artboards[0]) }
      : { artboards },
    coverage: { decompiled, skipped, warnings },
  };
}

function stripAbHeader(ab: ArtboardSpec): Partial<ArtboardSpec> {
  const { name: _n, width: _w, height: _h, ...rest } = ab;
  return rest;
}

// propertyKey → ライターのトラックproperty名
function buildPropKeyMap(): (key: number) => string | null {
  const defs = loadDefs();
  const map = new Map<number, string>();
  if (defs) {
    const want: Record<string, Record<string, string>> = {
      Node: { x: "x", y: "y" },
      TransformComponent: { rotation: "rotation", scaleX: "scaleX", scaleY: "scaleY" },
      WorldTransformComponent: { opacity: "opacity" },
      LayoutComponent: { width: "width", height: "height" },
      SolidColor: { colorValue: "fillColor" },
      TrimPath: { start: "trimStart", end: "trimEnd", offset: "trimOffset" },
      FollowPathConstraint: { distance: "followDistance" },
      Solo: { activeComponentId: "soloActive" },
    };
    for (const [typeName, props] of Object.entries(want)) {
      const t = defs.types[typeName];
      if (!t) continue;
      for (const [propName, trackName] of Object.entries(props)) {
        const p = t.properties[propName];
        if (p?.key !== undefined) map.set(p.key, trackName);
      }
    }
  }
  return (key: number) => map.get(key) ?? null;
}
