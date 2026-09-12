import { resolve } from "node:path";
import type { ProvenanceEntry, ProvenanceKind } from "./revisions/types.js";

export interface ProvenanceInput {
  kind: ProvenanceKind;
  source: string;
  license?: string;
  attribution?: string;
}

export interface ProvenanceFragment {
  __provenance?: ProvenanceInput[];
}

export function provenanceEntry(input: ProvenanceInput): ProvenanceEntry {
  return {
    kind: input.kind,
    source: input.source,
    license: input.license?.trim() || "unknown",
    ...(input.attribution?.trim() ? { attribution: input.attribution.trim() } : {}),
  };
}

export function fileProvenance(kind: ProvenanceKind, path: string, license?: string, attribution?: string): ProvenanceEntry {
  return provenanceEntry({ kind, source: resolve(path), license, attribution });
}

export function mergeProvenance(...groups: Array<ReadonlyArray<ProvenanceInput | ProvenanceEntry> | undefined>): ProvenanceEntry[] {
  const out: ProvenanceEntry[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const raw of group ?? []) {
      const entry = provenanceEntry(raw);
      const key = JSON.stringify([entry.kind, entry.source, entry.license, entry.attribution ?? ""]);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(entry);
    }
  }
  return out;
}
