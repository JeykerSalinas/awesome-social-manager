import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { fileTypeFromBuffer } from "file-type";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { openDatabase, type AssetFeatures } from "@asm/core";

export const app = Fastify({ logger: process.env.NODE_ENV !== "test", requestIdHeader: "x-correlation-id" });
const db = openDatabase();
const storageRoot = resolve(process.env.STORAGE_PATH || "./storage");
await mkdir(storageRoot, { recursive: true });

await app.register(cors, { origin: true });
await app.register(multipart, {
  limits: { files: 50, fileSize: 25 * 1024 * 1024, parts: 55 },
});
await app.register(fastifyStatic, { root: storageRoot, prefix: "/media/" });

app.get("/health", async () => ({ status: "ok" }));

app.get("/api/batches", async () => {
  return db.prepare(`
    SELECT b.*, COUNT(a.id) AS asset_count
    FROM batches b LEFT JOIN assets a ON a.batch_id = b.id
    GROUP BY b.id ORDER BY b.created_at DESC
  `).all();
});

app.post("/api/batches", async (request, reply) => {
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

app.get<{ Params: { id: string } }>("/api/batches/:id", async (request, reply) => {
  const batch = db.prepare("SELECT * FROM batches WHERE id = ?").get(request.params.id) as Record<string, unknown> | undefined;
  if (!batch) return reply.code(404).send(errorBody(request.id, "BATCH_NOT_FOUND", "El lote no existe"));
  const assets = db.prepare(`
    SELECT a.*, aa.features_json FROM assets a
    LEFT JOIN asset_analyses aa ON aa.asset_id = a.id
    WHERE a.batch_id = ? ORDER BY a.created_at
  `).all(request.params.id) as Array<Record<string, unknown>>;
  return { ...batch, assets: assets.map(publicAsset) };
});

app.get<{ Params: { id: string } }>("/api/batches/:id/groups", async (request) => {
  const groups = db.prepare("SELECT * FROM groups WHERE batch_id = ? ORDER BY created_at")
    .all(request.params.id) as Array<Record<string, unknown>>;
  const assetQuery = db.prepare(`
    SELECT a.*, aa.features_json, ga.position FROM group_assets ga
    JOIN assets a ON a.id = ga.asset_id
    LEFT JOIN asset_analyses aa ON aa.asset_id = a.id
    WHERE ga.group_id = ? ORDER BY ga.position
  `);
  return groups.map((group) => ({ ...group, assets: (assetQuery.all(group.id) as Array<Record<string, unknown>>).map(publicAsset) }));
});

app.patch<{ Params: { id: string }; Body: { label?: string } }>("/api/groups/:id", async (request, reply) => {
  const label = request.body?.label?.trim();
  if (!label || label.length > 100) {
    return reply.code(400).send(errorBody(request.id, "INVALID_LABEL", "El nombre debe tener entre 1 y 100 caracteres"));
  }
  const result = db.prepare("UPDATE groups SET label = ? WHERE id = ?").run(label, request.params.id);
  if (!result.changes) return reply.code(404).send(errorBody(request.id, "GROUP_NOT_FOUND", "El grupo no existe"));
  return { id: request.params.id, label };
});

app.post<{ Params: { id: string } }>("/api/batches/:id/analyze", async (request, reply) => {
  const batch = db.prepare("SELECT id FROM batches WHERE id = ?").get(request.params.id);
  if (!batch) return reply.code(404).send(errorBody(request.id, "BATCH_NOT_FOUND", "El lote no existe"));
  const now = new Date().toISOString();
  db.prepare("UPDATE batches SET status = 'QUEUED', progress = 0, error = NULL, updated_at = ? WHERE id = ?")
    .run(now, request.params.id);
  db.prepare(`INSERT INTO jobs (id, type, status, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), "ANALYZE_BATCH", "PENDING", JSON.stringify({ batchId: request.params.id }), now, now);
  return reply.code(202).send({ id: request.params.id, status: "QUEUED" });
});

app.delete<{ Params: { id: string } }>("/api/batches/:id", async (request, reply) => {
  const result = db.prepare("DELETE FROM batches WHERE id = ?").run(request.params.id);
  if (!result.changes) return reply.code(404).send(errorBody(request.id, "BATCH_NOT_FOUND", "El lote no existe"));
  await rm(resolve(storageRoot, request.params.id), { recursive: true, force: true });
  return reply.code(204).send();
});

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  const errorCode = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  const isLimit = errorCode.startsWith("FST_REQ_FILE_TOO_LARGE") || errorCode.startsWith("FST_FILES_LIMIT");
  reply.code(isLimit ? 413 : 500).send(errorBody(
    request.id,
    isLimit ? "UPLOAD_LIMIT" : "INTERNAL_ERROR",
    isLimit ? "La carga supera el límite de 50 archivos o 25 MB por archivo" : "No se pudo completar la operación",
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
    thumbnailUrl: asset.thumbnail_path ? `/media/${String(asset.batch_id)}/thumbnails/${String(asset.id)}.jpg` : null,
    features: features ? { ...features, embedding: undefined, perceptualHash: undefined } : null,
  };
}

function errorBody(correlationId: string, code: string, message: string, details?: unknown) {
  return { code, message, details, correlationId };
}

const port = Number(process.env.API_PORT || 3001);
if (process.env.API_NO_LISTEN !== "true") {
  await app.listen({ host: process.env.API_HOST || "0.0.0.0", port });
}
