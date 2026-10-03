import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGE_SCRIPT } from "../pageScript.js";
import { RiveHost } from "../riveHost.js";

export type RawRivScenarioStep =
  | { type: "data"; path: string; value: unknown }
  | { type: "pointer"; action: string; x: number; y: number }
  | { type: "key"; key: string }
  | { type: "advance"; ms: number };

export interface RawRivScenario {
  id?: string;
  name?: string;
  target?: {
    artboard?: string;
    animation?: string;
    stateMachine?: string;
  };
  viewport?: { width: number; height: number };
  steps: RawRivScenarioStep[];
  capture?: {
    screenshot?: boolean;
    dataSnapshot?: boolean;
  };
}

export interface RawRivStepObservation {
  index: number;
  step: RawRivScenarioStep;
  statesChanged: string[];
  deliveryAdvanceSeconds?: number;
}

export interface RawRivDataObservation {
  available: boolean;
  viewModelName?: string;
  values: Record<string, boolean>;
  unsupportedProperties: Array<{ name: string; type: string }>;
}

export interface RawRivScenarioResult {
  schemaVersion: "rive-mcp.raw-riv-scenario/v1";
  ok: boolean;
  artifact: {
    sha256: string;
    bytes: number;
    unchangedAfterExecution: boolean;
  };
  backend: {
    name: "rive-mcp canvas-advanced raw-riv bridge";
    version: string;
    runtime: {
      name: "@rive-app/canvas-advanced";
      version: string;
    };
  };
  capabilities: {
    exactRawRiv: true;
    supportedActions: ["pointer:down", "pointer:up", "advance"];
    unsupportedActions: ["data", "key"];
    stateObservation: "state-changes";
    dataObservation: "top-level-boolean-view-model";
    visualObservation: "png";
  };
  unsupported: string[];
  scenarioHash: string;
  observations?: {
    initialStatesChanged: string[];
    steps: RawRivStepObservation[];
    initialData: RawRivDataObservation;
    finalData?: RawRivDataObservation;
    screenshot?: {
      width: number;
      height: number;
      sha256: string;
      bytes: number;
      base64: string;
    };
  };
  error?: string;
}

interface BrowserRawScenarioResult {
  initialStatesChanged: string[];
  steps: RawRivStepObservation[];
  initialData: RawRivDataObservation;
  finalData?: RawRivDataObservation;
  screenshot?: {
    width: number;
    height: number;
    base64: string;
  };
}

const READY_MARKER = "window.__riveReady = true;";

const RAW_RIV_EXTENSION = String.raw`
function rawRivBooleanSnapshot(file, artboard, vmi) {
  if (!vmi) {
    return {
      available: false,
      values: {},
      unsupportedProperties: [],
    };
  }
  const vm = file.defaultArtboardViewModel(artboard);
  const values = {};
  const unsupportedProperties = [];
  const properties = vmi.getProperties();
  for (const property of properties) {
    const type = String(property.type);
    if (type === "boolean") {
      const value = vmi.boolean(property.name);
      if (value) values[property.name] = value.value;
    } else {
      unsupportedProperties.push({ name: property.name, type });
    }
  }
  return {
    available: true,
    viewModelName: vm ? vm.name : undefined,
    values,
    unsupportedProperties,
  };
}

window.riveApi.runRawRivScenario = async function(b64, opts) {
  return withFile(b64, (file) => {
    const scene = makeScene(file, {
      artboard: opts.target && opts.target.artboard,
      stateMachine: opts.target && opts.target.stateMachine,
      width: opts.viewport && opts.viewport.width,
      height: opts.viewport && opts.viewport.height,
    });

    if (!scene.sm) {
      scene.cleanup();
      throw new Error("Raw .riv Scenario bridge requires a State Machine");
    }

    let vmi = null;
    try {
      const vm = file.defaultArtboardViewModel(scene.ab);
      if (vm) {
        vmi = vm.defaultInstance();
        if (vmi) {
          // canvas-advanced 2.38.5 high-level autoBind delegates to the
          // StateMachineInstance bindViewModelInstance API directly.
          scene.sm.bindViewModelInstance(vmi);
        }
      }

      const initialStatesChanged = scene.step(0);
      const initialData = rawRivBooleanSnapshot(file, scene.ab, vmi);
      const steps = [];

      for (let index = 0; index < opts.steps.length; index++) {
        const step = opts.steps[index];
        let statesChanged = [];
        let deliveryAdvanceSeconds;

        if (step.type === "pointer") {
          if (step.action === "down") {
            scene.sm.pointerDown(step.x, step.y, 1);
          } else if (step.action === "up") {
            scene.sm.pointerUp(step.x, step.y, 1);
          } else {
            throw new Error("unsupported pointer action reached runtime bridge: " + step.action);
          }

          // Match the official Web host path: pointer down/up is followed by
          // an immediate t=0 State Machine advance/drain. This is delivery
          // semantics, not an additional Scenario action.
          statesChanged = scene.step(0);
          deliveryAdvanceSeconds = 0;
        } else if (step.type === "advance") {
          statesChanged = scene.seek(step.ms / 1000);
        } else {
          throw new Error("unsupported Scenario step reached runtime bridge: " + step.type);
        }

        steps.push({
          index,
          step,
          statesChanged,
          ...(deliveryAdvanceSeconds === undefined
            ? {}
            : { deliveryAdvanceSeconds }),
        });
      }

      const finalData = opts.capture && opts.capture.dataSnapshot
        ? rawRivBooleanSnapshot(file, scene.ab, vmi)
        : undefined;

      let screenshot;
      if (!opts.capture || opts.capture.screenshot !== false) {
        scene.draw();
        screenshot = {
          width: scene.width,
          height: scene.height,
          base64: scene.capture("png"),
        };
      }

      return {
        initialStatesChanged,
        steps,
        initialData,
        finalData,
        screenshot,
      };
    } finally {
      scene.cleanup();
      if (vmi && typeof vmi.delete === "function") vmi.delete();
    }
  });
};
`;

