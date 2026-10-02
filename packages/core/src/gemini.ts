import sharp from "sharp";
import type { EmbeddingProvider } from "./embedding.js";
import type { CaptionProposal, GroupImageInput } from "./types.js";

export interface CaptionProvider {
  readonly name: string;
  describeGroup(images: GroupImageInput[]): Promise<CaptionProposal>;
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;

  constructor(
    private readonly model = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2",
    private readonly apiKey = process.env.GEMINI_API_KEY,
  ) {
    this.name = `gemini:${model}`;
  }

  async embed(path: string): Promise<number[]> {
    const client = await createGeminiClient(this.apiKey);
    const data = await imageData(path, 768);
    const response = await client.models.embedContent({
      model: this.model,
      contents: [{ inlineData: { mimeType: "image/jpeg", data } }],
    });
    const values = response.embeddings?.[0]?.values ?? response.embedding?.values;
    if (!Array.isArray(values) || !values.length) throw new Error("Gemini did not return an embedding");
    return values.map(Number);
  }
}

export class GeminiCaptionProvider implements CaptionProvider {
  readonly name: string;

  constructor(
    private readonly model = process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash",
    private readonly apiKey = process.env.GEMINI_API_KEY,
  ) {
    this.name = `gemini:${model}`;
  }

  async describeGroup(images: GroupImageInput[]): Promise<CaptionProposal> {
    if (!images.length) throw new Error("Cannot describe an empty image group");
    const client = await createGeminiClient(this.apiKey);
    const selected = images.slice(0, 10);
    const parts: Array<Record<string, unknown>> = [{
      text: buildPrompt(selected),
    }];
    for (const image of selected) {
      parts.push({ text: `assetId: ${image.assetId}` });
      parts.push({ inlineData: { mimeType: "image/jpeg", data: await imageData(image.path, 768) } });
    }
    const response = await client.models.generateContent({
      model: this.model,
      contents: [{ role: "user", parts }],
      config: {
        responseMimeType: "application/json",
        responseSchema: captionSchema,
        temperature: 0.4,
      },
    });
    return normalizeProposal(JSON.parse(response.text ?? "{}"), selected);
  }
}

export function createCaptionProvider(): CaptionProvider | null {
  return process.env.CAPTION_PROVIDER === "gemini" ? new GeminiCaptionProvider() : null;
}

async function createGeminiClient(apiKey: string | undefined): Promise<any> {
  if (!apiKey) throw new Error("GEMINI_API_KEY is required for Gemini providers");
  const moduleName = "@google/genai";
  const { GoogleGenAI } = await import(moduleName);
  return new GoogleGenAI({ apiKey });
}

async function imageData(path: string, maxSize: number): Promise<string> {
  const buffer = await sharp(path)
    .rotate()
    .resize(maxSize, maxSize, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return buffer.toString("base64");
}

function buildPrompt(images: GroupImageInput[]): string {
  const facts = images.map((image) => ({
    assetId: image.assetId,
    qualityScore: Number(image.qualityScore.toFixed(3)),
    capturedAt: image.capturedAt,
  }));
  return [
    "Analiza este grupo de fotos para un borrador de Instagram.",
    "No inventes nombres de ciudades, monumentos o eventos si no hay evidencia visual suficiente.",
    "Escribe en espanol natural, editorial y conciso.",
    "Devuelve solo JSON valido conforme al schema.",
    `Datos tecnicos por imagen: ${JSON.stringify(facts)}`,
  ].join("\n");
}

function normalizeProposal(value: Record<string, unknown>, images: GroupImageInput[]): CaptionProposal {
  const assetIds = new Set(images.map((image) => image.assetId));
  const altText = Array.isArray(value.altText)
    ? value.altText.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const assetId = String(record.assetId || "");
      const text = String(record.text || "").trim();
      return assetIds.has(assetId) && text ? [{ assetId, text }] : [];
    })
    : [];
  return {
    groupLabel: stringValue(value.groupLabel, "Grupo editorial"),
    context: stringValue(value.context, "Fotos seleccionadas para una posible publicacion."),
    caption: stringValue(value.caption, ""),
    hashtags: Array.isArray(value.hashtags) ? value.hashtags.map(String).filter(Boolean).slice(0, 12) : [],
    altText,
    confidence: clampNumber(value.confidence, 0.5),
  };
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function clampNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
}

const captionSchema = {
  type: "object",
  properties: {
    groupLabel: { type: "string" },
    context: { type: "string" },
    caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" }, maxItems: 12 },
    altText: {
      type: "array",
      items: {
        type: "object",
        properties: {
          assetId: { type: "string" },
          text: { type: "string" },
        },
        required: ["assetId", "text"],
      },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["groupLabel", "context", "caption", "hashtags", "altText", "confidence"],
};
