// riv_rig_character: キャラクターPNG 1枚から完成リグ付き .riv を一発生成
// - パーツ（耳/尻尾等）をポリゴンで切り出し → ピボットグループ + 穴埋めパッチ
// - 頭の傾きは 2ボーンスキンメッシュ（切れ目なし）
// - 目パチはベクターまぶたオーバーレイ
// - idle（呼吸+首かしげ+尻尾+目パチ）/ happy（尻尾ブンブン+耳ピク+弾み）+ SM(happyトリガー)
import type { SceneSpec, ShapeSpec, GroupSpec, ImageSpec, BoneSpec, TrackSpec } from "./rivWriter.js";
import { pngSize } from "./rivWriter.js";

export interface RigPartDef {
  polygon: Array<[number, number]>; // 画像px座標
  pivot?: [number, number]; // 付け根（省略時: bbox底辺中央）
  behindBody?: boolean; // 尻尾など体の後ろに描くパーツ
}
export interface RigOptions {
  artboardWidth?: number;
  artboardHeight?: number;
  backgroundColor?: string;
  scale?: number; // 省略時: アートボード高の72%にフィット
  parts?: Record<string, RigPartDef>; // 例: {earL, earR, tail}
  eyes?: Array<{ x: number; y: number; width: number; height: number }>; // 画像px座標
  furColor?: string; // まぶた/パッチの色
  outlineColor?: string;
  headRatio?: number; // 画像の上から何割が「頭」か（ボーン分割点、既定 0.45）
}

interface SlicedPart {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  png: string; // base64
}

