export type RevisionSourceKind =
  | "scene-spec"
  | "imported-riv"
  | "binary-edit"
  | "studio-edit";

export type ProvenanceKind =
  | "svg"
  | "iconify"
  | "lottie"
  | "riv"
  | "image"
  | "audio"
  | "font"
  | "generated"
  | "user-file";

export interface ProvenanceEntry {
  kind: ProvenanceKind;
  source: string;
  license: string;
  attribution?: string;
}

export interface RevisionOperation {
  tool: string;
  summary?: string;
  details?: unknown;
}

export interface AssetRevision {
  assetRef: string;
  revisionHash: string;
  parentRef?: string;
  rivHash: string;
  sourceHash?: string;
  sourceKind: RevisionSourceKind;
  createdAt: string;
  rivPath?: string;
  sourcePath?: string;
  operation?: RevisionOperation;
  provenance: ProvenanceEntry[];
}

export interface PutRevisionInput {
  rivBytes: Uint8Array;
  parentRef?: string;
  sourceBytes?: Uint8Array | string;
  sourceKind: RevisionSourceKind;
  rivPath?: string;
  sourcePath?: string;
  operation?: RevisionOperation;
  provenance?: ProvenanceEntry[];
}

export interface ResolvedRevision {
  revision: AssetRevision;
  rivBytes: Buffer;
}
