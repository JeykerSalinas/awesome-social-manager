import { config } from "dotenv";
import { Zernio } from "@zernio/node";

config({ quiet: true });

const apiKey = process.env.ZERNIO_API_KEY;
const accountId = process.env.ZERNIO_INSTAGRAM_ACCOUNT_ID;
const mediaUrl = process.env.ZERNIO_MEDIA_URL;
const caption = process.env.INSTAGRAM_CAPTION;

if (!apiKey) {
  throw new Error("Falta ZERNIO_API_KEY en .env");
}

if (!accountId) {
  throw new Error("Falta ZERNIO_INSTAGRAM_ACCOUNT_ID en .env");
}

if (!mediaUrl) {
  throw new Error("Falta ZERNIO_MEDIA_URL en .env");
}

if (!caption) {
  throw new Error("Falta INSTAGRAM_CAPTION en .env");
}

const confirmed = process.argv.includes("--confirm");
const zernio = new Zernio({ apiKey });

async function publishImage(): Promise<void> {
  console.log("Vista previa:");
  console.log({
    platform: "instagram",
    accountId,
    mediaUrl,
    caption,
  });

  if (!confirmed) {
    console.log("\nNo se publicó nada.");
    console.log("Añade --confirm para ejecutar la publicación.");
    return;
  }

  const { data } = await zernio.posts.createPost({
    body: {
      content: caption,
      mediaItems: [
        {
          type: "image",
          url: mediaUrl,
        },
      ],
      platforms: [
        {
          platform: "instagram",
          accountId,
        },
      ],
      publishNow: true,
    },
  });

  console.log("Publicación enviada a Zernio.");
  console.log("Post ID:", data.post._id);
}

publishImage().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Error desconocido";

  console.error("No se pudo publicar:", message);
  process.exitCode = 1;
});
