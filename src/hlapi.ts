// HLAPI: 物理ベイク・パーティクル・プレハブ
// コンパイル時に物理シミュレーションを実行し、Douglas-Peucker で疎なキーフレームに圧縮する
import type { SceneSpec, ArtboardSpec, TrackSpec, KeyframeSpec, ShapeSpec, AnimationSpec, EasingName } from "./rivWriter.js";
import { expandPresets } from "./motionPresets.js";

// ---- 物理ベイク -----------------------------------------------------------
export interface BakeSpec {
  type: "gravity" | "spring" | "pendulum" | "wind";
  from: number; // 開始値
  to?: number; // spring の目標値 / gravity の地面(y)
  // gravity
  velocity?: number; // 初速 (単位/秒)
  gravity?: number; // 加速度 (既定 1500)
  restitution?: number; // 反発係数 0-1 (既定 0.55)
  // spring
  stiffness?: number; // 既定 170
  damping?: number; // 既定 12
  // pendulum (rotation 向け)
  amplitude?: number; // 初期振幅（度） 既定 30
  frequency?: number; // Hz 既定 1
  decay?: number; // 減衰/秒 既定 1.2
  // wind (x 向け)
  strength?: number; // 振幅 既定 20
  gustiness?: number; // ガスト率 0-1 既定 0.4
}

// トラック拡張: keyframes の代わりに bake を書ける
export interface BakedTrackSpec extends Omit<TrackSpec, "keyframes"> {
  keyframes?: KeyframeSpec[];
  bake?: BakeSpec;
}

// Douglas-Peucker で (frame, value) 列を許容誤差 eps で間引く
export function simplify(points: Array<[number, number]>, eps: number): Array<[number, number]> {
  if (points.length <= 2) return points;
  const dmax = { d: 0, i: 0 };
  const [x1, y1] = points[0];
  const [x2, y2] = points[points.length - 1];
  const dx = x2 - x1, dy = y2 - y1;
  const norm = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < points.length - 1; i++) {
    const d = Math.abs(dy * points[i][0] - dx * points[i][1] + x2 * y1 - y2 * x1) / norm;
    if (d > dmax.d) { dmax.d = d; dmax.i = i; }
  }
  if (dmax.d <= eps) return [points[0], points[points.length - 1]];
  const left = simplify(points.slice(0, dmax.i + 1), eps);
  const right = simplify(points.slice(dmax.i), eps);
  return [...left.slice(0, -1), ...right];
}

export function bakeToKeyframes(bake: BakeSpec, durationFrames: number, fps: number): KeyframeSpec[] {
  const dt = 1 / fps;
  const samples: Array<[number, number]> = [];
  let v = 0;
  let value = bake.from;
  // pendulum/wind は閉形式、gravity/spring は数値積分
  for (let f = 0; f <= durationFrames; f++) {
    const t = f * dt;
    switch (bake.type) {
      case "gravity": {
        if (f === 0) { v = bake.velocity ?? 0; value = bake.from; break; }
        v += (bake.gravity ?? 1500) * dt;
        value += v * dt;
        const floor = bake.to ?? bake.from;
        if (value > floor) {
          value = floor;
          v = -v * (bake.restitution ?? 0.55);
          if (Math.abs(v) < 20) v = 0;
        }
        break;
      }
      case "spring": {
        if (f === 0) { v = bake.velocity ?? 0; value = bake.from; break; }
        const target = bake.to ?? 0;
        const k = bake.stiffness ?? 170;
        const c = bake.damping ?? 12;
        v += (-k * (value - target) - c * v) * dt;
        value += v * dt;
        break;
      }
      case "pendulum": {
        const amp = bake.amplitude ?? 30;
        const freq = bake.frequency ?? 1;
        const decay = bake.decay ?? 1.2;
        value = bake.from + amp * Math.exp(-decay * t) * Math.cos(2 * Math.PI * freq * t);
        break;
      }
      case "wind": {
        const s = bake.strength ?? 20;
        const g = bake.gustiness ?? 0.4;
        value =
          bake.from +
          s * (Math.sin(2 * Math.PI * 0.7 * t) * (1 - g) + g * Math.sin(2 * Math.PI * 2.3 * t) * Math.sin(2 * Math.PI * 0.23 * t));
        break;
      }
    }
    samples.push([f, value]);
  }
  const range = Math.max(...samples.map((s) => Math.abs(s[1] - bake.from)), 1);
  const eps = range * 0.008; // 値域の0.8%を許容誤差に
  const simplified = simplify(samples, eps);
  // 区間ごとにイージングを付与（既定 linear だと物理曲線がカクつく）
  return simplified.map(([frame, val], i) => {
    if (i === 0) return { frame, value: val };
    const prev = simplified[i - 1][1];
    let easing: EasingName = "ease-in-out";
    if (bake.type === "gravity") {
      // 落下(加速)は ease-in、跳ね返り後の減速は ease-out
      easing = val > prev ? "ease-in" : "ease-out";
    }
    return { frame, value: val, easing };
  });
}

// ---- パーティクル / プレハブ ----------------------------------------------
export interface ParticleSpec {
  prefab: "rain" | "snow" | "sparks" | "dust" | "confetti" | "bubbles";
  count?: number; // 既定 20
  area: { x: number; y: number; width: number; height: number }; // 出現領域
  animation: string; // 追加先アニメーション名（存在しなければ作成）
  fallDistance?: number; // 移動距離（既定 area.height）
  seed?: number;
}

// 決定論的乱数（seed付き）— ベイク結果を再現可能に
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CONFETTI_COLORS = ["#e94560", "#00d9ff", "#ffd700", "#45e960", "#c084fc"];

