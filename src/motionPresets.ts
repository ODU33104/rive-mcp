// セマンティック・モーションプリセット
// クライアント(LLM)は生キーフレームではなく「意図」を1行書く:
//   {"preset":"pop-in","target":"card"} / {"preset":"rise-in","targets":["a","b","c"],"stagger":5}
// 数値(振幅・duration・easing)はここで所有する。根拠:
//   - duration帯は Material Design 3 motion tokens (enter 400-500ms / exit 200-250ms / tap 100ms)
//   - 入場=減速(emphasized-decel)、退場=加速(emphasized-accel)、強調=対称
//   - MoVer(SIGGRAPH 2025)系の知見: 数値をモデルに書かせず検証可能な意味層を挟むと品質が跳ねる
import type { ArtboardSpec, AnimationSpec, TrackSpec, KeyframeSpec, EasingName } from "./rivWriter.js";

export type PresetName =
  // 入場
  | "fade-in" | "rise-in" | "drop-in" | "slide-in" | "pop-in" | "bounce-in"
  | "stagger-in" | "swoop-in" | "pop-cascade"
  // 退場
  | "fade-out" | "sink-out" | "slide-out" | "pop-out"
  // 強調(ワンショット)
  | "pulse" | "heartbeat" | "tada" | "shake" | "wobble" | "attention"
  // 常時ループ(アニメ全長にシームレス展開)
  | "breathing" | "float" | "sway" | "spin" | "glow-pulse" | "blink"
  | "parallax-drift" | "float-idle" | "shimmer";

export interface PresetSpec {
  preset: PresetName;
  target?: string; // 単体
  targets?: string[]; // 複数(stagger適用)
  at?: number; // 開始フレーム(既定0。常時系は無視して全長に展開)
  stagger?: number; // targets間の時差フレーム(既定: fps*0.05 ≒ 50ms)
  intensity?: number; // 振幅倍率 0.25-3(既定1)
  direction?: "left" | "right" | "up" | "down"; // slide-in/out(既定: left=左から入る/左へ出る)
  cycleSeconds?: number; // 常時系の1周期秒(既定はプリセットごと)
}

export const AMBIENT_PRESETS: Set<string> = new Set([
  "breathing", "float", "sway", "spin", "glow-pulse", "blink",
  "parallax-drift", "float-idle", "shimmer",
]);

export const PRESET_NAMES: PresetName[] = [
  "fade-in", "rise-in", "drop-in", "slide-in", "pop-in", "bounce-in",
  "stagger-in", "swoop-in", "pop-cascade",
  "fade-out", "sink-out", "slide-out", "pop-out",
  "pulse", "heartbeat", "tada", "shake", "wobble", "attention",
  "breathing", "float", "sway", "spin", "glow-pulse", "blink",
  "parallax-drift", "float-idle", "shimmer",
];

// 対象要素の基準値(絶対値キーフレームを作るために必要)
interface BaseValues {
  x: number; y: number; rotation: number; opacity: number;
  scale: number; // images[].scale。shapes/groupsは1
}

function findBase(ab: ArtboardSpec, id: string): BaseValues {
  for (const s of ab.shapes ?? []) if (s.id === id)
    return { x: s.x, y: s.y, rotation: s.rotation ?? 0, opacity: s.opacity ?? 1, scale: 1 };
  for (const g of ab.groups ?? []) if (g.id === id)
    return { x: g.x, y: g.y, rotation: g.rotation ?? 0, opacity: g.opacity ?? 1, scale: 1 };
  for (const im of ab.images ?? []) if (im.id === id)
    return { x: im.x, y: im.y, rotation: im.rotation ?? 0, opacity: im.opacity ?? 1, scale: im.scale ?? 1 };
  for (const t of ab.texts ?? []) if (t.id === id)
    return { x: t.x, y: t.y, rotation: 0, opacity: 1, scale: 1 };
  for (const n of ab.nested ?? []) if (n.id === id)
    return { x: n.x, y: n.y, rotation: 0, opacity: 1, scale: 1 };
  throw new Error(`preset target '${id}' not found (looked in shapes/groups/images/texts/nested)`);
}

