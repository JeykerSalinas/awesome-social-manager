import { describe, expect, it } from "vitest";
import { deduplicateAssets } from "./deduplication.js";
import type { AssetFeatures, ClusterInput } from "./types.js";

const base: AssetFeatures = {
  width: 3000,
  height: 4000,
  capturedAt: "2026-08-30T10:00:00.000Z",
  coordinates: null,
  camera: null,
  perceptualHash: "0000000000000000",
  embedding: [1, 0, 0],
  embeddingProvider: "test",
  brightness: 0.5,
  contrast: 0.5,
  sharpness: 0.7,
  exposure: 0.8,
  qualityScore: 0.75,
};

function input(assetId: string, overrides: Partial<AssetFeatures> = {}): ClusterInput {
  return { assetId, features: { ...base, ...overrides } };
}

describe("deduplication", () => {
  it("keeps the strongest image from a near-duplicate burst", () => {
    const result = deduplicateAssets([
      input("soft", { sharpness: 0.2, qualityScore: 0.35 }),
      input("keeper", { capturedAt: "2026-08-30T10:00:20.000Z", sharpness: 0.9, qualityScore: 0.92 }),
      input("dark", { capturedAt: "2026-08-30T10:00:35.000Z", exposure: 0.3, qualityScore: 0.5 }),
    ]);

    expect(result.find((item) => item.assetId === "keeper")).toMatchObject({
      selected: true,
      duplicateOfAssetId: null,
    });
    expect(result.filter((item) => !item.selected)).toHaveLength(2);
    expect(result.find((item) => item.assetId === "soft")?.duplicateOfAssetId).toBe("keeper");
  });

  it("does not collapse visually similar images taken far apart", () => {
    const result = deduplicateAssets([
      input("morning", { perceptualHash: "00000000000000ff" }),
      input("evening", { capturedAt: "2026-08-30T18:00:00.000Z", perceptualHash: "ffffffffffffff00" }),
    ]);

    expect(result.every((item) => item.selected)).toBe(true);
  });
});
