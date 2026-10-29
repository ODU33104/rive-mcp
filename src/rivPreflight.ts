import { readRiv, type RivObject } from "./rivBinary.js";
import {
  PREFLIGHT_MATRIX, PREFLIGHT_TARGETS, type PreflightTarget,
  type PreflightMatrixEntry,
} from "./preflightMatrix.js";

export interface PreflightIssue {
  feature: string;
  reason: string;
  source: string;
}

export interface PreflightResult {
  file: { bytes: number; majorVersion: number; minorVersion: number };
  features: Array<{ feature: string; count: number; where?: string[] }>;
  targets: Array<{
    target: PreflightTarget;
    verdict: "ok" | "warn" | "unsupported" | "unknown";
    issues: PreflightIssue[];
  }>;
  summary: { ok: number; warn: number; unsupported: number; unknown: number };
  runtimeCheck: { officialWasm: "loaded" | "failed"; detail: string };
}

const CORE_TYPES = new Set([
  "Backboard", "Artboard", "Node", "TransformComponent", "Shape",
  "Rectangle", "Ellipse", "Triangle", "Polygon", "Star", "Path",
  "PointsPath", "StraightVertex", "CubicVertex", "CubicDetachedVertex",
  "Fill", "Stroke", "SolidColor", "LinearGradient", "RadialGradient",
  "GradientStop", "ClippingShape", "Paint", "ShapePaint",
]);

