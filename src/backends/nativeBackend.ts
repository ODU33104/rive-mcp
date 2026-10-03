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
        scenarioSteps: { data: false, pointer: false, key: false, advance: true },
        verify: true,
        inspect: true,
        screenshot: true,
        dataSnapshot: false,
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
      if (step.type !== "advance") {
        const message = `native backend does not implement Scenario step "${step.type}"`;
        unsupported.push(message);
        eventSequence.push({ index, step, status: "unsupported", detail: message });
      } else if (!Number.isFinite(step.ms) || step.ms < 0) {
        const message = "advance.ms must be a finite non-negative number";
        unsupported.push(message);
        eventSequence.push({ index, step, status: "unsupported", detail: message });
      } else {
        eventSequence.push({ index, step, status: "applied" });
      }
    }
    if (scenario.capture?.dataSnapshot) {
      unsupported.push("native backend does not expose data snapshots through this Scenario adapter");
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
      const elapsedSeconds = scenario.steps.reduce(
        (sum, step) => sum + (step.type === "advance" ? step.ms / 1000 : 0),
        0
      );
      const shouldCapture = scenario.capture?.screenshot !== false;
      const artifacts: ExecutionResult["artifacts"] = [];
      let raw: unknown;
      if (shouldCapture) {
        const result = await this.host.renderFrames(bytes, {
          artboard: scenario.target?.artboard,
          animation: scenario.target?.animation,
          stateMachine: scenario.target?.stateMachine,
          startTime: elapsedSeconds,
          frameCount: 1,
          format: "png",
          width: scenario.viewport?.width,
          height: scenario.viewport?.height,
        });
        raw = {
          width: result.width,
          height: result.height,
          states: result.states,
        };
        if (!result.frames[0]) throw new Error("Native runtime returned no screenshot frame.");
        mkdirSync(this.outputDir, { recursive: true });
        const scenarioId = revisionHash(scenario).slice("sha256:".length, "sha256:".length + 16);
        const outPath = join(this.outputDir, `native-${scenarioId}.png`);
        const png = Buffer.from(result.frames[0], "base64");
        writeFileSync(outPath, png);
        artifacts.push({
          kind: "screenshot",
          path: outPath,
          sha256: sha256Bytes(png),
          bytes: png.length,
          mediaType: "image/png",
        });
      }
      return {
        ok: true,
        backend: identity,
        eventSequence,
        unsupported,
        diagnostics: [],
        artifacts,
        dataSnapshots: [],
        performance: { elapsedMs: Date.now() - started },
        raw,
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
