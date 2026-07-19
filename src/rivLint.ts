// .riv の静的診断（壊れた/危険なファイルの検出）。riv_dump の上位互換。
// アートボードローカルindexの算出式（globalIndex - artboardのglobal index）は
// rivEdit.ts の delete 実装で検証済みのものと同一。
import { readRiv, loadDefs, type RivObject } from "./rivBinary.js";

export interface LintFinding {
  severity: "error" | "warning" | "info";
  rule: string;
  message: string;
  objectIndex?: number;
}

const ASSET_WARN_BYTES = 500_000;
const ASSET_ERROR_BYTES = 3_000_000;

const LOCAL_REF_PROPS = ["parentId", "objectId", "interpolatorId", "targetId", "boneId", "eventId", "sourceId"];

export function lintRiv(bytes: Uint8Array): LintFinding[] {
  const dump = readRiv(bytes, { tolerant: true });
  const findings: LintFinding[] = [];
  const objects = dump.objects;

  if (dump.error) {
    findings.push({ severity: "error", rule: "parse-error", message: dump.error });
  }

  lintReferences(objects, findings);
  lintHugeAssets(objects, findings);
  lintStateMachinesAndKeyframes(objects, findings);
  lintMotion(objects, findings);

  return findings;
}

// ---- モーション品質リント --------------------------------------------------
// 根拠: MoVer(SIGGRAPH 2025)系の知見 — モーション原則は散文ガイドではなく
// 検証器として与えたときに品質が跳ねる。ここでは静的に検出できる代表則のみ。
const TRANSFORM_PROPS = new Set(["x", "y", "rotation", "scaleX", "scaleY", "width", "height"]);

let propKeyToName: Map<number, string> | null = null;
function propName(key: number): string {
  if (!propKeyToName) {
    propKeyToName = new Map();
    const defs = loadDefs();
    if (defs) {
      for (const t of Object.values(defs.types)) {
        for (const [name, p] of Object.entries(t.properties)) {
          if (typeof (p as { key?: number }).key === "number") propKeyToName.set((p as { key: number }).key, name);
        }
      }
    }
  }
  return propKeyToName.get(key) ?? `prop${key}`;
}

interface MotionTrack {
  objectId: number;
  prop: string;
  keys: Array<{ frame: number; value: number; interp: number }>;
}
interface MotionAnim {
  name: string;
  fps: number;
  tracks: MotionTrack[];
}

