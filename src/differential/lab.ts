import type { RiveExecutionBackend } from "../backends/types.js";
import type { ProjectRef, Scenario } from "../execution/types.js";
import { compareObservations } from "./compare.js";
import { normalizeObservation } from "./normalize.js";
import type { BackendObservationV1, DifferentialResultV1 } from "./types.js";

export interface DifferentialBackendRun {
  backend: RiveExecutionBackend;
  project: ProjectRef;
  executionArtifactHash?: string;
}

export interface RunDifferentialPairInput {
  artifactHash: string;
  scenario: Scenario;
  left: DifferentialBackendRun;
  right: DifferentialBackendRun;
}

export async function observeBackend(
  artifactHash: string,
  scenario: Scenario,
  run: DifferentialBackendRun
): Promise<BackendObservationV1> {
  const verify = await run.backend.verify(run.project);
  const inspect = await run.backend.inspect(run.project);
  const execution = await run.backend.execute(run.project, scenario);
  return normalizeObservation({
    artifactHash,
    executionArtifactHash: run.executionArtifactHash,
    scenario,
    verify,
    inspect,
    execution,
  });
}

export async function runDifferentialPair(
  input: RunDifferentialPairInput
): Promise<{
  left: BackendObservationV1;
  right: BackendObservationV1;
  result: DifferentialResultV1;
}> {
  const left = await observeBackend(input.artifactHash, input.scenario, input.left);
  const right = await observeBackend(input.artifactHash, input.scenario, input.right);
  return {
    left,
    right,
    result: compareObservations(left, right),
  };
}
