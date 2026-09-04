import sharp from "sharp";

export interface EmbeddingProvider {
  readonly name: string;
  embed(path: string): Promise<number[]>;
}

export class LocalVisualEmbeddingProvider implements EmbeddingProvider {
  readonly name = "local-color-v1";

  async embed(path: string): Promise<number[]> {
    const { data } = await sharp(path)
      .rotate()
      .resize(32, 32, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const bins = new Array<number>(24).fill(0);
    for (let index = 0; index < data.length; index += 3) {
      bins[Math.min(7, Math.floor((data[index] ?? 0) / 32))]! += 1;
      bins[8 + Math.min(7, Math.floor((data[index + 1] ?? 0) / 32))]! += 1;
      bins[16 + Math.min(7, Math.floor((data[index + 2] ?? 0) / 32))]! += 1;
    }
    const norm = Math.sqrt(bins.reduce((total, value) => total + value * value, 0)) || 1;
    return bins.map((value) => value / norm);
  }
}

export class ClipEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  private extractor: Promise<any> | null = null;

  constructor(private readonly model = process.env.CLIP_MODEL || "Xenova/clip-vit-base-patch32") {
    this.name = `clip:${model}`;
  }

  async embed(path: string): Promise<number[]> {
    const moduleName = "@huggingface/transformers";
    const transformers = await import(moduleName);
    this.extractor ??= transformers.pipeline("image-feature-extraction", this.model, { dtype: "q8" });
    const extractor = await this.extractor;
    const image = await transformers.RawImage.read(path);
    const output = await extractor(image, { pooling: "mean", normalize: true });
    return Array.from(output.data as Float32Array);
  }
}

export function createEmbeddingProvider(): EmbeddingProvider {
  return process.env.EMBEDDING_PROVIDER === "clip"
    ? new ClipEmbeddingProvider()
    : new LocalVisualEmbeddingProvider();
}
