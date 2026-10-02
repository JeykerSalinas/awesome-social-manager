# Awesome Social Manager · agrupación sencilla con CLIP

Una app Vue para seleccionar hasta 200 fotos y agruparlas por similitud semántica con CLIP, sin backend, claves ni coste de API. Rama independiente basada en `master`; reutiliza la idea del proveedor CLIP y la revisión de miniaturas de `feature/mvp-image-culling`.

## Ejecutar

Node.js 22 o superior:

```sh
npm install
npm run dev
```

Abre la URL local que muestra Vite. Selecciona JPEG, PNG o WebP y pulsa **Agrupar con CLIP**. Ajusta el control de similitud: valores bajos crean grupos más amplios, altos crean grupos más específicos. Las fotos aisladas conservan su propio grupo.

## Cómo funciona

- `src/clip.worker.js`: descarga `Xenova/clip-vit-base-patch32` cuantizado y calcula embeddings normalizados con Transformers.js/WASM en un Web Worker.
- `src/grouping.js`: compara embeddings mediante similitud coseno y agrupa con enlace completo, evitando cadenas de imágenes que unan temas diferentes.
- `src/App.vue`: carga local, progreso, errores por archivo, miniaturas y ajuste de grupos. Los embeddings se reutilizan al mover el control.

El análisis no utiliza fecha ni GPS. No genera captions ni nombres semánticos para los grupos, ni publica en Instagram. Es una agrupación aproximada por contenido; no reconstruye automáticamente historias o eventos.

## Coste y privacidad

Sin suscripción ni peticiones a servicios de inferencia. Consume CPU, memoria y electricidad del equipo. La primera ejecución requiere internet para descargar el modelo y el motor desde Hugging Face/CDN; el navegador puede conservarlos en caché. Las fotografías se procesan localmente y no se envían a esos servicios. No hay persistencia de fotos o resultados: recargar la página los elimina. No se necesita GPU.

Los lotes grandes o fotos de mucha resolución pueden ser lentos o consumir mucha memoria. Empieza con 10–20 fotos. Los umbrales son heurísticos y ajustables, no porcentajes de confianza.

## Comprobaciones

```sh
npm test
npm run build
```

La especificación en `docs/technical-specification.md` conserva el roadmap del producto completo; no describe el alcance de esta rama simplificada.
