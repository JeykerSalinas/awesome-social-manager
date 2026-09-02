**ESPECIFICACION TECNICA**

Dashboard inteligente para seleccionar, proponer y publicar contenido fotografico

**Proyecto:** Awesome Social Manager

**Version:** 0.2 - MVP

**Estado:** Borrador base para implementacion

**Fecha:** 02/09/2026

**Stack objetivo:** Vue 3 + Node.js + TypeScript + Zernio

| **DECISION PRINCIPAL** El MVP recibe archivos locales, analiza y agrupa fotografias de forma asincrona, genera borradores editables y solo publica o programa en Instagram cuando el usuario confirma la accion. |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 1. Objetivo

Construir una aplicacion web de una sola cuenta que convierta lotes de fotografias en propuestas de publicaciones para Instagram. El sistema debe reducir el trabajo manual de revisar, agrupar, ordenar y adaptar imagenes, sin eliminar la aprobacion humana antes de publicar.

# 2. Alcance del MVP

- Carga multiple de imagenes JPEG y PNG mediante arrastrar y soltar o selector de archivos.

- Extraccion de metadatos tecnicos y EXIF disponibles, sin depender de ellos para funcionar.

- Analisis visual, calculo de similitud y agrupacion por lugar, momento, apariencia e iluminacion.

- Generacion de una o varias propuestas de post por lote, con portada, orden y caption sugerido.

- Edicion de captions, reordenamiento, exclusion de imagenes y aprobacion manual.

- Preparacion de medios con Sharp y publicacion en Instagram mediante Zernio.

- Programacion de publicaciones con fecha, hora y zona horaria mediante Zernio.

- Seguimiento de estado: pendiente, procesando, listo, publicando, publicado o fallido.

## 2.1 Fuera de alcance inicial

- Acceso automatico a toda la biblioteca de Google Photos.

- Reconocimiento o identificacion nominal de personas.

- Publicacion autonoma sin confirmacion explicita.

- Video, Reels, Stories, anuncios, mensajeria y analitica avanzada.

- Multiusuario, roles, facturacion y aislamiento entre organizaciones.

- Edicion fotografica creativa; solo se contemplan transformaciones tecnicas.

# 3. Principios de diseno

| **Principio**           | **Aplicacion concreta**                                                                   |
|-------------------------|-------------------------------------------------------------------------------------------|
| Humano en el circuito   | El modelo propone; el usuario edita, aprueba y publica.                                   |
| Originales inmutables   | Las transformaciones crean derivados; nunca sobrescriben el archivo subido.               |
| Procesamiento asincrono | La interfaz no queda bloqueada mientras se analiza un lote.                               |
| IA desacoplada          | Vision, embeddings y generacion de caption se consumen mediante interfaces reemplazables. |
| Trazabilidad            | Cada grupo, propuesta y publicacion conserva estados, errores e identificadores externos. |
| Privacidad por defecto  | Se limita la retencion y se informa cuando una imagen sale hacia un proveedor de IA.      |

# 4. Flujo principal del usuario

1.  Crear un lote y subir entre 1 y 50 fotografias.

2.  Visualizar progreso de carga y procesamiento por archivo.

3.  Revisar los grupos sugeridos: lugar/evento, similitud visual y coherencia luminica.

4.  Abrir una propuesta, editar caption, portada, orden y seleccion de imagenes.

5.  Elegir Publicar ahora o Programar, revisar fecha, zona horaria y contenido, y confirmar.

6.  Consultar el estado hasta obtener URL publica o un error accionable.

## 4.1 Requisitos de interfaz

- Zona de carga con formatos, limites y errores visibles antes de iniciar.

- Tarjeta por lote con miniaturas, progreso y opcion de reintento.

- Vista de grupos con nombre sugerido, confianza, razones y cantidad de fotos.

- Editor de propuesta con contador de caracteres, orden drag-and-drop y previsualizacion del carrusel.

