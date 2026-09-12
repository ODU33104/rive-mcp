export interface FinalizeReceipt {
  finalizeRef: string;
  finalizeHash: string;
  assetRef: string;
  rivHash: string;
  lintReviewRef: string;
  critiqueReviewRef: string;
  outPath: string;
  runtimeValidation: { ok: true };
  createdAt: string;
}

export interface PutFinalizeInput {
  assetRef: string;
  lintReviewRef: string;
  critiqueReviewRef: string;
  outPath: string;
}
