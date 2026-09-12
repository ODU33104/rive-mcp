import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileRevisionStore } from "../dist/revisions/store.js";
import { FileReviewStore } from "../dist/review/store.js";

const root = mkdtempSync(join(tmpdir(), "rive-mcp-reviews-"));
const revisions = new FileRevisionStore(join(root, "revisions"));
const reviews = new FileReviewStore(revisions);
const rivA = Buffer.from("RIVE\x07\x00\x01review-a", "latin1");
const rivB = Buffer.from("RIVE\x07\x00\x01review-b", "latin1");

const a = revisions.put({
  rivBytes: rivA,
  sourceKind: "scene-spec",
  operation: { tool: "riv_create" },
});
const lint = reviews.put({
  assetRef: a.assetRef,
  kind: "lint",
  payload: { errorCount: 0, warningCount: 1, infoCount: 0, findings: [{ rule: "demo" }] },
});
assert.match(lint.reviewRef, /^rv_[0-9a-f]{32}$/);
assert.equal(lint.assetRef, a.assetRef);
assert.equal(lint.rivHash, a.rivHash);
assert.equal(reviews.get(lint.reviewRef).reviewRef, lint.reviewRef);

const lint2 = reviews.put({
  assetRef: a.assetRef,
  kind: "lint",
  payload: { errorCount: 0, warningCount: 1, infoCount: 0, findings: [{ rule: "demo" }] },
});
assert.equal(lint2.reviewRef, lint.reviewRef);

const critique = reviews.put({
  assetRef: a.assetRef,
  kind: "critique",
  payload: { runtimeValidation: { ok: true }, sampledFrames: 6 },
});
assert.notEqual(critique.reviewRef, lint.reviewRef);
assert.equal(reviews.listForAsset(a.assetRef).length, 2);

const b = revisions.put({
  rivBytes: rivB,
  parentRef: a.assetRef,
  sourceKind: "binary-edit",
  operation: { tool: "riv_edit" },
});
assert.equal(reviews.listForAsset(b.assetRef).length, 0, "child revision must not inherit parent reviews");
assert.equal(reviews.get(lint.reviewRef).assetRef, a.assetRef);

const reviewPath = join(reviews.root, lint.reviewRef + ".json");
const original = readFileSync(reviewPath, "utf8");
const tampered = JSON.parse(original);
tampered.assetRef = b.assetRef;
writeFileSync(reviewPath, JSON.stringify(tampered));
assert.throws(() => reviews.get(lint.reviewRef), /integrity check failed/);
writeFileSync(reviewPath, original);

console.log("review receipt tests passed");
