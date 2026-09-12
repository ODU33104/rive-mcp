import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { revisionHash, sha256Bytes } from "./hash.js";
import type { AssetRevision, PutRevisionInput, ResolvedRevision } from "./types.js";

const REF_RE = /^r_[0-9a-f]{32}$/;

function hashHex(hash: string): string {
  return hash.startsWith("sha256:") ? hash.slice(7) : hash;
}

function assertRiv(bytes: Uint8Array): void {
  if (bytes.length < 4 || Buffer.from(bytes.subarray(0, 4)).toString("latin1") !== "RIVE") {
    throw new Error("Revision bytes are not a .riv file (missing RIVE fingerprint)");
  }
}

function writeAtomic(path: string, data: Uint8Array | string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp-" + process.pid;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export class FileRevisionStore {
  readonly root: string;

  constructor(root = process.env.RIVE_MCP_REVISION_STORE || join(process.cwd(), ".rive-mcp", "revisions")) {
    this.root = resolve(root);
  }

  private objectPath(rivHash: string): string {
    const hex = hashHex(rivHash);
    return join(this.root, "objects", hex.slice(0, 2), hex + ".riv");
  }

  private metadataPath(assetRef: string): string {
    if (!REF_RE.test(assetRef)) throw new Error("Invalid assetRef: " + assetRef);
    return join(this.root, "metadata", assetRef + ".json");
  }

  has(assetRef: string): boolean {
    return existsSync(this.metadataPath(assetRef));
  }

  get(assetRef: string): ResolvedRevision {
    const metaPath = this.metadataPath(assetRef);
    if (!existsSync(metaPath)) throw new Error("Unknown assetRef: " + assetRef);
    const revision = JSON.parse(readFileSync(metaPath, "utf8")) as AssetRevision;
    if (revision.assetRef !== assetRef) throw new Error("Corrupt revision metadata for " + assetRef);
    const expectedRevisionHash = revisionHash({
      parentRef: revision.parentRef,
      rivHash: revision.rivHash,
      sourceHash: revision.sourceHash,
      sourceKind: revision.sourceKind,
      operation: revision.operation,
    });
    const expectedAssetRef = "r_" + hashHex(expectedRevisionHash).slice(0, 32);
    if (revision.revisionHash !== expectedRevisionHash || expectedAssetRef !== assetRef) {
      throw new Error("Revision metadata integrity check failed for " + assetRef);
    }
    const rivPath = this.objectPath(revision.rivHash);
    if (!existsSync(rivPath)) throw new Error("Revision object missing for " + assetRef);
    const rivBytes = readFileSync(rivPath);
    assertRiv(rivBytes);
    const actualHash = sha256Bytes(rivBytes);
    if (actualHash !== revision.rivHash) throw new Error("Revision integrity check failed for " + assetRef);
    return { revision, rivBytes };
  }


  latestForPath(rivPath: string): AssetRevision | null {
    const metadataDir = join(this.root, "metadata");
    if (!existsSync(metadataDir)) return null;
    const target = resolve(rivPath);
    let best: AssetRevision | null = null;
    for (const name of readdirSync(metadataDir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const revision = this.get(name.slice(0, -5)).revision;
        if (!revision.rivPath || resolve(revision.rivPath) !== target) continue;
        if (!best || revision.createdAt > best.createdAt) best = revision;
      } catch {
        // Ignore unrelated/corrupt metadata here; direct get() still reports integrity errors.
      }
    }
    return best;
  }

  put(input: PutRevisionInput): AssetRevision {
    assertRiv(input.rivBytes);
    if (input.parentRef) this.get(input.parentRef);

    const rivHash = sha256Bytes(input.rivBytes);
    const sourceHash = input.sourceBytes === undefined ? undefined : sha256Bytes(input.sourceBytes);
    const identity = {
      parentRef: input.parentRef,
      rivHash,
      sourceHash,
      sourceKind: input.sourceKind,
      operation: input.operation,
    };
    const fullRevisionHash = revisionHash(identity);
    const assetRef = "r_" + hashHex(fullRevisionHash).slice(0, 32);

    const existingPath = this.metadataPath(assetRef);
    if (existsSync(existingPath)) {
      const existing = JSON.parse(readFileSync(existingPath, "utf8")) as AssetRevision;
      if (existing.revisionHash !== fullRevisionHash || existing.rivHash !== rivHash) {
        throw new Error("assetRef collision detected: " + assetRef);
      }
      return existing;
    }

    const objectPath = this.objectPath(rivHash);
    if (!existsSync(objectPath)) writeAtomic(objectPath, input.rivBytes);

    const revision: AssetRevision = {
      assetRef,
      revisionHash: fullRevisionHash,
      parentRef: input.parentRef,
      rivHash,
      sourceHash,
      sourceKind: input.sourceKind,
      createdAt: new Date().toISOString(),
      rivPath: input.rivPath,
      sourcePath: input.sourcePath,
      operation: input.operation,
    };
    writeAtomic(existingPath, JSON.stringify(revision, null, 2) + "\n");
    return revision;
  }
}

export function revisionSummary(revision: AssetRevision): Record<string, unknown> {
  return {
    assetRef: revision.assetRef,
    parentRef: revision.parentRef ?? null,
    rivHash: revision.rivHash,
    sourceHash: revision.sourceHash ?? null,
    sourceKind: revision.sourceKind,
  };
}
