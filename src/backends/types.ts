import type {
  BackendIdentity,
  ExecutionResult,
  InspectResult,
  ProjectRef,
  Scenario,
  VerifyResult,
} from "../execution/types.js";

export interface RiveExecutionBackend {
  identify(): Promise<BackendIdentity>;
  verify(project: ProjectRef): Promise<VerifyResult>;
  inspect(project: ProjectRef): Promise<InspectResult>;
  execute(project: ProjectRef, scenario: Scenario): Promise<ExecutionResult>;
}
