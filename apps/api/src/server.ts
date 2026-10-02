import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { config } from "dotenv";
import { fileTypeFromBuffer } from "file-type";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { openDatabase, resolveDatabasePath, type AssetFeatures } from "@asm/core";

if (process.env.NODE_ENV !== "test") {
  config({ path: resolve(process.cwd(), ".env") });
  config({ path: resolve(process.cwd(), "../../.env") });
}

export const app = Fastify({ logger: process.env.NODE_ENV !== "test", requestIdHeader: "x-correlation-id" });
const db = openDatabase();
const storageRoot = resolve(process.env.STORAGE_PATH || "./storage");
const maxFiles = Number(process.env.UPLOAD_MAX_FILES || 200);
const maxFileSizeMb = Number(process.env.UPLOAD_MAX_FILE_SIZE_MB || 100);
const maxFileSizeBytes = maxFileSizeMb * 1024 * 1024;
await mkdir(storageRoot, { recursive: true });

await app.register(cors, { origin: true });
await app.register(multipart, {
  limits: { files: maxFiles, fileSize: maxFileSizeBytes, parts: maxFiles + 5 },
});
await app.register(fastifyStatic, { root: storageRoot, prefix: "/media/" });
await app.register(swagger, {
  openapi: {
    info: {
      title: "Awesome Social Manager API",
      description: "API para cargar lotes de fotos, analizar grupos, deduplicar tomas y revisar propuestas editoriales.",
      version: "0.1.0",
    },
    tags: [
      { name: "System", description: "Salud y diagnostico" },
      { name: "Batches", description: "Lotes de fotografias" },
      { name: "Groups", description: "Grupos, seleccion y deduplicacion" },
      { name: "Proposals", description: "Borradores de captions y hashtags" },
      { name: "Debug", description: "Diagnostico local sin secretos" },
    ],
  },
});
await app.register(swaggerUi, {
  routePrefix: "/docs",
  uiConfig: { docExpansion: "list", deepLinking: true },
});

const paramsIdSchema = objectSchema({ id: { type: "string" } }, ["id"]);
const errorSchema = objectSchema({
  code: { type: "string" },
  message: { type: "string" },
  details: {},
  correlationId: { type: "string" },
});

app.get("/health", {
  schema: {
    tags: ["System"],
    summary: "Estado de salud de la API",
    response: { 200: objectSchema({ status: { type: "string" } }) },
  },
}, async () => ({ status: "ok" }));

app.get("/api/debug/runtime", {
  schema: {
    tags: ["Debug"],
    summary: "Configuracion efectiva y contadores de diagnostico",
    response: { 200: { type: "object", additionalProperties: true }, 404: errorSchema },
  },
}, async (request, reply) => {
  if (!debugEnabled()) return reply.code(404).send(errorBody(request.id, "NOT_FOUND", "No existe"));
  return {
    nodeEnv: process.env.NODE_ENV || "development",
    cwd: process.cwd(),
    databasePath: resolveDatabasePath(),
    storageRoot,
    providers: {
      embedding: process.env.EMBEDDING_PROVIDER || "local",
      caption: process.env.CAPTION_PROVIDER || "",
      geminiEmbeddingModel: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2",
      geminiVisionModel: process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash",
      geminiApiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
    },
    counts: countTables(["batches", "assets", "asset_analyses", "groups", "group_assets", "group_contexts", "post_proposals", "jobs"]),
    recentJobs: db.prepare(`
      SELECT id, type, status, attempts, error, created_at, updated_at
      FROM jobs ORDER BY created_at DESC LIMIT 10
    `).all(),
  };
});