export function expandParticles(ab: ArtboardSpec, particles: ParticleSpec[]): void {
  ab.shapes = ab.shapes ?? [];
  ab.animations = ab.animations ?? [];
  for (const p of particles) {
    const rand = mulberry32(p.seed ?? 42);
    const count = Math.min(p.count ?? 20, 120);
    let anim = ab.animations.find((a) => a.name === p.animation);
    if (!anim) {
      anim = { name: p.animation, duration: 120, loop: "loop", tracks: [] };
      ab.animations.push(anim);
    }
    const dur = anim.duration;
    const fall = p.fallDistance ?? p.area.height;
    for (let i = 0; i < count; i++) {
      const id = `__${p.prefab}_${p.animation}_${i}`;
      const x0 = p.area.x + rand() * p.area.width;
      const y0 = p.area.y + rand() * p.area.height * 0.3;
      const phase = rand(); // ループ内の開始オフセット
      const shape = prefabShape(p.prefab, id, x0, y0, rand);
      ab.shapes.push(shape);
      const startFrame = Math.floor(phase * dur);
      // ループを途切れさせないため、フレームを phase シフトした折り返しキーで構成
      const yTrack: KeyframeSpec[] = [];
      const speed = 0.7 + rand() * 0.6;
      const totalFall = fall * speed;
      // 2 セグメント（シフト分割）: start→end で 1 落下
      const f1 = dur - startFrame;
      yTrack.push({ frame: 0, value: y0 + (startFrame / dur) * totalFall });
      yTrack.push({ frame: f1, value: y0 + totalFall });
      yTrack.push({ frame: f1, value: y0, easing: "hold" });
      if (startFrame > 0) yTrack.push({ frame: dur, value: y0 + (startFrame / dur) * totalFall });
      anim.tracks.push({ target: id, property: "y", keyframes: yTrack });
      // 横揺れ・回転はプレハブごとに
      if (p.prefab === "snow" || p.prefab === "bubbles" || p.prefab === "confetti") {
        const sway = 8 + rand() * 18;
        anim.tracks.push({
          target: id, property: "x",
          keyframes: [
            { frame: 0, value: x0 },
            { frame: Math.floor(dur / 2), value: x0 + sway, easing: "ease-in-out" },
            { frame: dur, value: x0, easing: "ease-in-out" },
          ],
        });
      }
      if (p.prefab === "confetti" || p.prefab === "sparks") {
        anim.tracks.push({
          target: id, property: "rotation",
          keyframes: [{ frame: 0, value: 0 }, { frame: dur, value: 360 * (rand() > 0.5 ? 1 : -1) }],
        });
      }
      if (p.prefab === "sparks" || p.prefab === "dust") {
        anim.tracks.push({
          target: id, property: "opacity",
          keyframes: [
            { frame: 0, value: 0.9 }, { frame: f1, value: 0 },
            { frame: f1, value: 0.9, easing: "hold" }, { frame: dur, value: startFrame > 0 ? 0.5 : 0.9 },
          ],
        });
      }
    }
  }
}

function prefabShape(prefab: ParticleSpec["prefab"], id: string, x: number, y: number, rand: () => number): ShapeSpec {
  switch (prefab) {
    case "rain":
      return { id, type: "rect", x, y, width: 2.5, height: 14 + rand() * 10, rotation: 8,
        opacity: 0.5 + rand() * 0.3, fill: { color: "#9ecfff" } };
    case "snow":
      return { id, type: "ellipse", x, y, width: 4 + rand() * 6, height: 4 + rand() * 6,
        opacity: 0.6 + rand() * 0.4, fill: { color: "#ffffff" } };
    case "sparks":
      return { id, type: "ellipse", x, y, width: 3 + rand() * 4, height: 3 + rand() * 4,
        fill: { color: rand() > 0.5 ? "#ffd700" : "#ff8c42" } };
    case "dust":
      return { id, type: "ellipse", x, y, width: 6 + rand() * 10, height: 6 + rand() * 10,
        opacity: 0.25, fill: { color: "#b8a988" } };
    case "confetti":
      return { id, type: "rect", x, y, width: 6 + rand() * 4, height: 9 + rand() * 4,
        rotation: rand() * 90, fill: { color: CONFETTI_COLORS[Math.floor(rand() * CONFETTI_COLORS.length)] } };
    case "bubbles":
      return { id, type: "ellipse", x, y, width: 8 + rand() * 12, height: 8 + rand() * 12,
        opacity: 0.4, fill: { color: "#9be8ff" }, stroke: { color: "#d8f6ff", thickness: 1.5 } };
  }
}

// ---- SceneSpec 前処理: bake / particles を展開 -----------------------------
export function expandHlapi(spec: SceneSpec & { particles?: ParticleSpec[] }): void {
  const abList: Array<ArtboardSpec & { particles?: ParticleSpec[] }> = spec.artboards ?? [spec as unknown as ArtboardSpec];
  for (const ab of abList) {
    // モーションプリセット → キーフレーム展開(bake より先。プリセットはbakeを生成しない)
    const abW = ab.width ?? spec.artboard?.width ?? 400;
    const abH = ab.height ?? spec.artboard?.height ?? 300;
    expandPresets(ab, abW, abH);
    const particles = (ab as { particles?: ParticleSpec[] }).particles;
    if (particles) {
      expandParticles(ab, particles);
      delete (ab as { particles?: ParticleSpec[] }).particles;
    }
    for (const anim of ab.animations ?? []) {
      for (const t of anim.tracks as BakedTrackSpec[]) {
        if (t.bake) {
          if (t.property === "rotation" && t.bake.type === "gravity") {
            throw new Error("gravity bake is for x/y; use pendulum for rotation");
          }
          t.keyframes = bakeToKeyframes(t.bake, anim.duration, anim.fps ?? 60);
          delete t.bake;
        }
      }
    }
  }
}