- Selector Publicar ahora/Programar con fecha, hora, zona horaria y resumen en hora local.

- Boton Publicar deshabilitado mientras haya archivos invalidos o analisis incompleto.

- Confirmacion que muestre cuenta destino, caption, cantidad de imagenes y transformaciones.

# 5. Arquitectura propuesta

> Vue 3 Web -\> Fastify API -\> SQLite/Drizzle  
> \|-\> File Storage  
> \|-\> Analysis Worker -\> Vision / Embeddings / Clustering  
> \|-\> Media Worker -\> Sharp -\> Zernio Scheduler -\> Instagram  
> \|\<- Zernio Webhooks / Reconciliation

| **Componente**     | **Responsabilidad**                                             | **Tecnologia MVP**                |
|--------------------|-----------------------------------------------------------------|-----------------------------------|
| Web                | Carga, progreso, revision, edicion y publicacion.               | Vue 3, Vite, TypeScript, Pinia    |
| API                | Validacion, persistencia, endpoints y autorizacion de acciones. | Fastify, TypeScript, Zod          |
| Worker de analisis | EXIF, miniaturas, embeddings, vision, clustering y propuestas.  | Node.js, Sharp, adaptadores de IA |
| Worker de medios   | Derivados y carga previa a Zernio.                              | Node.js, Sharp, @zernio/node      |
| Zernio             | Programacion, publicacion automatica y estados externos.        | scheduledFor, timezone, webhooks  |
| Persistencia       | Lotes, activos, grupos, propuestas, trabajos y publicaciones.   | SQLite + Drizzle ORM              |
| Archivos           | Originales y derivados fuera de la base de datos.               | Disco local; interfaz S3/Blob     |

## 5.1 Estructura de repositorio

> apps/  
> web/ \# Vue 3  
> api/ \# Fastify  
> worker/ \# analisis, medios y reconciliacion  
> packages/  
> shared/ \# tipos, esquemas Zod y contratos  
> ai/ \# interfaces y proveedores  
> storage/ \# almacenamiento local / cloud  
> zernio/ \# cliente y mapeo de errores  
> data/ \# SQLite local, excluido de Git  
> storage/ \# originales y derivados, excluido de Git

# 6. Pipeline de analisis

| **Etapa**     | **Entrada**       | **Salida**                                                      |
|---------------|-------------------|-----------------------------------------------------------------|
| Validacion    | Archivo subido    | MIME, tamano, dimensiones y rechazo temprano                    |
| Normalizacion | Original valido   | Miniatura y preview con orientacion corregida                   |
| Metadatos     | Original          | Fecha, GPS disponible, camara, orientacion                      |
| Calidad       | Preview           | Nitidez, exposicion, contraste y resolucion                     |
| Similitud     | Preview           | Hash perceptual y embedding visual                              |
| Vision        | Preview           | Escena, lugar probable, sujetos, clima, iluminacion y confianza |
| Clustering    | Features del lote | Grupos y elementos atipicos                                     |
| Planificacion | Grupo             | Propuestas de carrusel y captions                               |

## 6.1 Contrato del analisis visual

El proveedor debe responder JSON validado con Zod. Si una localizacion no puede sostenerse con GPS o evidencia visual suficiente, el campo debe quedar en null; no se inventaran nombres de ciudades o monumentos.

> {  
> "scene": "historic_square",  
> "place": { "name": "Piazza dei Cavalieri", "confidence": 0.91 },  
> "lighting": { "type": "daylight", "quality": 0.82 },  
> "topics": \["architecture", "travel"\],  
> "quality": { "sharpness": 0.88, "exposure": 0.78 },  
> "safety": { "sensitive": false },  
> "description": "Historic facade and statue in a public square"  
> }

## 6.2 Agrupacion

La agrupacion debe combinar senales; no se delega completamente a un LLM. Se propone clustering por densidad o jerarquico sobre un vector compuesto. Cuando falte GPS, sus pesos se redistribuyen entre fecha, embedding y etiquetas visuales.

