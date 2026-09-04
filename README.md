# Awesome Social Manager

MVP de curación editorial que transforma un lote de fotografías en grupos revisables antes de construir publicaciones para Instagram.

Esta primera vertical implementa:

- carga de hasta 50 imágenes JPEG/PNG con validación de contenido real;
- almacenamiento de originales inmutables y miniaturas;
- extracción de fecha, GPS y cámara desde EXIF;
- hash perceptual, nitidez, exposición, contraste y puntuación técnica;
- embeddings visuales locales o CLIP opcional;
- agrupación combinando geografía, tiempo y similitud visual;
- worker persistente con progreso, reintentos y recuperación de trabajos abandonados;
- dashboard Vue para revisar y renombrar los grupos;
- eliminación completa de un lote y sus archivos.

La publicación y programación mediante Zernio pertenecen a la siguiente vertical. Consulta la [especificación técnica](docs/technical-specification.md) para el alcance completo.

## Inicio rápido

Requisitos: Node.js 22 o superior.

```bash
cp .env.example .env
npm install
```

En tres terminales:

```bash
npm run dev:api
npm run dev:worker
npm run dev:web
```

Abre `http://localhost:5173`.

El modo predeterminado usa un descriptor visual local ligero y no requiere claves. Para usar embeddings CLIP:

```bash
EMBEDDING_PROVIDER=clip npm run dev:worker
```

La primera ejecución descarga `Xenova/clip-vit-base-patch32`. El modelo se puede cambiar con `CLIP_MODEL`.

## Docker

```bash
docker compose up --build
```

El dashboard estará disponible en `http://localhost:8080`. API y worker comparten volúmenes persistentes para SQLite y fotografías.

## Verificación

```bash
npm test
npm run typecheck
npm run build
```

## Privacidad

En modo `local`, las fotografías no salen del proceso. Al activar un proveedor externo, el despliegue debe informar al usuario y aplicar una política explícita de retención y eliminación.
