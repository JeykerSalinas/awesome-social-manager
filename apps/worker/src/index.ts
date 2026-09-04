import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  analyzeImage,
  clusterAssets,
  createEmbeddingProvider,
  openDatabase,
  type AppDatabase,
  type AssetFeatures,
  type ClusterInput,
} from "@asm/core";

interface JobRow {
  id: string;
  type: string;
  status: string;
  payload_json: string;
  attempts: number;
}

interface AssetRow {
  id: string;
  batch_id: string;
  original_path: string;
}

const db = openDatabase();
const embeddingProvider = createEmbeddingProvider();
const pollMs = Number(process.env.WORKER_POLL_MS || 1500);
let active = true;

console.log(`[worker] ready; embedding provider=${embeddingProvider.name}`);
process.once("SIGTERM", () => { active = false; });
process.once("SIGINT", () => { active = false; });

while (active) {
  const job = claimJob(db);
  if (!job) {
    await wait(pollMs);
    continue;
  }
  try {
    if (job.type !== "ANALYZE_BATCH") throw new Error(`Unsupported job type: ${job.type}`);
    const payload = JSON.parse(job.payload_json) as { batchId: string };
    await processBatch(db, payload.batchId);
    finishJob(db, job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[worker] job ${job.id} failed`, error);
    failJob(db, job, message);
  }
}

function claimJob(database: AppDatabase): JobRow | null {
  return database.transaction(() => {
    const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString();
    const job = database.prepare(`
      SELECT * FROM jobs
      WHERE (status = 'PENDING' OR (status = 'RUNNING' AND locked_at < ?)) AND attempts < 3
      ORDER BY created_at LIMIT 1
    `).get(staleBefore) as JobRow | undefined;
    if (!job) return null;
    const now = new Date().toISOString();
    database.prepare(`
      UPDATE jobs SET status = 'RUNNING', attempts = attempts + 1, locked_at = ?, updated_at = ?, error = NULL
      WHERE id = ?
    `).run(now, now, job.id);
    return { ...job, attempts: job.attempts + 1, status: "RUNNING" };
  })();
}

async function processBatch(database: AppDatabase, batchId: string): Promise<void> {
  const assets = database.prepare("SELECT id, batch_id, original_path FROM assets WHERE batch_id = ? ORDER BY created_at")
    .all(batchId) as AssetRow[];
  if (!assets.length) throw new Error("Batch has no assets");
  updateBatch(database, batchId, "ANALYZING", 1, null);
  const clusterInputs: ClusterInput[] = [];

  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index]!;
    const thumbnailPath = resolve(process.env.STORAGE_PATH || "./storage", batchId, "thumbnails", `${asset.id}.jpg`);
    try {
      const features = await analyzeImage(asset.original_path, thumbnailPath, embeddingProvider);
      const now = new Date().toISOString();
      database.prepare(`
        INSERT INTO asset_analyses (asset_id, features_json, model_version, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(asset_id) DO UPDATE SET
          features_json = excluded.features_json,
          model_version = excluded.model_version,
          created_at = excluded.created_at
      `).run(asset.id, JSON.stringify(features), embeddingProvider.name, now);
      database.prepare("UPDATE assets SET thumbnail_path = ?, status = 'ANALYZED', error = NULL WHERE id = ?")
        .run(thumbnailPath, asset.id);
      clusterInputs.push({ assetId: asset.id, features });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      database.prepare("UPDATE assets SET status = 'REJECTED', error = ? WHERE id = ?").run(message, asset.id);
    }
    const progress = Math.round(((index + 1) / assets.length) * 82);
    updateBatch(database, batchId, "ANALYZING", progress, null);
  }

  if (!clusterInputs.length) throw new Error("No image could be analyzed");
  updateBatch(database, batchId, "ANALYZING", 90, null);
  const groups = clusterAssets(clusterInputs);
  database.transaction(() => {
    database.prepare("DELETE FROM groups WHERE batch_id = ?").run(batchId);
    const insertGroup = database.prepare(`
      INSERT INTO groups (id, batch_id, label, confidence, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertAsset = database.prepare(`INSERT INTO group_assets (group_id, asset_id, position) VALUES (?, ?, ?)`);
    const markGrouped = database.prepare("UPDATE assets SET status = 'GROUPED' WHERE id = ?");
    for (const group of groups) {
      const groupId = randomUUID();
      insertGroup.run(groupId, batchId, group.label, group.confidence, group.reason, new Date().toISOString());
      const orderedIds = [...group.assetIds].sort((left, right) => {
        const a = clusterInputs.find((item) => item.assetId === left)?.features;
        const b = clusterInputs.find((item) => item.assetId === right)?.features;
        return sortAssets(a, b);
      });
      orderedIds.forEach((assetId, position) => {
        insertAsset.run(groupId, assetId, position);
        markGrouped.run(assetId);
      });
    }
  })();
  updateBatch(database, batchId, "READY", 100, null);
}

function sortAssets(left?: AssetFeatures, right?: AssetFeatures): number {
  if (left?.capturedAt && right?.capturedAt) return left.capturedAt.localeCompare(right.capturedAt);
  return (right?.qualityScore ?? 0) - (left?.qualityScore ?? 0);
}

function updateBatch(database: AppDatabase, id: string, status: string, progress: number, error: string | null) {
  database.prepare("UPDATE batches SET status = ?, progress = ?, error = ?, updated_at = ? WHERE id = ?")
    .run(status, progress, error, new Date().toISOString(), id);
}

function finishJob(database: AppDatabase, id: string): void {
  database.prepare("UPDATE jobs SET status = 'SUCCEEDED', updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
}

function failJob(database: AppDatabase, job: JobRow, message: string): void {
  const terminal = job.attempts >= 3;
  const nextStatus = terminal ? "FAILED" : "PENDING";
  database.prepare("UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?")
    .run(nextStatus, message, new Date().toISOString(), job.id);
  if (terminal) {
    const payload = JSON.parse(job.payload_json) as { batchId?: string };
    if (payload.batchId) updateBatch(database, payload.batchId, "FAILED", 0, message);
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