| **Senal**            | **Peso inicial** | **Uso**                                        |
|----------------------|------------------|------------------------------------------------|
| Distancia geografica | 35%              | GPS y geocodificacion inversa cuando existan.  |
| Embedding visual     | 30%              | Arquitectura, paisaje, escena y apariencia.    |
| Proximidad temporal  | 15%              | Fotos tomadas durante el mismo evento o paseo. |
| Iluminacion/color    | 10%              | Coherencia de carrusel y separacion dia/noche. |
| Hash perceptual      | 10%              | Duplicados y tomas casi identicas.             |

| **REGLA DE NEGOCIO** Un carrusel admite hasta 10 medios. Los grupos de mas de 10 fotos deben dividirse en propuestas coherentes o solicitar seleccion manual. |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 7. Motor de propuestas

Cada grupo puede producir cero, una o varias propuestas. El motor debe explicar por que eligio cada foto y mantener separadas la seleccion visual y la escritura del caption.

- Seleccionar de 1 a 10 imagenes, penalizando duplicados y mala calidad.

- Elegir portada mediante calidad tecnica, composicion, relevancia y fuerza visual.

- Ordenar como secuencia: apertura, contexto, detalle, personas/accion y cierre.

- Proponer caption sin afirmar lugares con confianza insuficiente.

- Generar texto alternativo accesible por imagen.

- Indicar recortes o adaptaciones necesarias antes de publicar.

## 7.1 Puntuacion de portada

| **Criterio**                | **Peso**  |
|-----------------------------|-----------|
| Calidad tecnica             | 30%       |
| Composicion                 | 25%       |
| Representatividad del grupo | 20%       |
| Iluminacion                 | 15%       |
| Penalizacion por duplicado  | -10% max. |

# 8. Modelo de datos

| **Entidad**   | **Campos principales**                                                            | **Notas**                           |
|---------------|-----------------------------------------------------------------------------------|-------------------------------------|
| Batch         | id, name, status, progress, createdAt                                             | Unidad de carga y procesamiento.    |
| Asset         | id, batchId, originalPath, mime, size, width, height, hash                        | Original inmutable.                 |
| AssetAnalysis | assetId, exif, vision, embeddingRef, quality                                      | Versionado por modelo/prompt.       |
| Group         | id, batchId, label, place, confidence, status                                     | Agrupacion editable.                |
| GroupAsset    | groupId, assetId, order, selected                                                 | Relacion y orden manual.            |
| PostProposal  | id, groupId, caption, status, coverAssetId                                        | Borrador editable.                  |
| ProposalAsset | proposalId, assetId, order, transform                                             | Carrusel y derivados.               |
| Job           | id, type, status, attempts, error, payload                                        | Trabajo asincrono persistente.      |
| Publication   | id, proposalId, zernioPostId, mode, scheduledForUtc, timezone, status, url, error | Programacion y seguimiento externo. |

## 8.1 Estados

> Batch: UPLOADING -\> QUEUED -\> ANALYZING -\> READY \| FAILED  
> Asset: UPLOADED -\> VALIDATED -\> ANALYZED -\> GROUPED \| REJECTED  
> Proposal: DRAFT -\> READY -\> EDITED -\> APPROVED -\> SCHEDULED -\> PUBLISHING -\> PUBLISHED \| FAILED \| CANCELLED  
> Job: PENDING -\> RUNNING -\> SUCCEEDED \| FAILED \| RETRYING

# 9. API HTTP

