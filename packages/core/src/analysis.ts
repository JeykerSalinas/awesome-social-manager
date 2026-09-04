import exifr from "exifr";
import sharp from "sharp";
import type { AssetFeatures, Coordinates } from "./types.js";
import type { EmbeddingProvider } from "./embedding.js";

export async function analyzeImage(
  originalPath: string,
  thumbnailPath: string,
  embeddingProvider: EmbeddingProvider,
): Promise<AssetFeatures> {
  const image = sharp(originalPath, { failOn: "error" }).rotate();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) throw new Error("Image dimensions could not be read");
  await image.clone().resize(640, 640, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 }).toFile(thumbnailPath);
  const [exif, perceptualHash, quality, embedding] = await Promise.all([
    readExif(originalPath), differenceHash(originalPath), measureQuality(originalPath),
    embeddingProvider.embed(originalPath),
  ]);
  return {
    width: metadata.width,
    height: metadata.height,
    capturedAt: exif.capturedAt,
    coordinates: exif.coordinates,
    camera: exif.camera,
    perceptualHash,
    embedding,
    embeddingProvider: embeddingProvider.name,
    ...quality,
  };
}

async function readExif(path: string): Promise<{
  capturedAt: string | null;
  coordinates: Coordinates | null;
  camera: string | null;
}> {
  try {
    const result = await exifr.parse(path, ["DateTimeOriginal", "CreateDate", "latitude", "longitude", "Make", "Model"]);
    const date = result?.DateTimeOriginal ?? result?.CreateDate;
    const latitude = Number(result?.latitude);
    const longitude = Number(result?.longitude);
    const coordinates = Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { latitude, longitude }
      : null;
    const camera = [result?.Make, result?.Model].filter(Boolean).join(" ").trim() || null;
    return { capturedAt: date instanceof Date ? date.toISOString() : null, coordinates, camera };
  } catch {
    return { capturedAt: null, coordinates: null, camera: null };
  }
}

export async function differenceHash(path: string): Promise<string> {
  const { data } = await sharp(path).rotate().resize(9, 8, { fit: "fill" }).greyscale().raw()
    .toBuffer({ resolveWithObject: true });
  const bits: number[] = [];
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const offset = row * 9 + column;
      bits.push((data[offset] ?? 0) > (data[offset + 1] ?? 0) ? 1 : 0);
    }
  }
  let hash = "";
  for (let index = 0; index < bits.length; index += 4) {
    hash += Number.parseInt(bits.slice(index, index + 4).join(""), 2).toString(16);
  }
  return hash;
}

async function measureQuality(path: string): Promise<{
  brightness: number; contrast: number; sharpness: number; exposure: number; qualityScore: number;
}> {
  const { data, info } = await sharp(path).rotate()
    .resize(384, 384, { fit: "inside", withoutEnlargement: true }).greyscale().raw()
    .toBuffer({ resolveWithObject: true });
  const values = Array.from(data);
  const mean = values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / Math.max(1, values.length);
  let laplacianTotal = 0;
  let laplacianSquared = 0;
  let count = 0;
  for (let y = 1; y < info.height - 1; y += 1) {
    for (let x = 1; x < info.width - 1; x += 1) {
      const index = y * info.width + x;
      const laplacian = 4 * (data[index] ?? 0) - (data[index - 1] ?? 0) -
        (data[index + 1] ?? 0) - (data[index - info.width] ?? 0) -
        (data[index + info.width] ?? 0);
      laplacianTotal += laplacian;
      laplacianSquared += laplacian * laplacian;
      count += 1;
    }
  }
  const laplacianMean = laplacianTotal / Math.max(1, count);
  const laplacianVariance = laplacianSquared / Math.max(1, count) - laplacianMean ** 2;
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const brightness = clamp(mean / 255);
  const contrast = clamp(Math.sqrt(variance) / 80);
  const sharpness = clamp(1 - Math.exp(-Math.max(0, laplacianVariance) / 700));
  const exposure = clamp(1 - Math.abs(mean - 127.5) / 127.5);
  const qualityScore = clamp(sharpness * 0.5 + exposure * 0.3 + contrast * 0.2);
  return { brightness, contrast, sharpness, exposure, qualityScore };
}
