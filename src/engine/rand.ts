/** Sequential generator (mulberry32) for building scenarios. */
export function sequence(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Order-independent draw in [0, 1): the same (seed, stream, a, b) always gives the same
 * number, whatever the scheduler did before. This keeps comparisons between schedulers fair.
 */
export function draw(seed: number, stream: number, a: number, b: number): number {
  let h = (seed ^ 0x9e3779b9) | 0;
  for (const v of [stream, a, b]) {
    h = Math.imul(h ^ (v | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}
