// Compatibility evidence is scoped to the runtime packages named by each target.
// A minimum version is not evidence of the version installed by the caller.
export const PREFLIGHT_TARGETS = [
  "web", "ios", "android", "flutter", "unity", "react-native",
] as const;

export type PreflightTarget = (typeof PREFLIGHT_TARGETS)[number];
export type PreflightFeature =
  | "Data Binding" | "Layout" | "Vector Feathering" | "Scripting"
  | "Audio" | "Text" | "Text Follow Path" | "N-Slicing";

export interface PreflightMatrixEntry {
  feature: PreflightFeature;
  target: PreflightTarget;
  minimumVersion: string | null;
  support: "supported" | "conditional" | "unsupported";
  source: string;
  note?: string;
}

const SOURCE = "https://raw.githubusercontent.com/rive-app/rive-docs/main/snippets/feature-support.jsx";

// Version thresholds are transcribed from the official Feature Support table.
// For web the WebGL2 package is used; the caller must separately verify its renderer.
const releases: Array<{
  feature: PreflightFeature;
  versions: Record<PreflightTarget, string | null>;
}> = [
  {
    feature: "Data Binding",
    versions: {
      web: "2.26.6+", ios: "6.8.0+", android: "10.1.0+",
      flutter: "0.14.0-dev.1", unity: "0.3.6-canary.27", "react-native": "0.1.4+",
    },
  },
  {
    feature: "Layout",
    versions: {
      web: "2.23.3+", ios: "6.3.0+", android: "9.10.0+",
      flutter: "0.14.0-dev.1", unity: "0.2.1+", "react-native": "0.1.4+",
    },
  },
  {
    feature: "Vector Feathering",
    versions: {
      web: "2.26.0+", ios: "6.6.0+", android: "10.0.0+",
      flutter: "0.14.0-dev.1", unity: "0.3.3-canary.72+", "react-native": "0.1.4+",
    },
  },
  {
    feature: "Scripting",
    versions: {
      web: "2.34.0+", ios: "6.13.0+", android: "11.1.0+",
      flutter: "0.14.1", unity: "0.4.1-canary.33+", "react-native": "0.1.5+",
    },
  },
  {
    feature: "Audio",
    versions: {
      web: "2.15.6+", ios: "5.11.5+", android: "9.3.5+",
      flutter: "0.13.4+", unity: null, "react-native": "0.1.4+",
    },
  },
  {
    feature: "Text",
    versions: {
      web: "2.11.0+", ios: "5.1.5+", android: "8.1.3+",
      flutter: "0.11.14+", unity: null, "react-native": "0.1.4+",
    },
  },
  {
    feature: "Text Follow Path",
    versions: {
      web: "2.26.7+", ios: "6.7.4+", android: "10.0.4",
      flutter: "0.14.0-dev.1", unity: "0.3.5+", "react-native": "0.1.4+",
    },
  },
  {
    feature: "N-Slicing",
    versions: {
      web: "2.23.11+", ios: "6.4.0+", android: "9.12.0+",
      flutter: "0.14.0-dev.1", unity: "0.2.2-canary.22+", "react-native": "0.1.4+",
    },
  },
];

export const PREFLIGHT_MATRIX: ReadonlyArray<PreflightMatrixEntry> =
  releases.flatMap(({ feature, versions }) =>
    PREFLIGHT_TARGETS.map((target) => ({
      feature,
      target,
      minimumVersion: versions[target],
      support: feature === "Vector Feathering" && target === "web"
        ? "conditional" as const : "supported" as const,
      source: SOURCE,
      ...(versions[target] === null
        ? { note: "The official table lists Supported but does not specify a minimum runtime version." }
        : {}),
      ...(feature === "Vector Feathering" && target === "web"
        ? { note: "Requires the WebGL2 Rive Renderer; Canvas2D does not support feathering." }
        : {}),
    })),
  );