app.get<{ Params: { id: string } }>("/api/debug/batches/:id", {
  schema: {
    tags: ["Debug"],
    summary: "Diagnostico detallado de un lote",
    params: paramsIdSchema,
    response: { 200: { type: "object", additionalProperties: true }, 404: errorSchema },
  },
}, async (request, reply) => {
  if (!debugEnabled()) return reply.code(404).send(errorBody(request.id, "NOT_FOUND", "No existe"));
  const batch = db.prepare("SELECT * FROM batches WHERE id = ?").get(request.params.id);
  if (!batch) return reply.code(404).send(errorBody(request.id, "BATCH_NOT_FOUND", "El lote no existe"));
  const assets = db.prepare(`
    SELECT a.id, a.original_name, a.status, a.error, a.thumbnail_path, aa.features_json, aa.model_version
    FROM assets a LEFT JOIN asset_analyses aa ON aa.asset_id = a.id
    WHERE a.batch_id = ? ORDER BY a.created_at
  `).all(request.params.id) as Array<Record<string, unknown>>;
  const groups = db.prepare(`
    SELECT g.id, g.label, g.confidence, g.reason,
      COUNT(ga.asset_id) AS asset_count,
      SUM(CASE WHEN ga.selected = 1 THEN 1 ELSE 0 END) AS selected_count
    FROM groups g LEFT JOIN group_assets ga ON ga.group_id = g.id
    WHERE g.batch_id = ?
    GROUP BY g.id ORDER BY g.created_at
  `).all(request.params.id);
  return {
    batch,
    jobs: db.prepare(`
      SELECT id, type, status, attempts, error, created_at, updated_at
      FROM jobs WHERE payload_json LIKE ? ORDER BY created_at DESC
    `).all(`%"batchId":"${request.params.id}"%`),
    assets: assets.map(debugAsset),
    groups,
    contexts: db.prepare(`
      SELECT gc.group_id, gc.provider, gc.model, gc.context_json, gc.created_at
      FROM group_contexts gc JOIN groups g ON g.id = gc.group_id
      WHERE g.batch_id = ? ORDER BY gc.created_at DESC
    `).all(request.params.id),
    proposals: db.prepare(`
      SELECT pp.id, pp.group_id, pp.status, pp.provider, pp.model, pp.confidence, pp.caption, pp.hashtags_json, pp.created_at, pp.updated_at
      FROM post_proposals pp JOIN groups g ON g.id = pp.group_id
      WHERE g.batch_id = ? ORDER BY pp.created_at DESC
    `).all(request.params.id),
  };
});

app.get("/api/batches", {
  schema: {
    tags: ["Batches"],
    summary: "Lista lotes recientes",
    response: { 200: { type: "array", items: { type: "object", additionalProperties: true } } },
  },
}, async () => {
  return db.prepare(`
    SELECT b.*, COUNT(a.id) AS asset_count
    FROM batches b LEFT JOIN assets a ON a.batch_id = b.id
    GROUP BY b.id ORDER BY b.created_at DESC
  `).all();
});