function bridgePageScript(): string {
  if (!PAGE_SCRIPT.includes(READY_MARKER)) {
    throw new Error("PAGE_SCRIPT ready marker changed; raw .riv bridge injection must be reviewed.");
  }
  return PAGE_SCRIPT.replace(READY_MARKER, RAW_RIV_EXTENSION + "\n" + READY_MARKER);
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const item = source[key];
      if (item !== undefined) out[key] = stableValue(item);
    }
    return out;
  }
  return value;
}

function scenarioHash(scenario: RawRivScenario): string {
  return sha256(JSON.stringify(stableValue(scenario)));
}

function packageVersion(path: string): string {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "unknown";
  } catch {
    return "unknown";
  }
}

function versions(): { backend: string; runtime: string } {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  return {
    backend: packageVersion(join(root, "package.json")),
    runtime: packageVersion(
      join(root, "node_modules", "@rive-app", "canvas-advanced", "package.json")
    ),
  };
}

function unsupportedFor(scenario: RawRivScenario): string[] {
  const unsupported: string[] = [];
  if (scenario.target?.animation) {
    unsupported.push("target.animation is not supported by the raw .riv State Machine bridge");
  }
  for (let index = 0; index < scenario.steps.length; index++) {
    const step = scenario.steps[index]!;
    if (step.type === "data") {
      unsupported.push("step " + index + ": data is not implemented by this bridge");
    } else if (step.type === "key") {
      unsupported.push("step " + index + ": key is not implemented by this bridge");
    } else if (step.type === "pointer") {
      if (!["down", "up"].includes(step.action)) {
        unsupported.push(
          "step " + index + ': pointer action "' + step.action +
          '" is outside the proven pointer down/up subset'
        );
      }
      if (!Number.isFinite(step.x) || !Number.isFinite(step.y)) {
        unsupported.push("step " + index + ": pointer coordinates must be finite");
      }
    } else if (
      step.type === "advance" &&
      (!Number.isFinite(step.ms) || step.ms < 0)
    ) {
      unsupported.push("step " + index + ": advance.ms must be finite and non-negative");
    }
  }
  return unsupported;
}

export class RawRivScenarioBridge {
  async execute(
    rivBytes: Buffer,
    scenario: RawRivScenario
  ): Promise<RawRivScenarioResult> {
    const beforeHash = sha256(rivBytes);
    const beforeBytes = rivBytes.length;
    const unsupported = unsupportedFor(scenario);
    const version = versions();

    const base: Omit<RawRivScenarioResult, "ok"> = {
      schemaVersion: "rive-mcp.raw-riv-scenario/v1",
      artifact: {
        sha256: beforeHash,
        bytes: beforeBytes,
        unchangedAfterExecution: true,
      },
      backend: {
        name: "rive-mcp canvas-advanced raw-riv bridge",
        version: version.backend,
        runtime: {
          name: "@rive-app/canvas-advanced",
          version: version.runtime,
        },
      },
      capabilities: {
        exactRawRiv: true,
        supportedActions: ["pointer:down", "pointer:up", "advance"],
        unsupportedActions: ["data", "key"],
        stateObservation: "state-changes",
        dataObservation: "top-level-boolean-view-model",
        visualObservation: "png",
      },
      unsupported,
      scenarioHash: scenarioHash(scenario),
    };

    if (unsupported.length > 0) {
      return { ...base, ok: false };
    }

    const host = new RiveHost(bridgePageScript());
    try {
      const page = await host.getPage();
      const result = await page.evaluate(
        async ([b64, opts]) => {
          const api = (window as unknown as {
            riveApi: {
              runRawRivScenario: (
                b64: string,
                opts: unknown
              ) => Promise<BrowserRawScenarioResult>;
            };
          }).riveApi;
          return api.runRawRivScenario(b64 as string, opts);
        },
        [rivBytes.toString("base64"), scenario] as const
      );

      const afterHash = sha256(rivBytes);
      const artifactUnchanged =
        beforeHash === afterHash && beforeBytes === rivBytes.length;

      let screenshot:
        | {
            width: number;
            height: number;
            base64: string;
            sha256: string;
            bytes: number;
          }
        | undefined = undefined;
      if (result.screenshot) {
        const png = Buffer.from(result.screenshot.base64, "base64");
        screenshot = {
          ...result.screenshot,
          sha256: sha256(png),
          bytes: png.length,
        };
      }

      return {
        ...base,
        ok: artifactUnchanged,
        artifact: {
          ...base.artifact,
          unchangedAfterExecution: artifactUnchanged,
        },
        observations: {
          ...result,
          screenshot,
        },
      };
    } catch (error) {
      return {
        ...base,
        ok: false,
        artifact: {
          ...base.artifact,
          unchangedAfterExecution:
            beforeHash === sha256(rivBytes) && beforeBytes === rivBytes.length,
        },
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await host.close();
    }
  }
}