// Categories describe only objects whose typeKey is physically present in the file.
// Unknown/new typeKeys remain visible rather than being treated as supported.
function category(name: string): string {
  if (/^type#\d+$/.test(name)) return "Unregistered type " + name.slice(5);
  if (/^(Script|Scripted)/.test(name)) return "Scripting";
  if (/^NSlic/.test(name)) return "N-Slicing";
  if (name === "Feather") return "Vector Feathering";
  if (name === "TextFollowPathModifier") return "Text Follow Path";
  if (/^(ViewModel|DataBind|DataConverter|BindableProperty)/.test(name)) return "Data Binding";
  if (/^(LayoutComponent|ForegroundLayoutDrawable|NestedArtboardLayout)/.test(name)) return "Layout";
  if (/^(AudioAsset|AudioEvent|ExportAudio)$/.test(name)) return "Audio";
  if (/^(Mesh|MeshVertex|ContourMeshVertex|Skin|Tendon|Weight|CubicWeight)$/.test(name)) return "Mesh Deformation";
  if (/^(Bone|RootBone|IKConstraint)$/.test(name)) return "Bones and IK";
  if (/^Blend(State|Animation)/.test(name)) return "Blend states";
  if (name === "Joystick") return "Joystick";
  if (/^(Text|FontAsset)/.test(name)) return "Text";
  if (/^(StateMachine|AnimationState|EntryState|AnyState|ExitState|StateTransition|Transition)/.test(name)) return "State Machine";
  if (/^(LinearAnimation|KeyedObject|KeyedProperty|KeyFrame|CubicEaseInterpolator)/.test(name)) return "Linear animations";
  if (name === "FollowPathConstraint") return "Follow Path";
  if (/^(Image|ImageAsset|LayerImageAsset)$/.test(name)) return "Raster images";
  if (/^(Event|OpenUrlEvent|Listener)/.test(name)) return "Events and listeners";
  if (/^NestedArtboard/.test(name)) return "Nested artboards";
  if (CORE_TYPES.has(name)) return "Core vector graphics";
  return "Other object types";
}

function detectFeatures(objects: RivObject[]): PreflightResult["features"] {
  const counts = new Map<string, { count: number; types: Set<string> }>();
  for (const object of objects) {
    const feature = category(object.typeName);
    const entry = counts.get(feature) ?? { count: 0, types: new Set<string>() };
    entry.count++;
    entry.types.add(`${object.typeName} (typeKey ${object.typeKey})`);
    counts.set(feature, entry);
  }
  return [...counts].map(([feature, { count, types }]) => ({
    feature,
    count,
    where: [...types].sort().slice(0, 12),
  })).sort((a, b) => a.feature.localeCompare(b.feature));
}

const matrixIndex = new Map<string, PreflightMatrixEntry>(
  PREFLIGHT_MATRIX.map((row) => [`${row.feature}:\0${row.target}`, row]),
);

export async function preflightRiv(
  bytes: Buffer,
  selectedTargets: readonly PreflightTarget[],
  strict: boolean,
  inspectOfficial: (bytes: Buffer) => Promise<{ artboardCount: number }>,
): Promise<PreflightResult> {
  if (bytes.length < 8 || bytes.toString("latin1", 0, 4) !== "RIVE") {
    throw new Error("Invalid or truncated .riv header");
  }
  const dump = readRiv(bytes, { tolerant: true });
  if (dump.error) throw new Error(`Cannot parse .riv: ${dump.error}`);
  if (!dump.objects.some((item) => item.typeName === "Artboard")) {
    throw new Error("Invalid or truncated .riv: no artboard found");
  }
  const features = detectFeatures(dump.objects);
  let runtimeCheck: PreflightResult["runtimeCheck"];
  try {
    const result = await inspectOfficial(bytes);
    runtimeCheck = {
      officialWasm: "loaded",
      detail: `Official canvas_advanced WASM loaded ${result.artboardCount} artboard(s); this does not verify other runtimes.`,
    };
  } catch (error) {
    runtimeCheck = {
      officialWasm: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const targets: PreflightResult["targets"] = selectedTargets.map((target) => {
    const issues: PreflightIssue[] = [];
    let uncertain = false;
    let warning = runtimeCheck.officialWasm === "failed";
    let unsupported = false;
    for (const item of features) {
      const entry = matrixIndex.get(`${item.feature}:\0${target}`);
      if (!entry) {
        uncertain = true;
        issues.push({
          feature: item.feature,
          reason: "No verified compatibility entry for this feature and target.",
          source: "unverified",
        });
        continue;
      }
      if (entry.support === "unsupported") {
        unsupported = true;
        issues.push({
          feature: item.feature,
          reason: entry.note ?? "The official compatibility table marks this feature unsupported.",
          source: entry.source,
        });
        continue;
      }
      if (entry.support === "conditional") warning = true;
      else uncertain = true;
      const threshold = entry.minimumVersion === null
        ? "a version not specified by the official table"
        : `version ${entry.minimumVersion}`;
      issues.push({
        feature: item.feature,
        reason: entry.support === "conditional"
          ? `${entry.note} Documented from ${threshold}; installed version and renderer are unknown.`
          : `The official table reports support from ${threshold}, but the installed runtime version was not provided.`,
        source: entry.source,
      });
    }
    if (runtimeCheck.officialWasm === "failed") {
      issues.push({
        feature: "Official WASM load",
        reason: runtimeCheck.detail,
        source: "src/riveHost.ts (local official WASM inspection)",
      });
    }
    const verdict = unsupported ? "unsupported"
      : warning || (strict && uncertain) ? "warn"
      : uncertain ? "unknown" : "ok";
    return { target, verdict, issues };
  });
  const summary = { ok: 0, warn: 0, unsupported: 0, unknown: 0 };
  for (const item of targets) summary[item.verdict]++;
  return {
    file: { bytes: bytes.length, majorVersion: dump.major, minorVersion: dump.minor },
    features, targets, summary, runtimeCheck,
  };
}

export function preflightTargets(value?: string[]): PreflightTarget[] {
  if (value === undefined) return [...PREFLIGHT_TARGETS];
  const invalid = value.filter((target) => !PREFLIGHT_TARGETS.some((t) => t === target));
  if (invalid.length) {
    throw new Error(`Unknown target(s): ${invalid.join(", ")}. Supported: ${PREFLIGHT_TARGETS.join(", ")}`);
  }
  return [...new Set(value)] as PreflightTarget[];
}
