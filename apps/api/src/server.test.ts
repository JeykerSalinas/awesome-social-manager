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
});
