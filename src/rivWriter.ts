// .riv バイナリライター + シーンビルダー
// typeKey/propertyKey は vendor/rive-defs/defs.json から動的解決（ハードコード禁止）
// 参照semantics（vehicles.riv 等の実ファイルで実証済み。docs/riv-format.md 参照）:
//   - parentId/objectId/interpolatorId/targetId/eventId = アートボード内ローカルindex（artboard=0）
//   - animationId = アートボード内 LinearAnimation の出現順 / stateToId = レイヤー内 state の出現順
//   - 遷移は直前の state、条件は直前の遷移、FireEvent は直前の state に帰属
//   - アセット(Image/Font)は Backboard 直後、assetId/fontAssetId = ファイル内アセット出現順
import { loadDefs, fieldTypeOf, type Defs } from "./rivBinary.js";
import { expandHlapi } from "./hlapi.js";

// ---- defs 解決ヘルパ -----------------------------------------------------
let fileToName: Map<string, string> | null = null;

function defs(): Defs {
  const d = loadDefs();
  if (!d) throw new Error("vendor/rive-defs/defs.json not found — run scripts/merge-defs.mjs");
  if (!fileToName) {
    fileToName = new Map();
    for (const [name, t] of Object.entries(d.types)) {
      fileToName.set(t.file.split("/").pop()!, name);
    }
  }
  return d;
}

function typeKeyOf(typeName: string): number {
  const t = defs().types[typeName];
  if (!t || t.typeKey == null) throw new Error(`Unknown type: ${typeName}`);
  return t.typeKey;
}

// extends チェーンを遡ってプロパティを解決
function resolveProp(typeName: string, propName: string): { key: number; type: string } {
  const d = defs();
  let cur: string | null = typeName;
  while (cur) {
    const t: Defs["types"][string] | undefined = d.types[cur];
    if (!t) break;
    const p = t.properties[propName];
    if (p) return p;
    cur = t.extends ? (fileToName!.get(t.extends.split("/").pop()!) ?? null) : null;
  }
  throw new Error(`Property ${propName} not found on ${typeName} (or ancestors)`);
}

// ---- バイナリライタ -------------------------------------------------------
class BinaryWriter {
  private chunks: number[] = [];
  varuint(v: number): void {
    if (v < 0 || !Number.isInteger(v)) throw new Error(`varuint expects non-negative int, got ${v}`);
    do {
      let b = v & 0x7f;
      v >>>= 7;
      if (v) b |= 0x80;
      this.chunks.push(b);
    } while (v);
  }
  float32(v: number): void {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, v, true);
    this.chunks.push(...new Uint8Array(buf));
  }
  uint32(v: number): void {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setUint32(0, v >>> 0, true);
    this.chunks.push(...new Uint8Array(buf));
  }
  string(s: string): void {
    const bytes = new TextEncoder().encode(s);
    this.varuint(bytes.length);
    this.chunks.push(...bytes);
  }
  raw(bytes: Uint8Array | number[]): void {
    for (const b of bytes) this.chunks.push(b);
  }
  bytes(): Uint8Array {
    return new Uint8Array(this.chunks);
  }
}

export interface WriterObject {
  type: string; // defs の型名 (例: "Shape")
  props: Record<string, unknown>; // defs のプロパティ名 → 値
}

const FIELD_BITS: Record<string, number> = { uint: 0, string: 1, double: 2, color: 3 };

export function writeRiv(objects: WriterObject[], opts?: { major?: number; minor?: number }): Uint8Array {
  const w = new BinaryWriter();
  w.raw([0x52, 0x49, 0x56, 0x45]); // "RIVE"
  w.varuint(opts?.major ?? 7);
  w.varuint(opts?.minor ?? 0);
  w.varuint(0); // fileId

  // ToC: 使用する全 propertyKey とフィールドタイプ
  const used = new Map<number, string>();
  for (const obj of objects) {
    for (const propName of Object.keys(obj.props)) {
      const p = resolveProp(obj.type, propName);
      used.set(p.key, fieldTypeOf(p.type));
    }
  }
  const tocKeys = [...used.keys()];
  for (const k of tocKeys) w.varuint(k);
  w.varuint(0);
  // ビットマップ: uint32 1つに4プロパティ（2bitずつLSBから）
  for (let i = 0; i < tocKeys.length; i += 4) {
    let word = 0;
    for (let j = 0; j < 4 && i + j < tocKeys.length; j++) {
      word |= FIELD_BITS[used.get(tocKeys[i + j])!] << (j * 2);
    }
    w.uint32(word);
  }

  for (const obj of objects) {
    w.varuint(typeKeyOf(obj.type));
    for (const [propName, value] of Object.entries(obj.props)) {
      if (value === undefined || value === null) continue;
      const p = resolveProp(obj.type, propName);
      w.varuint(p.key);
      switch (fieldTypeOf(p.type)) {
        case "double":
          w.float32(value as number);
          break;
        case "string":
          if (value instanceof Uint8Array) {
            w.varuint(value.length);
            w.raw(value);
          } else {
            w.string(String(value));
          }
          break;
        case "color":
          w.uint32(value as number);
          break;
        default:
          if (typeof value === "boolean") w.varuint(value ? 1 : 0);
          else w.varuint(value as number);
      }
    }
    w.varuint(0);
  }
  return w.bytes();
}

