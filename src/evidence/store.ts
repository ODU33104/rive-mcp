import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { stableJson } from "./hash.js";
import type { EvidenceManifestV1 } from "./manifest.js";

export interface StoredEvidence {
  evidenceRef: string;
  path: string;
  manifestHash: string;
  reproducibilityKey: string;
}

export class EvidenceStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  put(manifest: EvidenceManifestV1): StoredEvidence {
    mkdirSync(this.root, { recursive: true });
    const digest = manifest.manifestHash.replace(/^sha256:/, "");
    const path = join(this.root, `${digest}.json`);
    const serialized = stableJson(manifest) + "\n";
    if (existsSync(path)) {
      const existing = readFileSync(path, "utf8");
      if (existing !== serialized) {
        throw new Error(`Evidence hash collision or tampering detected for ${manifest.manifestHash}`);
      }
    } else {
      writeFileSync(path, serialized, { flag: "wx" });
    }
    return {
      evidenceRef: `evidence:${digest}`,
      path,
      manifestHash: manifest.manifestHash,
      reproducibilityKey: manifest.reproducibilityKey,
    };
  }
}
