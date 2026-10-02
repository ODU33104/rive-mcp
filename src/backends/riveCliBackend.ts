import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { sha256Bytes, revisionHash } from "../revisions/hash.js";
import type {
  BackendIdentity,
  Diagnostic,
  ExecutionArtifact,
  ExecutionResult,
  InspectResult,
  ProjectRef,
  Scenario,
  ScenarioStep,
  ScenarioStepOutcome,
  VerifyResult,
} from "../execution/types.js";
import type { RiveExecutionBackend } from "./types.js";

interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
  elapsedMs: number;
}

export interface RiveCliBackendOptions {
  binary?: string;
  outputDir?: string;
  timeoutMs?: number;
}

function runProcess(
  binary: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number }
): Promise<ProcessResult> {
  return new Promise((resolveResult, reject) => {
    const started = Date.now();
    const child = spawn(binary, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, RIVE_NO_TUI: "1", TERM: "dumb" },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveResult({
        code: timedOut ? 124 : (code ?? 1),
        stdout,
        stderr,
        elapsedMs: Date.now() - started,
      });
    });
  });
}

function parseJson(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(trimmed.slice(start, end + 1)); } catch {}
    }
    return undefined;
  }
}

function problemDiagnostics(raw: unknown): Diagnostic[] {
  if (!raw || typeof raw !== "object") return [];
  const root = raw as Record<string, unknown>;
  const data = root.data && typeof root.data === "object"
    ? root.data as Record<string, unknown>
    : undefined;
  const candidates = [
    ...(Array.isArray(root.problems) ? root.problems : []),
    ...(Array.isArray(data?.problems) ? data!.problems as unknown[] : []),
  ];
  return candidates.map((problem) => {
    const p = problem && typeof problem === "object"
      ? problem as Record<string, unknown>
      : { message: String(problem) };
    const severity = p.severity === "warning"
      ? "warning"
      : p.severity === "hint" ? "info" : "error";
    return {
      severity,
      code: String(p.code ?? p.kind ?? "RIVE_CLI_PROBLEM"),
      message: String(p.message ?? JSON.stringify(p)),
      source: typeof p.script === "string" ? p.script : undefined,
      details: problem,
    };
  });
}

function failedProcessDiagnostic(result: ProcessResult, command: string): Diagnostic[] {
  if (result.code === 0) return [];
  return [{
    severity: "error",
    code: result.code === 124 ? "BACKEND_TIMEOUT" : "RIVE_CLI_EXIT",
    message: `${command} exited with code ${result.code}: ${(result.stderr || result.stdout).trim().slice(-2000)}`,
    source: "rive-cli",
  }];
}

function dataValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return undefined;
}

function summarizeInspect(raw: unknown): InspectResult["summary"] {
  if (!raw || typeof raw !== "object") return {};
  const root = raw as Record<string, unknown>;
  const artboards = Array.isArray(root.artboards) ? root.artboards : [];
  return {
    artboardCount: artboards.length,
    artboards: artboards.map((item) => {
      const a = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        name: typeof a.name === "string" ? a.name : undefined,
        animationCount: Array.isArray(a.animations) ? a.animations.length : undefined,
        stateMachineCount: Array.isArray(a.stateMachines) ? a.stateMachines.length : undefined,
      };
    }),
    problems: Array.isArray(root.problems) ? root.problems : undefined,
  };
}

function artifact(path: string, kind: ExecutionArtifact["kind"], mediaType?: string): ExecutionArtifact {
  const bytes = readFileSync(path);
  return {
    kind,
    path,
    sha256: sha256Bytes(bytes),
    bytes: bytes.length,
    mediaType,
  };
}

export class RiveCliBackend implements RiveExecutionBackend {
  private readonly binary: string;
  private readonly outputDir: string;
  private readonly timeoutMs: number;
  private identity?: BackendIdentity;

