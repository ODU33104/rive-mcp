import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Action, JsonValue, StateObservation } from "./types.js";
import type { Invariant } from "./invariants.js";
import { stableJson } from "../stateSpace/signature.js";

export interface FailureRecord {
  schemaVersion: 1;
  failureId: string;
  origin: "real" | "synthetic-regression" | "imported";
  artifactHash: string;
  artifact?: { path?: string; project?: string };
  tool: { name: string; version?: string };
  runtime?: { name: string; version?: string };
  scenario: {
    seed?: string | number;
    strategy: string;
    maxDepth?: number;
    maxSequences?: number;
  };
  inputSequence: Action[];
  minimalReproduction: {
    sequence: Action[];
    minimality: "locally-minimized";
    reproductionAttempts: number;
    reproductionSuccesses: number;
    reproductionSuccessRate: number;
  };
  expectedInvariant: Invariant;
  observedResult: {
    stepIndex: number;
    observation?: StateObservation;
    message: string;
  };
  evidence?: {
    screenshots?: string[];
    data?: JsonValue;
    events?: JsonValue;
  };
  knownAffectedVersions?: string[];
  fixedVersion?: string;
  discoveredAt: string;
}

export type FailureRecordInput = Omit<FailureRecord, "schemaVersion" | "failureId"> & { failureId?: string };

export function failureIdFor(input: Pick<FailureRecordInput, "artifactHash" | "expectedInvariant" | "minimalReproduction">): string {
  const identity = stableJson({
    artifactHash: input.artifactHash,
    invariantId: input.expectedInvariant.id,
    minimalSequence: input.minimalReproduction.sequence,
  });
  return `fail_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

export function makeFailureRecord(input: FailureRecordInput): FailureRecord {
  return {
    schemaVersion: 1,
    ...input,
    failureId: input.failureId ?? failureIdFor(input),
  };
}

export class JsonFailureCorpus {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  save(record: FailureRecord): string {
    mkdirSync(this.root, { recursive: true });
    const path = join(this.root, `${record.failureId}.json`);
    writeFileSync(path, JSON.stringify(record, null, 2) + "\n", "utf8");
    return path;
  }
}
