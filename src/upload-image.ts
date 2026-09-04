import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { config } from "dotenv";
import { Zernio } from "@zernio/node";

config({ quiet: true });

const apiKey = process.env.ZERNIO_API_KEY;
const imagePath = process.env.IMAGE_PATH;

if (!apiKey) {
  throw new Error("Falta ZERNIO_API_KEY en .env");
}

if (!imagePath) {
  throw new Error("Falta IMAGE_PATH en .env");
}

const zernio = new Zernio({ apiKey });

async function uploadImage(): Promise<void> {
  const image = await readFile(imagePath);
  const imageInfo = await stat(imagePath);
  const contentType = "image/jpeg" as const;

  const { data } = await zernio.media.getMediaPresignedUrl({
    body: {
      filename: basename(imagePath),
      contentType,
      size: imageInfo.size,
    },
  });

  if (!data.uploadUrl || !data.publicUrl) {
    throw new Error("Zernio no devolvió las URLs necesarias");
  }

  const response = await fetch(data.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
    },
    body: image,
  });

  if (!response.ok) {
    throw new Error(
      `Falló la subida: ${response.status} ${response.statusText}`
    );
  }

  console.log("Imagen subida correctamente.");
  console.log("Public URL:", data.publicUrl);
}

uploadImage().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Error desconocido";

  console.error("No se pudo subir la imagen:", message);
  process.exitCode = 1;
});
