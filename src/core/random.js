// Deterministic randomness: the city must look the same on every reload, so every
// "random" choice comes from one seeded stream. mulberry32 is tiny and good enough
// for placement jitter, colour picks and window patterns.

export function makeRandom(seed = 1337) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    /** float in [lo, hi) */
    range: (lo, hi) => lo + next() * (hi - lo),
    /** integer in [lo, hi] inclusive */
    int: (lo, hi) => Math.floor(lo + next() * (hi - lo + 1)),
    pick: arr => arr[Math.floor(next() * arr.length)],
    chance: p => next() < p,
    /** approx normal, mean 0 sd 1 */
    gauss: () => {
      let u = 0, v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    /** true with probability p, weighted toward the low end by `bias` (>1 = smaller) */
    biased: (lo, hi, bias = 2) => lo + Math.pow(next(), bias) * (hi - lo)
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** frame-rate independent exponential approach */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const mod = (v, n) => ((v % n) + n) % n;
export const TAU = Math.PI * 2;