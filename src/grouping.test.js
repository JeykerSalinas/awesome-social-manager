import test from 'node:test';
import assert from 'node:assert/strict';
import { cosine, groupPhotos } from './grouping.js';
const photo = (id, degrees) => ({ id, embedding: [Math.cos(degrees * Math.PI / 180), Math.sin(degrees * Math.PI / 180)] });
test('separates unrelated topics and retains every photo', () => {
  const result = groupPhotos([photo('a', 0), photo('b', 5), photo('c', 90)], .8);
  assert.deepEqual(result.map(g => g.map(p => p.id)), [['a', 'b'], ['c']]);
});
test('a bridge cannot chain unrelated endpoints into one group', () => {
  const result = groupPhotos([photo('a', 0), photo('b', 30), photo('c', 60)], .8);
  assert.equal(result.length, 2);
  assert.ok(result.every(g => !(g.some(p => p.id === 'a') && g.some(p => p.id === 'c'))));
});
test('threshold controls grouping and handles empty/single inputs', () => {
  assert.equal(groupPhotos([photo('a', 0), photo('b', 30)], .9).length, 2);
  assert.equal(groupPhotos([photo('a', 0), photo('b', 30)], .8).length, 1);
  assert.deepEqual(groupPhotos([]), []);
  assert.equal(groupPhotos([photo('a', 0)]).length, 1);
  assert.equal(cosine([0, 0], [1, 0]), 0);
});