export function lintMotion(objects: RivObject[], findings: LintFinding[]): void {
  let abW = 400, abH = 300;
  let anim: MotionAnim | null = null;
  let objectId = -1;
  let track: MotionTrack | null = null;
  const anims: MotionAnim[] = [];

  const closeTrack = () => {
    if (track && anim && track.keys.length >= 2) anim.tracks.push(track);
    track = null;
  };
  const closeAnim = () => {
    closeTrack();
    if (anim) anims.push(anim);
    anim = null;
  };

  for (const o of objects) {
    if (o.typeName === "Artboard") {
      closeAnim();
      abW = (o.properties.width as number) ?? abW;
      abH = (o.properties.height as number) ?? abH;
    } else if (o.typeName === "LinearAnimation") {
      closeAnim();
      anim = { name: (o.properties.name as string) ?? "?", fps: (o.properties.fps as number) ?? 60, tracks: [] };
    } else if (o.typeName === "KeyedObject") {
      closeTrack();
      objectId = (o.properties.objectId as number) ?? -1;
    } else if (o.typeName === "KeyedProperty") {
      closeTrack();
      if (anim) track = { objectId, prop: propName((o.properties.propertyKey as number) ?? -1), keys: [] };
    } else if (o.typeName === "KeyFrameDouble" && track) {
      track.keys.push({
        frame: (o.properties.frame as number) ?? 0,
        value: (o.properties.value as number) ?? 0,
        interp: (o.properties.interpolationType as number) ?? 1, // 省略=linear
      });
    } else if (o.typeName === "StateMachine" || o.typeName === "Backboard") {
      closeAnim();
    }
  }
  closeAnim();

  const maxDim = Math.max(abW, abH);
  for (const a of anims) {
    let linearMoves = 0;
    let easedMoves = 0;
    const opacityRises = new Map<number, number>(); // 初出現フレーム → 件数
    const scaleTracks = new Map<number, Set<string>>();

    for (const t of a.tracks) {
      const keys = t.keys.slice().sort((p, q) => p.frame - q.frame);
      const isScale = t.prop === "scaleX" || t.prop === "scaleY";
      const minDelta = isScale ? 0.01 : 0.5;
      for (let n = 1; n < keys.length; n++) {
        const prev = keys[n - 1], cur = keys[n];
        const delta = Math.abs(cur.value - prev.value);
        const df = cur.frame - prev.frame;
        if (TRANSFORM_PROPS.has(t.prop) && delta > minDelta && df > 0) {
          if (cur.interp === 1) linearMoves++;
          else if (cur.interp >= 2) easedMoves++;
          // 瞬間移動: アートボードの4割超を5フレーム(60fps換算~80ms)未満で移動
          if ((t.prop === "x" || t.prop === "y") && delta > maxDim * 0.4 && df < a.fps * 0.09 && cur.interp !== 0) {
            findings.push({
              severity: "warning",
              rule: "motion-teleport",
              message: `animation "${a.name}": object#${t.objectId} の ${t.prop} が ${df}フレームで ${Math.round(delta)}px 移動します（速すぎて視認できません。時間を伸ばすかholdで切り替えてください）`,
            });
          }
        }
      }
      if (t.prop === "opacity") {
        const rise = keys.find((kf, n) => n > 0 && keys[0].value < 0.05 && kf.value > 0.5);
        if (rise && keys[0].value < 0.05) {
          opacityRises.set(keys[0].frame, (opacityRises.get(keys[0].frame) ?? 0) + 1);
        }
      }
      if (isScale) {
        const deltas = keys.length ? Math.abs(Math.max(...keys.map((kf) => kf.value)) - Math.min(...keys.map((kf) => kf.value))) : 0;
        if (deltas > 0.05) {
          if (!scaleTracks.has(t.objectId)) scaleTracks.set(t.objectId, new Set());
          scaleTracks.get(t.objectId)!.add(t.prop);
        }
      }
    }

    if (linearMoves >= 4 && easedMoves === 0) {
      findings.push({
        severity: "warning",
        rule: "motion-robotic",
        message: `animation "${a.name}": トランスフォーム系の動き${linearMoves}区間が全てlinearです。機械的に見えます — 入場はemphasized-decel/ease-out、退場はemphasized-accel/ease-in、往復はease-in-outを使ってください`,
      });
    }
    for (const [frame, count] of opacityRises) {
      if (count >= 3) {
        findings.push({
          severity: "info",
          rule: "motion-no-stagger",
          message: `animation "${a.name}": ${count}個のオブジェクトがframe ${frame} から同時にフェードインします。1要素あたり${Math.max(2, Math.round(a.fps * 0.05))}フレーム程度ずらす(stagger)とプロらしくなります`,
        });
      }
    }
    for (const [oid, props] of scaleTracks) {
      if (props.size === 1) {
        const has = [...props][0];
        findings.push({
          severity: "info",
          rule: "motion-lopsided-scale",
          message: `animation "${a.name}": object#${oid} は ${has} のみアニメしています。等倍ポップなら scaleX/scaleY 両方、スカッシュ&ストレッチなら逆位相で両方動かすのが定石です`,
        });
      }
    }
  }
}

