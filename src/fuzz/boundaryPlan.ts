import type { Action } from "../explorer/types.js";
import { boundedBfsSequences } from "../explorer/explore.js";
import { actionSignature } from "../stateSpace/signature.js";
import { actionsForNumericBoundaries, type NumericBoundaryHint } from "./boundaries.js";

function sequenceKey(sequence: readonly Action[]): string {
  return sequence.map(actionSignature).join("\u001e");
}

/**
 * Keep the base BFS corpus and mutate only DataWrite positions whose path has a boundary hint.
 * This avoids making every boundary value part of the global Cartesian action alphabet.
 */
export function boundaryGuidedSequences(
  baseActions: readonly Action[],
  hints: readonly NumericBoundaryHint[],
  maxDepth: number
): Action[][] {
  const baseline = boundedBfsSequences(baseActions, maxDepth);
  const boundaryByPath = new Map<string, Action[]>();
  for (const action of actionsForNumericBoundaries(hints)) {
    if (action.kind !== "data-write") continue;
    const list = boundaryByPath.get(action.path) ?? [];
    list.push(action);
    boundaryByPath.set(action.path, list);
  }

  const out = new Map<string, Action[]>();
  const add = (sequence: readonly Action[]) => {
    const copy = [...sequence];
    out.set(sequenceKey(copy), copy);
  };
  for (const sequence of baseline) add(sequence);

  const pathsPresent = new Set<string>();
  for (const sequence of baseline) {
    sequence.forEach((action, index) => {
      if (action.kind !== "data-write") return;
      const replacements = boundaryByPath.get(action.path);
      if (!replacements?.length) return;
      pathsPresent.add(action.path);
      for (const replacement of replacements) {
        const mutated = [...sequence];
        mutated[index] = replacement;
        add(mutated);
      }
    });
  }

  // A static condition may reference a property missing from the seed corpus. Seed it explicitly,
  // then let ordinary base actions follow it so the boundary can trigger listeners/transitions.
  for (const [path, boundaryActions] of boundaryByPath) {
    if (pathsPresent.has(path)) continue;
    for (const boundaryAction of boundaryActions) {
      add([boundaryAction]);
      if (maxDepth > 1) {
        for (const suffix of boundedBfsSequences(baseActions, maxDepth - 1)) {
          add([boundaryAction, ...suffix]);
        }
      }
    }
  }

  return [...out.values()].sort((a, b) => a.length - b.length);
}
