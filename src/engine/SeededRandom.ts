/**
 * Mulberry32 seeded PRNG.
 * Produces deterministic pseudo-random numbers from a 32-bit integer seed.
 * Used for reproducible bursty traffic generation.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns an integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Returns an exponentially distributed value with the given mean. */
  nextExponential(mean: number): number {
    // Inverse transform sampling: -mean * ln(1 - U)
    let u = this.next();
    while (u === 0) u = this.next(); // avoid log(0)
    return -mean * Math.log(u);
  }
}
