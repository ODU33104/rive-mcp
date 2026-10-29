import { loadDefs, readRiv, writeRawRiv, type DefType, type RivObject } from "./rivBinary.js";
import { removeAtPositions } from "./rivEdit.js";
import { lintRiv, type LintFinding } from "./rivLint.js";

export type RepairFix = "unused-input" | "dead-easing" | "broken-reference" | "unused-interpolator";

export interface RepairCandidate {
  rule: RepairFix;
  objectIndex: number;
  detail: string;
}

export interface RepairAction {
  fix: RepairFix;
  count: number;
  detail: string;
}

export interface RepairSkip {
  rule: string;
  reason: string;
}

export interface RepairSummary {
  lintCount: number;
  byRule: Record<string, number>;
}

export interface RepairReport {
  applied: RepairAction[];
  skipped: RepairSkip[];
  before: RepairSummary;
  after: RepairSummary;
  bytes: { before: number; after: number };
  visual: { frames: number; maxDiffPixels: number; identical: boolean };
}

const KEYFRAMES = new Set(["KeyFrameDouble", "KeyFrameColor", "KeyFrameId"]);
const INTERPOLATORS = new Set(["CubicEaseInterpolator", "ElasticInterpolator"]);
const INPUTS = new Set(["StateMachineBool", "StateMachineNumber", "StateMachineTrigger"]);
const AVAILABLE: RepairFix[] = ["unused-input", "dead-easing", "broken-reference", "unused-interpolator"];

export function repairSummary(findings: LintFinding[]): RepairSummary {
  const byRule: Record<string, number> = {};
  for (const finding of findings) byRule[finding.rule] = (byRule[finding.rule] ?? 0) + 1;
  return { lintCount: findings.length, byRule };
}

function propertyKey(typeName: string, name: string): number {
  const defs = loadDefs();
  if (!defs) throw new Error("Rive definitions are unavailable");
  const byFile = new Map(Object.entries(defs.types).map(([n, t]) => [t.file.split("/").pop(), n]));
  let current: string | undefined = typeName;
  while (current) {
    const definition: DefType | undefined = defs.types[current];
    if (!definition) break;
    const key = definition.properties[name]?.key;
    if (typeof key === "number") return key;
    current = definition.extends ? byFile.get(definition.extends.split("/").pop()) : undefined;
  }
  throw new Error("Missing Rive definition: " + typeName + "." + name);
}

function valueOf(object: RivObject, key: number): number | undefined {
  const value = object.raw.find((p) => p.key === key)?.value;
  return typeof value === "number" ? value : undefined;
}

function erase(object: RivObject, key: number, name: string): void {
  object.raw = object.raw.filter((p) => p.key !== key);
  delete object.properties[name];
}

function artboards(objects: RivObject[]): Array<[number, number]> {
  const starts = objects.flatMap((o, i) => o.typeName === "Artboard" ? [i] : []);
  return starts.map((start, i) => [start, starts[i + 1] ?? objects.length]);
}

function safeToReindex(objects: RivObject[], start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    const object = objects[i];
    if (object.typeName.startsWith("Unknown") || object.unknownProps.length > 0 ||
        /^(DataBind|ViewModel|DataConverter)/.test(object.typeName)) return false;
  }
  return true;
}

function usedInputs(objects: RivObject[], start: number, end: number): Set<number> {
  const used = new Set<number>();
  for (let i = start; i < end; i++) {
    const o = objects[i];
    const id = o.properties.inputId;
    if (typeof id === "number") used.add(id);
  }
  return used;
}

/**
 * Propose only structural changes whose semantics are fixed by the Rive format.
 * The caller must compare rendered frames before writing any changed bytes.
 */
