// .riv の静的診断（壊れた/危険なファイルの検出）。riv_dump の上位互換。
// アートボードローカルindexの算出式（globalIndex - artboardのglobal index）は
// rivEdit.ts の delete 実装で検証済みのものと同一。
import { readRiv, type RivObject } from "./rivBinary.js";

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

  return findings;
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
