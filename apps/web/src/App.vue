<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

interface Features {
  width: number;
  height: number;
  capturedAt: string | null;
  coordinates: { latitude: number; longitude: number } | null;
  qualityScore: number;
  sharpness: number;
  exposure: number;
  embeddingProvider: string;
}

interface Asset {
  id: string;
  originalName: string;
  status: string;
  error: string | null;
  thumbnailUrl: string | null;
  features: Features | null;
}

interface Batch {
  id: string;
  name: string;
  status: string;
  progress: number;
  error: string | null;
  asset_count?: number;
  assets?: Asset[];
  created_at: string;
}

interface Group {
  id: string;
  label: string;
  confidence: number;
  reason: string;
  assets: Asset[];
}

const apiUrl = (import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:3001" : window.location.origin)).replace(/\/$/, "");
const batches = ref<Batch[]>([]);
const selectedBatch = ref<Batch | null>(null);
const groups = ref<Group[]>([]);
const selectedFiles = ref<File[]>([]);
const batchName = ref("");
const uploading = ref(false);
const dragActive = ref(false);
const message = ref("");
const fileInput = ref<HTMLInputElement | null>(null);
let pollTimer: number | undefined;

const processing = computed(() => selectedBatch.value && !["READY", "FAILED"].includes(selectedBatch.value.status));

onMounted(loadBatches);
onBeforeUnmount(stopPolling);

function chooseFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  selectedFiles.value = [...(input.files ?? [])];
}

function dropFiles(event: DragEvent) {
  dragActive.value = false;
  selectedFiles.value = [...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith("image/"));
}

async function upload() {
  if (!selectedFiles.value.length) return;
  uploading.value = true;
  message.value = "";
  const form = new FormData();
  if (batchName.value.trim()) form.append("name", batchName.value.trim());
  selectedFiles.value.forEach((file) => form.append("files", file));
  try {
    const response = await fetch(`${apiUrl}/api/batches`, { method: "POST", body: form });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "No se pudo crear el lote");
    selectedFiles.value = [];
    batchName.value = "";
    if (fileInput.value) fileInput.value.value = "";
    await loadBatches();
    await openBatch(result.id);
    if (result.rejected?.length) message.value = `${result.rejected.length} archivo(s) fueron rechazados.`;
  } catch (error) {
    message.value = error instanceof Error ? error.message : "Falló la carga";
  } finally {
    uploading.value = false;
  }
}

async function loadBatches() {
  const response = await fetch(`${apiUrl}/api/batches`);
  if (response.ok) batches.value = await response.json();
}

async function openBatch(id: string) {
  stopPolling();
  const response = await fetch(`${apiUrl}/api/batches/${id}`);
  if (!response.ok) return;
  selectedBatch.value = await response.json();
  if (selectedBatch.value?.status === "READY") await loadGroups(id);
  else if (selectedBatch.value?.status !== "FAILED") pollTimer = window.setInterval(() => refreshBatch(id), 1500);
}

async function refreshBatch(id: string) {
  const response = await fetch(`${apiUrl}/api/batches/${id}`);
  if (!response.ok) return;
  selectedBatch.value = await response.json();
  await loadBatches();
  if (selectedBatch.value?.status === "READY") {
    stopPolling();
    await loadGroups(id);
  } else if (selectedBatch.value?.status === "FAILED") stopPolling();
}

async function loadGroups(id: string) {
  const response = await fetch(`${apiUrl}/api/batches/${id}/groups`);
  if (response.ok) groups.value = await response.json();
}

