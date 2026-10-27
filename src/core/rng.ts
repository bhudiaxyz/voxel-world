/**
 * Deterministic randomness. Everything in the world is generated from a seed
 * so the diorama is identical on every reload — you can art-direct it.
 */

const _ON = 'bdgklmnrstvz', _CO = 'lnrsk', _V = 'aeiou';
function _pick(pool: string) { return pool[Math.floor(Math.random() * pool.length)]; }
function _word() {
  const n = Math.random() < 0.15 ? 1 : Math.random() < 0.6 ? 2 : 3;
  let w = '';
  for (let i = 0; i < n; i++) {
    w += _pick(_ON) + _pick(_V);
    if (i === n - 1 && Math.random() < 0.45) w += _pick(_CO);
  }
  return w;
}
/** Generate a random pronounceable seed word (e.g. "ZibaKorel"). */
export function genSeedWord(): string {
  const n = Math.random() > 0.8 ? 1 : Math.random() > 0.4 ? 2 : 3;
  return Array.from({ length: n }, () => { const w = _word(); return w[0].toUpperCase() + w.slice(1); }).join('');
}
/** Stable string → number hash for use as a numeric seed. */
export function hashSeedWord(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 100000;
}

/** mulberry32 — small, fast, good enough distribution. */
export function makeRng(seed = 1337) {
  let a = seed >>> 0;
  const fn = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  fn.range = (lo: any, hi: any) => lo + fn() * (hi - lo);
  fn.int = (lo: any, hi: any) => Math.floor(lo + fn() * (hi - lo + 1));
  fn.pick = (arr: any) => arr[Math.floor(fn() * arr.length) % arr.length];
  fn.chance = (p: any) => fn() < p;
  /** gaussian-ish, centred on 0, range roughly [-1,1] */
  fn.bell = () => (fn() + fn() + fn()) / 1.5 - 1;
  return fn;
}

/** Stable hash for a lattice point — used by the noise below and by shaders. */
function hash2(x: any, y: any, seed: any) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hash3(x: any, y: any, z: any, seed: any) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x1b873593) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export { hash2, hash3 };

const fade = (t: any) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: any, b: any, t: any) => a + (b - a) * t;

/** Value noise in [-1,1]. Smooth enough for terrain; cheap. */
export function makeNoise2D(seed = 1) {
  return (x: any, y: any) => {
    const xi = Math.floor(x),
      yi = Math.floor(y);
    const xf = x - xi,
      yf = y - yi;
    const u = fade(xf),
      v = fade(yf);
    const a = hash2(xi, yi, seed);
    const b = hash2(xi + 1, yi, seed);
    const cc = hash2(xi, yi + 1, seed);
    const d = hash2(xi + 1, yi + 1, seed);
    return lerp(lerp(a, b, u), lerp(cc, d, u), v) * 2 - 1;
  };
}

export function makeNoise3D(seed = 1) {
  return (x: any, y: any, z: any) => {
    const xi = Math.floor(x),
      yi = Math.floor(y),
      zi = Math.floor(z);
    const xf = x - xi,
      yf = y - yi,
      zf = z - zi;
    const u = fade(xf),
      v = fade(yf),
      w = fade(zf);
    const c000 = hash3(xi, yi, zi, seed),
      c100 = hash3(xi + 1, yi, zi, seed);
    const c010 = hash3(xi, yi + 1, zi, seed),
      c110 = hash3(xi + 1, yi + 1, zi, seed);
    const c001 = hash3(xi, yi, zi + 1, seed),
      c101 = hash3(xi + 1, yi, zi + 1, seed);
    const c011 = hash3(xi, yi + 1, zi + 1, seed),
      c111 = hash3(xi + 1, yi + 1, zi + 1, seed);
    const x00 = lerp(c000, c100, u),
      x10 = lerp(c010, c110, u);
    const x01 = lerp(c001, c101, u),
      x11 = lerp(c011, c111, u);
    return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 2 - 1;
  };
}

/** Fractal brownian motion over any 2D noise source. */
export function fbm2(noise: any, x: any, y: any, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let amp = 1,
    freq = 1,
    sum = 0,
    norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged fbm — good for rocky spines and river banks. */
export function ridge2(noise: any, x: any, y: any, octaves = 4) {
  let amp = 1,
    freq = 1,
    sum = 0,
    norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise(x * freq, y * freq));
    sum += n * n * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return sum / norm;
}

export const clamp = (v: any, lo: any, hi: any) => (v < lo ? lo : v > hi ? hi : v);
export const smoothstep = (e0: any, e1: any, x: any) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const mix = lerp;
