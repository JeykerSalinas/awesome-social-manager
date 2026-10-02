import { describe, expect, it } from "vitest";
import { clusterAssets, pairScore } from "./clustering.js";
import type { AssetFeatures, ClusterInput } from "./types.js";

const base: AssetFeatures = {
  width: 1200,
  height: 1600,
  capturedAt: "2026-08-30T10:00:00.000Z",
  coordinates: { latitude: 43.7228, longitude: 10.4017 },
  camera: null,
  perceptualHash: "0000000000000000",
  embedding: [1, 0, 0],
  embeddingProvider: "test",
  brightness: 0.5,
  contrast: 0.5,
  sharpness: 0.8,
  exposure: 0.9,
  qualityScore: 0.82,
};

function input(assetId: string, overrides: Partial<AssetFeatures> = {}): ClusterInput {
  return { assetId, features: { ...base, ...overrides } };
}

describe("clustering", () => {
  it("keeps photos from the same place and moment together", () => {
    const result = clusterAssets([
      input("pisa-1"),
      input("pisa-2", { capturedAt: "2026-08-30T11:00:00.000Z", perceptualHash: "1111111111111111" }),
      input("siena", {
        capturedAt: "2026-08-26T10:00:00.000Z",
        coordinates: { latitude: 43.3188, longitude: 11.3308 },
        embedding: [0, 1, 0],
        perceptualHash: "ffffffffffffffff",
      }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]?.assetIds).toEqual(expect.arrayContaining(["pisa-1", "pisa-2"]));
  });

  it("recognizes a near duplicate without metadata", () => {
    const score = pairScore(
      input("a", { capturedAt: null, coordinates: null }),
      input("b", { capturedAt: null, coordinates: null, embedding: [0.99, 0.01, 0] }),
    );
    expect(score).toBeGreaterThan(0.8);
  });
});
