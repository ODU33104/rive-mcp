import { decompileRiv } from "./rivDecompile.js";
import { readRiv, type RivObject } from "./rivBinary.js";
import {
  EASING_BEZIER,
  type ArtboardSpec,
  type GroupSpec,
  type ShapeSpec,
  type TrackSpec,
  type KeyframeSpec,
} from "./rivWriter.js";

export interface LottieExportIssue {
  feature: string;
  where: string;
  reason: string;
}

export interface LottieExportApproximation {
  feature: string;
  where: string;
  note: string;
}

export interface LottieExportOptions {
  artboard?: string;
  animation?: string;
  fps?: number;
}

export interface LottieExportResult {
  json: string;
  layers: number;
  supported: string[];
  lost: LottieExportIssue[];
  approximated: LottieExportApproximation[];
  verify: { frames: number; maxDiffPercent: number | "未確認" };
}

type JsonObject = Record<string, unknown>;
type Point = NonNullable<ShapeSpec["points"]>[number];

const staticProperty = (value: unknown): JsonObject => ({ a: 0, k: value });
const trackId = (target: string, property: string): string => target + "\u0000" + property;

function decodeColor(source: string): { rgb: number[]; opacity: number } {
  let value = source.replace(/^#/, "");
  if (value.length === 3) value = [...value].map((c) => c + c).join("");
  if (value.length === 6) value = "ff" + value;
  if (!/^[\da-f]{8}$/i.test(value)) throw new Error("Invalid color: " + source);
  return {
    rgb: [2, 4, 6].map((n) => parseInt(value.slice(n, n + 2), 16) / 255),
    opacity: (parseInt(value.slice(0, 2), 16) / 255) * 100,
  };
}

function bezierPath(points: Point[], closed: boolean): JsonObject {
  const v: number[][] = [];
  const i: number[][] = [];
  const o: number[][] = [];
  for (const point of points) {
    v.push([point.x, point.y]);
    if (!point.cubic) {
      i.push([0, 0]);
      o.push([0, 0]);
      continue;
    }
    const c = point.cubic;
    const inAngle = ((c.inRotation ?? c.rotation + 180) * Math.PI) / 180;
    const outAngle = (c.rotation * Math.PI) / 180;
    const inLength = c.inDistance ?? c.distance ?? 0;
    const outLength = c.outDistance ?? c.distance ?? 0;
    i.push([Math.cos(inAngle) * inLength, Math.sin(inAngle) * inLength]);
    o.push([Math.cos(outAngle) * outLength, Math.sin(outAngle) * outLength]);
  }
  return { v, i, o, c: closed };
}

function intervalEase(
  easing: KeyframeSpec["easing"],
  location: string,
  approximated: LottieExportApproximation[]
): { hold: boolean; curve: [number, number, number, number] } {
  if (easing === "hold") return { hold: true, curve: [0, 0, 1, 1] };
  if (!easing || easing === "linear") return { hold: false, curve: [0, 0, 1, 1] };
  if (Array.isArray(easing)) return { hold: false, curve: easing };
  if (easing.startsWith("elastic-")) {
    approximated.push({
      feature: "easing",
      where: location,
      note: easing + " approximated with a cubic back curve",
    });
    const fallback = easing === "elastic-in" ? "ease-in-back" : "ease-out-back";
    return { hold: false, curve: EASING_BEZIER[fallback] ?? [0, 0, 1, 1] };
  }
  const curve = EASING_BEZIER[easing];
  if (curve) return { hold: false, curve };
  approximated.push({
    feature: "easing",
    where: location,
    note: easing + " approximated with linear interpolation",
  });
  return { hold: false, curve: [0, 0, 1, 1] };
}

function keyframed(
  track: TrackSpec | undefined,
  initial: unknown,
  convert: (key: KeyframeSpec, index: number) => unknown,
  frameScale: number,
  location: string,
  lost: LottieExportIssue[],
  approximated: LottieExportApproximation[]
): JsonObject {
  if (!track) return staticProperty(initial);
  const keys = [...track.keyframes].sort((a, b) => a.frame - b.frame);
  if (
    !keys.length ||
    keys.some((key, index) =>
      !Number.isFinite(key.frame) ||
      (index > 0 && key.frame <= keys[index - 1].frame) ||
      convert(key, index) === undefined
    )
  ) {
    lost.push({
      feature: "animation." + track.property,
      where: location,
      reason: "Invalid, missing, or duplicate keyframe values",
    });
    return staticProperty(initial);
  }
  const values = keys.map(convert);
  const result: JsonObject[] = keys.map((key, index) => ({
    t: key.frame * frameScale,
    s: values[index],
  }));
  for (let index = 0; index + 1 < keys.length; index++) {
    // SceneSpec easing describes the interval arriving at the next keyframe.
    const ease = intervalEase(keys[index + 1].easing, location, approximated);
    result[index].e = values[index + 1];
    if (ease.hold) {
      result[index].h = 1;
    } else {
      result[index].o = { x: ease.curve[0], y: ease.curve[1] };
      result[index + 1].i = { x: ease.curve[2], y: ease.curve[3] };
    }
  }
  return { a: 1, k: result };
}

function scalar(
  track: TrackSpec | undefined,
  initial: number,
  multiplier: number,
  frameScale: number,
  location: string,
  lost: LottieExportIssue[],
  approximated: LottieExportApproximation[]
): JsonObject {
  return keyframed(
    track,
    initial * multiplier,
    (key) => typeof key.value === "number" && Number.isFinite(key.value)
      ? [key.value * multiplier] : undefined,
    frameScale,
    location,
    lost,
    approximated
  );
}

function vector(
  xTrack: TrackSpec | undefined,
  yTrack: TrackSpec | undefined,
  x: number,
  y: number,
  multiplier: number,
  frameScale: number,
  location: string,
  lost: LottieExportIssue[],
  approximated: LottieExportApproximation[]
): JsonObject {
  if (!xTrack && !yTrack) return staticProperty([x * multiplier, y * multiplier]);
  const first = xTrack ?? yTrack!;
  const firstKeys = [...first.keyframes].sort((a, b) => a.frame - b.frame);
  const second = xTrack && yTrack ? yTrack : undefined;
  const secondKeys = second
    ? [...second.keyframes].sort((a, b) => a.frame - b.frame) : undefined;
  const aligned = !secondKeys ||
    (secondKeys.length === firstKeys.length &&
      secondKeys.every((key, index) => key.frame === firstKeys[index].frame));
  if (!aligned) {
    lost.push({
      feature: "animation." + second!.property,
      where: location,
      reason: "Axis keyframe times differ; secondary axis is held at its initial value",
    });
  }
  if (aligned && secondKeys && secondKeys.some((key, index) =>
    JSON.stringify(key.easing ?? "linear") !==
      JSON.stringify(firstKeys[index].easing ?? "linear")
  )) {
    approximated.push({
      feature: "easing",
      where: location,
      note: "Axis curves differ; the first axis curve is used for both",
    });
  }
  const xs = first === xTrack ? firstKeys : aligned ? secondKeys : undefined;
  const ys = first === yTrack ? firstKeys : aligned ? secondKeys : undefined;
  return keyframed(
    first,
    [x * multiplier, y * multiplier],
    (_key, index) => {
      const xValue = xs ? xs[index]?.value : x;
      const yValue = ys ? ys[index]?.value : y;
      return typeof xValue === "number" && Number.isFinite(xValue) &&
        typeof yValue === "number" && Number.isFinite(yValue)
        ? [xValue * multiplier, yValue * multiplier] : undefined;
    },
    frameScale,
    location,
    lost,
    approximated
  );
}

function unsupportedObject(object: RivObject): string | null {
  const t = object.typeName;
  if (/^StateMachine|^StateTransition|^Transition.*Condition$|^EntryState$|^AnyState$|^ExitState$|^AnimationState$|^BlendState/.test(t)) return "state machine";
  if (/^ViewModel|^DataBind|^DataConverter|^DataEnum/.test(t)) return "data binding / view model";
  if (/^LayoutComponent/.test(t)) return "layout";
  if (/^(RootBone|Bone|Skin|Tendon|Weight|Mesh|MeshVertex)$/.test(t)) return "bone / mesh";
  if (/^Text|^Font|^Glyph/.test(t)) return "text / font";
  if (/^Image|^FileAssetContents$/.test(t)) return "image / embedded asset";
  if (/^Audio/.test(t)) return "audio";
  if (/Event|Listener|^KeyFrameCallback$/.test(t)) return "event";
  if (/^Nested/.test(t)) return "nested artboard";
  if (t.startsWith("type#")) return "unknown binary object";
  return null;
}

export function exportLottie(
  bytes: Uint8Array,
  options: LottieExportOptions = {}
): LottieExportResult {
  if (options.animation === "all") throw new Error("animation=all is not supported; select one animation");
  const dump = readRiv(bytes, { tolerant: true });
  if (dump.error) throw new Error("Cannot export partially parsed .riv: " + dump.error);
  const { scene, coverage } = decompileRiv(bytes);
  const artboards: ArtboardSpec[] = scene.artboards ??
    (scene.artboard ? [{
      ...scene.artboard,
      groups: scene.groups,
      shapes: scene.shapes,
      animations: scene.animations,
      backgroundColor: scene.backgroundColor,
      constraints: scene.constraints,
      layouts: scene.layouts,
      bones: scene.bones,
      images: scene.images,
      texts: scene.texts,
      audio: scene.audio,
      nested: scene.nested,
      stateMachine: scene.stateMachine,
      events: scene.events,
    }] : []);
  const artboardIndex = options.artboard === undefined ? 0 :
    artboards.findIndex((item) => item.name === options.artboard);
  const board = artboards[artboardIndex];
  if (!board) throw new Error("Artboard not found: " + (options.artboard ?? "first"));
  const animation = options.animation === undefined ? board.animations?.[0] :
    board.animations?.find((item) => item.name === options.animation);
  if (!animation) throw new Error("Animation not found: " + (options.animation ?? "first"));

  const originalFps = animation.fps ?? 60;
  const outputFps = options.fps ?? originalFps;
  if (![originalFps, outputFps, animation.duration, board.width, board.height]
    .every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("FPS, duration, width, and height must be positive finite numbers");
  }
  const frameScale = outputFps / originalFps;
  const duration = animation.duration * frameScale;
  const lost: LottieExportIssue[] = [];
  const approximated: LottieExportApproximation[] = [];
  const supported = new Set<string>();
  const issueIds = new Set<string>();
  const addLost = (feature: string, where: string, reason: string): void => {
    const id = JSON.stringify([feature, where, reason]);
    if (issueIds.has(id)) return;
    issueIds.add(id);
    lost.push({ feature, where, reason });
  };

  const starts = dump.objects.flatMap((item, index) =>
    item.typeName === "Artboard" ? [index] : []);
  const raw = [
    ...dump.objects.slice(0, starts[0] ?? 0),
    ...dump.objects.slice(starts[artboardIndex], starts[artboardIndex + 1] ?? dump.objects.length),
  ];
  for (const item of raw) {
    const feature = unsupportedObject(item);
    if (feature) addLost(feature, "object#" + item.index + " (" + item.typeName + ")", "Not exported to Lottie");
    if (item.typeName === "CubicEaseInterpolator" || item.typeName === "CubicInterpolator") {
      const values = ["x1", "y1", "x2", "y2"].map((key) => item.properties[key]);
      if (values.every((value) => typeof value === "number" && Number.isFinite(value))) {
        const bezier = values as number[];
        const isLinear = Math.abs(bezier[0] - bezier[1]) < 0.001 &&
          Math.abs(bezier[2] - bezier[3]) < 0.001;
        const matchesPreset = Object.values(EASING_BEZIER).some((curve) =>
          curve !== null && curve.every((n, index) => Math.abs(n - bezier[index]) < 0.001));
        if (!isLinear && !matchesPreset) {
          approximated.push({
            feature: "easing",
            where: "object#" + item.index,
            note: "Custom cubic curve is mapped to the closest named preset by decompileRiv",
          });
        }
      }
    }
    if (item.unknownProps.length) {
      addLost("unknown properties", "object#" + item.index,
        String(item.unknownProps.length) + " unrecognized properties");
    }
  }
  for (const [type, count] of Object.entries(coverage.skipped)) {
    if (count) addLost("unconverted " + type, "source",
      String(count) + " objects not restored by decompileRiv");
  }
  for (const warning of coverage.warnings) {
    if (/approximat|nearest|custom curve/.test(warning)) {
      approximated.push({ feature: "decompile", where: "source", note: warning });
    } else {
      addLost("decompile warning", "source", warning);
    }
  }
  if (board.backgroundColor) addLost("artboard background", board.name ?? "artboard", "Background fill is not exported");
  if (board.constraints?.length) addLost("constraint", board.name ?? "artboard", "Constraints are not evaluated");
  if (board.stateMachine) addLost("state machine", board.name ?? "artboard", "State machine playback is not exported");
  if (board.layouts?.length) addLost("layout", board.name ?? "artboard", "Layout is not evaluated");
  if (board.bones?.length) addLost("bone / mesh", board.name ?? "artboard", "Skinning is not exported");
  if (board.images?.length) addLost("image asset", board.name ?? "artboard", "Image assets are not exported");
  if (board.texts?.length) addLost("text / font", board.name ?? "artboard", "Text is not exported");
  if (board.audio?.length) addLost("audio", board.name ?? "artboard", "Audio is not exported");
  if (board.nested?.length) addLost("nested artboard", board.name ?? "artboard", "Nested content is not flattened");
  if (board.events?.length || animation.events?.length) addLost("event", animation.name, "Event triggers are not exported");
  if (animation.loop === "pingPong") addLost("ping-pong playback", animation.name, "Playback mode is not serialized");

  const tracks = new Map<string, TrackSpec>();
  for (const track of animation.tracks) {
    const id = trackId(track.target, track.property);
    if (tracks.has(id)) {
      addLost("animation." + track.property, track.target, "Duplicate track target and property");
    } else {
      tracks.set(id, track);
    }
  }
  const consumed = new Set<string>();
  const getTrack = (target: string, property: string): TrackSpec | undefined => {
    const id = trackId(target, property);
    const track = tracks.get(id);
    if (track) consumed.add(id);
    return track;
  };
  function transform(item: ShapeSpec | GroupSpec): JsonObject {
    const id = item.id;
    const x = getTrack(id, "x");
    const y = getTrack(id, "y");
    const sx = getTrack(id, "scaleX");
    const sy = getTrack(id, "scaleY");
    return {
      a: staticProperty([0, 0]),
      p: x || y
        ? {
            s: true,
            x: scalar(x, item.x, 1, frameScale, id + ".x", lost, approximated),
            y: scalar(y, item.y, 1, frameScale, id + ".y", lost, approximated),
          }
        : staticProperty([item.x, item.y]),
      s: vector(sx, sy, item.scaleX ?? 1, item.scaleY ?? 1, 100,
        frameScale, id + ".scale", lost, approximated),
      r: scalar(getTrack(id, "rotation"), item.rotation ?? 0, 1,
        frameScale, id + ".rotation", lost, approximated),
      o: scalar(getTrack(id, "opacity"), item.opacity ?? 1, 100,
        frameScale, id + ".opacity", lost, approximated),
    };
  }

  const groups = board.groups ?? [];
  const shapes = [...(board.shapes ?? [])].sort((a, b) => (b.z ?? 0) - (a.z ?? 0));
  const members = [...groups, ...shapes];
  const ids = new Map(members.map((item, index) => [item.id, index + 1]));
  if (ids.size !== members.length) throw new Error("Duplicate group or shape IDs");
  const layers: JsonObject[] = [];
  const parentOf = (parent: string | undefined, owner: string): JsonObject => {
    if (!parent) return {};
    const id = ids.get(parent);
    if (!id) {
      addLost("parent", owner, "Missing parent " + parent);
      return {};
    }
    return { parent: id };
  };

  for (const group of groups) {
    const ks = transform(group);
    if ((group.opacity !== undefined && group.opacity !== 1) ||
      getTrack(group.id, "opacity")) {
      addLost("group opacity", group.id, "Lottie null parents do not propagate opacity");
      ks.o = staticProperty(100);
    }
    if (group.solo) addLost("solo visibility", group.id, "Active-child switching is not exported");
    if (group.clipBy) addLost("clipping", group.id, "Clipping masks are not exported");
    layers.push({
      ty: 3, ind: ids.get(group.id), nm: group.id, ks,
      ip: 0, op: duration, st: 0, ...parentOf(group.parent, group.id),
    });
  }

  for (const shape of shapes) {
    const geometry: JsonObject[] = [];
    if (shape.type === "rect" || shape.type === "ellipse") {
      geometry.push({
        ty: shape.type === "rect" ? "rc" : "el",
        nm: shape.id,
        p: staticProperty([shape.pathX ?? 0, shape.pathY ?? 0]),
        s: vector(getTrack(shape.id, "width"), getTrack(shape.id, "height"),
          shape.width ?? 100, shape.height ?? 100, 1,
          frameScale, shape.id + ".size", lost, approximated),
        ...(shape.type === "rect" ? { r: staticProperty(shape.cornerRadius ?? 0) } : {}),
      });
    } else if (shape.type === "polygon") {
      const paths = shape.subpaths ?? (shape.points
        ? [{ points: shape.points, closed: shape.closed }] : []);
      for (const [index, path] of paths.entries()) {
        const location = shape.id + "#" + index;
        if (path.points.length < 2) {
          addLost("path", location, "Fewer than two vertices");
          continue;
        }
        if (path.points.some((p) => !!p.radius)) {
          addLost("rounded path vertex", location, "Vertex corner radius is not reconstructed");
        }
        geometry.push({
          ty: "sh", nm: location,
          ks: staticProperty(bezierPath(path.points, path.closed !== false)),
        });
      }
    } else {
      addLost("geometry", shape.id, "Unsupported geometry type " + shape.type);
    }
    if (!geometry.length) {
      addLost("shape", shape.id, "No convertible geometry");
      continue;
    }
    supported.add("shape." + shape.type);
    if (shape.clipBy) addLost("clipping", shape.id, "Clipping masks are not exported");
    if (shape.blendMode && shape.blendMode !== "srcOver") {
      addLost("blend mode", shape.id, "Blend mode " + shape.blendMode + " is not exported");
    }
    if (shape.fill?.feather || shape.stroke?.feather) {
      addLost("feather", shape.id, "Feather effects are not exported");
    }
    if (shape.fill?.gradient) {
      addLost("gradient fill", shape.id, "Gradient fill conversion is not verified");
    }
    if (shape.fill?.color) {
      const initial = decodeColor(shape.fill.color);
      const colorTrack = getTrack(shape.id, "fillColor");
      const distinctPaints = !!shape.stroke && !!colorTrack;
      if (distinctPaints) {
        addLost("animated paint color", shape.id,
          "Decompiled fill and stroke color tracks do not retain paint identity");
      }
      const fillTrack = distinctPaints ? undefined : colorTrack;
      const animatedAlpha = fillTrack?.keyframes.some((key) =>
        !!key.color && Math.abs(decodeColor(key.color).opacity - initial.opacity) > 1e-5);
      geometry.push({
        ty: "fl", nm: shape.id + ".fill",
        c: keyframed(fillTrack, initial.rgb,
          (key) => key.color ? decodeColor(key.color).rgb : undefined,
          frameScale, shape.id + ".fill", lost, approximated),
        o: animatedAlpha
          ? keyframed(fillTrack, initial.opacity,
              (key) => key.color ? [decodeColor(key.color).opacity] : undefined,
              frameScale, shape.id + ".fill.opacity", lost, approximated)
          : staticProperty(initial.opacity),
        r: 1,
      });
      supported.add("solid fill");
    }
    if (shape.stroke) {
      const color = decodeColor(shape.stroke.color);
      const cap = { butt: 1, round: 2, square: 3 }[shape.stroke.cap ?? "butt"];
      const join = { miter: 1, round: 2, bevel: 3 }[shape.stroke.join ?? "miter"];
      geometry.push({
        ty: "st", nm: shape.id + ".stroke",
        c: staticProperty(color.rgb), o: staticProperty(color.opacity),
        w: staticProperty(shape.stroke.thickness), lc: cap, lj: join,
      });
      supported.add("solid stroke");
      if (shape.stroke.trim) {
        const trim = shape.stroke.trim;
        geometry.push({
          ty: "tm", nm: shape.id + ".trim",
          m: trim.mode === "synchronized" ? 2 : 1,
          s: scalar(getTrack(shape.id, "trimStart"), trim.start ?? 0, 100,
            frameScale, shape.id + ".trimStart", lost, approximated),
          e: scalar(getTrack(shape.id, "trimEnd"), trim.end ?? 1, 100,
            frameScale, shape.id + ".trimEnd", lost, approximated),
          o: scalar(getTrack(shape.id, "trimOffset"), trim.offset ?? 0, 360,
            frameScale, shape.id + ".trimOffset", lost, approximated),
        });
        supported.add("stroke trim");
      }
    }
    geometry.push({
      ty: "tr", a: staticProperty([0, 0]), p: staticProperty([0, 0]),
      s: staticProperty([100, 100]), r: staticProperty(0), o: staticProperty(100),
    });
    layers.push({
      ty: 4, ind: ids.get(shape.id), nm: shape.id, ip: 0, op: duration, st: 0,
      ks: transform(shape),
      shapes: [{ ty: "gr", nm: shape.id, it: geometry }],
      ...parentOf(shape.parent, shape.id),
    });
  }

  for (const [id, track] of tracks) {
    if (!consumed.has(id)) {
      addLost("animation." + track.property, track.target,
        "Track cannot be represented by this export");
    }
  }
  supported.add("position / rotation / scale / opacity");
  if (animation.tracks.length) supported.add("keyframes / easing");
  const document = {
    v: "5.7.4", fr: outputFps, ip: 0, op: duration,
    w: Math.max(1, Math.round(board.width)), h: Math.max(1, Math.round(board.height)),
    nm: animation.name, ddd: 0, assets: [], layers,
  };
  return {
    json: JSON.stringify(document),
    layers: layers.length,
    supported: [...supported].sort(),
    lost, approximated,
    verify: { frames: 0, maxDiffPercent: "未確認" },
  };
}
