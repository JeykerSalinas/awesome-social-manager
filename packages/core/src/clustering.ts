import { cosineSimilarity, hammingDistance, haversineKm } from "./math.js";
import type { ClusterInput, ClusterResult } from "./types.js";

export function clusterAssets(inputs: ClusterInput[], threshold = 0.67): ClusterResult[] {
  const parents = inputs.map((_, index) => index);
  const find = (value: number): number => {
    let current = value;
    while (parents[current] !== current) {
      parents[current] = parents[parents[current]!]!;
      current = parents[current]!;
    }
    return current;
  };
  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parents[rootB] = rootA;
  };
  for (let left = 0; left < inputs.length; left += 1) {
    for (let right = left + 1; right < inputs.length; right += 1) {
      if (pairScore(inputs[left]!, inputs[right]!) >= threshold) union(left, right);
    }
  }
  const components = new Map<number, ClusterInput[]>();
  inputs.forEach((input, index) => {
    const root = find(index);
    components.set(root, [...(components.get(root) ?? []), input]);
  });
  return [...components.values()].map(toCluster).sort((a, b) => b.assetIds.length - a.assetIds.length);
}

export function pairScore(left: ClusterInput, right: ClusterInput): number {
  const visual = Math.max(0, cosineSimilarity(left.features.embedding, right.features.embedding));
  const duplicateBonus = hammingDistance(left.features.perceptualHash, right.features.perceptualHash) <= 6 ? 0.18 : 0;
  const hours = timeDifferenceHours(left.features.capturedAt, right.features.capturedAt);
  const time = hours === null ? 0.35 : Math.exp(-hours / 10);
  const leftCoordinates = left.features.coordinates;
  const rightCoordinates = right.features.coordinates;
  if (leftCoordinates && rightCoordinates) {
    const geography = Math.exp(-haversineKm(leftCoordinates, rightCoordinates) / 15);
    return Math.min(1, geography * 0.4 + time * 0.25 + visual * 0.35 + duplicateBonus);
  }
  return Math.min(1, time * 0.42 + visual * 0.58 + duplicateBonus);
}

function toCluster(items: ClusterInput[]): ClusterResult {
  const capturedDates = items.map((item) => item.features.capturedAt)
    .filter((value): value is string => Boolean(value)).sort();
  const coordinates = items.map((item) => item.features.coordinates)
    .find((value): value is NonNullable<typeof value> => Boolean(value));
  const label = coordinates
    ? `Evento cerca de ${coordinates.latitude.toFixed(3)}, ${coordinates.longitude.toFixed(3)}`
    : capturedDates[0]
      ? `Evento del ${new Intl.DateTimeFormat("es", { dateStyle: "medium" }).format(new Date(capturedDates[0]))}`
      : "Grupo visual";
  const pairScores: number[] = [];
  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) {
      pairScores.push(pairScore(items[left]!, items[right]!));
    }
  }
  const confidence = pairScores.length
    ? pairScores.reduce((total, score) => total + score, 0) / pairScores.length
    : 0.5;
  return {
    assetIds: items.map((item) => item.assetId),
    confidence: Number(confidence.toFixed(3)), label,
    reason: coordinates ? "Coincidencia geográfica, temporal y visual"
      : capturedDates.length ? "Proximidad temporal y similitud visual"
        : "Similitud visual; no se encontraron metadatos de fecha o GPS",
  };
}

function timeDifferenceHours(left: string | null, right: string | null): number | null {
  if (!left || !right) return null;
  return Math.abs(new Date(left).getTime() - new Date(right).getTime()) / 3_600_000;
}
