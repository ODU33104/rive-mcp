// 検出済みの UI 要素 + 役割から、動くプロトタイプのシーン仕様を組み立てる。
import type { UiElement } from "./uiDetect.js";
import type {
  SceneSpec, ShapeSpec, ImageSpec, GroupSpec, AnimationSpec, TrackSpec, StateMachineSpec,
} from "./rivWriter.js";
import type { PresetSpec, PresetName } from "./motionPresets.js";

export type Role =
  | "background" | "nav" | "header" | "card" | "panel" | "button"
  | "text" | "icon" | "image" | "chart" | "list-item" | "badge"
  | "divider" | "avatar" | "input" | "fab";

export interface RoleMotion {
  entrance: string;
  idle?: string;
  hover?: "lift" | "grow" | "tint" | "spin";
  press?: boolean;
}

/**
 * entrance / idle には motionPresets.ts の PRESET_NAMES に実在する名前だけを書く。
 * 存在しない名前は展開時に黙って無視され、「動かない .riv」ができる。
 * 例外は "chart-grow"（Task 6 でこのファイルが自前で組む合成モーション）。
 *
 * idle は常時ループする「待機中の動き」の枠なので、AMBIENT_PRESETS に
 * 属する名前だけを書く。heartbeat/attention 等のワンショット強調系を
 * 書くと一度動いて止まり、それ以降は静止したプロトタイプになる。
 */
export const ROLE_MOTION: Record<Role, RoleMotion> = {
  background:  { entrance: "fade-in" },
  nav:         { entrance: "slide-in" },
  header:      { entrance: "slide-in" },
  card:        { entrance: "pop-cascade", idle: "float", hover: "lift" },
  panel:       { entrance: "stagger-in", idle: "float" },
  button:      { entrance: "swoop-in", hover: "grow", press: true },
  fab:         { entrance: "swoop-in", idle: "breathing", hover: "grow", press: true },
  text:        { entrance: "fade-in" },
  icon:        { entrance: "pop-cascade", hover: "spin" },
  image:       { entrance: "fade-in" },
  chart:       { entrance: "chart-grow" },
  "list-item": { entrance: "stagger-in", hover: "tint" },
  badge:       { entrance: "pop-cascade", idle: "glow-pulse" },
  divider:     { entrance: "fade-in" },
  avatar:      { entrance: "pop-cascade", hover: "spin" },
  input:       { entrance: "fade-in", hover: "tint" },
};

export function motionFor(role: string): RoleMotion {
  return ROLE_MOTION[role as Role] ?? ROLE_MOTION.panel;
}

/** 要素をどこまで動かしてよいか。 */
export type MotionCapability = "free" | "fade-only" | "merge";

/** 位置を動かさない入場。fade-only の要素はこれだけを使う。 */
export const FADE_ONLY_ENTRANCE = "fade-in";

// 信頼度がこれ未満、かつ小さい要素は、独立した要素として出さずに背景へ残す。
// 「動かさない」だけでは、要素として存在する以上いつか誰かが動かす。
const MERGE_CONFIDENCE_MAX = 0.05;
const MERGE_AREA_MAX_PX = 1200;

/**
 * **矩形で切り出したラスタは背景が焼き付いている。**
 * このプロトタイプでは最下層に元画像そのものが残るので、焼き付いた切り出しを
 * 動かすと元の位置にも同じ絵が見えたまま二重になる。静止していれば完全に一致するので、
 * 再構成誤差では原理的に検出できない（だから信頼度で守るしかない）。
 *
 * alpha matte が付いている要素だけは、背景が透明なので自由に動かしてよい。
 *
 * 判定は semanticHint ではなく **matteEligible** を見る。写真が「テキスト行」として
 * 誤検出されることがあり、意味のラベルは信用できない（pageScript.ts の matte 推定を参照）。
 */
export function motionCapabilityOf(el: {
  renderMode: string;
  matteEligible?: boolean;
  matteConfidence?: number;
  rect: [number, number, number, number];
}): MotionCapability {
  // ベクター図形は塗りで再構成されるので焼き付きが無い。制限しない。
  if (el.renderMode !== "raster") return "free";
  if (el.matteEligible) return "free";
  const area = el.rect[2] * el.rect[3];
  if ((el.matteConfidence ?? 0) < MERGE_CONFIDENCE_MAX && area <= MERGE_AREA_MAX_PX) return "merge";
  return "fade-only";
}

