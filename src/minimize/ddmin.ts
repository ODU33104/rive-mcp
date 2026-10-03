import type { Action } from "../explorer/types.js";

export interface MinimizeResult {
  sequence: Action[];
  attempts: number;
  originalLength: number;
  minimality: "locally-minimized";
}

/**
 * Classic delta debugging followed by a single-action deletion sweep.
 * It guarantees only local 1-deletion minimality, not a mathematical global minimum.
 */
export async function minimizeFailingSequence(
  sequence: readonly Action[],
  stillFails: (candidate: readonly Action[]) => Promise<boolean>
): Promise<MinimizeResult> {
  let current = [...sequence];
  let attempts = 0;
  if (current.length === 0) return { sequence: current, attempts, originalLength: 0, minimality: "locally-minimized" };

  attempts++;
  if (!(await stillFails(current))) {
    throw new Error("Cannot minimize a sequence that does not reproduce the failure");
  }

  let granularity = 2;
  while (current.length >= 2) {
    const chunkSize = Math.ceil(current.length / granularity);
    let reduced = false;
    for (let start = 0; start < current.length; start += chunkSize) {
      const candidate = current.slice(0, start).concat(current.slice(start + chunkSize));
      attempts++;
      if (await stillFails(candidate)) {
        current = candidate;
        granularity = Math.max(2, granularity - 1);
        reduced = true;
        break;
      }
    }
    if (reduced) continue;
    if (granularity >= current.length) break;
    granularity = Math.min(current.length, granularity * 2);
  }

  for (let index = 0; index < current.length;) {
    const candidate = current.slice(0, index).concat(current.slice(index + 1));
    attempts++;
    if (await stillFails(candidate)) current = candidate;
    else index++;
  }

  return {
    sequence: current,
    attempts,
    originalLength: sequence.length,
    minimality: "locally-minimized",
  };
}