  constructor(options: RiveCliBackendOptions = {}) {
    this.binary = options.binary ?? process.env.RIVE_CLI_BIN ?? "rive";
    this.outputDir = resolve(options.outputDir ?? ".rive-mcp/evidence");
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async identify(): Promise<BackendIdentity> {
    if (this.identity) return this.identity;
    const result = await runProcess(this.binary, ["--version"], { timeoutMs: this.timeoutMs });
    if (result.code !== 0) {
      throw new Error(`Unable to identify Rive CLI: ${(result.stderr || result.stdout).trim()}`);
    }
    const versionText = (result.stdout || result.stderr).trim();
    const version = versionText.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)?.[0] ?? versionText;
    this.identity = {
      id: "rive-cli",
      name: "Official Rive CLI",
      version,
      capabilities: {
        projectKinds: ["directory"],
        scenarioSteps: { data: true, pointer: true, key: true, advance: true },
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
    if (project.kind !== "directory") {
      return {
        ok: false,
        diagnostics: [{
          severity: "error",
          code: "UNSUPPORTED_PROJECT_KIND",
          message: "Rive CLI backend requires an RML project directory.",
        }],
        elapsedMs: Date.now() - started,
      };
    }
    const result = await runProcess(
      this.binary,
      [project.path, "--verify", "--format=json"],
      { timeoutMs: this.timeoutMs }
    );
    const raw = parseJson(result.stdout);
    const diagnostics = [
      ...problemDiagnostics(raw),
      ...failedProcessDiagnostic(result, "rive --verify"),
    ];
    const success = raw && typeof raw === "object"
      ? (raw as Record<string, unknown>).success
      : undefined;
    return {
      ok: result.code === 0 && success !== false && !diagnostics.some((d) => d.severity === "error"),
      diagnostics,
      elapsedMs: result.elapsedMs,
      raw,
    };
  }

  async inspect(project: ProjectRef): Promise<InspectResult> {
    const started = Date.now();
    if (project.kind !== "directory") {
      return {
        ok: false,
        summary: {},
        diagnostics: [{
          severity: "error",
          code: "UNSUPPORTED_PROJECT_KIND",
          message: "Rive CLI backend requires an RML project directory.",
        }],
        elapsedMs: Date.now() - started,
      };
    }
    const result = await runProcess(
      this.binary,
      ["inspect", project.path, "--json"],
      { timeoutMs: this.timeoutMs }
    );
    const raw = parseJson(result.stdout);
    const diagnostics = [
      ...problemDiagnostics(raw),
      ...failedProcessDiagnostic(result, "rive inspect"),
    ];
    return {
      ok: result.code === 0 && raw !== undefined && !diagnostics.some((d) => d.severity === "error"),
      summary: summarizeInspect(raw),
      diagnostics,
      elapsedMs: result.elapsedMs,
      raw,
    };
  }

  async execute(project: ProjectRef, scenario: Scenario): Promise<ExecutionResult> {
    const identity = await this.identify();
    const started = Date.now();
    const eventSequence: ScenarioStepOutcome[] = [];
    const unsupported: string[] = [];
    if (project.kind !== "directory") {
      return {
        ok: false,
        backend: identity,
        eventSequence,
        unsupported: ["project: riv"],
        diagnostics: [{
          severity: "error",
          code: "UNSUPPORTED_PROJECT_KIND",
          message: "Rive CLI backend executes RML project directories, not standalone .riv files.",
        }],
        artifacts: [],
        dataSnapshots: [],
        performance: { elapsedMs: Date.now() - started },
      };
    }

    const interactionArgs: string[] = [];
    for (let index = 0; index < scenario.steps.length; index++) {
      const step = scenario.steps[index]!;
      const mapped = this.mapStep(step);
      if (mapped.error) {
        unsupported.push(mapped.error);
        eventSequence.push({ index, step, status: "unsupported", detail: mapped.error });
      } else {
        interactionArgs.push(mapped.arg!);
        eventSequence.push({ index, step, status: "applied" });
      }
    }

    if (scenario.capture?.dataSnapshot && !identity.capabilities.dataSnapshot) {
      unsupported.push("capture: dataSnapshot");
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

    mkdirSync(this.outputDir, { recursive: true });
    const scenarioId = revisionHash(scenario).slice("sha256:".length, "sha256:".length + 16);
    const stem = `${basename(resolve(project.path))}-${scenarioId}`;
    const screenshotPath = join(this.outputDir, `${stem}.png`);
    const dataPath = join(this.outputDir, `${stem}.data.json`);
    const args = [
      project.path,
      `--screenshot=${screenshotPath}`,
      ...interactionArgs,
    ];
    if (scenario.viewport) {
      args.push(`--viewport=${scenario.viewport.width}x${scenario.viewport.height}`);
    }
    if (scenario.target?.artboard) args.push(`--artboard=${scenario.target.artboard}`);
    if (scenario.capture?.dataSnapshot) args.push(`--data-dump=${dataPath}`);

    const result = await runProcess(this.binary, args, { timeoutMs: this.timeoutMs });
    const diagnostics = [
      ...failedProcessDiagnostic(result, "rive --screenshot"),
    ];
    if (diagnostics.some((d) => d.severity === "error")) {
      for (const outcome of eventSequence) {
        if (outcome.status === "applied") outcome.status = "failed";
      }
    }

    const artifacts: ExecutionArtifact[] = [];
    if (existsSync(screenshotPath) && statSync(screenshotPath).isFile()) {
      artifacts.push(artifact(screenshotPath, "screenshot", "image/png"));
    }
    const dataSnapshots: ExecutionResult["dataSnapshots"] = [];
    if (scenario.capture?.dataSnapshot && existsSync(dataPath)) {
      const text = readFileSync(dataPath, "utf8");
      const value = parseJson(text) ?? text;
      const dataArtifact = artifact(dataPath, "data-snapshot", "application/json");
      artifacts.push(dataArtifact);
      dataSnapshots.push({ path: dataPath, sha256: dataArtifact.sha256, value });
    }

    return {
      ok: result.code === 0
        && diagnostics.every((d) => d.severity !== "error")
        && artifacts.some((a) => a.kind === "screenshot"),
      backend: identity,
      eventSequence,
      unsupported,
      diagnostics,
      artifacts,
      dataSnapshots,
      performance: { elapsedMs: result.elapsedMs },
      raw: { stdout: result.stdout, stderr: result.stderr, exitCode: result.code },
    };
  }

  private mapStep(step: ScenarioStep): { arg?: string; error?: string } {
    switch (step.type) {
      case "data": {
        const value = dataValue(step.value);
        if (value === undefined) {
          return { error: `data value at "${step.path}" must be a finite number, boolean, or string` };
        }
        return { arg: `--data=${step.path}=${value}` };
      }
      case "pointer": {
        if (!["down", "up", "move", "exit", "click"].includes(step.action)) {
          return { error: `pointer action "${step.action}" is not representable by the current Scenario model` };
        }
        if (!Number.isFinite(step.x) || !Number.isFinite(step.y)) {
          return { error: "pointer coordinates must be finite numbers" };
        }
        return { arg: `--pointer=${step.action}@${step.x},${step.y}` };
      }
      case "key":
        return step.key
          ? { arg: `--key=${step.key}` }
          : { error: "key must not be empty" };
      case "advance":
        return Number.isFinite(step.ms) && step.ms >= 0
          ? { arg: `--advance=${step.ms}ms` }
          : { error: "advance.ms must be a finite non-negative number" };
    }
  }
}
