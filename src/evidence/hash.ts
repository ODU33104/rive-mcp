import { createHash } from "node:crypto";

export function sha256Bytes(data: Uint8Array | string): string {
  return "sha256:" + createHash("sha256").update(data).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function revisionHash(value: unknown): string {
  return sha256Bytes(stableJson(value));
}
