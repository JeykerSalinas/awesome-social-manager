import { AutoProcessor, CLIPVisionModelWithProjection, env, RawImage } from '@huggingface/transformers';
env.allowLocalModels = false;
let extractor;
self.onmessage = async ({ data }) => {
  try {
    extractor ??= await Promise.all([
      AutoProcessor.from_pretrained('Xenova/clip-vit-base-patch32'),
      CLIPVisionModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32', {
        dtype: 'q8', device: 'wasm',
        progress_callback: progress => self.postMessage({ type: 'download', progress }),
      }),
    ]);
    const [processor, model] = extractor;
    for (let i = 0; i < data.photos.length; i++) {
      const photo = data.photos[i];
      try {
        const image = await RawImage.fromBlob(photo.file);
        const inputs = await processor(image);
        const { image_embeds } = await model(inputs);
        const values = Array.from(image_embeds.data);
        const norm = Math.hypot(...values) || 1;
        self.postMessage({ type: 'embedding', id: photo.id, embedding: values.map(value => value / norm) });
      } catch (error) {
        self.postMessage({ type: 'photo-error', id: photo.id, message: String(error.message || error) });
      }
      self.postMessage({ type: 'progress', done: i + 1, total: data.photos.length });
    }
    self.postMessage({ type: 'done' });
  } catch (error) {
    extractor = null;
    self.postMessage({ type: 'error', message: String(error.message || error) });
  }
};
