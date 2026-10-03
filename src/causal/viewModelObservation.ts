import type { BackendIdentity, ExecutionResult, ScenarioStep } from "../execution/types.js";

export type ViewModelScalar = boolean | number | string | null;

export interface ViewModelObservationCheckpoint {
  id: string;
  phase: "initial" | "step" | "final";
  stepIndex?: number;
  stepType?: ScenarioStep["type"];
  values: Record<string, ViewModelScalar>;
}

export interface ViewModelValueChange {
  path: string;
  before: ViewModelScalar;
  after: ViewModelScalar;
  fromCheckpoint: string;
  toCheckpoint: string;
}

export interface ViewModelExecutionObservation {
  schemaVersion: 1;
  status: "observed" | "unavailable";
  source: "NativeBackend.execute";
  backend: Pick<BackendIdentity, "id" | "version" | "runtimeVersion">;
  checkpoints: ViewModelObservationCheckpoint[];
  changes: ViewModelValueChange[];
  warnings: string[];
  unavailableReason?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function scalarMap(
  value: unknown,
  checkpoint: string,
  warnings: string[]
): Record<string, ViewModelScalar> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, ViewModelScalar> = {};
  for (const key of Object.keys(value).sort()) {
    const item = value[key];
    if (
      item === null ||
      typeof item === "boolean" ||
      typeof item === "string" ||
      (typeof item === "number" && Number.isFinite(item))
    ) {
      out[key] = item as ViewModelScalar;
    } else {
      warnings.push(
        `${checkpoint}: omitted non-scalar ViewModel value at "${key}"`
      );
    }
  }
  return out;
}

function addChanges(
  changes: ViewModelValueChange[],
  previous: ViewModelObservationCheckpoint,
  current: ViewModelObservationCheckpoint
): void {
  for (const path of Object.keys(current.values).sort()) {
    if (!(path in previous.values)) continue;
    const before = previous.values[path]!;
    const after = current.values[path]!;
    if (Object.is(before, after)) continue;
    changes.push({
      path,
      before,
      after,
      fromCheckpoint: previous.id,
      toCheckpoint: current.id,
    });
  }
}

export function normalizeViewModelExecutionObservation(
  execution: ExecutionResult
): ViewModelExecutionObservation {
  const backend = {
    id: execution.backend.id,
    version: execution.backend.version,
    runtimeVersion: execution.backend.runtimeVersion,
  };
  const warnings: string[] = [];

  if (!execution.ok) {
    return {
      schemaVersion: 1,
      status: "unavailable",
      source: "NativeBackend.execute",
      backend,
      checkpoints: [],
      changes: [],
      warnings,
      unavailableReason: "execution result is not successful",
    };
  }

  const raw = isRecord(execution.raw) ? execution.raw : null;
  const rawInitial = raw && isRecord(raw.initial) ? raw.initial : null;
  const initialValues = scalarMap(rawInitial?.data, "initial", warnings);
  const rawSteps = raw && Array.isArray(raw.steps) ? raw.steps : [];
  const finalSnapshot = execution.dataSnapshots.at(-1);
  const finalValues = scalarMap(finalSnapshot?.value, "final", warnings);

  if (!initialValues || !finalValues) {
    return {
      schemaVersion: 1,
      status: "unavailable",
      source: "NativeBackend.execute",
      backend,
      checkpoints: [],
      changes: [],
      warnings: [...new Set(warnings)].sort(),
      unavailableReason:
        "execution result does not expose both initial and final scalar ViewModel snapshots",
    };
  }

  const checkpoints: ViewModelObservationCheckpoint[] = [
    { id: "initial", phase: "initial", values: initialValues },
  ];

  for (let index = 0; index < rawSteps.length; index++) {
    const rawStep = rawSteps[index];
    if (!isRecord(rawStep)) continue;
    const values = scalarMap(rawStep.data, `step:${index}`, warnings);
    if (!values) continue;
    const executionStep = execution.eventSequence[index]?.step;
    checkpoints.push({
      id: `step:${index}`,
      phase: "step",
      stepIndex: index,
      stepType: executionStep?.type,
      values,
    });
  }

  checkpoints.push({ id: "final", phase: "final", values: finalValues });

  const changes: ViewModelValueChange[] = [];
  for (let index = 1; index < checkpoints.length; index++) {
    addChanges(changes, checkpoints[index - 1]!, checkpoints[index]!);
  }

  return {
    schemaVersion: 1,
    status: "observed",
    source: "NativeBackend.execute",
    backend,
    checkpoints,
    changes,
    warnings: [...new Set(warnings)].sort(),
  };
}
