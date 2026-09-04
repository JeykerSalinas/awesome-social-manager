import { config } from "dotenv";
import { Zernio } from "@zernio/node";

config();

const apiKey = process.env.ZERNIO_API_KEY;

if (!apiKey) {
  throw new Error("Falta ZERNIO_API_KEY en el archivo .env");
}

const zernio = new Zernio({ apiKey });

async function createProfile(): Promise<void> {
  const { data } = await zernio.profiles.createProfile({
    body: {
      name: "Awesome Social Manager",
      description: "Prueba de integración con Instagram",
    },
  });

  console.log("Perfil creado correctamente");
  console.log("Profile ID:", data.profile._id);
}

createProfile().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Error desconocido";

  console.error("No se pudo crear el perfil:", message);
  process.exitCode = 1;
});