// ---- Task 6: シーン組み立て ------------------------------------------------

export interface PrototypeElement extends UiElement {
  role: string;
  name?: string;
}

export interface PrototypeInput {
  elements: PrototypeElement[];
  source: { width: number; height: number };
  interactions: boolean;
  motion: { entranceMs?: number; stagger?: number; ambient?: boolean };
}

type AnimWithPresets = AnimationSpec & { presets?: PresetSpec[] };

const FPS = 60;

// buildPresetTracks(motionPresets.ts) は各プリセットの所要時間ぶん
// fit(at+秒数) が anim.duration を超えると例外を投げる。entrance 側の
// duration をここで先読みして安全マージンを取らないと、entranceMs が
// 短い/要素が多いケースで createRiv がそのまま落ちる
const ENTRANCE_PRESET_SEC: Record<string, number> = {
  "fade-in": 0.3, "rise-in": 0.45, "drop-in": 0.5, "slide-in": 0.4,
  "pop-in": 0.6, "bounce-in": 0.65, "stagger-in": 0.56, "swoop-in": 0.6,
  "pop-cascade": 0.62,
};

function clampRect(
  rect: [number, number, number, number], w: number, h: number
): [number, number, number, number] {
  const [x, y, rw, rh] = rect;
  const nx = Math.max(0, Math.min(x, w));
  const ny = Math.max(0, Math.min(y, h));
  const nw = Math.max(0, Math.min(rw - (nx - x), w - nx));
  const nh = Math.max(0, Math.min(rh - (ny - y), h - ny));
  return [nx, ny, nw, nh];
}