async function saveLabel(group: Group) {
  const response = await fetch(`${apiUrl}/api/groups/${group.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: group.label }),
  });
  message.value = response.ok ? "Nombre del grupo guardado." : "No se pudo guardar el nombre.";
}

async function retry() {
  if (!selectedBatch.value) return;
  await fetch(`${apiUrl}/api/batches/${selectedBatch.value.id}/analyze`, { method: "POST" });
  await openBatch(selectedBatch.value.id);
}

async function deleteBatch(id: string) {
  if (!window.confirm("Se eliminarán las imágenes y todos sus análisis. ¿Continuar?")) return;
  const response = await fetch(`${apiUrl}/api/batches/${id}`, { method: "DELETE" });
  if (!response.ok) return;
  if (selectedBatch.value?.id === id) {
    selectedBatch.value = null;
    groups.value = [];
  }
  await loadBatches();
}

function stopPolling() {
  if (pollTimer) window.clearInterval(pollTimer);
  pollTimer = undefined;
}

function media(path: string | null) {
  return path ? `${apiUrl}${path}` : "";
}

function percent(value = 0) {
  return `${Math.round(value * 100)}%`;
}

function statusLabel(status: string) {
  return ({ UPLOADING: "Subiendo", QUEUED: "En cola", ANALYZING: "Analizando", READY: "Listo", FAILED: "Fallido" } as Record<string, string>)[status] || status;
}
</script>

<template>
  <header class="topbar">
    <a class="brand" href="#">ASM<span>°</span></a>
    <p>Curador editorial para tus fotografías</p>
    <span class="prototype">MVP · CRIBADO</span>
  </header>

  <main>
    <section class="hero">
      <div>
        <p class="eyebrow">ARCHIVO → HISTORIA</p>
        <h1>Encuentra los posts<br />escondidos en tus fotos.</h1>
        <p class="intro">Sube un lote. El sistema extrae contexto, mide calidad y reúne las imágenes que parecen pertenecer al mismo momento.</p>
      </div>
      <div class="hero-index">01</div>
    </section>

    <section class="workspace-grid">
      <div class="upload-card">
        <div class="section-heading">
          <span>Nuevo lote</span><span>{{ String(selectedFiles.length).padStart(2, '0') }} fotos</span>
        </div>
        <input v-model="batchName" class="name-input" placeholder="Nombre opcional: Italia, agosto 2026…" />
        <button
          class="drop-zone"
          :class="{ active: dragActive }"
          type="button"
          @click="fileInput?.click()"
          @dragover.prevent="dragActive = true"
          @dragleave.prevent="dragActive = false"
          @drop.prevent="dropFiles"
        >
          <span class="plus">＋</span>
          <strong>Arrastra tus fotografías</strong>
          <small>JPEG o PNG · máximo 50 · 25 MB por archivo</small>
        </button>
        <input ref="fileInput" class="hidden" type="file" accept="image/jpeg,image/png" multiple @change="chooseFiles" />
        <div v-if="selectedFiles.length" class="selection-row">
          <span>{{ selectedFiles.length }} archivos listos</span>
          <button class="primary" :disabled="uploading" @click="upload">{{ uploading ? 'Subiendo…' : 'Crear y analizar' }} →</button>
        </div>
        <p v-if="message" class="message">{{ message }}</p>
      </div>

      <aside class="batch-list">
        <div class="section-heading"><span>Lotes recientes</span><span>{{ batches.length }}</span></div>
        <button v-for="batch in batches" :key="batch.id" class="batch-row" :class="{ selected: selectedBatch?.id === batch.id }" @click="openBatch(batch.id)">
          <span><strong>{{ batch.name }}</strong><small>{{ batch.asset_count }} fotografías</small></span>
          <span class="status" :class="batch.status.toLowerCase()">{{ statusLabel(batch.status) }}</span>
          <span class="remove" title="Eliminar" @click.stop="deleteBatch(batch.id)">×</span>
        </button>
        <p v-if="!batches.length" class="empty-small">Aún no hay lotes.</p>
      </aside>
    </section>

    <section v-if="selectedBatch" class="results">
      <div class="result-title">
        <div>
          <p class="eyebrow">RESULTADO DEL ANÁLISIS</p>
          <h2>{{ selectedBatch.name }}</h2>
        </div>
        <div class="progress-copy">
          <strong>{{ selectedBatch.progress }}%</strong>
          <span>{{ statusLabel(selectedBatch.status) }}</span>
        </div>
      </div>
      <div class="progress"><i :style="{ width: `${selectedBatch.progress}%` }"></i></div>

      <div v-if="processing" class="analysis-state">
        <span class="spinner"></span>
        <p><strong>Separando momentos y buscando tomas similares.</strong><br />Puedes recargar la página; el trabajo queda persistido.</p>
      </div>
      <div v-else-if="selectedBatch.status === 'FAILED'" class="analysis-state error-state">
        <p><strong>El análisis no pudo terminar.</strong><br />{{ selectedBatch.error }}</p>
        <button class="primary" @click="retry">Reintentar</button>
      </div>

      <div v-else class="groups-grid">
        <article v-for="(group, index) in groups" :key="group.id" class="group-card">
          <div class="group-number">{{ String(index + 1).padStart(2, '0') }}</div>
          <div class="group-copy">
            <input v-model="group.label" class="group-label" @change="saveLabel(group)" />
            <p>{{ group.reason }} · confianza {{ percent(group.confidence) }}</p>
          </div>
          <div class="photo-strip">
            <figure v-for="asset in group.assets" :key="asset.id">
              <img :src="media(asset.thumbnailUrl)" :alt="asset.originalName" />
              <figcaption>
                <span>{{ percent(asset.features?.qualityScore) }}</span>
                <span>{{ asset.features?.capturedAt ? new Date(asset.features.capturedAt).toLocaleDateString('es') : 'sin fecha' }}</span>
              </figcaption>
            </figure>
          </div>
        </article>
        <p v-if="!groups.length" class="empty-small">No se generaron grupos.</p>
      </div>
    </section>
  </main>
</template>
