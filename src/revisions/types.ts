export type RevisionSourceKind =
  | "scene-spec"
  | "imported-riv"
  | "binary-edit"
  | "studio-edit";

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
}

export interface PutRevisionInput {
  rivBytes: Uint8Array;
  parentRef?: string;
  sourceBytes?: Uint8Array | string;
  sourceKind: RevisionSourceKind;
  rivPath?: string;
  sourcePath?: string;
  operation?: RevisionOperation;
}

export interface ResolvedRevision {
  revision: AssetRevision;
  rivBytes: Buffer;
}