| **Metodo** | **Ruta**                       | **Funcion**                               |
|------------|--------------------------------|-------------------------------------------|
| POST       | /api/batches                   | Crear lote y cargar archivos multipart.   |
| GET        | /api/batches/:id               | Estado, progreso y errores.               |
| POST       | /api/batches/:id/analyze       | Reintentar o iniciar analisis.            |
| DELETE     | /api/batches/:id               | Eliminar lote, metadatos y archivos.      |
| GET        | /api/batches/:id/groups        | Listar grupos y propuestas.               |
| PATCH      | /api/groups/:id                | Renombrar o ajustar grupo.                |
| POST       | /api/groups/:id/proposals      | Regenerar propuestas.                     |
| PATCH      | /api/proposals/:id             | Caption, portada, orden y seleccion.      |
| POST       | /api/proposals/:id/publish     | Publicar ahora o programar mediante mode. |
| PATCH      | /api/publications/:id/schedule | Reprogramar fecha y zona horaria.         |
| DELETE     | /api/publications/:id/schedule | Cancelar una publicacion programada.      |
| GET        | /api/publications/:id          | Consultar estado y URL.                   |

## 9.1 Reglas de API

- Todas las respuestas de error incluyen code, message, details y correlationId.

- Publicar exige proposalId, revision esperada e idempotencyKey.

- Programar exige scheduledFor local, timezone IANA y una fecha futura; el backend conserva tambien UTC.

- PATCH de propuesta usa control optimista para no sobrescribir ediciones concurrentes.

- La carga valida MIME real; la extension del archivo no se considera suficiente.

- Los endpoints de estado nunca exponen API keys, URLs firmadas de subida ni trazas internas.

# 10. Procesamiento asincrono

El MVP ejecutara un worker separado y una tabla Job persistente. La API crea trabajos y devuelve 202 Accepted. El worker reclama trabajos con bloqueo, actualiza progreso y aplica reintentos limitados. Si el volumen crece, la interfaz Job podra migrar a BullMQ/Redis sin cambiar los casos de uso.

| **Trabajo**        | **Reintentos** | **Politica**                                                    |
|--------------------|----------------|-----------------------------------------------------------------|
| ANALYZE_ASSET      | 2              | Reintentar timeouts y 5xx; no reintentar archivo invalido.      |
| CLUSTER_BATCH      | 1              | Idempotente; recalcula todo el lote.                            |
| GENERATE_PROPOSALS | 2              | Validar JSON; segundo intento con prompt de reparacion.         |
| SUBMIT_PUBLICATION | 2              | Crear publicacion inmediata o programada con clave idempotente. |
| SYNC_PUBLICATION   | Hasta terminal | Backoff hasta published o failed.                               |

## 10.1 Programacion y ejecucion automatica

Zernio sera el scheduler principal del MVP. Al confirmar Programar, la API prepara los medios y crea el post con scheduledFor y timezone. Zernio conserva el estado scheduled y lo publica automaticamente en el momento indicado. La aplicacion guarda el zernioPostId, la fecha UTC y la zona IANA para mostrar, reprogramar o cancelar el contenido.

- No se necesita mantener un cron propio despierto para disparar cada post.

- Los webhooks actualizan scheduled, publishing, published, failed o partial; una reconciliacion periodica cubre eventos perdidos.

- Editar caption o medios despues de programar exige actualizar el post remoto o cancelar y crear una nueva revision de forma idempotente.

- La hora se captura en la zona elegida por el usuario, se persiste tambien en UTC y se valida contra cambios de horario de verano.

- El dashboard distingue claramente borradores, programados, publicando, publicados, fallidos y cancelados.

## 10.2 Implicaciones de despliegue

Delegar el reloj de publicacion a Zernio permite desplegar la API en un servicio que escale a cero. El worker de analisis sigue siendo asincrono y puede ejecutarse como proceso separado o trabajo bajo demanda. Para produccion se requiere una URL HTTPS publica para webhooks y una tarea de reconciliacion cada 10-15 minutos; esta tarea comprueba publicaciones no terminales y repara estados sin volver a publicar.

# 11. Publicacion con Zernio

1.  Validar que la propuesta este aprobada y no haya cambiado desde la confirmacion.

