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

export interface GroupContext {
  groupLabel: string;
  context: string;
  scene: string;
  placeName: string | null;
  topics: string[];
  lighting: string;
  confidence: number;
}

export interface CaptionProposal {
  groupLabel: string;
  context: string;
  caption: string;
  hashtags: string[];
  altText: Array<{
    assetId: string;
    text: string;
  }>;
  confidence: number;
}

export interface GroupImageInput {
  assetId: string;
  path: string;
  mime: string;
  qualityScore: number;
  capturedAt: string | null;
}