// ---- シーン定義 (riv_create の入力) ---------------------------------------
export interface GradientSpec {
  type?: "linear" | "radial";
  stops: Array<{ color: string; position?: number }>;
  start?: { x: number; y: number };
  end?: { x: number; y: number };
}
export interface GroupSpec {
  id: string;
  x: number;
  y: number;
  parent?: string; // グループ or ボーン
  rotation?: number; // 度
  opacity?: number;
}
export interface MeshSpec {
  columns?: number; // 自動グリッド（既定6x6）。頂点は "<imageId>#v<row>_<col>" で参照可能
  rows?: number;
  bones?: string[]; // 指定するとメッシュをボーンにスキニング（距離ベース自動ウェイト）
}
export interface BoneSpec {
  id: string;
  parent: string; // グループid（チェーン先頭=RootBone）またはボーンid（子Bone）
  x?: number;
  y?: number;
  rotation?: number; // 度。子Boneは親ボーン先端からの相対角
  length: number;
}
export interface ConstraintSpec {
  type: "ik";
  bone: string; // チェーン末端のボーン
  target: string; // 目標のグループ（このグループのx/yをアニメするとIKが解決）
  parentBoneCount?: number; // 末端から遡って参加するボーン数（既定1）
  invertDirection?: boolean;
  strength?: number; // 0-1
}
export interface ImageSpec {
  id: string;
  bytes?: Uint8Array;
  pngPath?: string; // ツール層で bytes に解決される
  x: number;
  y: number;
  scale?: number;
  rotation?: number; // 度
  opacity?: number;
  parent?: string;
  mesh?: MeshSpec;
  z?: number; // 描画順（大きいほど前面）。既定: shapes=配列順, images=1000+, texts=2000+, nested=3000+
}
export interface ShapeSpec {
  id: string;
  type: "rect" | "ellipse" | "triangle" | "polygon";
  x: number;
  y: number;
  parent?: string;
  z?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  cornerRadius?: number;
  points?: Array<{
    x: number;
    y: number;
    radius?: number; // 直線頂点(StraightVertex)の角丸半径。cubicと併用不可
    // 指定するとベジェハンドル付き頂点(Cubic*Vertex)になる。有機的な曲線シェイプ用
    cubic?: {
      rotation: number; // 度。この頂点の接線方向
      distance?: number; // 対称ハンドル長（省略時はinDistance/outDistanceを個別指定）
      inDistance?: number; // 非対称: 入り側ハンドル長
      outDistance?: number; // 非対称: 出側ハンドル長
    };
  }>;
  fill?: { color?: string; gradient?: GradientSpec; feather?: FeatherSpec };
  stroke?: { color: string; thickness: number; feather?: FeatherSpec };
}
export interface FeatherSpec {
  strength?: number; // ぼかし半径。既定 12
  offsetX?: number;
  offsetY?: number;
  inner?: boolean; // true で内側シャドウ的な効果
}
export interface TextRunSpec {
  text: string;
  name?: string; // 付けるとランタイムから文字列を差し替え可能
  fontSize?: number; // 既定 32
  color?: string; // 既定 #000000
  font?: string; // fonts[].id（既定: 先頭のフォント）
}
export interface TextSpec {
  id: string;
  x: number;
  y: number;
  width?: number; // 指定時は固定サイズ（折り返し）、省略時は auto
  height?: number;
  align?: "left" | "right" | "center";
  parent?: string;
  z?: number;
  runs: TextRunSpec[];
}
export interface NestedSpec {
  id: string;
  artboard: string; // 埋め込む先のアートボード名
  x: number;
  y: number;
  parent?: string;
  z?: number;
  stateMachine?: string; // 対象アートボードのSM名（既定: 先頭）。入力は自動で公開される
}
export interface EventSpec {
  id: string;
  type?: "custom" | "openUrl";
  url?: string;
}
export interface KeyframeSpec {
  frame: number;
  value?: number;
  color?: string;
  easing?: EasingName;
  amplitude?: number; // elastic-* 専用。既定 1
  period?: number; // elastic-* 専用。既定 0.5（秒）
}
export type EasingName =
  | "hold" | "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out"
  | "ease-out-back" | "ease-in-back" | "smooth" | "snap"
  | "emphasized-decel" | "emphasized-accel"
  | "elastic-in" | "elastic-out" | "elastic-in-out";
export interface TrackSpec {
  target: string;
  property:
    | "x" | "y" | "rotation" | "scaleX" | "scaleY" | "opacity"
    | "width" | "height" | "fillColor";
  keyframes: KeyframeSpec[];
}
export interface AnimationSpec {
  name: string;
  fps?: number;
  duration: number; // フレーム数
  loop?: "oneShot" | "loop" | "pingPong";
  tracks: TrackSpec[];
}
export interface SMStateSpec {
  name: string;
  animation?: string;
  blend1d?: {
    input: string; // number入力名。値で複数アニメをミックス
    animations: Array<{ animation: string; value: number }>;
  };
  fireEvent?: string; // state 進入時に発火する events[].id
}
export interface SMTransitionSpec {
  from: string; // "entry" | "any" | state名
  to: string;
  durationMs?: number;
  exitTimeMs?: number;
  condition?: { input: string; op?: "==" | "!=" | "<=" | ">=" | "<" | ">"; value?: number | boolean };
}
export interface SMLayerSpec {
  name?: string;
  states: SMStateSpec[];
  transitions: SMTransitionSpec[];
}
export interface ListenerSpec {
  target: string; // shape/image/group/text/nested の id
  type?: "click" | "down" | "up" | "enter" | "exit" | "move";
  actions: Array<{ input: string; value?: number | boolean | "toggle" }>;
}
export interface StateMachineSpec {
  name: string;
  inputs?: Array<{ name: string; type: "bool" | "number" | "trigger"; initial?: number | boolean }>;
  // 単一レイヤー簡易形式（states/transitions）または複数レイヤー（layers）
  states?: SMStateSpec[];
  transitions?: SMTransitionSpec[];
  layers?: SMLayerSpec[];
  listeners?: ListenerSpec[];
}
export interface ArtboardSpec {
  name?: string;
  width: number;
  height: number;
  backgroundColor?: string;
  groups?: GroupSpec[];
  bones?: BoneSpec[];
  constraints?: ConstraintSpec[];
  shapes?: ShapeSpec[];
  images?: ImageSpec[];
  texts?: TextSpec[];
  nested?: NestedSpec[];
  events?: EventSpec[];
  animations?: AnimationSpec[];
  stateMachine?: StateMachineSpec | StateMachineSpec[];
}
export interface FontSpec {
  id: string;
  path?: string; // ツール層で bytes に解決される（ttf/otf）
  bytes?: Uint8Array;
}
export interface SceneSpec extends Partial<Omit<ArtboardSpec, "name" | "width" | "height">> {
  artboard?: { name?: string; width: number; height: number }; // 単一アートボード形式
  artboards?: ArtboardSpec[]; // 複数アートボード形式
  fonts?: FontSpec[];
}

