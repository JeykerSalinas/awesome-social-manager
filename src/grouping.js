// CLIP embeddings are normalized. Cosine similarity also accepts raw vectors.
export function cosine(a, b) {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

// Complete-link merging prevents one bridging image from joining unrelated groups.
export function groupPhotos(photos, threshold = 0.75) {
  const groups = photos.map(photo => [photo]);
  const similarities = new Map();
  const score = (a, b) => {
    const key = [a.id, b.id].sort().join(':');
    if (!similarities.has(key)) similarities.set(key, cosine(a.embedding, b.embedding));
    return similarities.get(key);
  };
  while (groups.length > 1) {
    let best = -Infinity, pair = null;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      let minimum = 1;
      for (const a of groups[i]) for (const b of groups[j]) minimum = Math.min(minimum, score(a, b));
      if (minimum >= threshold && minimum > best) { best = minimum; pair = [i, j]; }
    }
    if (!pair) break;
    groups[pair[0]].push(...groups[pair[1]]);
    groups.splice(pair[1], 1);
  }
  return groups.sort((a, b) => b.length - a.length);
}
