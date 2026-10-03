import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RiveHost } from "../riveHost.js";
import { PAGE_SCRIPT } from "../pageScript.js";
import { revisionHash, sha256Bytes } from "../evidence/hash.js";
import type {
  BackendIdentity,
  Diagnostic,
  ExecutionResult,
  InspectResult,
  ProjectRef,
  Scenario,
  VerifyResult,
} from "../execution/types.js";
import type { RiveExecutionBackend } from "./types.js";

export interface NativeBackendOptions {
  outputDir?: string;
}

function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function packageVersion(path: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

function errorDiagnostic(error: unknown, code: string): Diagnostic {
  return {
    severity: "error",
    code,
    message: error instanceof Error ? error.message : String(error),
    source: "rive-mcp-native",
  };
}

export class NativeBackend implements RiveExecutionBackend {
  private readonly host: RiveHost;
  private readonly outputDir: string;
  private identity?: BackendIdentity;

  constructor(options: NativeBackendOptions = {}) {
    this.host = new RiveHost(PAGE_SCRIPT);
    this.outputDir = resolve(options.outputDir ?? ".rive-mcp/evidence");
  }

  async identify(): Promise<BackendIdentity> {
    if (this.identity) return this.identity;
    const root = repoRoot();
    this.identity = {
      id: "rive-mcp-native",
      name: "rive-mcp native runtime backend",
      version: packageVersion(join(root, "package.json")) ?? "unknown",
      runtimeVersion: packageVersion(join(root, "node_modules", "@rive-app", "canvas-advanced", "package.json")),
      capabilities: {
        projectKinds: ["riv"],
        scenarioSteps: { data: false, pointer: true, key: false, advance: true },
        verify: true,
        inspect: true,
        screenshot: true,
        dataSnapshot: true,
      },
    };
    return this.identity;
  }

  async verify(project: ProjectRef): Promise<VerifyResult> {
    const started = Date.now();
    if (project.kind !== "riv") {
      return {
        ok: false,
        diagnostics: [{
          severity: "error",
          code: "UNSUPPORTED_PROJECT_KIND",
          message: "Native backend requires a standalone .riv file.",
        }],
        elapsedMs: Date.now() - started,
      };
    }
    try {
      const bytes = readFileSync(project.path);
      await this.host.inspect(bytes);
      return { ok: true, diagnostics: [], elapsedMs: Date.now() - started };
    } catch (error) {
      return {
        ok: false,
        diagnostics: [errorDiagnostic(error, "NATIVE_RUNTIME_REJECTED")],
        elapsedMs: Date.now() - started,
      };
    }
  }

  async inspect(project: ProjectRef): Promise<InspectResult> {
    const started = Date.now();
    if (project.kind !== "riv") {
      return {
        ok: false,
        summary: {},
        diagnostics: [{
          severity: "error",
          code: "UNSUPPORTED_PROJECT_KIND",
          message: "Native backend requires a standalone .riv file.",
        }],
        elapsedMs: Date.now() - started,
      };
    }
    try {
      const raw = await this.host.inspect(readFileSync(project.path));
      return {
        ok: true,
        summary: {
          artboardCount: raw.artboardCount,
          artboards: raw.artboards.map((artboard) => ({
            name: artboard.name,
            animationCount: artboard.animations.length,
            stateMachineCount: artboard.stateMachines.length,
          })),
        },
        diagnostics: [],
        elapsedMs: Date.now() - started,
        raw,
      };
    } catch (error) {
      return {
        ok: false,
        summary: {},
        diagnostics: [errorDiagnostic(error, "NATIVE_INSPECT_FAILED")],
        elapsedMs: Date.now() - started,
      };
    }
  }

  async execute(project: ProjectRef, scenario: Scenario): Promise<ExecutionResult> {
    const identity = await this.identify();
    const started = Date.now();
    const eventSequence: ExecutionResult["eventSequence"] = [];
    const unsupported: string[] = [];

    if (project.kind !== "riv") {
      return {
        ok: false,
        backend: identity,
        eventSequence,
        unsupported: ["project: directory"],
        diagnostics: [{
          severity: "error",
          code: "UNSUPPORTED_PROJECT_KIND",
          message: "Native backend executes standalone .riv files, not RML project directories.",
        }],
        artifacts: [],
        dataSnapshots: [],
        performance: { elapsedMs: Date.now() - started },
      };
    }

    for (let index = 0; index < scenario.steps.length; index++) {
      const step = scenario.steps[index]!;
      if (step.type === "data" || step.type === "key") {
        const message = `native backend does not implement Scenario step "${step.type}"`;
        unsupported.push(message);
        eventSequence.push({ index, step, status: "unsupported", detail: message });
      } else if (step.type === "pointer") {
        if (!["down", "up"].includes(step.action)) {
          const message = `pointer action "${step.action}" is not supported by the raw runtime bridge`;
          unsupported.push(message);
          eventSequence.push({ index, step, status: "unsupported", detail: message });
        } else if (!Number.isFinite(step.x) || !Number.isFinite(step.y)) {
          const message = "pointer coordinates must be finite numbers";
          unsupported.push(message);
          eventSequence.push({ index, step, status: "unsupported", detail: message });
        } else {
          eventSequence.push({ index, step, status: "applied" });
        }
      } else if (!Number.isFinite(step.ms) || step.ms < 0) {
        const message = "advance.ms must be a finite non-negative number";
        unsupported.push(message);
        eventSequence.push({ index, step, status: "unsupported", detail: message });
      } else {
        eventSequence.push({ index, step, status: "applied" });
      }
    }

    if (unsupported.length > 0) {
      return {
        ok: false,
        backend: identity,
        eventSequence,
        unsupported,
        diagnostics: unsupported.map((message) => ({
          severity: "error" as const,
          code: "UNSUPPORTED_SCENARIO_CAPABILITY",
          message,
        })),
        artifacts: [],
        dataSnapshots: [],
        performance: { elapsedMs: Date.now() - started },
      };
    }

    try {
      const bytes = readFileSync(project.path);
      const shouldCapture = scenario.capture?.screenshot !== false;
      const result = await this.host.executeScenario(bytes, {
        artboard: scenario.target?.artboard,
        stateMachine: scenario.target?.stateMachine,
        width: scenario.viewport?.width,
        height: scenario.viewport?.height,
        steps: scenario.steps,
        captureScreenshot: shouldCapture,
      });

      mkdirSync(this.outputDir, { recursive: true });
      const scenarioId = revisionHash(scenario).slice("sha256:".length, "sha256:".length + 16);
      const artifacts: ExecutionResult["artifacts"] = [];
      const dataSnapshots: ExecutionResult["dataSnapshots"] = [];

      if (shouldCapture) {
        if (!result.screenshot) throw new Error("Native runtime returned no screenshot frame.");
        const outPath = join(this.outputDir, `native-${scenarioId}.png`);
        const png = Buffer.from(result.screenshot, "base64");
        writeFileSync(outPath, png);
        artifacts.push({
          kind: "screenshot",
          path: outPath,
          sha256: sha256Bytes(png),
          bytes: png.length,
          mediaType: "image/png",
        });
      }

      if (scenario.capture?.dataSnapshot) {
        if (result.data === null) {
          throw new Error("Native runtime returned no bound ViewModel data snapshot.");
        }
        const dataPath = join(this.outputDir, `native-${scenarioId}.data.json`);
        const dataBytes = Buffer.from(JSON.stringify(result.data, null, 2) + "\n", "utf8");
        writeFileSync(dataPath, dataBytes);
        const dataHash = sha256Bytes(dataBytes);
        artifacts.push({
          kind: "data-snapshot",
          path: dataPath,
          sha256: dataHash,
          bytes: dataBytes.length,
          mediaType: "application/json",
        });
        dataSnapshots.push({
          path: dataPath,
          sha256: dataHash,
          value: result.data,
        });
      }

      return {
        ok: true,
        backend: identity,
        eventSequence,
        unsupported,
        diagnostics: [],
        artifacts,
        dataSnapshots,
        performance: { elapsedMs: Date.now() - started },
        raw: {
          width: result.width,
          height: result.height,
          initial: result.initial,
          steps: result.steps,
        },
      };
    } catch (error) {
      return {
        ok: false,
        backend: identity,
        eventSequence: eventSequence.map((item) => (
          item.status === "applied" ? { ...item, status: "failed" as const } : item
        )),
        unsupported,
        diagnostics: [errorDiagnostic(error, "NATIVE_EXECUTION_FAILED")],
        artifacts: [],
        dataSnapshots: [],
        performance: { elapsedMs: Date.now() - started },
      };
    }
  }

  async close(): Promise<void> {
    await this.host.close();
  }
}
