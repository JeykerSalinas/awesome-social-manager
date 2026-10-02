import { cosineSimilarity, hammingDistance } from "./math.js";
import type { ClusterInput } from "./types.js";

export interface DuplicateDecision {
  assetId: string;
  selected: boolean;
  duplicateOfAssetId: string | null;
  duplicateReason: string | null;
}

interface DuplicateCandidate {
  left: ClusterInput;
  right: ClusterInput;
  reason: string;
}

export function deduplicateAssets(inputs: ClusterInput[]): DuplicateDecision[] {
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

  for (const candidate of findDuplicateCandidates(inputs)) {
    union(inputs.indexOf(candidate.left), inputs.indexOf(candidate.right));
  }

  const sets = new Map<number, ClusterInput[]>();
  inputs.forEach((input, index) => {
    const root = find(index);
    sets.set(root, [...(sets.get(root) ?? []), input]);
  });

  const decisions = new Map<string, DuplicateDecision>();
  for (const items of sets.values()) {
    const keep = [...items].sort(compareKeepCandidate)[0]!;
    for (const item of items) {
      const selected = item.assetId === keep.assetId;
      decisions.set(item.assetId, {
        assetId: item.assetId,
        selected,
        duplicateOfAssetId: selected ? null : keep.assetId,
        duplicateReason: selected ? null : duplicateReason(item, keep),
      });
    }
  }

  return inputs.map((input) => decisions.get(input.assetId)!);
}

function findDuplicateCandidates(inputs: ClusterInput[]): DuplicateCandidate[] {
  const candidates: DuplicateCandidate[] = [];
  for (let left = 0; left < inputs.length; left += 1) {
    for (let right = left + 1; right < inputs.length; right += 1) {
      const candidate = duplicateCandidate(inputs[left]!, inputs[right]!);
      if (candidate) candidates.push(candidate);
    }
  }
  return candidates;
}

function duplicateCandidate(left: ClusterInput, right: ClusterInput): DuplicateCandidate | null {
  const hashDistance = hammingDistance(left.features.perceptualHash, right.features.perceptualHash);
  const visual = cosineSimilarity(left.features.embedding, right.features.embedding);
  const seconds = timeDifferenceSeconds(left.features.capturedAt, right.features.capturedAt);

  if (hashDistance <= 4) return { left, right, reason: "hash perceptual casi identico" };
  if (hashDistance <= 8 && seconds !== null && seconds <= 120) {
    return { left, right, reason: "misma rafaga y hash perceptual cercano" };
  }
  if (visual >= 0.985 && seconds !== null && seconds <= 90) {
    return { left, right, reason: "misma rafaga y embedding visual casi identico" };
  }
  return null;
}

function compareKeepCandidate(left: ClusterInput, right: ClusterInput): number {
  return score(right) - score(left);
}

function score(input: ClusterInput): number {
  const resolution = Math.min(1, (input.features.width * input.features.height) / 12_000_000);
  return input.features.qualityScore * 0.55 +
    input.features.sharpness * 0.25 +
    input.features.exposure * 0.12 +
    resolution * 0.08;
}

function duplicateReason(item: ClusterInput, keep: ClusterInput): string {
  const hashDistance = hammingDistance(item.features.perceptualHash, keep.features.perceptualHash);
  const seconds = timeDifferenceSeconds(item.features.capturedAt, keep.features.capturedAt);
  const timeCopy = seconds === null ? "sin fecha comparable" : `tomada a ${Math.round(seconds)}s de la conservada`;
  return `Similar a la foto conservada; distancia hash ${hashDistance}, ${timeCopy}`;
}

function timeDifferenceSeconds(left: string | null, right: string | null): number | null {
  if (!left || !right) return null;
  return Math.abs(new Date(left).getTime() - new Date(right).getTime()) / 1000;
}