function lintReferences(objects: RivObject[], findings: LintFinding[]) {
  const abStarts = objects.filter((o) => o.typeName === "Artboard").map((o) => o.index);
  const imageAssetCount = objects.filter((o) => o.typeName === "ImageAsset").length;

  abStarts.forEach((abStart, i) => {
    const abEnd = abStarts[i + 1] ?? objects.length;
    const abName = (objects[abStart].properties.name as string) ?? `artboard#${i}`;
    const localSize = abEnd - abStart;
    for (let gi = abStart; gi < abEnd; gi++) {
      const o = objects[gi];
      for (const propName of LOCAL_REF_PROPS) {
        const v = o.properties[propName];
        if (typeof v !== "number") continue;
        if (v < 0 || v >= localSize) {
          findings.push({
            severity: "error",
            rule: "broken-reference",
            message: `${abName}: ${o.typeName}#${o.index} の ${propName}=${v} がアートボードのローカルindex範囲外です`,
            objectIndex: o.index,
          });
        }
      }
      if (o.typeName === "Image" && typeof o.properties.assetId === "number") {
        const aId = o.properties.assetId as number;
        if (aId < 0 || aId >= imageAssetCount) {
          findings.push({
            severity: "error",
            rule: "broken-reference",
            message: `${abName}: Image#${o.index} の assetId=${aId} が存在しない画像アセットを指しています`,
            objectIndex: o.index,
          });
        }
      }
    }
  });
}

function lintHugeAssets(objects: RivObject[], findings: LintFinding[]) {
  for (const o of objects) {
    if (o.typeName !== "FileAssetContents") continue;
    const raw = o.raw.find((r) => r.value instanceof Uint8Array);
    const size = raw && raw.value instanceof Uint8Array ? raw.value.length : 0;
    if (size >= ASSET_ERROR_BYTES) {
      findings.push({
        severity: "error",
        rule: "huge-asset",
        message: `埋め込みアセット#${o.index} が ${(size / 1e6).toFixed(1)}MB あります（${ASSET_ERROR_BYTES / 1e6}MB以上）`,
        objectIndex: o.index,
      });
    } else if (size >= ASSET_WARN_BYTES) {
      findings.push({
        severity: "warning",
        rule: "huge-asset",
        message: `埋め込みアセット#${o.index} が ${(size / 1e3).toFixed(0)}KB あります（${ASSET_WARN_BYTES / 1e3}KB以上）`,
        objectIndex: o.index,
      });
    }
  }
}