type K = KeyframeSpec;
const k = (frame: number, value: number, easing?: EasingName, extra?: Partial<K>): K =>
  ({ frame: Math.round(frame), value, ...(easing ? { easing } : {}), ...extra });

// 1ターゲット分のトラック群を作る。frameはat起点の相対→呼び出し側で絶対化しない(ここで絶対値で作る)
function buildPresetTracks(
  p: PresetSpec, target: string, at: number, base: BaseValues,
  fps: number, duration: number, abW: number, abH: number
): TrackSpec[] {
  const i = clamp(p.intensity ?? 1, 0.25, 3);
  const sec = (s: number) => s * fps;
  const dx = Math.max(24, abW * 0.1) * i * (p.direction === "right" ? 1 : -1);
  const dy = Math.max(16, abH * 0.06) * i;
  const S = base.scale;
  const tr = (property: TrackSpec["property"], keyframes: K[]): TrackSpec => ({ target, property, keyframes });
  const fit = (endFrame: number) => {
    if (endFrame > duration)
      throw new Error(`preset '${p.preset}' on '${target}' needs frames up to ${Math.ceil(endFrame)} but animation duration is ${duration}. Increase duration or lower 'at'.`);
  };

  switch (p.preset) {
    // ---- 入場 ----
    case "fade-in":
      fit(at + sec(0.3));
      return [tr("opacity", [k(at, 0, "hold"), k(at + sec(0.3), base.opacity, "smooth")])];
    case "rise-in":
      fit(at + sec(0.45));
      return [
        tr("y", [k(at, base.y + dy, "hold"), k(at + sec(0.45), base.y, "emphasized-decel")]),
        tr("opacity", [k(at, 0, "hold"), k(at + sec(0.25), base.opacity, "smooth")]),
      ];
    case "drop-in":
      fit(at + sec(0.5));
      return [
        tr("y", [k(at, base.y - dy * 2, "hold"), k(at + sec(0.5), base.y, "ease-out-back")]),
        tr("opacity", [k(at, 0, "hold"), k(at + sec(0.2), base.opacity, "smooth")]),
      ];
    case "slide-in": {
      const sx = p.direction === "up" || p.direction === "down" ? 0 : dx;
      const sy = p.direction === "up" ? dy * 1.6 : p.direction === "down" ? -dy * 1.6 : 0;
      fit(at + sec(0.4));
      const tracks: TrackSpec[] = [tr("opacity", [k(at, 0, "hold"), k(at + sec(0.25), base.opacity, "smooth")])];
      if (sx) tracks.push(tr("x", [k(at, base.x + sx, "hold"), k(at + sec(0.4), base.x, "emphasized-decel")]));
      if (sy) tracks.push(tr("y", [k(at, base.y + sy, "hold"), k(at + sec(0.4), base.y, "emphasized-decel")]));
      return tracks;
    }
    case "pop-in":
      fit(at + sec(0.6));
      return [
        tr("scaleX", [k(at, 0.4 * S, "hold"), k(at + sec(0.6), S, "elastic-out", { amplitude: 1, period: 0.35 })]),
        tr("scaleY", [k(at, 0.4 * S, "hold"), k(at + sec(0.6), S, "elastic-out", { amplitude: 1, period: 0.35 })]),
        tr("opacity", [k(at, 0, "hold"), k(at + sec(0.15), base.opacity, "smooth")]),
      ];
    case "bounce-in":
      fit(at + sec(0.65));
      return [
        tr("y", [
          k(at, base.y - Math.max(60, abH * 0.25) * i, "hold"),
          k(at + sec(0.35), base.y, "ease-in"),
          k(at + sec(0.47), base.y - dy * 0.45, "ease-out"),
          k(at + sec(0.58), base.y, "ease-in"),
          k(at + sec(0.65), base.y),
        ]),
        // 着地スカッシュ(体積保存: scaleYが潰れる瞬間scaleXが広がる)
        tr("scaleY", [k(at, S, "hold"), k(at + sec(0.35), S, "hold"), k(at + sec(0.41), 0.88 * S, "ease-out"), k(at + sec(0.55), S, "smooth")]),
        tr("scaleX", [k(at, S, "hold"), k(at + sec(0.35), S, "hold"), k(at + sec(0.41), 1.12 * S, "ease-out"), k(at + sec(0.55), S, "smooth")]),
        tr("opacity", [k(at, 0, "hold"), k(at + sec(0.12), base.opacity, "smooth")]),
      ];
    case "stagger-in": {
      // リスト/カード群の時差登場向け。本動作(上昇)の12%を逆方向(さらに沈む)へ
      // anticipationさせてから ease-out-back でわずかにオーバーシュートして着地する。
      // targets+stagger(40-80ms目安)と組み合わせて使う。
      fit(at + sec(0.56));
      const antic = dy * 0.12 * i;
      return [
        tr("y", [
          k(at, base.y + dy, "hold"),
          k(at + sec(0.08), base.y + dy + antic, "ease-out"), // anticipation: 逆方向へ一瞬沈む
          k(at + sec(0.44), base.y - dy * 0.08, "ease-out-back"), // overshoot
          k(at + sec(0.56), base.y, "ease-out"),
        ]),
        tr("scaleY", [k(at, 0.96 * S, "hold"), k(at + sec(0.08), 0.9 * S, "ease-out"), k(at + sec(0.44), 1.04 * S, "ease-out-back"), k(at + sec(0.56), S, "smooth")]),
        tr("scaleX", [k(at, 1.02 * S, "hold"), k(at + sec(0.08), 1.06 * S, "ease-out"), k(at + sec(0.44), 0.98 * S, "ease-out-back"), k(at + sec(0.56), S, "smooth")]),
        tr("rotation", [k(at, base.rotation + 2.5 * i, "hold"), k(at + sec(0.44), base.rotation - 1 * i, "ease-out-back"), k(at + sec(0.56), base.rotation, "smooth")]),
        tr("opacity", [k(at, 0, "hold"), k(at + sec(0.18), base.opacity, "smooth")]),
      ];
    }
    case "swoop-in": {
      // 直線移動ではなく弧を描く入場(アークの原則)。x/yのタイミングをずらして
      // 合成軌道を弓なりにし、rotationで旋回方向へ軽くバンクさせる。
      fit(at + sec(0.6));
      const sx = dx * 1.4;
      const bank = (sx > 0 ? -1 : 1) * 6 * i;
      return [
        tr("x", [k(at, base.x + sx, "hold"), k(at + sec(0.5), base.x, "ease-out")]),
        tr("y", [
          k(at, base.y + dy * 0.5, "hold"),
          k(at + sec(0.28), base.y - dy * 1.1, "ease-out"), // 弧の頂点(逆方向へ一旦振る)
          k(at + sec(0.6), base.y, "ease-out-back"),
        ]),
        tr("rotation", [
          k(at, base.rotation + bank, "hold"),
          k(at + sec(0.5), base.rotation, "ease-out-back"),
        ]),
        tr("opacity", [k(at, 0, "hold"), k(at + sec(0.2), base.opacity, "smooth")]),
      ];
    }
    case "pop-cascade": {
      // pop-inを連鎖前提でリッチ化: 予備収縮(anticipation)→大きめelasticオーバーシュート
      // →軽い二次バウンド(follow-through)。targets+staggerで連鎖ポップに。
      fit(at + sec(0.62));
      return [
        tr("scaleY", [
          k(at, S, "hold"),
          k(at + sec(0.08), 0.82 * S, "ease-in"), // anticipation: しゃがみ込む
          k(at + sec(0.36), (1 + 0.14 * i) * S, "elastic-out", { amplitude: 1.1, period: 0.4 }),
          k(at + sec(0.62), S, "smooth"),
        ]),
        tr("scaleX", [
          k(at, S, "hold"),
          k(at + sec(0.08), 1.16 * S, "ease-in"),
          k(at + sec(0.36), (1 + 0.14 * i) * S, "elastic-out", { amplitude: 1.1, period: 0.4 }),
          k(at + sec(0.62), S, "smooth"),
        ]),
        tr("rotation", [k(at, base.rotation, "hold"), k(at + sec(0.36), base.rotation + 4 * i, "elastic-out", { amplitude: 0.8, period: 0.4 }), k(at + sec(0.62), base.rotation, "smooth")]),
        tr("opacity", [k(at, 0, "hold"), k(at + sec(0.14), base.opacity, "smooth")]),
      ];
    }
    // ---- 退場 ----
    case "fade-out":
      fit(at + sec(0.25));
      return [tr("opacity", [k(at, base.opacity, "hold"), k(at + sec(0.25), 0, "emphasized-accel")])];
    case "sink-out":
      fit(at + sec(0.3));
      return [
        tr("y", [k(at, base.y, "hold"), k(at + sec(0.3), base.y + dy, "emphasized-accel")]),
        tr("opacity", [k(at, base.opacity, "hold"), k(at + sec(0.25), 0, "emphasized-accel")]),
      ];
    case "slide-out": {
      const sx = p.direction === "up" || p.direction === "down" ? 0 : dx;
      const sy = p.direction === "up" ? -dy * 1.6 : p.direction === "down" ? dy * 1.6 : 0;
      fit(at + sec(0.3));
      const tracks: TrackSpec[] = [tr("opacity", [k(at, base.opacity, "hold"), k(at + sec(0.25), 0, "emphasized-accel")])];
      if (sx) tracks.push(tr("x", [k(at, base.x, "hold"), k(at + sec(0.3), base.x + sx, "emphasized-accel")]));
      if (sy) tracks.push(tr("y", [k(at, base.y, "hold"), k(at + sec(0.3), base.y + sy, "emphasized-accel")]));
      return tracks;
    }
    case "pop-out":
      fit(at + sec(0.3));
      return [
        tr("scaleX", [k(at, S, "hold"), k(at + sec(0.3), 0.6 * S, "ease-in-back")]),
        tr("scaleY", [k(at, S, "hold"), k(at + sec(0.3), 0.6 * S, "ease-in-back")]),
        tr("opacity", [k(at, base.opacity, "hold"), k(at + sec(0.28), 0, "emphasized-accel")]),
      ];
    // ---- 強調 ----
    case "pulse":
      fit(at + sec(0.5));
      return [
        tr("scaleX", [k(at, S, "hold"), k(at + sec(0.25), (1 + 0.06 * i) * S, "ease-in-out"), k(at + sec(0.5), S, "ease-in-out")]),
        tr("scaleY", [k(at, S, "hold"), k(at + sec(0.25), (1 + 0.06 * i) * S, "ease-in-out"), k(at + sec(0.5), S, "ease-in-out")]),
      ];
    case "heartbeat": {
      fit(at + sec(0.9));
      const beat = (t0: number, amp: number): K[] => [
        k(t0, S, "hold"), k(t0 + sec(0.12), (1 + amp) * S, "ease-out"), k(t0 + sec(0.3), S, "ease-in-out"),
      ];
      const keys = [...beat(at, 0.08 * i), ...beat(at + sec(0.35), 0.05 * i)];
      return [tr("scaleX", keys), tr("scaleY", keys.map((f) => ({ ...f })))];
    }
    case "tada":
      fit(at + sec(0.8));
      return [
        tr("scaleX", [k(at, S, "hold"), k(at + sec(0.15), 0.93 * S, "ease-in-out"), k(at + sec(0.3), (1 + 0.08 * i) * S, "ease-out"), k(at + sec(0.7), (1 + 0.08 * i) * S), k(at + sec(0.8), S, "ease-in-out")]),
        tr("scaleY", [k(at, S, "hold"), k(at + sec(0.15), 0.93 * S, "ease-in-out"), k(at + sec(0.3), (1 + 0.08 * i) * S, "ease-out"), k(at + sec(0.7), (1 + 0.08 * i) * S), k(at + sec(0.8), S, "ease-in-out")]),
        tr("rotation", [
          k(at, base.rotation, "hold"), k(at + sec(0.15), base.rotation - 3 * i, "ease-in-out"),
          k(at + sec(0.3), base.rotation + 3 * i, "ease-in-out"), k(at + sec(0.42), base.rotation - 3 * i, "ease-in-out"),
          k(at + sec(0.54), base.rotation + 3 * i, "ease-in-out"), k(at + sec(0.66), base.rotation - 2 * i, "ease-in-out"),
          k(at + sec(0.8), base.rotation, "ease-in-out"),
        ]),
      ];
    case "shake": {
      fit(at + sec(0.6));
      const amp = 9 * i;
      const keys: K[] = [k(at, base.x, "hold")];
      const offsets = [1, -0.8, 0.55, -0.35, 0.18];
      offsets.forEach((o, n) => keys.push(k(at + sec(0.09 * (n + 1)), base.x + amp * o, "ease-in-out")));
      keys.push(k(at + sec(0.6), base.x, "ease-out"));
      return [tr("x", keys)];
    }
    case "wobble": {
      fit(at + sec(0.9));
      const amp = 8 * i;
      const keys: K[] = [k(at, base.rotation, "hold")];
      const offsets = [1, -0.7, 0.45, -0.25, 0.1];
      offsets.forEach((o, n) => keys.push(k(at + sec(0.15 * (n + 1)), base.rotation + amp * o, "ease-in-out")));
      keys.push(k(at + sec(0.9), base.rotation, "ease-out"));
      return [tr("rotation", keys)];
    }
    case "attention": {
      // 通知バッジ/新着アイコン向け複合ワンショット。pop-inの勢いをtadaより速く・
      // shakeより短く仕立てる: 予備収縮→elasticポップ→小さな回転の余韻(follow-through)。
      fit(at + sec(0.46));
      const amp = 6 * i;
      return [
        tr("scaleX", [k(at, S, "hold"), k(at + sec(0.06), 0.88 * S, "ease-in"), k(at + sec(0.22), (1 + 0.18 * i) * S, "elastic-out", { amplitude: 1, period: 0.3 }), k(at + sec(0.46), S, "smooth")]),
        tr("scaleY", [k(at, S, "hold"), k(at + sec(0.06), 1.1 * S, "ease-in"), k(at + sec(0.22), (1 + 0.18 * i) * S, "elastic-out", { amplitude: 1, period: 0.3 }), k(at + sec(0.46), S, "smooth")]),
        tr("rotation", [
          k(at, base.rotation, "hold"),
          k(at + sec(0.26), base.rotation + amp, "ease-in-out"),
          k(at + sec(0.34), base.rotation - amp * 0.6, "ease-in-out"),
          k(at + sec(0.42), base.rotation + amp * 0.3, "ease-in-out"),
          k(at + sec(0.46), base.rotation, "ease-out"),
        ]),
      ];
    }
    // ---- 常時ループ(全長シームレス。at無視) ----
    case "breathing":
      return cycleTracks(duration, fps, p.cycleSeconds ?? 3.6, (t0, t1) => [
        tr("scaleY", [k(t0, S), k((t0 + t1) / 2, (1 + 0.02 * i) * S, "ease-in-out"), k(t1, S, "ease-in-out")]),
        tr("scaleX", [k(t0, S), k((t0 + t1) / 2, (1 - 0.008 * i) * S, "ease-in-out"), k(t1, S, "ease-in-out")]),
      ]);
    case "float":
      return cycleTracks(duration, fps, p.cycleSeconds ?? 3, (t0, t1) => [
        tr("y", [k(t0, base.y), k((t0 + t1) / 2, base.y - 7 * i, "ease-in-out"), k(t1, base.y, "ease-in-out")]),
      ]);
    case "sway":
      return cycleTracks(duration, fps, p.cycleSeconds ?? 3.4, (t0, t1) => [
        tr("rotation", [
          k(t0, base.rotation - 2.5 * i), k((t0 + t1) / 2, base.rotation + 2.5 * i, "ease-in-out"),
          k(t1, base.rotation - 2.5 * i, "ease-in-out"),
        ]),
      ]);
    case "spin":
      return [tr("rotation", [k(0, base.rotation), k(duration, base.rotation + 360 * Math.max(1, Math.round(duration / fps / (p.cycleSeconds ?? 2))), "linear")])];
    case "glow-pulse":
      return cycleTracks(duration, fps, p.cycleSeconds ?? 2, (t0, t1) => [
        tr("opacity", [k(t0, base.opacity), k((t0 + t1) / 2, base.opacity * (1 - 0.3 * Math.min(i, 2)), "ease-in-out"), k(t1, base.opacity, "ease-in-out")]),
      ]);
    case "blink": {
      // まぶたオーバーレイ用: 普段opacity 0、瞬間的に1(閉眼)。約2.2秒周期+ダブルブリンク風
      const keys: K[] = [k(0, 0, "hold")];
      const cyc = sec(p.cycleSeconds ?? 2.2);
      for (let t = cyc * 0.75; t + sec(0.14) < duration; t += cyc) {
        keys.push(k(t, 0, "hold"), k(t + sec(0.05), 1, "hold"), k(t + sec(0.12), 0, "hold"));
      }
      keys.push(k(duration, 0));
      return [tr("opacity", keys)];
    }
    case "parallax-drift":
      // 多層背景のパララックス用。direction で軸を選び、intensity を「奥行き」として
      // レイヤーごとに変える(遠景=小さいintensity・長いcycleSeconds / 近景=大きいintensity・短いcycleSeconds)
      return cycleTracks(duration, fps, p.cycleSeconds ?? 6, (t0, t1) => {
        const axis: "x" | "y" = p.direction === "up" || p.direction === "down" ? "y" : "x";
        const amp = (axis === "x" ? Math.max(20, abW * 0.05) : Math.max(12, abH * 0.05)) * i;
        const baseVal = axis === "x" ? base.x : base.y;
        return [tr(axis, [k(t0, baseVal - amp / 2), k((t0 + t1) / 2, baseVal + amp / 2, "ease-in-out"), k(t1, baseVal - amp / 2, "ease-in-out")])];
      });
    case "float-idle":
      // アイドル呼吸+浮遊+微回転を位相をずらして合成する「生きた」ループ。
      // 全プロパティが同位相で揺れると機械的に見えるため、ピーク位置を30/50/70%にずらす。
      return cycleTracks(duration, fps, p.cycleSeconds ?? 4, (t0, t1) => {
        const span = t1 - t0;
        return [
          tr("y", [k(t0, base.y), k(t0 + span * 0.5, base.y - 8 * i, "ease-in-out"), k(t1, base.y, "ease-in-out")]),
          tr("rotation", [
            k(t0, base.rotation - 1.5 * i),
            k(t0 + span * 0.3, base.rotation + 1.5 * i, "ease-in-out"),
            k(t0 + span * 0.75, base.rotation - 1 * i, "ease-in-out"),
            k(t1, base.rotation - 1.5 * i, "ease-in-out"),
          ]),
          tr("scaleY", [k(t0, S), k(t0 + span * 0.7, (1 + 0.012 * i) * S, "ease-in-out"), k(t1, S, "ease-in-out")]),
        ];
      });
    case "shimmer":
      // stroke.trim{start,end} で幅を決めた「光の帯」を trimOffset で滑らせる定番ハイライト演出。
      // 対象シェイプに stroke.trim を設定しておくこと(例: {start:0, end:0.18})。
      return cycleTracks(duration, fps, p.cycleSeconds ?? 2.2, (t0, t1) => [
        tr("trimOffset", [k(t0, 0, "linear"), k(t1, 1, "linear")]),
      ]);
  }
}