function polygonOf(rect: [number, number, number, number]): Array<[number, number]> {
  const [x, y, w, h] = rect;
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

export function buildPrototypeScene(input: PrototypeInput): {
  spec: SceneSpec;
  rasterRegions: Array<{ name: string; polygon: Array<[number, number]>; matte?: { fg: string; bg: string; space: "srgb" | "linear" } }>;
  warnings: string[];
} {
  const warnings: string[] = [];
  const { width: srcW, height: srcH } = input.source;
  const byId = new Map(input.elements.map((e) => [e.id, e]));

  // 1) はみ出し矩形をクランプ（黙って直さず、必ず警告に積む）
  const clamped = new Map<number, [number, number, number, number]>();
  for (const el of input.elements) {
    const before = el.rect;
    const after = clampRect(before, srcW, srcH);
    clamped.set(el.id, after);
    if (after.some((v, i) => v !== before[i])) {
      warnings.push(`element ${el.id}: rect clamped to image bounds (${before.join(",")} -> ${after.join(",")})`);
    }
  }

  // 2) z順: ルートから深さ優先(pre-order)で振る。祖先は常に子孫より小さいzになるので、
  // 「panel を塗りつぶしても子は前面に残る」「テキスト画像はボタン矩形の上に乗る」が
  // ツリーの深さに関係なく成り立つ。z空間は shapes/images 共通(rivWriter.ts の既定値:
  // images=1000+ が shapes より常に前面になる仕様)なので、既定値に頼らずここで明示的に振る。
  // ルートの並び順がそのまま最背面からの描画順になる。y→x は「上にあるものほど背面」
  // というスクリーンショット経路の近似で、SVG のように**文書順が描画順そのもの**である
  // 入力では正解が別にある。両方が zIndex を持つときだけそちらを使う（既存経路は不変）。
  const roots = input.elements
    .filter((e) => e.parent === null)
    .sort((a, b) =>
      (a.zIndex !== undefined && b.zIndex !== undefined ? a.zIndex - b.zIndex : 0) ||
      a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0]);
  const zOf = new Map<number, number>();
  let zCounter = 1; // 0 は base 画像（最背面）用に予約
  const assignZ = (el: PrototypeElement): void => {
    zOf.set(el.id, zCounter++);
    for (const cid of el.children) {
      const child = byId.get(cid);
      if (child) assignZ(child);
    }
  };
  roots.forEach(assignZ);

  // 3) entrance の登場順: 親を持たない要素から幅優先
  const bfsOrder: PrototypeElement[] = [];
  const queue: PrototypeElement[] = [...roots];
  while (queue.length) {
    const el = queue.shift()!;
    bfsOrder.push(el);
    for (const cid of el.children) {
      const child = byId.get(cid);
      if (child) queue.push(child);
    }
  }

  // 4) 要素ごとにベクター化/ラスタ化/スキップを判定
  const shapes: ShapeSpec[] = [];
  const images: ImageSpec[] = [];
  const groups: GroupSpec[] = [];
  const rasterRegions: Array<{ name: string; polygon: Array<[number, number]>; matte?: { fg: string; bg: string; space: "srgb" | "linear" } }> = [];
  const targetIdOf = new Map<number, string>(); // 要素id -> shape/image id（アニメの対象）
  const capabilityOf = new Map<number, MotionCapability>();
  let mergedIntoBase = 0;

  for (const el of input.elements) {
    const rect = clamped.get(el.id)!;
    const [x, y, w, h] = rect;
    if (w <= 0 || h <= 0) continue; // 完全に画像外にクランプされた要素は描く意味が無い

    // ShapeSpec/ImageSpec の x/y は中心。検出結果は左上原点の矩形なので変換が要る
    // （変換を忘れると全要素が自分のサイズの半分ぶんズレる。lottieImport.ts の
    // 全面矩形配置と riv_slice_image の centerX/centerY が同じ規約）
    const cx = x + w / 2;
    const cy = y + h / 2;
    const z = zOf.get(el.id)!;

    // renderMode:"vector-panel" は「ベクター化の資格がある」の意味であって「必ずベクター化
    // される」ではない。実際にベクター矩形として再構築するのは fill を持つ場合だけ(このガード)。
    // 塗りつぶした矩形の元画素を base 画像から消さないのは、raster化するのが
    // renderMode:"raster" 要素だけだから。今は fill が常に不透明色なので、より高い z の矩形が
    // base側の同じ範囲を完全に隠して問題にならない。もし将来 fill を半透明にするなら、この
    // 矩形もラスタ削り取り対象に加えないと base の元画素が透けて二重露出する
    if (el.renderMode === "vector-panel" && el.fill) {
      const id = `el${el.id}`;
      const shape: ShapeSpec = { id, type: "rect", x: cx, y: cy, width: w, height: h, z, fill: { color: el.fill } };
      if (el.cornerRadius) shape.cornerRadius = el.cornerRadius;
      if (el.stroke) shape.stroke = { color: el.stroke.color, thickness: el.stroke.width };
      shapes.push(shape);
      targetIdOf.set(el.id, id);
    } else if (el.renderMode === "vector-shape" && el.shapes?.length) {
      // 任意のベジェ形状。**アニメの対象はシェイプ自身ではなくラッパーグループ**にする
      // （riv_import_svg の imports と同じ方式）。ShapeSpec の座標系は「bbox 中心 = x,y、
      // 頂点はその相対」なので、グループを要素の中心に置いて子をその分だけ戻すと、
      // 拡大・回転が要素の中心を軸に起きる。グループを原点(0,0)に置くと
      // アートボード左上を軸に拡大されて pop 系の入場が崩れる。
      const gid = `el${el.id}`;
      groups.push({ id: gid, x: cx, y: cy });
      el.shapes.forEach((s, i) => {
        shapes.push({
          ...s,
          id: `${gid}_${s.id}`, // SVG 側の id が重複していても .riv 内では一意にする
          parent: gid,
          x: s.x - cx,
          y: s.y - cy,
          z: z + i * 1e-3,
        });
      });
      targetIdOf.set(el.id, gid);
    } else if (el.renderMode === "raster") {
      // capability が merge の要素は**そもそも切り出さない**。切り出さなければ
      // 背景画像の中に残り、周囲と一緒に動く。信頼度が極端に低い小片を
      // 独立した画像アセットにしても、動かせば壊れるものが1つ増えるだけ。
      let cap = motionCapabilityOf(el);
      // 「背景に残す」は、背景がその場所で見えているときにしか成立しない。親が塗りを持つ
      // vector-panel なら、その塗りが base を隠すので、残した画素は消える。
      // 反実仮想判定が乗せた patch（アクセントバー・破線）がまさにこれで、
      // 信頼度の低い小さなテキスト行も同じ経路で消えていた。fade-only に格下げして切り出す。
      const parent = el.parent === null ? undefined : byId.get(el.parent);
      if (cap === "merge" && parent && parent.renderMode === "vector-panel" && parent.fill) cap = "fade-only";
      capabilityOf.set(el.id, cap);
      if (cap === "merge") {
        mergedIntoBase++;
        continue;
      }
      const name = `el${el.id}_${el.role}`; // id を含むので role が衝突しても一意
      // matte を持つテキストは、矩形の切り出しではなく前景色+alpha として切り出す。
      // 判定は検出側で済んでおり、ここは「持っていれば渡す」だけ。
      rasterRegions.push({ name, polygon: polygonOf(rect), matte: el.matte });
      images.push({ id: name, x: cx, y: cy, scale: 1, z }); // bytes は attachRasterAssets が後で埋める
      targetIdOf.set(el.id, name);
    }
    // fill の無い vector-panel 要素は可視要素を持たない（base 画像側にそのまま残るだけ）
  }

  // 5) entrance タイムライン
  const entranceMs = input.motion.entranceMs ?? 1200;
  const animatable = bfsOrder.filter((el) => targetIdOf.has(el.id));

  // 要素ごとに固定staggerを積むと入場が要素数に比例して伸びる(60要素で4.0秒/120要素で7.6秒、
  // entranceMsを6倍超過)。段数を上限12で切り、同じ段の要素はまとめて動かすことで
  // ずれ幅の合計をentranceMsの半分に収め、残り半分を各要素自身の動きの尺にする
  const steps = Math.min(animatable.length, 12);
  const bucket = Math.max(1, Math.ceil(animatable.length / Math.max(1, steps)));
  const stagger =
    steps > 1
      ? Math.min(input.motion.stagger ?? 60, (entranceMs * 0.5) / (steps - 1))
      : input.motion.stagger ?? 60;
  const delayFor = (i: number) => Math.floor(i / bucket) * stagger;

  const entrancePresets: PresetSpec[] = [];
  const entranceTracks: TrackSpec[] = [];
  let maxEndFrame = Math.round((entranceMs / 1000) * FPS);

  animatable.forEach((el, i) => {
    const targetId = targetIdOf.get(el.id)!;
    const atFrame = Math.round((delayFor(i) / 1000) * FPS);
    // **焼き付いた切り出しを平行移動させない。** capability が fade-only の要素は
    // ロールの入場（rise-in/slide-in など位置を動かすもの）を使わず fade に落とす。
    const cap = capabilityOf.get(el.id) ?? "free";
    const preset = cap === "fade-only" ? FADE_ONLY_ENTRANCE : motionFor(el.role).entrance;

    if (preset === "chart-grow") {
      // chart-grow は既存プリセットに無いので自前でキーフレームを組む。
      // Riveのシェイプ/画像は自分の中心を軸にスケールされるため、素直に
      // scaleY 0→1 させると上下双方に伸びてしまう。矩形の下端にグループを置き、
      // シェイプ(またはラスタ画像)をそのグループのローカル座標へ移してから
      // 「グループのscaleY」を動かすことで、下端固定の成長に見せかける
      const rect = clamped.get(el.id)!;
      const [rx, ry, rw, rh] = rect;
      const groupId = `${targetId}_grow`;
      // rivWriter は「グループは使う前に定義されていること」を求める。対象が既に
      // グループ(vector-shape のラッパー)のときは、その手前に差し込まないと
      // 「親が見つからない」で createRiv が落ちる
      const growGroup: GroupSpec = { id: groupId, x: rx + rw / 2, y: ry + rh };
      const targetIdx = groups.findIndex((g) => g.id === targetId);
      if (targetIdx >= 0) groups.splice(targetIdx, 0, growGroup);
      else groups.push(growGroup);
      const shapeMatch = shapes.find((s) => s.id === targetId);
      const imageMatch = images.find((im) => im.id === targetId);
      // vector-shape の対象は既にラッパーグループ。そのグループを grow グループの子にする
      // （見落とすと、頂点を持たない空のグループを伸ばして「何も起きない chart」になる）
      const groupMatch = groups.find((g) => g.id === targetId);
      if (shapeMatch) {
        shapeMatch.parent = groupId;
        shapeMatch.x = 0;
        shapeMatch.y = -rh / 2;
      } else if (imageMatch) {
        imageMatch.parent = groupId;
        imageMatch.x = 0;
        imageMatch.y = -rh / 2;
      } else if (groupMatch) {
        groupMatch.parent = groupId;
        groupMatch.x = 0;
        groupMatch.y = -rh / 2;
      }
      const durSec = 0.5;
      const endFrame = atFrame + Math.round(durSec * FPS);
      entranceTracks.push({
        target: groupId,
        property: "scaleY",
        keyframes: [
          { frame: atFrame, value: 0, easing: "hold" },
          { frame: endFrame, value: 1, easing: "emphasized-decel" },
        ],
      });
      maxEndFrame = Math.max(maxEndFrame, endFrame);
    } else {
      entrancePresets.push({ preset: preset as PresetName, target: targetId, at: atFrame });
      const presetSec = ENTRANCE_PRESET_SEC[preset] ?? 0.65;
      maxEndFrame = Math.max(maxEndFrame, atFrame + Math.ceil(presetSec * FPS));
    }
  });

  const animations: AnimWithPresets[] = [];
  if (animatable.length) {
    animations.push({
      name: "entrance",
      fps: FPS,
      duration: maxEndFrame + 1,
      loop: "oneShot",
      tracks: entranceTracks,
      presets: entrancePresets,
    });
  }

  // 6) idle（常時ループ）タイムライン。RoleMotion.idle を持つ要素だけに適用するが、
  // ambient指定があればタイムライン自体は（対象が0件でも）必ず作る
  if (input.motion.ambient) {
    const idlePresets: PresetSpec[] = animatable
      // idle は float/breathing など位置や大きさを動かすものばかりなので、
      // 焼き付いた切り出し(fade-only)には付けない。常時ループする分、
      // 入場より二重露出が目立つ。
      .filter((el) => motionFor(el.role).idle && (capabilityOf.get(el.id) ?? "free") === "free")
      .map((el) => ({ preset: motionFor(el.role).idle as PresetName, target: targetIdOf.get(el.id)! }));
    animations.push({ name: "idle", fps: FPS, duration: FPS * 4, loop: "loop", tracks: [], presets: idlePresets });
  }

  // 7) interactions ステートマシン（hover=Boolean入力 / press=Trigger入力）
  let stateMachine: StateMachineSpec | undefined;
  if (input.interactions) {
    const smInputs: NonNullable<StateMachineSpec["inputs"]> = [];
    for (const el of animatable) {
      // hover(lift/grow/spin) と press はいずれも位置か大きさを変える。
      // 焼き付いた切り出しに付けると、触るたびに元の位置の絵と二重になる。
      if ((capabilityOf.get(el.id) ?? "free") !== "free") continue;
      const m = motionFor(el.role);
      if (m.hover) smInputs.push({ name: `hover_${el.id}`, type: "bool", initial: false });
      if (m.press) smInputs.push({ name: `press_${el.id}`, type: "trigger" });
    }
    stateMachine = { name: "Interactions", inputs: smInputs };
  }

  // 何がどう制限されたかを黙って隠さない。プロトタイプが「思ったより動かない」ときの
  // 原因がここに出る。
  const fadeOnly = [...capabilityOf.values()].filter((c) => c === "fade-only").length;
  if (fadeOnly > 0) {
    warnings.push(
      `${fadeOnly} raster element(s) fade in place instead of moving: their crops carry ` +
        `the background with them, so moving them would show the same pixels twice.`
    );
  }
  if (mergedIntoBase > 0) {
    warnings.push(
      `${mergedIntoBase} small low-confidence raster element(s) were left in the background ` +
        `layer instead of becoming separate objects.`
    );
  }

  if (shapes.length === 0 && rasterRegions.length === 0) {
    warnings.push(
      `no visual elements produced from ${input.elements.length} input element(s) ` +
        `(all were fully out of image bounds, or panel/line without fill)`
    );
  }

  const spec: SceneSpec = {
    artboard: { width: srcW, height: srcH },
    shapes,
    images,
    ...(groups.length ? { groups } : {}),
    ...(animations.length ? { animations: animations as AnimationSpec[] } : {}),
    ...(stateMachine ? { stateMachine } : {}),
  };

  return { spec, rasterRegions, warnings };
}

export function attachRasterAssets(
  spec: SceneSpec,
  sliced: { parts: Array<{ name: string; png: string }>; base: string }
): void {
  const images = spec.images ?? (spec.images = []);
  const byId = new Map(images.map((im) => [im.id, im]));
  for (const part of sliced.parts) {
    const img = byId.get(part.name);
    if (!img) continue; // buildPrototypeScene が作らなかった名前は無視（呼び出し順の取り違え対策）
    img.bytes = b64(part.png);
  }
  const w = spec.artboard?.width ?? spec.artboards?.[0]?.width ?? 0;
  const h = spec.artboard?.height ?? spec.artboards?.[0]?.height ?? 0;
  images.push({ id: "base", x: w / 2, y: h / 2, scale: 1, z: 0, bytes: b64(sliced.base) });
}

function b64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}
