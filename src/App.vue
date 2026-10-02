<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { groupPhotos } from './grouping.js';
const photos = ref([]), busy = ref(false), message = ref(''), threshold = ref(0.75);
const analyzed = computed(() => photos.value.filter(p => p.embedding));
const groups = computed(() => groupPhotos(analyzed.value, Number(threshold.value)));
let worker;
function select(event) {
  for (const p of photos.value) URL.revokeObjectURL(p.url);
  const files = [...event.target.files];
  const valid = files.filter(f => ['image/jpeg', 'image/png', 'image/webp'].includes(f.type));
  photos.value = valid.slice(0, 200).map(file => ({ id: crypto.randomUUID(), file, name: file.name, url: URL.createObjectURL(file), embedding: null, error: '' }));
  message.value = files.length !== photos.value.length ? 'Se aceptan hasta 200 fotografías JPEG, PNG o WebP.' : '';
}
function analyze() {
  const pending = photos.value.filter(p => !p.embedding);
  if (!pending.length || busy.value) return;
  busy.value = true;
  message.value = 'Preparando CLIP. La primera descarga puede tardar varios minutos…';
  worker ??= new Worker(new URL('./clip.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'embedding' || data.type === 'photo-error') {
      const photo = photos.value.find(p => p.id === data.id);
      if (photo) { photo.embedding = data.embedding || null; photo.error = data.message || ''; }
    }
    if (data.type === 'download') {
      const p = data.progress;
      if (p.status === 'progress') message.value = `Descargando modelo: ${p.file} · ${Math.round(p.progress || 0)}%`;
    }
    if (data.type === 'progress') message.value = `Analizando fotografías: ${data.done} / ${data.total}`;
    if (data.type === 'done') { busy.value = false; message.value = 'Análisis terminado. Ajusta la similitud para cambiar los grupos.'; }
    if (data.type === 'error') { busy.value = false; message.value = `No se pudo cargar CLIP: ${data.message}. Comprueba la conexión y vuelve a intentar.`; }
  };
  worker.onerror = () => { busy.value = false; message.value = 'El proceso de CLIP falló. Puedes volver a intentarlo.'; worker.terminate(); worker = null; };
  worker.postMessage({ photos: pending.map(p => ({ id: p.id, file: p.file })) });
}
onBeforeUnmount(() => { worker?.terminate(); photos.value.forEach(p => URL.revokeObjectURL(p.url)); });
</script>
<template>
  <main>
    <p class="eyebrow">ASM · CLIP LOCAL</p>
    <h1>Agrupa tus fotos<br>por lo que cuentan.</h1>
    <p class="intro">Selecciona fotografías y reúne contenido parecido. Todo el análisis ocurre en tu navegador, sin claves ni pagos por imagen.</p>
    <section class="controls">
      <label class="upload">Seleccionar fotografías<input type="file" multiple accept="image/jpeg,image/png,image/webp" :disabled="busy" @change="select"></label>
      <span>{{ photos.length }} fotografías</span>
      <button :disabled="busy || !photos.some(p => !p.embedding)" @click="analyze">{{ busy ? 'Analizando…' : 'Agrupar con CLIP' }}</button>
      <p role="status">{{ message }}</p>
      <small>La primera vez se descargan el modelo y su motor. Las fotos no se suben. Los resultados duran mientras mantengas esta página abierta.</small>
    </section>
    <section v-if="analyzed.length" class="settings">
      <label for="similarity">Similitud mínima: {{ Number(threshold).toFixed(2) }}</label>
      <input id="similarity" v-model="threshold" type="range" min="0.50" max="0.95" step="0.01" :disabled="busy">
      <div class="range-labels"><span>Grupos más amplios</span><span>Grupos más específicos</span></div>
      <p>{{ groups.length }} grupos · {{ analyzed.length }} fotos analizadas. La similitud no es una probabilidad ni una garantía de contexto.</p>
    </section>
    <section class="groups">
      <article v-for="(group, index) in groups" :key="group.map(p => p.id).join(',')">
        <h2>Grupo {{ index + 1 }} <span>{{ group.length }} fotos</span></h2>
        <div class="photos"><figure v-for="photo in group" :key="photo.id"><img :src="photo.url" :alt="photo.name" loading="lazy"><figcaption>{{ photo.name }}</figcaption></figure></div>
      </article>
    </section>
    <section v-if="photos.some(p => p.error)"><h2>Fotos que no se pudieron analizar</h2><p v-for="photo in photos.filter(p => p.error)" :key="photo.id">{{ photo.name }}: {{ photo.error }}</p></section>
    <div v-if="photos.length && !analyzed.length && !busy" class="photos preview"><figure v-for="photo in photos" :key="photo.id"><img :src="photo.url" :alt="photo.name" loading="lazy"></figure></div>
  </main>
</template>
