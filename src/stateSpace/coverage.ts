import type { StaticStateGraph } from "../explorer/types.js";

/** Reachability proof is intentionally gated on an explicitly exhaustive static graph. */
export function proveStaticallyUnreachable(graph?: StaticStateGraph): string[] {
  if (!graph?.complete) return [];
  const adjacency = new Map<string, string[]>();
  for (const state of graph.states) adjacency.set(state, []);
  for (const transition of graph.transitions) {
    if (!adjacency.has(transition.from)) adjacency.set(transition.from, []);
    adjacency.get(transition.from)!.push(transition.to);
  }

  const reached = new Set<string>();
  const queue = [...graph.entryStates];
  while (queue.length) {
    const state = queue.shift()!;
    if (reached.has(state)) continue;
    reached.add(state);
    for (const next of adjacency.get(state) ?? []) {
      if (!reached.has(next)) queue.push(next);
    }
  }
  return graph.states.filter((state) => !reached.has(state)).sort();
}