2.  Crear derivados compatibles. Para carruseles, todas las imagenes comparten la relacion de aspecto de la primera.

3.  Solicitar URLs firmadas de Zernio y cargar cada derivado.

4.  Crear el post con mediaItems, caption y accountId; usar publishNow=true o scheduledFor + timezone.

5.  Guardar zernioPostId y pasar la publicacion a PUBLISHING o SCHEDULED.

6.  Consumir webhooks y reconciliar el estado hasta PUBLISHED, FAILED, PARTIAL o CANCELLED.

7.  Mostrar URL final o error categorizado y accion recomendada.

## 11.1 Transformaciones

- Preservar siempre el original.

- Corregir orientacion EXIF antes de calcular dimensiones finales.

- Producir JPEG de calidad configurable y tamano final inferior a 8 MB.

- Aplicar crop o padding con previsualizacion; nunca recortar silenciosamente caras o sujetos principales.

- Guardar receta de transformacion para reproducibilidad.

# 12. Dashboard

| **Pantalla**  | **Elementos**                                                        |
|---------------|----------------------------------------------------------------------|
| Lotes         | Nueva carga, lotes recientes, progreso, errores y eliminacion.       |
| Revision      | Grupos, miniaturas, confianza, etiquetas y movimiento manual.        |
| Propuesta     | Carrusel, portada, orden, caption editable, contador y preview.      |
| Confirmacion  | Cuenta, contenido, transformaciones, ahora/programar, fecha y zona.  |
| Publicaciones | Calendario/lista, estado, hora local, URL, error, editar o cancelar. |

## 12.1 Comportamiento de botones

- Guardar caption: persiste una nueva revision y confirma visualmente el guardado.

- Regenerar caption: solicita confirmacion si existen cambios manuales no guardados.

- Publicar ahora: abre modal de confirmacion; no debe iniciar publicacion desde un clic accidental.

- Programar: valida fecha futura y zona horaria, muestra el equivalente local y confirma antes de enviar.

- Reprogramar/Cancelar: solo aparecen mientras Zernio mantenga el post en estado scheduled.

- Reintentar: solo aparece para errores recuperables y conserva el historial del intento anterior.

- Eliminar lote: explica que se borraran originales locales, derivados y analisis.

# 13. Seguridad y privacidad

- API keys y secretos solo en variables de entorno del backend/worker.

- Validar magic bytes, limitar tamano, renombrar archivos y bloquear traversal de rutas.

- No servir originales mediante rutas publicas permanentes.

- Documentar que las imagenes pueden enviarse al proveedor de vision seleccionado.

- No realizar identificacion facial. La deteccion generica de personas solo se usa para evitar recortes inadecuados.

- Permitir eliminacion completa por lote y definir una retencion por defecto configurable.

- En despliegue remoto, exigir autenticacion y HTTPS; el MVP local puede operar en localhost sin login.

# 14. Errores y observabilidad

| **Categoria** | **Ejemplo**                         | **Respuesta del sistema**                                 |
|---------------|-------------------------------------|-----------------------------------------------------------|
| Entrada       | Formato o archivo corrupto          | Rechazo por archivo; el resto del lote continua.          |
| Proveedor IA  | Timeout, cuota o JSON invalido      | Retry acotado; error accionable; conservar progreso.      |
| Clasificacion | Baja confianza                      | Grupo Sin clasificar; permitir correccion manual.         |
| Zernio        | Aspect ratio invalido               | Bloquear antes de publicar y ofrecer transformacion.      |
| Instagram     | Token expirado o rechazo            | Marcar failed, categorizar y solicitar reconexion.        |
| Programacion  | Webhook perdido o desfase de estado | Reconciliar por zernioPostId sin duplicar el post.        |
| Sistema       | Worker reiniciado                   | Trabajo persistente recuperable sin duplicar publicacion. |

