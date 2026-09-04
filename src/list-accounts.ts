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

type ConnectedAccount = {
  _id: string;
  platform: string;
  username?: string;
};

async function listAccounts(): Promise<void> {
    const { data } = await zernio.accounts.listAccounts({
      query: {
        profileId,
        platform: "instagram",
        status: "connected",
      },
    });
  const accounts = data.accounts as ConnectedAccount[];

  const instagramAccounts = accounts.filter(
    (account) => account.platform === "instagram"
  );

  if (instagramAccounts.length === 0) {
    console.log("No se encontraron cuentas de Instagram.");
    return;
  }

  console.log("Cuentas de Instagram conectadas:");

  for (const account of instagramAccounts) {
    console.log(`Usuario: ${account.username ?? "desconocido"}`);
    console.log(`Account ID: ${account._id}`);
  }
}

listAccounts().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Error desconocido";

  console.error("No se pudieron consultar las cuentas:", message);
  process.exitCode = 1;
});
