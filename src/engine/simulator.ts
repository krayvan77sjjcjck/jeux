export type SimulationMode = 'fair' | 'biased_pattern';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates a realistic provably-fair Crash round (99% RTP, 1% house edge).
 * M = max(1.00, floor(99 / (1 - U)) / 100) capped at 250x for clean display.
 */
export function generateCrashMultiplier(
  rng: () => number = Math.random,
  mode: SimulationMode = 'fair',
  previousValue?: number
): number {
  if (mode === 'biased_pattern' && previousValue !== undefined) {
    // Educational non-independent stream: after a very low crash (< 1.4x), boost next round slightly
    if (previousValue < 1.4) {
      const u = rng();
      const boosted = 1.65 + u * 2.1;
      return Math.round(boosted * 100) / 100;
    }
  }

  const u = Math.min(0.9995, Math.max(0.0001, rng()));
  // Instant crash ~1% of the time at 1.00x
  if (u < 0.01) {
    return 1.0;
  }
  const raw = 0.99 / (1 - u);
  const clamped = Math.min(250.0, Math.max(1.0, raw));
  return Math.round(clamped * 100) / 100;
}

export function generateSeedDataset(count = 160, seed = 42026): number[] {
  const rng = mulberry32(seed);
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    values.push(generateCrashMultiplier(rng, 'fair'));
  }
  return values;
}
