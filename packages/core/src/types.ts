export type BatchStatus = "UPLOADING" | "QUEUED" | "ANALYZING" | "READY" | "FAILED";
export type AssetStatus = "UPLOADED" | "ANALYZED" | "GROUPED" | "REJECTED";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface AssetFeatures {
  width: number;
  height: number;
  capturedAt: string | null;
  coordinates: Coordinates | null;
  camera: string | null;
  perceptualHash: string;
  embedding: number[];
  embeddingProvider: string;
  brightness: number;
  contrast: number;
  sharpness: number;
  exposure: number;
  qualityScore: number;
}

export interface ClusterInput {
  assetId: string;
  features: AssetFeatures;
}

export interface ClusterResult {
  assetIds: string[];
  confidence: number;
  label: string;
  reason: string;
}