app.post("/api/batches", {
  schema: {
    tags: ["Batches"],
    summary: "Crea un lote y sube imagenes JPEG/PNG",
    consumes: ["multipart/form-data"],
    response: {
      202: objectSchema({
        id: { type: "string" },
        name: { type: "string" },
        status: { type: "string" },
        accepted: { type: "number" },
        rejected: { type: "array", items: { type: "object", additionalProperties: true } },
      }),
      400: errorSchema,
      413: errorSchema,
    },
  },
}, async (request, reply) => {
  const batchId = randomUUID();
  const now = new Date().toISOString();
  const directory = resolve(storageRoot, batchId);
  await mkdir(resolve(directory, "originals"), { recursive: true });
  await mkdir(resolve(directory, "thumbnails"), { recursive: true });
  db.prepare(`INSERT INTO batches (id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run(batchId, `Lote ${now.slice(0, 10)}`, "UPLOADING", now, now);

  let accepted = 0;
  const rejected: Array<{ name: string; reason: string }> = [];
  let batchName: string | null = null;
  try {
    for await (const part of request.parts()) {
      if (part.type === "field") {
        if (part.fieldname === "name" && typeof part.value === "string") batchName = part.value.slice(0, 100);
        continue;
      }
      const buffer = await part.toBuffer();
      const detected = await fileTypeFromBuffer(buffer);
      if (!detected || !["image/jpeg", "image/png"].includes(detected.mime)) {
        rejected.push({ name: part.filename, reason: "Solo se permiten imágenes JPEG o PNG reales" });
        continue;
      }
      const assetId = randomUUID();
      const extension = detected.mime === "image/png" ? ".png" : ".jpg";
      const originalPath = resolve(directory, "originals", `${assetId}${extension}`);
      await writeFile(originalPath, buffer, { flag: "wx" });
      db.prepare(`
        INSERT INTO assets (id, batch_id, original_name, original_path, mime, size, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(assetId, batchId, part.filename || `image${extname(originalPath)}`, originalPath,
        detected.mime, buffer.byteLength, "UPLOADED", now);
      accepted += 1;
    }

    if (!accepted) {
      db.prepare("DELETE FROM batches WHERE id = ?").run(batchId);
      await rm(directory, { recursive: true, force: true });
      return reply.code(400).send(errorBody(request.id, "NO_VALID_IMAGES", "No se recibió ninguna imagen válida", rejected));
    }
    const finalName = batchName?.trim() || `Lote ${now.slice(0, 10)}`;
    db.prepare("UPDATE batches SET name = ?, status = 'QUEUED', updated_at = ? WHERE id = ?")
      .run(finalName, new Date().toISOString(), batchId);
    db.prepare(`INSERT INTO jobs (id, type, status, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), "ANALYZE_BATCH", "PENDING", JSON.stringify({ batchId }), now, now);
    return reply.code(202).send({ id: batchId, name: finalName, status: "QUEUED", accepted, rejected });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    db.prepare("UPDATE batches SET status = 'FAILED', error = ?, updated_at = ? WHERE id = ?")
      .run(message, new Date().toISOString(), batchId);
    throw error;
  }
});

app.get<{ Params: { id: string } }>("/api/batches/:id", {
  schema: {
    tags: ["Batches"],
    summary: "Obtiene estado y assets de un lote",
    params: paramsIdSchema,
    response: { 200: { type: "object", additionalProperties: true }, 404: errorSchema },
  },
}, async (request, reply) => {
  const batch = db.prepare("SELECT * FROM batches WHERE id = ?").get(request.params.id) as Record<string, unknown> | undefined;
  if (!batch) return reply.code(404).send(errorBody(request.id, "BATCH_NOT_FOUND", "El lote no existe"));
  const assets = db.prepare(`
    SELECT a.*, aa.features_json FROM assets a
    LEFT JOIN asset_analyses aa ON aa.asset_id = a.id
    WHERE a.batch_id = ? ORDER BY a.created_at
  `).all(request.params.id) as Array<Record<string, unknown>>;
  return { ...batch, assets: assets.map(publicAsset) };
});

app.get<{ Params: { id: string } }>("/api/batches/:id/groups", {
  schema: {
    tags: ["Groups"],
    summary: "Lista grupos, assets, contexto y propuesta de un lote",
    params: paramsIdSchema,
    response: { 200: { type: "array", items: { type: "object", additionalProperties: true } } },
  },
}, async (request) => {
  const groups = db.prepare("SELECT * FROM groups WHERE batch_id = ? ORDER BY created_at")
    .all(request.params.id) as Array<Record<string, unknown>>;
  const assetQuery = db.prepare(`
    SELECT a.*, aa.features_json, ga.position, ga.selected, ga.duplicate_of_asset_id, ga.duplicate_reason FROM group_assets ga
    JOIN assets a ON a.id = ga.asset_id
    LEFT JOIN asset_analyses aa ON aa.asset_id = a.id
    WHERE ga.group_id = ? ORDER BY ga.position
  `);
  const contextQuery = db.prepare("SELECT * FROM group_contexts WHERE group_id = ?");
  const proposalQuery = db.prepare("SELECT * FROM post_proposals WHERE group_id = ? ORDER BY created_at DESC LIMIT 1");
  return groups.map((group) => ({
    ...group,
    context: publicContext(contextQuery.get(group.id) as Record<string, unknown> | undefined),
    proposal: publicProposal(proposalQuery.get(group.id) as Record<string, unknown> | undefined),
    assets: (assetQuery.all(group.id) as Array<Record<string, unknown>>).map(publicAsset),
  }));
});

app.patch<{ Params: { id: string }; Body: { label?: string } }>("/api/groups/:id", {
  schema: {
    tags: ["Groups"],
    summary: "Renombra un grupo",
    params: paramsIdSchema,
    body: objectSchema({ label: { type: "string", minLength: 1, maxLength: 100 } }, ["label"]),
    response: { 200: objectSchema({ id: { type: "string" }, label: { type: "string" } }), 400: errorSchema, 404: errorSchema },
  },
}, async (request, reply) => {
  const label = request.body?.label?.trim();
  if (!label || label.length > 100) {
    return reply.code(400).send(errorBody(request.id, "INVALID_LABEL", "El nombre debe tener entre 1 y 100 caracteres"));
  }
  const result = db.prepare("UPDATE groups SET label = ? WHERE id = ?").run(label, request.params.id);
  if (!result.changes) return reply.code(404).send(errorBody(request.id, "GROUP_NOT_FOUND", "El grupo no existe"));
  return { id: request.params.id, label };
});

app.patch<{ Params: { id: string }; Body: { caption?: string; hashtags?: string[] } }>(
  "/api/proposals/:id",
  {
    schema: {
      tags: ["Proposals"],
      summary: "Edita caption y hashtags de una propuesta",
      params: paramsIdSchema,
      body: objectSchema({
        caption: { type: "string", minLength: 1, maxLength: 2200 },
        hashtags: { type: "array", items: { type: "string" }, maxItems: 12 },
      }, ["caption", "hashtags"]),
      response: { 200: { type: "object", additionalProperties: true }, 400: errorSchema, 404: errorSchema },
    },
  },
  async (request, reply) => {
    const caption = request.body?.caption?.trim();
    const hashtags = Array.isArray(request.body?.hashtags)
      ? request.body.hashtags.map((item) => item.trim()).filter(Boolean).slice(0, 12)
      : null;
    if (!caption || caption.length > 2200) {
      return reply.code(400).send(errorBody(request.id, "INVALID_CAPTION", "El caption debe tener entre 1 y 2200 caracteres"));
    }
    if (!hashtags) return reply.code(400).send(errorBody(request.id, "INVALID_HASHTAGS", "hashtags debe ser un arreglo"));
    const result = db.prepare(`
      UPDATE post_proposals SET caption = ?, hashtags_json = ?, status = 'EDITED', updated_at = ? WHERE id = ?
    `).run(caption, JSON.stringify(hashtags), new Date().toISOString(), request.params.id);
    if (!result.changes) return reply.code(404).send(errorBody(request.id, "PROPOSAL_NOT_FOUND", "La propuesta no existe"));
    return { id: request.params.id, caption, hashtags, status: "EDITED" };
  },
);

app.patch<{ Params: { groupId: string; assetId: string }; Body: { selected?: boolean } }>(
  "/api/groups/:groupId/assets/:assetId",
  {
    schema: {
      tags: ["Groups"],
      summary: "Restaura o excluye manualmente una foto del grupo",
      params: objectSchema({ groupId: { type: "string" }, assetId: { type: "string" } }, ["groupId", "assetId"]),
      body: objectSchema({ selected: { type: "boolean" } }, ["selected"]),
      response: { 200: { type: "object", additionalProperties: true }, 400: errorSchema, 404: errorSchema },
    },
  },
  async (request, reply) => {
    if (typeof request.body?.selected !== "boolean") {
      return reply.code(400).send(errorBody(request.id, "INVALID_SELECTION", "selected debe ser boolean"));
    }
    const result = db.prepare(`
      UPDATE group_assets
      SET selected = ?,
        duplicate_of_asset_id = CASE WHEN ? = 1 THEN NULL ELSE duplicate_of_asset_id END,
        duplicate_reason = CASE WHEN ? = 1 THEN NULL ELSE duplicate_reason END
      WHERE group_id = ? AND asset_id = ?
    `).run(
      request.body.selected ? 1 : 0,
      request.body.selected ? 1 : 0,
      request.body.selected ? 1 : 0,
      request.params.groupId,
      request.params.assetId,
    );
    if (!result.changes) return reply.code(404).send(errorBody(request.id, "GROUP_ASSET_NOT_FOUND", "La foto no existe en el grupo"));
    return { groupId: request.params.groupId, assetId: request.params.assetId, selected: request.body.selected };
  },
);

app.post<{ Params: { id: string } }>("/api/batches/:id/analyze", {
  schema: {
    tags: ["Batches"],
    summary: "Reencola el analisis de un lote",
    params: paramsIdSchema,
    response: { 202: objectSchema({ id: { type: "string" }, status: { type: "string" } }), 404: errorSchema },
  },
}, async (request, reply) => {
  const batch = db.prepare("SELECT id FROM batches WHERE id = ?").get(request.params.id);
  if (!batch) return reply.code(404).send(errorBody(request.id, "BATCH_NOT_FOUND", "El lote no existe"));
  const now = new Date().toISOString();
  db.prepare("UPDATE batches SET status = 'QUEUED', progress = 0, error = NULL, updated_at = ? WHERE id = ?")
    .run(now, request.params.id);
  db.prepare(`INSERT INTO jobs (id, type, status, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), "ANALYZE_BATCH", "PENDING", JSON.stringify({ batchId: request.params.id }), now, now);
  return reply.code(202).send({ id: request.params.id, status: "QUEUED" });
});

app.delete<{ Params: { id: string } }>("/api/batches/:id", {
  schema: {
    tags: ["Batches"],
    summary: "Elimina un lote y sus archivos",
    params: paramsIdSchema,
    response: { 204: { type: "null" }, 404: errorSchema },
  },
}, async (request, reply) => {
  const result = db.prepare("DELETE FROM batches WHERE id = ?").run(request.params.id);
  if (!result.changes) return reply.code(404).send(errorBody(request.id, "BATCH_NOT_FOUND", "El lote no existe"));
  await rm(resolve(storageRoot, request.params.id), { recursive: true, force: true });
  return reply.code(204).send();
});

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  const errorCode = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  const isLimit = errorCode.startsWith("FST_REQ_FILE_TOO_LARGE") ||
    errorCode.startsWith("FST_FILES_LIMIT") ||
    errorCode.startsWith("FST_PARTS_LIMIT");
  reply.code(isLimit ? 413 : 500).send(errorBody(
    request.id,
    isLimit ? "UPLOAD_LIMIT" : "INTERNAL_ERROR",
    isLimit ? `La carga supera el límite de ${maxFiles} archivos o ${maxFileSizeMb} MB por archivo` : "No se pudo completar la operación",
  ));
});

