import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WILSON_RANKING_VERSION, wilsonScore } from '../src/ranking.js';

interface RankingVector {
  schema_version: number;
  z: number;
  cases: { up: number; down: number; score: number }[];
}

const vectorPath = fileURLToPath(
  new URL('../vectors/ranking-v1.json', import.meta.url),
);

describe('Wilson ranking v1', () => {
  it('matches the language-independent score vectors', async () => {
    const vectors = JSON.parse(
      await readFile(vectorPath, 'utf8'),
    ) as RankingVector;

    expect(vectors.schema_version).toBe(WILSON_RANKING_VERSION);
    for (const vector of vectors.cases) {
      expect(wilsonScore(vector.up, vector.down, vectors.z)).toBeCloseTo(
        vector.score,
        12,
      );
    }
  });

  it('rejects non-integer and negative vote totals', () => {
    expect(() => wilsonScore(-1, 0)).toThrow();
    expect(() => wilsonScore(1.5, 0)).toThrow();
  });
});
