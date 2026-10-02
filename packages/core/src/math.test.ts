import { describe, expect, it } from "vitest";
import { cosineSimilarity, hammingDistance, haversineKm } from "./math.js";

describe("image comparison math", () => {
  it("computes cosine similarity", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("computes hash bit distance", () => {
    expect(hammingDistance("0000", "0000")).toBe(0);
    expect(hammingDistance("0000", "ffff")).toBe(16);
  });

  it("measures geographic distance", () => {
    const madrid = { latitude: 40.4168, longitude: -3.7038 };
    const barcelona = { latitude: 41.3874, longitude: 2.1686 };
    expect(haversineKm(madrid, barcelona)).toBeGreaterThan(500);
    expect(haversineKm(madrid, barcelona)).toBeLessThan(510);
  });
});