// ---- 2D行列（内部表現: px = x*xx + y*xy + tx / xx,yx = 第1列） -------------
interface Mat {
  xx: number; yx: number; xy: number; yy: number; tx: number; ty: number;
}
const matIdentity: Mat = { xx: 1, yx: 0, xy: 0, yy: 1, tx: 0, ty: 0 };
function matMul(a: Mat, b: Mat): Mat {
  return {
    xx: a.xx * b.xx + a.xy * b.yx,
    yx: a.yx * b.xx + a.yy * b.yx,
    xy: a.xx * b.xy + a.xy * b.yy,
    yy: a.yx * b.xy + a.yy * b.yy,
    tx: a.xx * b.tx + a.xy * b.ty + a.tx,
    ty: a.yx * b.tx + a.yy * b.ty + a.ty,
  };
}
function matTRS(x: number, y: number, rotRad: number, sx = 1, sy = 1): Mat {
  const c = Math.cos(rotRad), s = Math.sin(rotRad);
  return { xx: c * sx, yx: s * sx, xy: -s * sy, yy: c * sy, tx: x, ty: y };
}
function matApply(m: Mat, x: number, y: number): { x: number; y: number } {
  return { x: x * m.xx + y * m.xy + m.tx, y: x * m.yx + y * m.yy + m.ty };
}

// PNG の IHDR から natural size を読む
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) {
    throw new Error("Not a PNG file");
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: dv.getUint32(16, false), height: dv.getUint32(20, false) };
}

