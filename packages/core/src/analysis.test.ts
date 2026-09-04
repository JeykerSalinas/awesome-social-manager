import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { analyzeImage } from "./analysis.js";
import { LocalVisualEmbeddingProvider } from "./embedding.js";

describe("image analysis", () => {
  let directory: string;
  let source: string;
  let thumbnail: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "asm-analysis-"));
    source = join(directory, "source.jpg");
    thumbnail = join(directory, "thumbnail.jpg");
    await sharp({
      create: { width: 900, height: 1200, channels: 3, background: { r: 210, g: 70, b: 45 } },
    }).jpeg().toFile(source);
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("creates a thumbnail and deterministic visual features", async () => {
    const result = await analyzeImage(source, thumbnail, new LocalVisualEmbeddingProvider());
    expect(result.width).toBe(900);
    expect(result.height).toBe(1200);
    expect(result.perceptualHash).toHaveLength(16);
    expect(result.embedding).toHaveLength(24);
    expect(result.qualityScore).toBeGreaterThanOrEqual(0);
    expect(result.qualityScore).toBeLessThanOrEqual(1);
    const metadata = await sharp(thumbnail).metadata();
    expect(metadata.width).toBeLessThanOrEqual(640);
    expect(metadata.height).toBeLessThanOrEqual(640);
  });
});
