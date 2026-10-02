import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

describe("batch API", () => {
  let app: typeof import("./server.js").app;
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "asm-api-"));
    process.env.NODE_ENV = "test";
    process.env.API_NO_LISTEN = "true";
    process.env.DATABASE_PATH = join(directory, "app.db");
    process.env.STORAGE_PATH = join(directory, "storage");
    app = (await import("./server.js")).app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("accepts a real JPEG multipart and persists a queued batch", async () => {
    const image = await sharp({
      create: { width: 120, height: 160, channels: 3, background: { r: 20, g: 90, b: 180 } },
    }).jpeg().toBuffer();
    const boundary = "----asm-vitest-boundary";
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nTest batch\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="test.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      image,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const response = await app.inject({
      method: "POST",
      url: "/api/batches",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(response.statusCode).toBe(202);
    const created = response.json();
    expect(created).toMatchObject({ name: "Test batch", status: "QUEUED", accepted: 1 });
    const status = await app.inject({ method: "GET", url: `/api/batches/${created.id}` });
    expect(status.statusCode).toBe(200);
    expect(status.json().assets).toHaveLength(1);
  });

  it("rejects data disguised as an image", async () => {
    const boundary = "----asm-invalid-boundary";
    const payload = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="fake.jpg"\r\nContent-Type: image/jpeg\r\n\r\nnot an image\r\n--${boundary}--\r\n`,
    );
    const response = await app.inject({
      method: "POST",
      url: "/api/batches",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("NO_VALID_IMAGES");
  });

  it("serves OpenAPI documentation", async () => {
    const docs = await app.inject({ method: "GET", url: "/docs" });
    expect(docs.statusCode).toBe(200);
    expect(docs.headers["content-type"]).toContain("text/html");

    const spec = await app.inject({ method: "GET", url: "/docs/json" });
    expect(spec.statusCode).toBe(200);
    expect(spec.json().openapi).toBeTruthy();
  });

  it("updates the manual selection for a grouped asset", async () => {
    const db = (await import("@asm/core")).openDatabase();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO batches (id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("batch-selection", "Selection", "READY", now, now);
    db.prepare(`
      INSERT INTO assets (id, batch_id, original_name, original_path, mime, size, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("asset-selection", "batch-selection", "test.jpg", "/tmp/test.jpg", "image/jpeg", 100, "GROUPED", now);
    db.prepare("INSERT INTO groups (id, batch_id, label, confidence, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("group-selection", "batch-selection", "Group", 0.9, "Test", now);
    db.prepare(`
      INSERT INTO group_assets (group_id, asset_id, position, selected, duplicate_of_asset_id, duplicate_reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("group-selection", "asset-selection", 0, 0, "keeper", "Similar");

    const response = await app.inject({
      method: "PATCH",
      url: "/api/groups/group-selection/assets/asset-selection",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ selected: true }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ selected: true });
    const row = db.prepare(`
      SELECT selected, duplicate_of_asset_id, duplicate_reason FROM group_assets
      WHERE group_id = ? AND asset_id = ?
    `).get("group-selection", "asset-selection") as {
      selected: number;
      duplicate_of_asset_id: string | null;
      duplicate_reason: string | null;
    };
    expect(row.selected).toBe(1);
    expect(row.duplicate_of_asset_id).toBeNull();
    expect(row.duplicate_reason).toBeNull();
  });
});