// #RGB / #RRGGBB / #AARRGGBB → ARGB uint32
export function parseColor(c: string): number {
  let s = c.replace(/^#/, "");
  if (s.length === 3) s = s.split("").map((ch) => ch + ch).join("");
  if (s.length === 6) s = "ff" + s;
  if (s.length !== 8) throw new Error(`Invalid color: ${c} (use #RGB/#RRGGBB/#AARRGGBB)`);
  return Number.parseInt(s, 16) >>> 0;
}

export const EASING_BEZIER: Record<string, [number, number, number, number] | null> = {
  hold: null,
  linear: null,
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
  "ease-out-back": [0.34, 1.56, 0.64, 1], // オーバーシュート
  "ease-in-back": [0.36, 0, 0.66, -0.56], // 溜め
  smooth: [0.4, 0, 0.2, 1], // Material standard
  snap: [0.7, 0, 0.1, 1],
  "emphasized-decel": [0.05, 0.7, 0.1, 1], // M3 emphasized decelerate — 入場・到着
  "emphasized-accel": [0.3, 0, 0.8, 0.15], // M3 emphasized accelerate — 退場・離脱
};

// ElasticInterpolator.easingValue: Easing::easeIn=0 / easeOut=1 / easeInOut=2 (rive-runtime)
export const ELASTIC_EASING_VALUE: Record<string, number> = {
  "elastic-in": 0,
  "elastic-out": 1,
  "elastic-in-out": 2,
};
function elasticKey(easing: string, amplitude: number, period: number): string {
  return `${easing}:${amplitude}:${period}`;
}

const LOOP_VALUES = { oneShot: 0, loop: 1, pingPong: 2 } as const;

// rive-runtime include/rive/animation/transition_condition_op.hpp
const CONDITION_OPS = { "==": 0, "!=": 1, "<=": 2, ">=": 3, "<": 4, ">": 5 } as const;
// rive-runtime include/rive/listener_type.hpp
const LISTENER_TYPES = { enter: 0, exit: 1, down: 2, up: 3, move: 4, click: 6 } as const;
// テキスト整列（Text alignValue）
const TEXT_ALIGN = { left: 0, right: 1, center: 2 } as const;

// ---- ビルダー: SceneSpec → WriterObject[] ---------------------------------
export function buildScene(spec: SceneSpec): { objects: WriterObject[]; warnings: string[] } {
  const warnings: string[] = [];
  const objects: WriterObject[] = [{ type: "Backboard", props: {} }];

  // アートボード一覧に正規化（従来の単一形式をサポート）
  const artboards: ArtboardSpec[] = spec.artboards ?? [
    {
      name: spec.artboard?.name,
      width: spec.artboard?.width ?? 400,
      height: spec.artboard?.height ?? 300,
      backgroundColor: spec.backgroundColor,
      groups: spec.groups,
      bones: spec.bones,
      constraints: spec.constraints,
      shapes: spec.shapes,
      images: spec.images,
      texts: spec.texts,
      nested: spec.nested,
      events: spec.events,
      animations: spec.animations,
      stateMachine: spec.stateMachine,
    },
  ];
  const artboardIndexByName = new Map<string, number>();
  artboards.forEach((ab, i) => artboardIndexByName.set(ab.name ?? `Artboard ${i + 1}`, i));

  // ---- アセット（フォント → 画像の順。assetId/fontAssetId = 出現順） -------
  const assetIndexOf = new Map<string, number>(); // "font:<id>" / "image:<id>" → index
  for (const font of spec.fonts ?? []) {
    if (!font.bytes) throw new Error(`Font '${font.id}' has no bytes (path unresolved?)`);
    assetIndexOf.set(`font:${font.id}`, assetIndexOf.size);
    objects.push({ type: "FontAsset", props: { name: font.id } });
    objects.push({ type: "FileAssetContents", props: { bytes: font.bytes } });
  }
  for (const ab of artboards) {
    for (const img of ab.images ?? []) {
      if (!img.bytes) throw new Error(`Image '${img.id}' has no bytes (pngPath unresolved?)`);
      const dims = pngSize(img.bytes);
      assetIndexOf.set(`image:${img.id}`, assetIndexOf.size);
      objects.push({ type: "ImageAsset", props: { name: img.id, width: dims.width, height: dims.height } });
      objects.push({ type: "FileAssetContents", props: { bytes: img.bytes } });
    }
  }

  // ---- 各アートボードを出力 -------------------------------------------------
  for (const ab of artboards) {
    emitArtboard(ab);
  }
  return { objects, warnings };

  function emitArtboard(ab: ArtboardSpec): void {
    let localIndex = 0;
    const push = (obj: WriterObject): number => {
      objects.push(obj);
      return ++localIndex;
    };
    objects.push({
      type: "Artboard",
      props: { name: ab.name ?? "Artboard", width: ab.width, height: ab.height },
    });

    // グループ（ボーン親のものはボーン定義後に遅延emit）
    const groupIds = new Map<string, number>();
    const boneIds = new Map<string, number>();
    const worldOf = new Map<string, Mat>();
    const emitGroup = (g: GroupSpec): void => {
      let parentLocal = 0;
      let parentWorld = matIdentity;
      if (g.parent !== undefined) {
        const pid = groupIds.get(g.parent) ?? boneIds.get(g.parent);
        if (pid === undefined) {
          throw new Error(`Group '${g.id}' parent '${g.parent}' not found (define groups/bones before use)`);
        }
        parentLocal = pid;
        parentWorld = worldOf.get(g.parent)!;
      }
      const props: Record<string, unknown> = { name: g.id, parentId: parentLocal, x: g.x, y: g.y };
      if (g.rotation) props.rotation = (g.rotation * Math.PI) / 180;
      if (g.opacity !== undefined) props.opacity = g.opacity;
      worldOf.set(g.id, matMul(parentWorld, matTRS(g.x, g.y, ((g.rotation ?? 0) * Math.PI) / 180)));
      groupIds.set(g.id, push({ type: "Node", props }));
    };
    const boneNames = new Set((ab.bones ?? []).map((b) => b.id));
    const deferredGroups: GroupSpec[] = [];
    for (const g of ab.groups ?? []) {
      if (
        g.parent !== undefined &&
        (boneNames.has(g.parent) || deferredGroups.some((d) => d.id === g.parent))
      ) {
        deferredGroups.push(g);
      } else {
        emitGroup(g);
      }
    }

    // ボーン
    const boneLength = new Map<string, number>();
    for (const b of ab.bones ?? []) {
      const rotRad = ((b.rotation ?? 0) * Math.PI) / 180;
      if (boneIds.has(b.parent)) {
        const props: Record<string, unknown> = { name: b.id, parentId: boneIds.get(b.parent)!, length: b.length };
        if (b.rotation) props.rotation = rotRad;
        const parentWorld = worldOf.get(b.parent)!;
        worldOf.set(b.id, matMul(parentWorld, matMul(matTRS(boneLength.get(b.parent)!, 0, 0), matTRS(0, 0, rotRad))));
        boneIds.set(b.id, push({ type: "Bone", props }));
      } else {
        const parentGroup = groupIds.get(b.parent);
        if (parentGroup === undefined) throw new Error(`Bone '${b.id}' parent group '${b.parent}' not found`);
        const props: Record<string, unknown> = {
          name: b.id, parentId: parentGroup, x: b.x ?? 0, y: b.y ?? 0, length: b.length,
        };
        if (b.rotation) props.rotation = rotRad;
        const parentWorld = worldOf.get(b.parent)!;
        worldOf.set(b.id, matMul(parentWorld, matTRS(b.x ?? 0, b.y ?? 0, rotRad)));
        boneIds.set(b.id, push({ type: "RootBone", props }));
      }
      boneLength.set(b.id, b.length);
    }
    for (const g of deferredGroups) emitGroup(g);

    // コンストレイント（IK）
    for (const c of ab.constraints ?? []) {
      if (c.type !== "ik") throw new Error(`Unsupported constraint type '${c.type}'`);
      const bone = boneIds.get(c.bone);
      if (bone === undefined) throw new Error(`IK bone '${c.bone}' not found`);
      const target = groupIds.get(c.target);
      if (target === undefined) throw new Error(`IK target group '${c.target}' not found`);
      const props: Record<string, unknown> = {
        parentId: bone,
        targetId: target,
        parentBoneCount: c.parentBoneCount ?? 1,
      };
      if (c.invertDirection) props.invertDirection = true;
      if (c.strength !== undefined) props.strength = c.strength;
      push({ type: "IKConstraint", props });
    }

    const parentOf = (parent?: string): number => {
      if (parent === undefined) return 0;
      const pid = groupIds.get(parent) ?? boneIds.get(parent);
      if (pid === undefined) {
        throw new Error(`Parent '${parent}' not found. Groups: ${[...groupIds.keys()].join(", ") || "-"} / Bones: ${[...boneIds.keys()].join(", ") || "-"}`);
      }
      return pid;
    };

    const shapeIds = new Map<string, number>();
    const fillColorIds = new Map<string, number>();
    const imageIds = new Map<string, number>();
    const textIds = new Map<string, number>();
    const nestedIds = new Map<string, number>();
    const eventIds = new Map<string, number>();
    const vertexIds = new Map<string, number>();

    const emitImage = (img: ImageSpec): void => {
      const imgProps: Record<string, unknown> = {
        name: img.id,
        parentId: parentOf(img.parent),
        x: img.x,
        y: img.y,
        assetId: assetIndexOf.get(`image:${img.id}`),
      };
      if (img.scale !== undefined) {
        imgProps.scaleX = img.scale;
        imgProps.scaleY = img.scale;
      }
      if (img.rotation) imgProps.rotation = (img.rotation * Math.PI) / 180;
      if (img.opacity !== undefined) imgProps.opacity = img.opacity;
      const image = push({ type: "Image", props: imgProps });
      imageIds.set(img.id, image);

      if (img.mesh) {
        const dims = pngSize(img.bytes!);
        const cols = img.mesh.columns ?? 6;
        const rows = img.mesh.rows ?? 6;
        const tris: number[] = [];
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const tl = r * (cols + 1) + c;
            const tr = tl + 1;
            const bl = tl + (cols + 1);
            const br = bl + 1;
            tris.push(tl, bl, tr, tr, bl, br);
          }
        }
        const triBytes = new Uint8Array(tris.length * 2);
        const dv = new DataView(triBytes.buffer);
        tris.forEach((t, i) => dv.setUint16(i * 2, t, true));
        const mesh = push({ type: "Mesh", props: { parentId: image, triangleIndexBytes: triBytes } });

        const skinBones = img.mesh.bones ?? [];
        let imageWorld: Mat | null = null;
        if (skinBones.length > 0) {
          const parentWorld = img.parent !== undefined ? worldOf.get(img.parent) ?? matIdentity : matIdentity;
          imageWorld = matMul(
            parentWorld,
            matTRS(img.x, img.y, ((img.rotation ?? 0) * Math.PI) / 180, img.scale ?? 1, img.scale ?? 1)
          );
          for (const bid of skinBones) {
            if (!boneIds.has(bid)) throw new Error(`Skin bone '${bid}' not found. Bones: ${[...boneIds.keys()].join(", ")}`);
          }
        }
        // 距離ベース自動ウェイト（最寄り2ボーン、4乗減衰、byteパック、tendonは1-based）
        const weightFor = (lx: number, ly: number): { values: number; indices: number } => {
          const p = matApply(imageWorld!, lx, ly);
          const dists = skinBones.map((bid, i) => {
            const w = worldOf.get(bid)!;
            const o = matApply(w, 0, 0);
            const t = matApply(w, boneLength.get(bid)!, 0);
            const dx = t.x - o.x, dy = t.y - o.y;
            const len2 = dx * dx + dy * dy || 1;
            const s = Math.max(0, Math.min(1, ((p.x - o.x) * dx + (p.y - o.y) * dy) / len2));
            const qx = o.x + s * dx - p.x, qy = o.y + s * dy - p.y;
            return { i, d: Math.hypot(qx, qy) };
          }).sort((a, b) => a.d - b.d);
          if (dists.length === 1) return { values: 255, indices: dists[0].i + 1 };
          const [a, b] = dists;
          const wa = 1 / Math.pow(a.d + 1, 4), wb = 1 / Math.pow(b.d + 1, 4);
          const va = Math.round((255 * wa) / (wa + wb));
          return {
            values: (va & 0xff) | ((255 - va) << 8),
            indices: (a.i + 1) | ((b.i + 1) << 8),
          };
        };

        for (let r = 0; r <= rows; r++) {
          for (let c = 0; c <= cols; c++) {
            const u = c / cols;
            const v = r / rows;
            const lx = (u - 0.5) * dims.width;
            const ly = (v - 0.5) * dims.height;
            const id = push({ type: "MeshVertex", props: { parentId: mesh, x: lx, y: ly, u, v } });
            vertexIds.set(`${img.id}#v${r}_${c}`, id);
            if (skinBones.length > 0) {
              const wv = weightFor(lx, ly);
              push({ type: "Weight", props: { parentId: id, values: wv.values, indices: wv.indices } });
            }
          }
        }
        if (skinBones.length > 0 && imageWorld) {
          // Rive行列プロパティは列ベクトル命名（xx,xy=第1列）— 内部Matとxy↔yxを入れ替えて書く
          const skin = push({
            type: "Skin",
            props: {
              parentId: mesh,
              xx: imageWorld.xx, xy: imageWorld.yx, yx: imageWorld.xy,
              yy: imageWorld.yy, tx: imageWorld.tx, ty: imageWorld.ty,
            },
          });
          for (const bid of skinBones) {
            const w = worldOf.get(bid)!;
            push({
              type: "Tendon",
              props: {
                parentId: skin, boneId: boneIds.get(bid)!,
                xx: w.xx, xy: w.yx, yx: w.xy, yy: w.yy, tx: w.tx, ty: w.ty,
              },
            });
          }
        }
      }
    };

    const emitShape = (s: ShapeSpec): void => {
      const shapeProps: Record<string, unknown> = { name: s.id, parentId: parentOf(s.parent), x: s.x, y: s.y };
      if (s.rotation) shapeProps.rotation = (s.rotation * Math.PI) / 180;
      if (s.opacity !== undefined) shapeProps.opacity = s.opacity;
      const shape = push({ type: "Shape", props: shapeProps });
      shapeIds.set(s.id, shape);

      if (s.type === "polygon") {
        if (!s.points || s.points.length < 3) throw new Error(`polygon '${s.id}' needs >=3 points`);
        const path = push({ type: "PointsPath", props: { parentId: shape, isClosed: true } });
        for (const p of s.points) {
          if (p.cubic) {
            const rotation = (p.cubic.rotation * Math.PI) / 180;
            const inDistance = p.cubic.inDistance ?? p.cubic.distance ?? 0;
            const outDistance = p.cubic.outDistance ?? p.cubic.distance ?? 0;
            if (inDistance === outDistance) {
              push({
                type: "CubicMirroredVertex",
                props: { parentId: path, x: p.x, y: p.y, rotation, distance: inDistance },
              });
            } else {
              push({
                type: "CubicAsymmetricVertex",
                props: { parentId: path, x: p.x, y: p.y, rotation, inDistance, outDistance },
              });
            }
          } else {
            push({
              type: "StraightVertex",
              props: { parentId: path, x: p.x, y: p.y, ...(p.radius ? { radius: p.radius } : {}) },
            });
          }
        }
      } else {
        const typeName = s.type === "rect" ? "Rectangle" : s.type === "ellipse" ? "Ellipse" : "Triangle";
        const props: Record<string, unknown> = {
          parentId: shape,
          width: s.width ?? 100,
          height: s.height ?? 100,
        };
        if (s.type === "rect" && s.cornerRadius) {
          props.linkCornerRadius = true;
          props.cornerRadiusTL = s.cornerRadius;
        }
        push({ type: typeName, props });
      }

      const emitFeather = (paintId: number, f: FeatherSpec): void => {
        push({
          type: "Feather",
          props: {
            parentId: paintId,
            strength: f.strength ?? 12,
            ...(f.offsetX ? { offsetX: f.offsetX } : {}),
            ...(f.offsetY ? { offsetY: f.offsetY } : {}),
            ...(f.inner ? { inner: f.inner } : {}),
          },
        });
      };

      if (s.fill) {
        const fill = push({ type: "Fill", props: { parentId: shape } });
        if (s.fill.feather) emitFeather(fill, s.fill.feather);
        if (s.fill.gradient) {
          const g = s.fill.gradient;
          const w2 = (s.width ?? 100) / 2;
          const h2 = (s.height ?? 100) / 2;
          const grad = push({
            type: g.type === "radial" ? "RadialGradient" : "LinearGradient",
            props: {
              parentId: fill,
              startX: g.start?.x ?? -w2,
              startY: g.start?.y ?? -h2,
              endX: g.end?.x ?? w2,
              endY: g.end?.y ?? h2,
            },
          });
          g.stops.forEach((stop, i) => {
            push({
              type: "GradientStop",
              props: {
                parentId: grad,
                colorValue: parseColor(stop.color),
                position: stop.position ?? i / Math.max(1, g.stops.length - 1),
              },
            });
          });
        } else {
          const sc = push({
            type: "SolidColor",
            props: { parentId: fill, colorValue: parseColor(s.fill.color ?? "#888888") },
          });
          fillColorIds.set(s.id, sc);
        }
      }

      if (s.stroke) {
        const stroke = push({ type: "Stroke", props: { parentId: shape, thickness: s.stroke.thickness } });
        if (s.stroke.feather) emitFeather(stroke, s.stroke.feather);
        push({ type: "SolidColor", props: { parentId: stroke, colorValue: parseColor(s.stroke.color) } });
      }
    };

    const emitText = (t: TextSpec): void => {
      const props: Record<string, unknown> = {
        name: t.id,
        parentId: parentOf(t.parent),
        x: t.x,
        y: t.y,
        alignValue: TEXT_ALIGN[t.align ?? "left"],
      };
      if (t.width !== undefined) {
        props.sizingValue = 1; // 固定サイズ
        props.width = t.width;
        props.height = t.height ?? 100;
      }
      const text = push({ type: "Text", props });
      textIds.set(t.id, text);
      // ラン毎にスタイルを作成（fontSize/color/font の組でデデュープ）
      const styleIds = new Map<string, number>();
      const styleOf = (run: TextRunSpec): number => {
        const fontId = run.font ?? spec.fonts?.[0]?.id;
        if (fontId === undefined) throw new Error(`Text '${t.id}' needs fonts[] at scene level`);
        const fontIndex = assetIndexOf.get(`font:${fontId}`);
        if (fontIndex === undefined) throw new Error(`Font '${fontId}' not found in fonts[]`);
        const key = `${fontId}|${run.fontSize ?? 32}|${run.color ?? "#000000"}`;
        let sid = styleIds.get(key);
        if (sid === undefined) {
          sid = push({
            type: "TextStylePaint",
            props: { parentId: text, fontSize: run.fontSize ?? 32, fontAssetId: fontIndex },
          });
          const fill = push({ type: "Fill", props: { parentId: sid } });
          push({ type: "SolidColor", props: { parentId: fill, colorValue: parseColor(run.color ?? "#000000") } });
          styleIds.set(key, sid);
        }
        return sid;
      };
      for (const run of t.runs) {
        const rp: Record<string, unknown> = { parentId: text, styleId: styleOf(run), text: run.text };
        if (run.name) rp.name = run.name;
        push({ type: "TextValueRun", props: rp });
      }
    };

    const emitNested = (n: NestedSpec): void => {
      const targetIndex = artboardIndexByName.get(n.artboard);
      if (targetIndex === undefined) {
        throw new Error(`Nested artboard '${n.artboard}' not found. Artboards: ${[...artboardIndexByName.keys()].join(", ")}`);
      }
      const na = push({
        type: "NestedArtboard",
        props: { name: n.id, parentId: parentOf(n.parent), x: n.x, y: n.y, artboardId: targetIndex },
      });
      nestedIds.set(n.id, na);
      // 対象アートボードのSMをマウントし、入力を自動公開
      const targetAb = artboards[targetIndex];
      const sms = normalizeSMs(targetAb.stateMachine);
      if (sms.length > 0) {
        const smIndex = n.stateMachine ? sms.findIndex((s) => s.name === n.stateMachine) : 0;
        if (smIndex < 0) throw new Error(`Nested SM '${n.stateMachine}' not found in artboard '${n.artboard}'`);
        const nsm = push({ type: "NestedStateMachine", props: { parentId: na, animationId: smIndex } });
        (sms[smIndex].inputs ?? []).forEach((inp, i) => {
          const typeName = inp.type === "bool" ? "NestedBool" : inp.type === "number" ? "NestedNumber" : "NestedTrigger";
          push({ type: typeName, props: { name: inp.name, parentId: nsm, inputId: i } });
        });
      }
    };

    // 統一z順で描画（大きいzが前面 = 先に書く）
    const drawables: Array<{ z: number; emit: () => void }> = [
      ...(ab.shapes ?? []).map((s, i) => ({ z: s.z ?? i, emit: () => emitShape(s) })),
      ...(ab.images ?? []).map((img, i) => ({ z: img.z ?? 1000 + i, emit: () => emitImage(img) })),
      ...(ab.texts ?? []).map((t, i) => ({ z: t.z ?? 2000 + i, emit: () => emitText(t) })),
      ...(ab.nested ?? []).map((n, i) => ({ z: n.z ?? 3000 + i, emit: () => emitNested(n) })),
    ];
    drawables.sort((a, b) => b.z - a.z);
    for (const d of drawables) d.emit();

    // 背景（最後 = 最背面）
    if (ab.backgroundColor) {
      const bg = push({
        type: "Shape",
        props: { name: "__background", parentId: 0, x: ab.width / 2, y: ab.height / 2 },
      });
      push({ type: "Rectangle", props: { parentId: bg, width: ab.width, height: ab.height } });
      const fill = push({ type: "Fill", props: { parentId: bg } });
      push({ type: "SolidColor", props: { parentId: fill, colorValue: parseColor(ab.backgroundColor) } });
    }

    // イベント
    for (const ev of ab.events ?? []) {
      if (ev.type === "openUrl") {
        eventIds.set(ev.id, push({ type: "OpenUrlEvent", props: { name: ev.id, parentId: 0, url: ev.url ?? "" } }));
      } else {
        eventIds.set(ev.id, push({ type: "Event", props: { name: ev.id, parentId: 0 } }));
      }
    }

    // イージング用インターポレータ
    const interpolatorIds = new Map<string, number>();
    const neededEasings = new Set<string>();
    const neededElastics = new Map<string, { easing: string; amplitude: number; period: number }>();
    for (const a of ab.animations ?? []) {
      for (const t of a.tracks) {
        for (const k of t.keyframes) {
          if (!k.easing) continue;
          if (EASING_BEZIER[k.easing]) {
            neededEasings.add(k.easing);
          } else if (k.easing in ELASTIC_EASING_VALUE) {
            const amplitude = k.amplitude ?? 1;
            const period = k.period ?? 0.5;
            neededElastics.set(elasticKey(k.easing, amplitude, period), { easing: k.easing, amplitude, period });
          }
        }
      }
    }
    for (const name of neededEasings) {
      const [x1, y1, x2, y2] = EASING_BEZIER[name]!;
      interpolatorIds.set(name, push({ type: "CubicEaseInterpolator", props: { x1, y1, x2, y2 } }));
    }
    for (const [key, p] of neededElastics) {
      interpolatorIds.set(
        key,
        push({
          type: "ElasticInterpolator",
          props: { easingValue: ELASTIC_EASING_VALUE[p.easing], amplitude: p.amplitude, period: p.period },
        })
      );
    }

    // アニメーション
    const PROP_KEYS: Record<string, { type: string; prop: string }> = {
      x: { type: "Node", prop: "x" },
      y: { type: "Node", prop: "y" },
      rotation: { type: "TransformComponent", prop: "rotation" },
      scaleX: { type: "TransformComponent", prop: "scaleX" },
      scaleY: { type: "TransformComponent", prop: "scaleY" },
      opacity: { type: "WorldTransformComponent", prop: "opacity" },
      width: { type: "LayoutComponent", prop: "width" },
      height: { type: "LayoutComponent", prop: "height" },
      fillColor: { type: "SolidColor", prop: "colorValue" },
    };
    const animationNames: string[] = [];
    for (const a of ab.animations ?? []) {
      animationNames.push(a.name);
      push({
        type: "LinearAnimation",
        props: {
          name: a.name,
          fps: a.fps ?? 60,
          duration: a.duration,
          loopValue: LOOP_VALUES[a.loop ?? "loop"],
        },
      });
      for (const t of a.tracks) {
        const isColor = t.property === "fillColor";
        const isVertex = t.target.includes("#v");
        let targetId: number | undefined;
        let propRef: { type: string; prop: string } | undefined;
        if (isColor) {
          targetId = fillColorIds.get(t.target);
          if (targetId === undefined) {
            throw new Error(`Track target '${t.target}' has no solid fill (gradient fills can't be color-keyed)`);
          }
          propRef = PROP_KEYS.fillColor;
        } else if (isVertex) {
          targetId = vertexIds.get(t.target);
          if (targetId === undefined) {
            throw new Error(`Mesh vertex '${t.target}' not found (format: <imageId>#v<row>_<col>)`);
          }
          if (t.property !== "x" && t.property !== "y") {
            throw new Error(`Mesh vertices only support x/y tracks, got '${t.property}'`);
          }
          propRef = { type: "Vertex", prop: t.property };
        } else {
          targetId =
            shapeIds.get(t.target) ?? imageIds.get(t.target) ?? groupIds.get(t.target) ??
            boneIds.get(t.target) ?? textIds.get(t.target) ?? nestedIds.get(t.target);
          if (targetId === undefined) {
            throw new Error(
              `Track target '${t.target}' not found. Available: ${[...shapeIds.keys(), ...imageIds.keys(), ...groupIds.keys(), ...boneIds.keys(), ...textIds.keys(), ...nestedIds.keys()].join(", ")}`
            );
          }
          propRef = PROP_KEYS[t.property];
          if (!propRef) throw new Error(`Unsupported property '${t.property}'`);
        }
        push({ type: "KeyedObject", props: { objectId: targetId } });
        push({ type: "KeyedProperty", props: { propertyKey: resolveProp(propRef.type, propRef.prop).key } });
        t.keyframes.forEach((k, i) => {
          // rive-runtime の仕様: KeyFrame の interpolationType/interpolatorId は
          // 「このフレームから次のフレームへ向かう区間」の補間に使われる（このフレーム自身への
          // 到達には使われない）。シーン仕様では「このキーフレームへ向かう動き」に easing を
          // 書く方が直感的なので、次要素の easing をこのフレームへシフトして書き込む。
          const next = t.keyframes[i + 1];
          const easing = next?.easing ?? "linear";
          const interpolationType = easing === "hold" ? 0 : easing === "linear" ? 1 : 2;
          const kfProps: Record<string, unknown> = { interpolationType };
          if (k.frame) kfProps.frame = k.frame;
          if (interpolationType === 2) {
            const idKey =
              easing in ELASTIC_EASING_VALUE
                ? elasticKey(easing, next!.amplitude ?? 1, next!.period ?? 0.5)
                : easing;
            kfProps.interpolatorId = interpolatorIds.get(idKey);
          }
          if (isColor) {
            if (k.color === undefined) throw new Error(`fillColor keyframe needs 'color'`);
            push({ type: "KeyFrameColor", props: { ...kfProps, value: parseColor(k.color) } });
          } else {
            let v = k.value ?? 0;
            if (t.property === "rotation") v = (v * Math.PI) / 180;
            push({ type: "KeyFrameDouble", props: { ...kfProps, value: v } });
          }
        });
      }
    }

    // ステートマシン（複数対応）
    for (const sm of normalizeSMs(ab.stateMachine)) {
      push({ type: "StateMachine", props: { name: sm.name } });
      const inputIds = new Map<string, number>();
      (sm.inputs ?? []).forEach((inp, i) => {
        inputIds.set(inp.name, i);
        const typeName =
          inp.type === "bool" ? "StateMachineBool" : inp.type === "number" ? "StateMachineNumber" : "StateMachineTrigger";
        const props: Record<string, unknown> = { name: inp.name };
        if (inp.type === "bool" && inp.initial !== undefined) props.value = !!inp.initial;
        if (inp.type === "number" && inp.initial !== undefined) props.value = Number(inp.initial);
        push({ type: typeName, props });
      });

      const layers: SMLayerSpec[] =
        sm.layers ?? [{ name: "Layer 1", states: sm.states ?? [], transitions: sm.transitions ?? [] }];
      for (const [li, layer] of layers.entries()) {
        push({ type: "StateMachineLayer", props: { name: layer.name ?? `Layer ${li + 1}` } });
        const stateIds = new Map<string, number>([["entry", 0], ["any", 1], ["exit", 2]]);
        layer.states.forEach((st, i) => stateIds.set(st.name, 3 + i));

        const emitTransitions = (from: string) => {
          for (const tr of layer.transitions.filter((t) => t.from === from)) {
            const toId = stateIds.get(tr.to);
            if (toId === undefined) throw new Error(`Transition target '${tr.to}' not found in layer`);
            const props: Record<string, unknown> = { stateToId: toId };
            if (tr.durationMs) props.duration = tr.durationMs;
            if (tr.exitTimeMs !== undefined) {
              props.exitTime = tr.exitTimeMs;
              props.flags = 4;
            }
            push({ type: "StateTransition", props });
            if (tr.condition) {
              const inputId = inputIds.get(tr.condition.input);
              if (inputId === undefined) throw new Error(`Condition input '${tr.condition.input}' not found`);
              const inputType = (sm.inputs ?? [])[inputId].type;
              if (inputType === "trigger") {
                push({ type: "TransitionTriggerCondition", props: { inputId } });
              } else if (inputType === "bool") {
                push({
                  type: "TransitionBoolCondition",
                  props: { inputId, opValue: CONDITION_OPS[tr.condition.op ?? "=="] },
                });
              } else {
                push({
                  type: "TransitionNumberCondition",
                  props: {
                    inputId,
                    opValue: CONDITION_OPS[tr.condition.op ?? "=="],
                    value: Number(tr.condition.value ?? 0),
                  },
                });
              }
            }
          }
        };
        const emitState = (st: SMStateSpec) => {
          if (st.blend1d) {
            const inputId = inputIds.get(st.blend1d.input);
            if (inputId === undefined) throw new Error(`Blend input '${st.blend1d.input}' not found`);
            push({ type: "BlendState1DInput", props: { inputId } });
            for (const ba of st.blend1d.animations) {
              const animationId = animationNames.indexOf(ba.animation);
              if (animationId < 0) throw new Error(`Blend animation '${ba.animation}' not found`);
              push({ type: "BlendAnimation1D", props: { animationId, value: ba.value } });
            }
          } else {
            const animationId = animationNames.indexOf(st.animation ?? "");
            if (animationId < 0) throw new Error(`State '${st.name}' references unknown animation '${st.animation}'`);
            push({ type: "AnimationState", props: { animationId } });
          }
          if (st.fireEvent) {
            const eventId = eventIds.get(st.fireEvent);
            if (eventId === undefined) throw new Error(`fireEvent '${st.fireEvent}' not found in events[]`);
            push({ type: "StateMachineFireEvent", props: { eventId } });
          }
        };

        push({ type: "EntryState", props: {} });
        emitTransitions("entry");
        push({ type: "AnyState", props: {} });
        emitTransitions("any");
        push({ type: "ExitState", props: {} });
        for (const st of layer.states) {
          emitState(st);
          emitTransitions(st.name);
        }
      }

      // リスナー（全レイヤーの後）
      for (const ls of sm.listeners ?? []) {
        const targetId =
          shapeIds.get(ls.target) ?? imageIds.get(ls.target) ?? groupIds.get(ls.target) ??
          textIds.get(ls.target) ?? nestedIds.get(ls.target);
        if (targetId === undefined) throw new Error(`Listener target '${ls.target}' not found`);
        push({
          type: "StateMachineListenerSingle",
          props: { name: ls.target, targetId, listenerTypeValue: LISTENER_TYPES[ls.type ?? "click"] },
        });
        for (const act of ls.actions) {
          const inputId = inputIds.get(act.input);
          if (inputId === undefined) throw new Error(`Listener action input '${act.input}' not found`);
          const inputType = (sm.inputs ?? [])[inputId].type;
          if (inputType === "trigger") {
            push({ type: "ListenerTriggerChange", props: { inputId } });
          } else if (inputType === "bool") {
            // value: 0=false, 1=true, 2=トグル
            const v = act.value === "toggle" ? 2 : act.value ? 1 : 0;
            push({ type: "ListenerBoolChange", props: { inputId, value: v } });
          } else {
            push({ type: "ListenerNumberChange", props: { inputId, value: Number(act.value ?? 0) } });
          }
        }
      }
    }
  }
}

function normalizeSMs(sm: StateMachineSpec | StateMachineSpec[] | undefined): StateMachineSpec[] {
  if (!sm) return [];
  return Array.isArray(sm) ? sm : [sm];
}

export function createRiv(spec: SceneSpec): { bytes: Uint8Array; warnings: string[] } {
  // HLAPI（bake/particles）を先に展開
  expandHlapi(spec);
  const { objects, warnings } = buildScene(spec);
  return { bytes: writeRiv(objects), warnings };
}