export function repairRiv(
  bytes: Uint8Array,
  fixes?: RepairFix[],
  target?: { rule: RepairFix; objectIndex: number }
): { bytes: Uint8Array; candidates: RepairCandidate[]; report: RepairReport } {
  const selected = new Set(fixes ?? AVAILABLE);
  for (const fix of selected) {
    if (!AVAILABLE.includes(fix)) throw new Error("Unknown repair fix: " + fix);
  }

  const originalFindings = lintRiv(bytes);
  if (originalFindings.some((f) => f.rule === "parse-error")) {
    throw new Error("Cannot repair a file with a parse error");
  }
  const dump = readRiv(bytes);
  if (dump.error) throw new Error("Cannot repair a file with a parse error: " + dump.error);
  let objects = dump.objects;
  const actions: RepairCandidate[] = [];
  const allowed = (rule: RepairFix, index: number) =>
    selected.has(rule) && (!target || (target.rule === rule && target.objectIndex === index));
  const skips: RepairSkip[] = [];
  const removed = new Set<number>();
  const interpType = propertyKey("InterpolatingKeyFrame", "interpolationType");
  const interpId = propertyKey("InterpolatingKeyFrame", "interpolatorId");
  const publicKey = propertyKey("StateMachineInput", "public");
  const broken = new Set(originalFindings
    .filter((f) => f.rule === "broken-reference" && f.objectIndex !== undefined)
    .map((f) => f.objectIndex!));

  const bounds = artboards(objects);
  for (const [start, end] of bounds) {
    const canRemove = safeToReindex(objects, start, end);
    for (let i = start; i < end; i++) {
      const obj = objects[i];
      if (!KEYFRAMES.has(obj.typeName)) continue;
      const kind = valueOf(obj, interpType) ?? 1;
      const id = valueOf(obj, interpId);
      if (allowed("broken-reference", obj.index) && broken.has(obj.index) &&
          (kind === 0 || kind === 1) && id !== undefined && (id < 0 || id >= end - start)) {
        erase(obj, interpId, "interpolatorId");
        actions.push({ rule: "broken-reference", objectIndex: obj.index, detail: "Discarded unused out-of-range interpolatorId" });
      }
    }

    if (selected.has("unused-input")) {
      for (let i = start; i < end; i++) {
        if (objects[i].typeName !== "StateMachine") continue;
        let smEnd = i + 1;
        while (smEnd < end && objects[smEnd].typeName !== "StateMachine") smEnd++;
        const inputs: number[] = [];
        let j = i + 1;
        while (j < smEnd && INPUTS.has(objects[j].typeName)) inputs.push(j++);
        const used = usedInputs(objects, j, smEnd);
        for (let ordinal = inputs.length - 1; ordinal >= 0; ordinal--) {
          const pos = inputs[ordinal];
          const inp = objects[pos];
          if (used.has(ordinal) || valueOf(inp, publicKey) !== 0) break;
          if (target && !allowed("unused-input", inp.index)) break;
          if (!canRemove) {
            skips.push({ rule: "unused-input", reason: "Input #" + inp.index + ": unknown references prevent safe local index remapping" });
            break;
          }
          removed.add(pos);
          actions.push({ rule: "unused-input", objectIndex: inp.index, detail: "Removed private trailing input without references" });
        }
        i = smEnd - 1;
      }
    }

    // A final keyframe's cubic settings remain intact. Only truly orphaned
    // interpolator objects may be removed; all local references are counted.
    if ((selected.has("dead-easing") || selected.has("unused-interpolator")) && canRemove) {
      const referenced = new Set<number>();
      for (let i = start; i < end; i++) {
        if (removed.has(i)) continue;
        const rawId = valueOf(objects[i], interpId);
        const propertyId = objects[i].properties.interpolatorId;
        if (rawId !== undefined) referenced.add(start + rawId);
        if (typeof propertyId === "number") referenced.add(start + propertyId);
      }
      const rule: RepairFix = selected.has("unused-interpolator") ? "unused-interpolator" : "dead-easing";
      for (let i = start; i < end; i++) {
        if (INTERPOLATORS.has(objects[i].typeName) && !referenced.has(i) &&
            allowed(rule, objects[i].index)) {
          removed.add(i);
          actions.push({ rule, objectIndex: objects[i].index, detail: "Removed unreferenced easing object" });
        }
      }
    }
  }

  // All deletion ranges use original positions, processed from back to front.
  for (const [start, end] of bounds.reverse()) {
    const here = new Set([...removed].filter((p) => p >= start && p < end));
    if (here.size) objects = removeAtPositions(objects, start, end, here);
  }
  const changed = actions.length > 0;
  const result = changed ? writeRawRiv({ ...dump, objects }) : bytes;
  const newFindings = changed ? lintRiv(result) : originalFindings;
  if (newFindings.some((f) => f.rule === "parse-error")) throw new Error("Repair produced a parse error");
  if (newFindings.filter((f) => f.severity === "error").length >
      originalFindings.filter((f) => f.severity === "error").length) {
    throw new Error("Repair introduced additional structural errors");
  }
  const remaining = new Map<string, number>();
  for (const f of newFindings) {
    const key = f.rule + ":" + (f.objectIndex ?? "") + ":" + f.message;
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  for (const f of originalFindings) {
    const key = f.rule + ":" + (f.objectIndex ?? "") + ":" + f.message;
    const count = remaining.get(key) ?? 0;
    if (count > 0) {
      remaining.set(key, count - 1);
      skips.push({
        rule: f.rule,
        reason: (f.objectIndex !== undefined ? "Object #" + f.objectIndex + ": " : "") +
          (f.rule === "dead-easing" && selected.has("dead-easing")
            ? "final keyframe easing is not applied; not rewritten"
            : selected.has(f.rule as RepairFix)
              ? "Not provably safe to change automatically"
              : "Fix not selected or requires manual review"),
      });
    }
  }
  return {
    bytes: result,
    candidates: actions,
    report: {
      applied: actions.map((action) => ({ fix: action.rule, count: 1, detail: action.detail })),
      skipped: skips,
      before: repairSummary(originalFindings),
      after: repairSummary(newFindings),
      bytes: { before: bytes.length, after: result.length },
      visual: { frames: 0, maxDiffPixels: 0, identical: true },
    },
  };
}
