import { createHash } from "node:crypto";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) out[key] = canonicalize(item);
    }
    return out;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Corpus identities cannot contain non-finite numbers.");
  }
  return value;
}

export function stableCorpusJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function corpusHash(value: unknown): string {
  return "sha256:" + createHash("sha256").update(stableCorpusJson(value)).digest("hex");
}

export function shortCorpusId(prefix: string, value: unknown): string {
  return `${prefix}_${corpusHash(value).slice("sha256:".length, "sha256:".length + 24)}`;
}
