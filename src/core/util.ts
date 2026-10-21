// Small shared helpers: hashing, colors, clamping.

export const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (e0: number, e1: number, v: number) => {
  const t = clamp((v - e0) / (e1 - e0 || 1e-9));
  return t * t * (3 - 2 * t);
};
/** Positive modulo (wraps negatives), for tiling. */
export const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Integer hash of (x, y, seed) -> [0, 1). Deterministic and well mixed. */
export function hash(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2147483587);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** "#rgb" / "#rrggbb" -> [r, g, b] in 0..1 (sRGB, as authored). */
export function parseHex(s: string): [number, number, number] | undefined {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim());
  if (!m) return undefined;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

export const toHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.round(clamp(v) * 255).toString(16).padStart(2, "0")).join("");

/** A seeded random stream, for things that need many values (placements). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
}
