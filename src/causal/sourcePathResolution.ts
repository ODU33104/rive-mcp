import type { DataBindOut, DataBindingResult } from "../dataBinding.js";

export type DataBindSourcePathResolution =
  | {
      status: "resolved";
      sourcePathIds: number[];
      semanticPath: string;
      evidence: {
        kind: "explicit-artifact-metadata";
        objectIndices: number[];
      };
    }
  | {
      status: "unresolved";
      sourcePathIds: number[];
      reason:
        | "missing-source-path-ids"
        | "no-explicit-semantic-join";
      matchingDataBindPathObjectIndices: number[];
      note: string;
    };

/**
 * Classify whether a DataBind source path is semantically resolved.
 *
 * Numeric equality is preserved as evidence only. It is not enough to prove
 * that a sourcePathIds element indexes a ViewModel or one of its properties.
 * A future resolved branch must be backed by an explicit artifact-contained
 * join and must not use runtime value/timing correlation.
 */
export function analyzeDataBindSourcePath(
  binding: DataBindOut,
  dataBinding: DataBindingResult
): DataBindSourcePathResolution {
  const sourcePathIds = [...(binding.sourcePathIds ?? [])];

  if (sourcePathIds.length === 0) {
    return {
      status: "unresolved",
      sourcePathIds,
      reason: "missing-source-path-ids",
      matchingDataBindPathObjectIndices: [],
      note:
        "No sourcePathIds are encoded for this binding, so no semantic ViewModel property path can be proven.",
    };
  }

  const matchingDataBindPathObjectIndices = dataBinding.dataBindPaths
    .filter(
      (candidate) =>
        candidate.path.length === sourcePathIds.length &&
        candidate.path.every((value, index) => value === sourcePathIds[index])
    )
    .map((candidate) => candidate.objectIndex)
    .sort((a, b) => a - b);

  return {
    status: "unresolved",
    sourcePathIds,
    reason: "no-explicit-semantic-join",
    matchingDataBindPathObjectIndices,
    note:
      "Numeric sourcePathIds are retained as provenance evidence, but the decoded artifact does not currently expose an explicit join from those IDs to a semantic ViewModel/property identity. Matching DataBindPath numeric sequences are candidates only and do not prove semantic identity.",
  };
}