export function buildCharacterRig(
  pngBytes: Uint8Array,
  sliced: { base: string; parts: SlicedPart[] },
  opts: RigOptions
): SceneSpec {
  const dims = pngSize(pngBytes);
  const abW = opts.artboardWidth ?? 600;
  const abH = opts.artboardHeight ?? 460;
  const S = opts.scale ?? (abH * 0.72) / dims.height;
  const fur = opts.furColor ?? "#f8eee2";
  const rootW = { x: abW / 2, y: abH * 0.9 };
  const C = { x: abW / 2, y: abH * 0.9 - (dims.height * S) / 2 - abH * 0.02 }; // base画像中心
  const toWorld = (px: number, py: number) => ({
    x: C.x + (px - dims.width / 2) * S,
    y: C.y + (py - dims.height / 2) * S,
  });
  const headSplitY = C.y + (opts.headRatio ?? 0.45 - 0.5) * dims.height * S; // 首の位置(ワールド)
  const neckY = C.y + ((opts.headRatio ?? 0.45) - 0.5) * dims.height * S;

  const groups: GroupSpec[] = [{ id: "root", x: rootW.x, y: rootW.y }];
  const headGW = { x: rootW.x, y: neckY };
  groups.push({ id: "headG", x: 0, y: neckY - rootW.y, parent: "root" });

  const bones: BoneSpec[] = [
    { id: "bodyBone", parent: "root", x: 0, y: -abH * 0.04, rotation: -90, length: rootW.y - abH * 0.04 - neckY },
    { id: "headBone", parent: "bodyBone", length: Math.max(40, neckY - (C.y - (dims.height * S) / 2) - 20) },
  ];

  const partsMap = new Map(sliced.parts.map((p) => [p.name, p]));
  const images: ImageSpec[] = [
    {
      id: "base",
      bytes: b64(sliced.base),
      x: C.x - rootW.x,
      y: C.y - rootW.y,
      scale: S,
      parent: "root",
      mesh: { columns: 8, rows: 8, bones: ["bodyBone", "headBone"] },
      z: 1000,
    },
  ];
  const shapes: ShapeSpec[] = [];
  const partIds: string[] = [];

  for (const [name, def] of Object.entries(opts.parts ?? {})) {
    const p = partsMap.get(name);
    if (!p) continue;
    partIds.push(name);
    const isEar = name.toLowerCase().includes("ear");
    const pivotPx: [number, number] = def.pivot ?? [p.x + p.width / 2, p.y + p.height];
    const pv = toWorld(...pivotPx);
    const parent = isEar ? "headG" : "root";
    const parentW = isEar ? headGW : rootW;
    groups.push({ id: name + "G", x: pv.x - parentW.x, y: pv.y - parentW.y, parent });
    const cW = toWorld(p.x + p.width / 2, p.y + p.height / 2);
    images.push({
      id: name,
      bytes: b64(p.png),
      x: cW.x - pv.x,
      y: cW.y - pv.y,
      scale: S,
      parent: name + "G",
      z: def.behindBody ? 999 : 1001,
    });
    if (isEar) {
      // 穴埋めパッチ（base上・耳下）
      shapes.push({
        id: name + "Patch", type: "ellipse", parent: "headG",
        x: pv.x - headGW.x, y: pv.y - headGW.y - 4,
        width: p.width * S * 0.75, height: p.height * S * 0.28,
        fill: { color: fur }, z: 1000.5,
      });
    }
  }

  // まぶた
  const lidTargets: string[] = [];
  (opts.eyes ?? []).forEach((eye, i) => {
    const c = toWorld(eye.x + eye.width / 2, eye.y + eye.height / 2);
    const lw = eye.width * S * 1.15;
    const lh = eye.height * S * 1.05;
    shapes.push({
      id: `lid${i}`, type: "ellipse", parent: "headG",
      x: c.x - headGW.x, y: c.y - headGW.y, width: lw, height: lh,
      opacity: 0, fill: { color: fur }, z: 1500,
    });
    shapes.push({
      id: `lash${i}`, type: "rect", parent: "headG",
      x: c.x - headGW.x, y: c.y - headGW.y + lh * 0.06, width: lw * 0.85, height: Math.max(3, lh * 0.1),
      cornerRadius: 2, opacity: 0, fill: { color: opts.outlineColor ?? "#6b4a3a" }, z: 1501,
    });
    lidTargets.push(`lid${i}`, `lash${i}`);
  });

  const blinkKeys = [
    { frame: 0, value: 0, easing: "hold" as const }, { frame: 96, value: 1, easing: "hold" as const },
    { frame: 104, value: 0, easing: "hold" as const }, { frame: 196, value: 1, easing: "hold" as const },
    { frame: 204, value: 0, easing: "hold" as const }, { frame: 240, value: 0 },
  ];
  const headTiltKeys = [
    { frame: 0, value: 0 }, { frame: 70, value: 3.2, easing: "ease-in-out" as const },
    { frame: 160, value: -2.6, easing: "ease-in-out" as const }, { frame: 240, value: 0, easing: "ease-in-out" as const },
  ];

  const idleTracks: TrackSpec[] = [
    { target: "headBone", property: "rotation", keyframes: headTiltKeys },
    { target: "headG", property: "rotation", keyframes: headTiltKeys },
    { target: "root", property: "scaleY", keyframes: [
      { frame: 0, value: 1 }, { frame: 120, value: 1.015, easing: "ease-in-out" }, { frame: 240, value: 1, easing: "ease-in-out" } ] },
    ...lidTargets.map((t) => ({ target: t, property: "opacity" as const, keyframes: blinkKeys })),
  ];
  const happyTracks: TrackSpec[] = [
    { target: "root", property: "y", keyframes: [
      { frame: 0, value: rootW.y }, { frame: 12, value: rootW.y - abH * 0.045, easing: "ease-out" },
      { frame: 24, value: rootW.y, easing: "ease-in" }, { frame: 34, value: rootW.y - abH * 0.03, easing: "ease-out" },
      { frame: 44, value: rootW.y, easing: "ease-in" }, { frame: 90, value: rootW.y } ] },
    { target: "headBone", property: "rotation", keyframes: [
      { frame: 0, value: 0 }, { frame: 25, value: 5, easing: "ease-in-out" }, { frame: 65, value: 5 }, { frame: 90, value: 0, easing: "ease-in-out" } ] },
    { target: "headG", property: "rotation", keyframes: [
      { frame: 0, value: 0 }, { frame: 25, value: 5, easing: "ease-in-out" }, { frame: 65, value: 5 }, { frame: 90, value: 0, easing: "ease-in-out" } ] },
  ];
  for (const name of partIds) {
    const isEar = name.toLowerCase().includes("ear");
    if (isEar) {
      const dir = name.toLowerCase().includes("r") ? 1 : -1;
      happyTracks.push({
        target: name + "G", property: "rotation",
        keyframes: [
          { frame: 0, value: 0 }, { frame: 8, value: 12 * dir, easing: "ease-out" },
          { frame: 20, value: 0, easing: "ease-in-out" }, { frame: 34, value: 7 * dir, easing: "ease-out" },
          { frame: 46, value: 0, easing: "ease-in-out" } ],
      });
    } else {
      // 尻尾等: idle ではゆらゆら、happy ではブンブン
      idleTracks.push({
        target: name + "G", property: "rotation",
        keyframes: [
          { frame: 0, value: 0 }, { frame: 60, value: 9, easing: "ease-in-out" },
          { frame: 130, value: -4, easing: "ease-in-out" }, { frame: 200, value: 7, easing: "ease-in-out" },
          { frame: 240, value: 0, easing: "ease-in-out" } ],
      });
      happyTracks.push({
        target: name + "G", property: "rotation",
        keyframes: [
          { frame: 0, value: 0 }, { frame: 12, value: -24, easing: "ease-in-out" }, { frame: 28, value: 22, easing: "ease-in-out" },
          { frame: 44, value: -24, easing: "ease-in-out" }, { frame: 60, value: 22, easing: "ease-in-out" },
          { frame: 76, value: -12, easing: "ease-in-out" }, { frame: 90, value: 0, easing: "ease-in-out" } ],
      });
    }
  }

  return {
    artboard: { name: "Character", width: abW, height: abH },
    backgroundColor: opts.backgroundColor,
    groups,
    bones,
    shapes,
    images,
    animations: [
      { name: "idle", duration: 240, fps: 60, loop: "loop", tracks: idleTracks },
      { name: "happy", duration: 90, fps: 60, loop: "oneShot", tracks: happyTracks },
    ],
    stateMachine: {
      name: "Character",
      inputs: [{ name: "happy", type: "trigger" }],
      states: [
        { name: "idleS", animation: "idle" },
        { name: "happyS", animation: "happy" },
      ],
      transitions: [
        { from: "entry", to: "idleS" },
        { from: "idleS", to: "happyS", condition: { input: "happy" } },
        { from: "happyS", to: "idleS", exitTimeMs: 1500 },
      ],
    },
  };
}

function b64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}
