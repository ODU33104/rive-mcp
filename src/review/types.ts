export type ReviewKind = "lint" | "critique";

export interface ReviewReceipt {
  reviewRef: string;
  reviewHash: string;
  assetRef: string;
  rivHash: string;
  kind: ReviewKind;
  createdAt: string;
  payload: unknown;
}

export interface PutReviewInput {
  assetRef: string;
  kind: ReviewKind;
  payload: unknown;
}
