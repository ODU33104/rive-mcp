import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileRevisionStore } from "../dist/revisions/store.js";
import { revisionHash } from "../dist/revisions/hash.js";

const root = mkdtempSync(join(tmpdir(), "rive-mcp-revisions-"));
const rivA = Buffer.from("RIVE\x07\x00\x01revision-a", "latin1");
const rivB = Buffer.from("RIVE\x07\x00\x01revision-b", "latin1");

const store = new FileRevisionStore(root);
const a = store.put({
  rivBytes: rivA,
  sourceBytes: "{\"scene\":\"a\"}",
  sourceKind: "scene-spec",
  operation: { tool: "riv_create" },
});

assert.match(a.assetRef, /^r_[0-9a-f]{32}$/);
assert.match(a.rivHash, /^sha256:[0-9a-f]{64}$/);
assert.equal(a.parentRef, undefined);
assert.deepEqual(store.get(a.assetRef).rivBytes, rivA);

// Same content + same lineage/operation resolves to the same immutable revision.
const a2 = store.put({
  rivBytes: rivA,
  sourceBytes: "{\"scene\":\"a\"}",
  sourceKind: "scene-spec",
  operation: { tool: "riv_create" },
});
assert.equal(a2.assetRef, a.assetRef);

// Re-opening the store simulates an MCP/server restart.
const reopened = new FileRevisionStore(root);
assert.equal(reopened.get(a.assetRef).revision.rivHash, a.rivHash);

// Branches from one base remain independent.
const b = reopened.put({
  rivBytes: rivB,
  parentRef: a.assetRef,
  sourceKind: "binary-edit",
  operation: { tool: "riv_edit", details: { branch: "b" } },
});
const c = reopened.put({
  rivBytes: rivA,
  parentRef: a.assetRef,
  sourceKind: "binary-edit",
  operation: { tool: "riv_edit", details: { branch: "c" } },
});
assert.equal(b.parentRef, a.assetRef);
assert.equal(c.parentRef, a.assetRef);
assert.notEqual(b.assetRef, c.assetRef);
assert.deepEqual(reopened.get(a.assetRef).rivBytes, rivA);

// Path lookup supports Studio handoff lineage without creating revisions for every UI gesture.
const watchedPath = join(root, "watched.riv");
const p1 = reopened.put({ rivBytes: rivA, sourceKind: "scene-spec", rivPath: watchedPath, operation: { tool: "riv_create" } });
const p2 = reopened.put({ rivBytes: rivB, parentRef: p1.assetRef, sourceKind: "studio-edit", rivPath: watchedPath, operation: { tool: "riv_studio_notes" } });
assert.equal(reopened.latestForPath(watchedPath)?.assetRef, p2.assetRef);

// Revisions written before provenance existed keep their original immutable identity.
const legacyHash = revisionHash({
  parentRef: undefined,
  rivHash: a.rivHash,
  sourceHash: a.sourceHash,
  sourceKind: a.sourceKind,
  operation: a.operation,
});
const legacyRef = "r_" + legacyHash.slice("sha256:".length, "sha256:".length + 32);
writeFileSync(join(root, "metadata", legacyRef + ".json"), JSON.stringify({
  assetRef: legacyRef,
  revisionHash: legacyHash,
  rivHash: a.rivHash,
  sourceHash: a.sourceHash,
  sourceKind: a.sourceKind,
  createdAt: "2026-01-01T00:00:00.000Z",
  operation: a.operation,
}));
const legacy = reopened.get(legacyRef).revision;
assert.equal(legacy.assetRef, legacyRef);
assert.deepEqual(legacy.provenance, []);


// Metadata is part of the immutable identity too: changing lineage must invalidate the ref.
const metaPath = join(root, "metadata", a.assetRef + ".json");
const originalMeta = readFileSync(metaPath, "utf8");
const tamperedMeta = JSON.parse(originalMeta);
tamperedMeta.parentRef = "r_ffffffffffffffffffffffffffffffff";
writeFileSync(metaPath, JSON.stringify(tamperedMeta));
assert.throws(() => reopened.get(a.assetRef), /metadata integrity check failed/);
writeFileSync(metaPath, originalMeta);

assert.throws(() => reopened.get("r_00000000000000000000000000000000"), /Unknown assetRef/);
assert.throws(() => reopened.put({
  rivBytes: Buffer.from("NOTRIVE"),
  sourceKind: "imported-riv",
}), /missing RIVE fingerprint/);

// Integrity is checked on every read.
const objectPath = join(root, "objects", b.rivHash.slice(7, 9), b.rivHash.slice(7) + ".riv");
writeFileSync(objectPath, Buffer.from("RIVE\x07\x00\x01tampered", "latin1"));
assert.throws(() => reopened.get(b.assetRef), /integrity check failed/);

console.log("revision tests passed");
