import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { revisionHash } from "../revisions/hash.js";
import type { FileRevisionStore } from "../revisions/store.js";
import type { FileReviewStore } from "../review/store.js";
import type { FinalizeReceipt, PutFinalizeInput } from "./types.js";

const FINALIZE_REF_RE = /^fin_[0-9a-f]{32}$/;

function hashHex(hash: string): string {
  return hash.startsWith("sha256:") ? hash.slice(7) : hash;
}

function writeAtomic(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp-" + process.pid;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export class FileFinalizeStore {
  readonly root: string;

  constructor(
    private readonly revisions: FileRevisionStore,
    private readonly reviews: FileReviewStore,
    root = join(revisions.root, "finalized")
  ) {
    this.root = resolve(root);
  }

  private receiptPath(finalizeRef: string): string {
    if (!FINALIZE_REF_RE.test(finalizeRef)) throw new Error("Invalid finalizeRef: " + finalizeRef);
    return join(this.root, finalizeRef + ".json");
  }

  put(input: PutFinalizeInput): FinalizeReceipt {
    const revision = this.revisions.get(input.assetRef).revision;
    const lint = this.reviews.get(input.lintReviewRef);
    const critique = this.reviews.get(input.critiqueReviewRef);
    if (lint.kind !== "lint" || critique.kind !== "critique") throw new Error("Finalize requires one lint and one critique receipt");
    for (const receipt of [lint, critique]) {
      if (receipt.assetRef !== revision.assetRef || receipt.rivHash !== revision.rivHash) {
        throw new Error("Review receipt does not match finalize revision");
      }
    }
    const identity = {
      assetRef: revision.assetRef,
      rivHash: revision.rivHash,
      lintReviewRef: lint.reviewRef,
      critiqueReviewRef: critique.reviewRef,
      outPath: resolve(input.outPath),
      runtimeValidation: { ok: true as const },
    };
    const fullHash = revisionHash(identity);
    const finalizeRef = "fin_" + hashHex(fullHash).slice(0, 32);
    const path = this.receiptPath(finalizeRef);
    if (existsSync(path)) return this.get(finalizeRef);
    const receipt: FinalizeReceipt = {
      finalizeRef,
      finalizeHash: fullHash,
      ...identity,
      createdAt: new Date().toISOString(),
    };
    writeAtomic(path, JSON.stringify(receipt, null, 2) + "\n");
    return receipt;
  }

  get(finalizeRef: string): FinalizeReceipt {
    const path = this.receiptPath(finalizeRef);
    if (!existsSync(path)) throw new Error("Unknown finalizeRef: " + finalizeRef);
    const receipt = JSON.parse(readFileSync(path, "utf8")) as FinalizeReceipt;
    const expectedHash = revisionHash({
      assetRef: receipt.assetRef,
      rivHash: receipt.rivHash,
      lintReviewRef: receipt.lintReviewRef,
      critiqueReviewRef: receipt.critiqueReviewRef,
      outPath: receipt.outPath,
      runtimeValidation: receipt.runtimeValidation,
    });
    const expectedRef = "fin_" + hashHex(expectedHash).slice(0, 32);
    if (receipt.finalizeHash !== expectedHash || expectedRef !== finalizeRef) {
      throw new Error("Finalize metadata integrity check failed for " + finalizeRef);
    }
    return receipt;
  }
}
