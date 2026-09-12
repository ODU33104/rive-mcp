import { existsSync, mkdirSync, readFileSync, renameSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { revisionHash } from "../revisions/hash.js";
import type { FileRevisionStore } from "../revisions/store.js";
import type { PutReviewInput, ReviewReceipt } from "./types.js";

const REVIEW_REF_RE = /^rv_[0-9a-f]{32}$/;

function hashHex(hash: string): string {
  return hash.startsWith("sha256:") ? hash.slice(7) : hash;
}

function writeAtomic(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp-" + process.pid;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export class FileReviewStore {
  readonly root: string;

  constructor(private readonly revisions: FileRevisionStore, root = join(revisions.root, "reviews")) {
    this.root = resolve(root);
  }

  private receiptPath(reviewRef: string): string {
    if (!REVIEW_REF_RE.test(reviewRef)) throw new Error("Invalid reviewRef: " + reviewRef);
    return join(this.root, reviewRef + ".json");
  }

  put(input: PutReviewInput): ReviewReceipt {
    const revision = this.revisions.get(input.assetRef).revision;
    const identity = {
      assetRef: revision.assetRef,
      rivHash: revision.rivHash,
      kind: input.kind,
      payload: input.payload,
    };
    const fullHash = revisionHash(identity);
    const reviewRef = "rv_" + hashHex(fullHash).slice(0, 32);
    const path = this.receiptPath(reviewRef);
    if (existsSync(path)) return this.get(reviewRef);

    const receipt: ReviewReceipt = {
      reviewRef,
      reviewHash: fullHash,
      assetRef: revision.assetRef,
      rivHash: revision.rivHash,
      kind: input.kind,
      createdAt: new Date().toISOString(),
      payload: input.payload,
    };
    writeAtomic(path, JSON.stringify(receipt, null, 2) + "\n");
    return receipt;
  }

  get(reviewRef: string): ReviewReceipt {
    const path = this.receiptPath(reviewRef);
    if (!existsSync(path)) throw new Error("Unknown reviewRef: " + reviewRef);
    const receipt = JSON.parse(readFileSync(path, "utf8")) as ReviewReceipt;
    if (receipt.reviewRef !== reviewRef) throw new Error("Corrupt review metadata for " + reviewRef);
    const expectedHash = revisionHash({
      assetRef: receipt.assetRef,
      rivHash: receipt.rivHash,
      kind: receipt.kind,
      payload: receipt.payload,
    });
    const expectedRef = "rv_" + hashHex(expectedHash).slice(0, 32);
    if (receipt.reviewHash !== expectedHash || expectedRef !== reviewRef) {
      throw new Error("Review metadata integrity check failed for " + reviewRef);
    }
    const current = this.revisions.get(receipt.assetRef).revision;
    if (current.rivHash !== receipt.rivHash) throw new Error("Review receipt rivHash mismatch for " + reviewRef);
    return receipt;
  }

  listForAsset(assetRef: string): ReviewReceipt[] {
    this.revisions.get(assetRef);
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        try { return this.get(name.slice(0, -5)); } catch { return null; }
      })
      .filter((x): x is ReviewReceipt => !!x && x.assetRef === assetRef);
  }
}

export function reviewSummary(receipt: ReviewReceipt): Record<string, unknown> {
  return {
    reviewRef: receipt.reviewRef,
    assetRef: receipt.assetRef,
    rivHash: receipt.rivHash,
    kind: receipt.kind,
  };
}