Cada operacion asincrona debe registrar correlationId, batchId, assetId/proposalId, jobId, duracion, proveedor, modelo, intento, estado y categoria de error. Nunca se registran API keys ni contenido binario.

# 15. Estrategia de pruebas

- Unitarias: validadores, scoring, pesos, transformaciones, estados y mapeo de errores.

- Contrato: respuestas del proveedor de vision y SDK de Zernio con fixtures anonimizados.

- Integracion: carga multipart, persistencia, worker, reintentos e idempotencia.

- Tiempo: zonas IANA, UTC, cambio de horario, fecha pasada, reprogramacion y cancelacion.

- Visuales: miniaturas, orden del carrusel, caption largo y estados de error.

- End-to-end: cargar lote, procesar, editar, programar a corto plazo y obtener la URL final sin intervencion manual.

# 16. Criterios de aceptacion

| **ID** | **Criterio**                                                                               |
|--------|--------------------------------------------------------------------------------------------|
| AC-01  | Se pueden cargar 1-50 JPEG/PNG y los invalidos se identifican individualmente.             |
| AC-02  | El procesamiento continua en segundo plano y el progreso sobrevive a una recarga.          |
| AC-03  | El lote termina con grupos revisables y una explicacion minima por grupo.                  |
| AC-04  | Cada propuesta contiene 1-10 imagenes, portada, orden y caption editable.                  |
| AC-05  | Los cambios manuales no se pierden al recargar ni al regenerar otra propuesta.             |
| AC-06  | No se publica nada sin confirmacion final explicita.                                       |
| AC-07  | Una publicacion exitosa muestra la URL de Instagram.                                       |
| AC-08  | Una publicacion fallida muestra una causa accionable sin exponer secretos.                 |
| AC-09  | Eliminar un lote elimina sus archivos y registros dependientes.                            |
| AC-10  | El flujo completo funciona en Docker Compose para desarrollo local.                        |
| AC-11  | Una propuesta puede publicarse ahora o programarse con fecha, hora y zona IANA.            |
| AC-12  | Una publicacion programada puede reprogramarse o cancelarse antes de entrar en publishing. |
| AC-13  | El estado local converge con Zernio mediante webhook y reconciliacion sin duplicados.      |

# 17. Roadmap de implementacion

| **Fase**          | **Entregable**                                         | **Salida verificable**      |
|-------------------|--------------------------------------------------------|-----------------------------|
| 1\. Base          | Monorepo, DB, storage, carga y miniaturas              | Lote persistido y visible   |
| 2\. Analisis      | EXIF, calidad, vision y embeddings                     | JSON por activo             |
| 3\. Agrupacion    | Clustering y correccion manual                         | Grupos revisables           |
| 4\. Propuestas    | Seleccion, orden, captions y editor                    | Borrador aprobable          |
| 5\. Programacion  | Zernio scheduledFor/timezone, calendario y cancelacion | Post automatico verificable |
| 6\. Publicacion   | Webhooks, reconciliacion, estado y errores             | Post con URL final          |
| 7\. Integraciones | Google Photos Picker/Takeout y storage cloud           | Ingesta externa             |

# 18. Decisiones pendientes

- Proveedor inicial de vision y politica de costes por lote.

- Proveedor de embeddings: local o API administrada.

- Geocodificador para coordenadas GPS y limites de uso.

- Retencion de originales y derivados despues de publicar.

- Destino de despliegue: local, VPS, Azure Container Apps u otro.

- Frecuencia y plataforma de la reconciliacion programada en produccion.

- Necesidad de autenticacion desde la primera version desplegada.

# 19. Fuentes tecnicas

- **Zernio - Instagram:** https://docs.zernio.com/platforms/instagram

- **Zernio - Quickstart:** https://docs.zernio.com/

- **Google Photos API updates:** https://developers.google.com/photos/support/updates

- **Google Photos Picker:** https://developers.google.com/photos/picker/guides/media-items
