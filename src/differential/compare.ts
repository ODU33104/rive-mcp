import { revisionHash } from "../evidence/hash.js";
import type {
  BackendObservationV1,
  CheckpointDifference,
  DifferentialClassification,
  DifferentialResultV1,
  NormalizedCheckpoint,
} from "./types.js";

function byId(observation: BackendObservationV1): Map<string, NormalizedCheckpoint> {
  return new Map(observation.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
}

function checkpointOrder(left: BackendObservationV1, right: BackendObservationV1): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const checkpoint of [...left.checkpoints, ...right.checkpoints]) {
    if (!seen.has(checkpoint.id)) {
      seen.add(checkpoint.id);
      out.push(checkpoint.id);
    }
  }
  return out;
}

function classifyDifference(
  id: string,
  left?: NormalizedCheckpoint,
  right?: NormalizedCheckpoint
): CheckpointDifference | undefined {
  if (!left || !right) {
    return {
      checkpointId: id,
      kind: "missing",
      leftStatus: left?.status,
      rightStatus: right?.status,
      leftValueHash: left?.valueHash,
      rightValueHash: right?.valueHash,
      detail: "checkpoint missing from one backend observation",
    };
  }

  if (left.status === "unsupported" || right.status === "unsupported") {
    return {
      checkpointId: id,
      kind: "unsupported",
      leftStatus: left.status,
      rightStatus: right.status,
      leftValueHash: left.valueHash,
      rightValueHash: right.valueHash,
      detail: "at least one backend cannot represent this checkpoint",
    };
  }

  if (left.status !== right.status) {
    return {
      checkpointId: id,
      kind: "status",
      leftStatus: left.status,
      rightStatus: right.status,
      leftValueHash: left.valueHash,
      rightValueHash: right.valueHash,
      detail: `checkpoint status differs: ${left.status} vs ${right.status}`,
    };
  }

  if (left.valueHash !== right.valueHash) {
    return {
      checkpointId: id,
      kind: "value",
      leftStatus: left.status,
      rightStatus: right.status,
      leftValueHash: left.valueHash,
      rightValueHash: right.valueHash,
      detail: "normalized checkpoint value differs",
    };
  }
  return undefined;
}

export function compareObservations(
  left: BackendObservationV1,
  right: BackendObservationV1
): DifferentialResultV1 {
  const metadataMismatch =
    left.artifactHash !== right.artifactHash ||
    left.scenarioHash !== right.scenarioHash;

  const differences: CheckpointDifference[] = [];
  if (!metadataMismatch) {
    const leftById = byId(left);
    const rightById = byId(right);
    for (const id of checkpointOrder(left, right)) {
      const difference = classifyDifference(id, leftById.get(id), rightById.get(id));
      if (difference) differences.push(difference);
    }
  }

  let classification: DifferentialClassification;
  if (metadataMismatch) {
    classification = "inconclusive";
  } else if (differences.some((item) => item.kind === "missing")) {
    classification = "inconclusive";
  } else if (differences.some((item) => item.kind === "unsupported")) {
    classification = "unsupported";
  } else if (differences.length > 0) {
    classification = "divergent";
  } else {
    classification = "equivalent";
  }

  const firstDivergentCheckpoint = differences[0];
  const withoutKey: Omit<DifferentialResultV1, "deterministicKey"> = {
    schemaVersion: "rive-mcp.differential-result/v1",
    artifactHash: left.artifactHash,
    scenarioHash: left.scenarioHash,
    leftBackend: left.backend,
    rightBackend: right.backend,
    classification,
    firstDivergentCheckpoint,
    differences,
  };

  return {
    ...withoutKey,
    deterministicKey: revisionHash(withoutKey),
  };
}