function lintStateMachinesAndKeyframes(objects: RivObject[], findings: LintFinding[]) {
  let smName = "";
  let inSM = false;
  let declaringInputs = false;
  let declaredInputs: string[] = [];
  let usedInputIds = new Set<number>();

  let animNames: string[] = [];

  let layerOpen = false;
  let stateCounter = 3;
  let stateNames: string[] = [];
  let currentStateIdx: number | null = null;
  let incoming = new Map<number, number>();
  let transitions: Array<{ source: number; target: number; hasCondition: boolean; hasExitTime: boolean }> = [];
  let lastTransition: (typeof transitions)[number] | null = null;

  const finalizeLayer = () => {
    if (!layerOpen) return;
    for (let idx = 3; idx < stateCounter; idx++) {
      if ((incoming.get(idx) ?? 0) === 0) {
        findings.push({
          severity: "warning",
          rule: "unreachable-state",
          message: `StateMachine "${smName}" の state "${stateNames[idx] ?? idx}" へ遷移する経路がありません`,
        });
      }
    }
    for (const t of transitions) {
      if (t.source === t.target && !t.hasCondition && !t.hasExitTime) {
        findings.push({
          severity: "warning",
          rule: "infinite-loop-risk",
          message: `StateMachine "${smName}" の state "${stateNames[t.source] ?? t.source}" に条件・exitTimeの無い自己遷移があります（無限ループの恐れ）`,
        });
      }
    }
    layerOpen = false;
    stateCounter = 3;
    stateNames = [];
    currentStateIdx = null;
    incoming = new Map();
    transitions = [];
    lastTransition = null;
  };

  const finalizeSM = () => {
    finalizeLayer();
    if (inSM) {
      declaredInputs.forEach((name, idx) => {
        if (!usedInputIds.has(idx)) {
          findings.push({
            severity: "info",
            rule: "unused-input",
            message: `StateMachine "${smName}" の input "${name}" はどの遷移条件からも参照されていません`,
          });
        }
      });
    }
    inSM = false;
    declaringInputs = false;
    declaredInputs = [];
    usedInputIds = new Set();
  };

  let track: RivObject[] = [];
  let trackActive = false;
  const finalizeTrack = () => {
    if (trackActive && track.length > 0) {
      const sorted = track.slice().sort((a, b) => (a.properties.frame as number) - (b.properties.frame as number));
      const last = sorted[sorted.length - 1];
      if (last.properties.interpolationType === 2) {
        findings.push({
          severity: "info",
          rule: "dead-easing",
          message: `${last.typeName}#${last.index}（frame ${last.properties.frame}）はトラック最終キーフレームのため、設定されたeasingは適用されません`,
          objectIndex: last.index,
        });
      }
    }
    track = [];
    trackActive = false;
  };

  for (const o of objects) {
    if (o.typeName === "KeyedProperty") {
      finalizeTrack();
      trackActive = true;
      continue;
    } else if (trackActive && o.typeName.startsWith("KeyFrame")) {
      track.push(o);
      continue;
    } else if (trackActive) {
      finalizeTrack();
    }

    if (o.typeName === "Artboard") {
      animNames = [];
    }
    if (o.typeName === "LinearAnimation") {
      animNames.push((o.properties.name as string) ?? `animation${animNames.length}`);
    }

    if (o.typeName === "StateMachine") {
      finalizeSM();
      inSM = true;
      declaringInputs = true;
      smName = (o.properties.name as string) ?? "StateMachine";
      continue;
    }
    if (!inSM) continue;

    if (declaringInputs && ["StateMachineBool", "StateMachineNumber", "StateMachineTrigger"].includes(o.typeName)) {
      declaredInputs.push((o.properties.name as string) ?? `input${declaredInputs.length}`);
      continue;
    }
    if (o.typeName === "StateMachineLayer") {
      finalizeLayer();
      declaringInputs = false;
      layerOpen = true;
      stateCounter = 3;
      stateNames = ["Entry", "Any", "Exit"];
      currentStateIdx = null;
      incoming = new Map();
      transitions = [];
      lastTransition = null;
      continue;
    }
    if (!layerOpen) continue;

    if (o.typeName === "EntryState") {
      currentStateIdx = 0;
      continue;
    }
    if (o.typeName === "AnyState") {
      currentStateIdx = 1;
      continue;
    }
    if (o.typeName === "ExitState") {
      currentStateIdx = 2;
      continue;
    }
    if (o.typeName === "AnimationState" || o.typeName === "BlendState1DInput") {
      currentStateIdx = stateCounter;
      if (o.typeName === "AnimationState" && typeof o.properties.animationId === "number") {
        const animName = animNames[o.properties.animationId as number] ?? "?";
        stateNames[currentStateIdx] = `state#${currentStateIdx} (animation "${animName}")`;
      } else {
        stateNames[currentStateIdx] = `state#${currentStateIdx}`;
      }
      stateCounter++;
      if (o.typeName === "BlendState1DInput" && typeof o.properties.inputId === "number") {
        usedInputIds.add(o.properties.inputId as number);
      }
      continue;
    }
    if (o.typeName === "StateTransition" && currentStateIdx !== null) {
      const target = o.properties.stateToId as number;
      incoming.set(target, (incoming.get(target) ?? 0) + 1);
      const t = {
        source: currentStateIdx,
        target,
        hasCondition: false,
        hasExitTime: o.properties.exitTime !== undefined,
      };
      transitions.push(t);
      lastTransition = t;
      continue;
    }
    if (/^Transition.*Condition$/.test(o.typeName)) {
      if (lastTransition) lastTransition.hasCondition = true;
      if (typeof o.properties.inputId === "number") usedInputIds.add(o.properties.inputId as number);
      continue;
    }
    if (o.typeName.startsWith("Listener") && typeof o.properties.inputId === "number") {
      usedInputIds.add(o.properties.inputId as number);
      continue;
    }
  }
  finalizeTrack();
  finalizeSM();
}
