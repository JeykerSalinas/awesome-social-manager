import { config } from "dotenv";
import { Zernio } from "@zernio/node";

config({ quiet: true });

const apiKey = process.env.ZERNIO_API_KEY;
const profileId = process.env.ZERNIO_PROFILE_ID;

if (!apiKey) {
  throw new Error("Falta ZERNIO_API_KEY en .env");
}

if (!profileId) {
  throw new Error("Falta ZERNIO_PROFILE_ID en .env");
}

const zernio = new Zernio({ apiKey });

async function connectInstagram(): Promise<void> {
  const { data } = await zernio.connect.getConnectUrl({
    path: {
      platform: "instagram",
    },
    query: {
      profileId,
      loginMethod: "instagram_login",
    },
  });

  console.log("Abre este enlace en el navegador:");
  console.log(data.authUrl);
}

connectInstagram().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Error desconocido";

  console.error("No se pudo generar el enlace OAuth:", message);
  process.exitCode = 1;
});
