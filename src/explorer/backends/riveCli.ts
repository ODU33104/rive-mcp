import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Action, ExecutionTrace, ExplorationBackend, JsonValue, StateObservation, TraceStep } from "../types.js";
import { stableJson } from "../../stateSpace/signature.js";
import { actionToRiveCliArgs } from "./riveCliArgs.js";
import { diagnosticLines, hashCanonicalData, hashPngVisualPayload, runCommand } from "./riveCliProcess.js";

export { actionToRiveCliArgs } from "./riveCliArgs.js";
export { hashPngVisualPayload } from "./riveCliProcess.js";

export interface RiveCliCommand { executable?: string; argsPrefix?: readonly string[]; }
export interface RiveCliBackendOptions {
  projectDir: string;
  command?: RiveCliCommand;
  artboard?: string;
  viewport?: { width: number; height: number };
  dataDumpFilter?: readonly string[];
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  /**
   * Cache successful prefix observations for the lifetime of this backend.
   * Exploration assumes the project is immutable during one backend lifetime.
   * Determinism checks should construct a fresh backend per attempt.
   */
  cachePrefixes?: boolean;
}
interface PrefixObservation { observation: StateObservation; diagnostics: string[]; cost: number; }

function jsonObject(value: unknown): Record<string, JsonValue> | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") return undefined;
  return value as Record<string, JsonValue>;
}

function prefixKey(sequence: readonly Action[]): string {
  return stableJson(sequence);
}

export class RiveCliBackend implements ExplorationBackend {
  readonly name = "rive-cli";
  private readonly projectDir: string;
  private readonly executable: string;
  private readonly argsPrefix: readonly string[];
  private readonly artboard?: string;
  private readonly viewport?: { width: number; height: number };
  private readonly dataDumpFilter?: readonly string[];
  private readonly timeoutMs: number;
  private readonly env: NodeJS.ProcessEnv;
  private readonly cachePrefixes: boolean;
  private readonly prefixCache = new Map<string, Omit<PrefixObservation, "cost">>();
  private versionPromise?: Promise<string | undefined>;

  constructor(options: RiveCliBackendOptions) {
    this.projectDir = resolve(options.projectDir);
    this.executable = options.command?.executable ?? "rive";
    this.argsPrefix = options.command?.argsPrefix ?? [];
    this.artboard = options.artboard;
    this.viewport = options.viewport;
    this.dataDumpFilter = options.dataDumpFilter;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.cachePrefixes = options.cachePrefixes ?? true;
    this.env = { ...process.env, RIVE_NO_TUI: "1", TERM: "dumb", RIVE_ANALYTICS: "off", ...options.env };
  }

  private async version(): Promise<string | undefined> {
    if (!this.versionPromise) {
      this.versionPromise = runCommand(this.executable, [...this.argsPrefix, "--version"], {
        cwd: this.projectDir, timeoutMs: Math.min(this.timeoutMs, 15_000), env: this.env,
      }).then((r) => r.code === 0 ? ((r.stdout.trim() || r.stderr.trim()) || undefined) : undefined).catch(() => undefined);
    }
    return this.versionPromise;
  }

  private async observe(sequence: readonly Action[]): Promise<PrefixObservation> {
    const key = prefixKey(sequence);
    if (this.cachePrefixes) {
      const cached = this.prefixCache.get(key);
      if (cached) return { ...cached, cost: 0 };
    }

    const workDir = await mkdtemp(join(tmpdir(), "rive-cli-explorer-"));
    const screenshotPath = join(workDir, "frame.png");
    const dataDumpPath = join(workDir, "data.json");
    try {
      const args = [...this.argsPrefix, this.projectDir, `--screenshot=${screenshotPath}`, `--data-dump=${dataDumpPath}`];
      if (this.artboard) args.push(`--artboard=${this.artboard}`);
      if (this.viewport) args.push(`--viewport=${this.viewport.width}x${this.viewport.height}`);
      if (this.dataDumpFilter?.length) args.push(`--data-dump-filter=${this.dataDumpFilter.join(",")}`);
      for (const action of sequence) args.push(...actionToRiveCliArgs(action));
      const result = await runCommand(this.executable, args, { cwd: this.projectDir, timeoutMs: this.timeoutMs, env: this.env });
      if (result.code !== 0) {
        const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
        throw new Error(`Rive CLI observation failed (${result.code}): ${detail}`);
      }
      const [png, dataBytes] = await Promise.all([readFile(screenshotPath), readFile(dataDumpPath)]);
      const parsed = JSON.parse(dataBytes.toString("utf8")) as unknown;
      const observed = {
        observation: {
          viewModel: jsonObject(parsed),
          frameHash: hashPngVisualPayload(png),
          dataHash: hashCanonicalData(stableJson(parsed)),
        },
        diagnostics: diagnosticLines(result.stderr),
      };
      if (this.cachePrefixes) this.prefixCache.set(key, observed);
      return { ...observed, cost: 1 };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  async execute(sequence: readonly Action[]): Promise<ExecutionTrace> {
    const version = await this.version();
    let cost = 0;
    const first = await this.observe([]).catch((error) => { throw new Error(`Rive CLI could not observe initial state: ${String(error)}`); });
    const initial = first.observation;
    cost += first.cost;
    const steps: TraceStep[] = [];
    for (let index = 0; index < sequence.length; index++) {
      const action = sequence[index];
      try {
        const observed = await this.observe(sequence.slice(0, index + 1));
        cost += observed.cost;
        steps.push({ action, observation: observed.observation, diagnostics: observed.diagnostics, cost: observed.cost });
      } catch (error) {
        steps.push({ action, error: String(error), cost: 1 });
        cost += 1;
        break;
      }
    }
    return { initial, steps, backend: { name: this.name, version }, runtime: { name: "rive-cli-headless", version }, cost };
  }
}