function publicAsset(asset: Record<string, unknown>) {
  const features = asset.features_json ? JSON.parse(String(asset.features_json)) as AssetFeatures : null;
  return {
    id: asset.id,
    originalName: asset.original_name,
    mime: asset.mime,
    size: asset.size,
    status: asset.status,
    error: asset.error,
    selected: asset.selected === undefined ? true : Boolean(asset.selected),
    duplicateOfAssetId: asset.duplicate_of_asset_id ?? null,
    duplicateReason: asset.duplicate_reason ?? null,
    thumbnailUrl: asset.thumbnail_path ? `/media/${String(asset.batch_id)}/thumbnails/${String(asset.id)}.jpg` : null,
    features: features ? { ...features, embedding: undefined, perceptualHash: undefined } : null,
  };
}

function publicContext(context: Record<string, unknown> | undefined) {
  if (!context) return null;
  const value = JSON.parse(String(context.context_json)) as Record<string, unknown>;
  return {
    provider: context.provider,
    model: context.model,
    groupLabel: value.groupLabel,
    context: value.context,
    error: value.error,
    confidence: value.confidence,
  };
}

function publicProposal(proposal: Record<string, unknown> | undefined) {
  if (!proposal) return null;
  return {
    id: proposal.id,
    caption: proposal.caption,
    hashtags: JSON.parse(String(proposal.hashtags_json)) as string[],
    altText: JSON.parse(String(proposal.alt_text_json)) as Array<{ assetId: string; text: string }>,
    status: proposal.status,
    provider: proposal.provider,
    confidence: proposal.confidence,
  };
}

function debugEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEBUG_ENDPOINTS === "true";
}

function countTables(tables: string[]) {
  return Object.fromEntries(tables.map((table) => [
    table,
    (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count,
  ]));
}

function debugAsset(asset: Record<string, unknown>) {
  const features = asset.features_json ? JSON.parse(String(asset.features_json)) as AssetFeatures : null;
  return {
    id: asset.id,
    originalName: asset.original_name,
    status: asset.status,
    error: asset.error,
    modelVersion: asset.model_version,
    thumbnailReady: Boolean(asset.thumbnail_path),
    embeddingProvider: features?.embeddingProvider ?? null,
    embeddingDimensions: features?.embedding?.length ?? 0,
    embeddingSample: features?.embedding?.slice(0, 8) ?? [],
    qualityScore: features?.qualityScore ?? null,
    capturedAt: features?.capturedAt ?? null,
    coordinates: features?.coordinates ?? null,
  };
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

function errorBody(correlationId: string, code: string, message: string, details?: unknown) {
  return { code, message, details, correlationId };
}

const port = Number(process.env.API_PORT || 3001);
if (process.env.API_NO_LISTEN !== "true") {
  await app.listen({ host: process.env.API_HOST || "0.0.0.0", port });
}