// durationをcycleSecondsで割った整数回のループを敷き詰める(シームレス保証)
function cycleTracks(
  duration: number, fps: number, cycleSeconds: number,
  make: (t0: number, t1: number) => TrackSpec[]
): TrackSpec[] {
  const cycles = Math.max(1, Math.round(duration / fps / cycleSeconds));
  const span = duration / cycles;
  const byProp = new Map<string, TrackSpec>();
  for (let c = 0; c < cycles; c++) {
    for (const t of make(c * span, (c + 1) * span)) {
      const existing = byProp.get(t.target + " " + t.property);
      if (existing) {
        // 先頭キーは前サイクル終端と重複するので除いて連結
        existing.keyframes.push(...t.keyframes.slice(1));
      } else byProp.set(t.target + " " + t.property, t);
    }
  }
  return [...byProp.values()];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// アニメーション内の presets を tracks に展開(hlapi.expandHlapi から呼ばれる)
export function expandPresets(ab: ArtboardSpec, abW: number, abH: number): void {
  for (const anim of ab.animations ?? []) {
    const withPresets = anim as AnimationSpec & { presets?: PresetSpec[] };
    if (!withPresets.presets?.length) continue;
    const fps = anim.fps ?? 60;
    anim.tracks = anim.tracks ?? [];
    // 同一 target+property への複数プリセット(例: pop-in → 後半に pulse)はプロの定石。
    // フレーム範囲が重ならない限り1トラックにマージし、重なりだけをエラーにする。
    const owned = new Map<string, { track: TrackSpec; ranges: Array<[number, number]> }>();
    for (const t of anim.tracks) {
      const frames = t.keyframes.map((kf) => kf.frame);
      owned.set(t.target + " " + t.property, { track: t, ranges: [[Math.min(...frames), Math.max(...frames)]] });
    }
    for (const p of withPresets.presets) {
      const targets = p.targets ?? (p.target ? [p.target] : []);
      if (!targets.length) throw new Error(`preset '${p.preset}': target or targets required`);
      const stagger = p.stagger ?? Math.round(fps * 0.05);
      targets.forEach((id, idx) => {
        const base = findBase(ab, id);
        const at = (p.at ?? 0) + idx * stagger;
        for (const t of buildPresetTracks(p, id, at, base, fps, anim.duration, abW, abH)) {
          const sig = t.target + " " + t.property;
          const frames = t.keyframes.map((kf) => kf.frame);
          const range: [number, number] = [Math.min(...frames), Math.max(...frames)];
          const slot = owned.get(sig);
          if (!slot) {
            owned.set(sig, { track: t, ranges: [range] });
            anim.tracks.push(t);
            continue;
          }
          for (const [s, e] of slot.ranges) {
            if (range[0] < e && s < range[1])
              throw new Error(
                `preset '${p.preset}' animates ${t.target}.${t.property} over frames ${range[0]}-${range[1]}, which overlaps an existing track/preset (frames ${s}-${e}) in '${anim.name}'. ` +
                (AMBIENT_PRESETS.has(p.preset)
                  ? `Ambient presets span the whole animation — put '${p.preset}' in a separate looping animation (e.g. "idle") and chain it after the entrance via the state machine (exitTimeMs).`
                  : `Shift 'at' so ranges don't overlap, or drop one of them.`)
              );
          }
          // 隣接(同一フレーム)の重複キーは既存側を優先して落とす
          const existingFrames = new Set(slot.track.keyframes.map((kf) => kf.frame));
          slot.track.keyframes.push(...t.keyframes.filter((kf) => !existingFrames.has(kf.frame)));
          slot.track.keyframes.sort((a, b) => a.frame - b.frame);
          slot.ranges.push(range);
        }
      });
    }
    delete withPresets.presets;
  }
}
