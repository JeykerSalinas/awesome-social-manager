import sharp from "sharp";

const inputPath = "assets/20230806_130310.jpg";
const outputPath = "assets/20230806_130310-instagram.jpg";

async function prepareImage(): Promise<void> {
  await sharp(inputPath)
    .rotate()
    .resize({
      width: 3506,
      height: 1836,
      fit: "cover",
      position: "centre",
    })
    .jpeg({
      quality: 90,
    })
    .toFile(outputPath);

  console.log("Imagen preparada correctamente.");
  console.log("Resultado:", outputPath);
}

prepareImage().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Error desconocido";

  console.error("No se pudo preparar la imagen:", message);
  process.exitCode = 1;
});
