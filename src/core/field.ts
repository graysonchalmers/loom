// Fields: scalar values over the unit tile (u, v in [0, 1), v down), evaluated lazily to an n×n
// buffer and memoized per resolution. Every generator is periodic over the tile and every spatial
// op wraps around its edges, so anything built from them tiles seamlessly by construction.
// Tex is the same thing for colors (sRGB as authored, 3 floats per pixel).
import { LoomError, wrap } from "./errors.ts";
import { clamp, lerp, mod, parseHex, smooth } from "./util.ts";

/** Set by the Project while a file runs: where in the art file a field is being created. */
let locate: () => string | undefined = () => undefined;
export function setLocator(fn: () => string | undefined): void { locate = fn; }

/** Named colors from pal(); color strings may be "#rrggbb" or a name. */
let palette = new Map<string, [number, number, number]>();
export function setPalette(p: Map<string, [number, number, number]>): void { palette = p; }
export function colorOf(s: string): [number, number, number] | undefined { return parseHex(s) ?? palette.get(s); }

type Make = (n: number) => Float32Array;

export class Field {
  readonly kind = "field";
  label: string;
  loc?: string;
  private readonly make: Make;
  private readonly memo = new Map<number, Float32Array>();

  constructor(make: Make, label: string, loc = locate()) {
    this.make = make;
    this.label = label;
    this.loc = loc;
  }

  eval(n: number): Float32Array {
    let b = this.memo.get(n);
    if (!b) {
      try { b = this.make(n); } catch (e) { throw wrap(e).within(this.label, this.loc); }
      this.memo.set(n, b);
    }
    return b;
  }

  /** Name this field so the viewer lists it (and errors mention it). */
  as(label: unknown): this {
    if (typeof label !== "string" || !label) throw new LoomError('as("name"): a name for the viewer', locate());
    this.label = label;
    named.push({ label, loc: locate() ?? this.loc, node: this });
    return this;
  }

  // ---------------------------------------------------------------- arithmetic
  add(b: unknown) { return map2(this, lift(b, "add"), (x, y) => x + y, "add"); }
  sub(b: unknown) { return map2(this, lift(b, "sub"), (x, y) => x - y, "sub"); }
  mul(b: unknown) { return map2(this, lift(b, "mul"), (x, y) => x * y, "mul"); }
  div(b: unknown) { return map2(this, lift(b, "div"), (x, y) => x / (Math.abs(y) < 1e-9 ? 1e-9 : y), "div"); }
  min(b: unknown) { return map2(this, lift(b, "min"), Math.min, "min"); }
  max(b: unknown) { return map2(this, lift(b, "max"), Math.max, "max"); }
  /** Blend toward `b` by `t` (0 = this, 1 = b); t may be a field (a mask). */
  mix(b: unknown, t: unknown = 0.5) { return map3(this, lift(b, "mix"), lift(t, "mix"), (x, y, k) => x + (y - x) * k, "mix"); }
  pow(k: unknown) { const e = num(k, "pow"); return map1(this, (x) => Math.sign(x) * Math.abs(x) ** e, `pow(${e})`); }
  abs() { return map1(this, Math.abs, "abs"); }
  invert() { return map1(this, (x) => 1 - x, "invert"); }
  clamp(lo: unknown = 0, hi: unknown = 1) { const a = num(lo, "clamp"), b = num(hi, "clamp"); return map1(this, (x) => clamp(x, a, b), "clamp"); }
  /** Remap [inLo, inHi] to [outLo, outHi], clamped. */
  levels(inLo: unknown = 0, inHi: unknown = 1, outLo: unknown = 0, outHi: unknown = 1) {
    const a = num(inLo, "levels"), b = num(inHi, "levels"), c = num(outLo, "levels"), d = num(outHi, "levels");
    return map1(this, (x) => lerp(c, d, clamp((x - a) / (b - a || 1e-9))), "levels");
  }
  /** Smoothstep from lo to hi. */
  smooth(lo: unknown = 0, hi: unknown = 1) { const a = num(lo, "smooth"), b = num(hi, "smooth"); return map1(this, (x) => smooth(a, b, x), "smooth"); }
  /** 0 below t, 1 above, with a soft band of width `soft`. */
  threshold(t: unknown = 0.5, soft: unknown = 0) {
    const a = num(t, "threshold"), s = Math.max(1e-6, num(soft, "threshold"));
    return map1(this, (x) => smooth(a - s / 2, a + s / 2, x), "threshold");
  }
  /** Stretch the actual min..max of this field to 0..1. */
  normalize() {
    return new Field((n) => {
      const a = this.eval(n);
      let lo = Infinity, hi = -Infinity;
      for (const x of a) { if (x < lo) lo = x; if (x > hi) hi = x; }
      const out = new Float32Array(a.length), k = hi - lo || 1;
      for (let i = 0; i < a.length; i++) out[i] = (a[i] - lo) / k;
      return out;
    }, "normalize");
  }

  // ---------------------------------------------------------------- space (all wrap around the tile)
  /** Gaussian-ish blur; r in tile units (0.01 = 1% of the tile). */
  blur(r: unknown = 0.01) { const k = num(r, "blur"); return new Field((n) => blurBuf(this.eval(n), n, Math.max(1, Math.round(k * n))), `blur(${k})`); }
  /** Domain warp: sample this field displaced by (fx - 0.5, fy - 0.5) * amount (tile units). */
  warp(by: unknown, amount: unknown = 0.05, by2?: unknown) {
    const fx = lift(by, "warp"), fy = by2 === undefined ? fx.offset(0.37, 0.61) : lift(by2, "warp"), amt = num(amount, "warp");
    return new Field((n) => {
      const src = this.eval(n), dx = fx.eval(n), dy = fy.eval(n), out = new Float32Array(n * n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const i = y * n + x;
        out[i] = sample(src, n, (x + 0.5) / n + (dx[i] - 0.5) * amt, (y + 0.5) / n + (dy[i] - 0.5) * amt);
      }
      return out;
    }, `warp(${amt})`);
  }
  /** Shift by (du, dv) tile units (wraps). */
  offset(du: unknown = 0, dv: unknown = 0) {
    const a = num(du, "offset"), b = num(dv, "offset");
    return new Field((n) => {
      const src = this.eval(n), out = new Float32Array(n * n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[y * n + x] = sample(src, n, (x + 0.5) / n - a, (y + 0.5) / n - b);
      return out;
    }, "offset");
  }
  /** Tile this field k×k times inside the tile (k must be whole to stay seamless). */
  repeat(k: unknown) {
    const r = whole(k, "repeat");
    return new Field((n) => {
      const src = this.eval(n), out = new Float32Array(n * n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[y * n + x] = sample(src, n, ((x + 0.5) / n) * r, ((y + 0.5) / n) * r);
      return out;
    }, `repeat(${r})`);
  }
  rotate(deg: unknown = 90) {
    const d = num(deg, "rotate");
    if (![90, 180, 270].includes(mod(d, 360))) throw new LoomError("rotate: 90, 180 or 270 (other angles would break the tiling)", locate());
    const q = mod(d, 360) / 90;
    return new Field((n) => {
      const src = this.eval(n), out = new Float32Array(n * n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const [sx, sy] = q === 1 ? [y, n - 1 - x] : q === 2 ? [n - 1 - x, n - 1 - y] : [n - 1 - y, x];
        out[y * n + x] = src[sy * n + sx];
      }
      return out;
    }, `rotate(${d})`);
  }
  flip(axis: unknown = "x") {
    if (axis !== "x" && axis !== "y") throw new LoomError('flip("x" | "y")', locate());
    return new Field((n) => {
      const src = this.eval(n), out = new Float32Array(n * n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[y * n + x] = axis === "x" ? src[y * n + (n - 1 - x)] : src[(n - 1 - y) * n + x];
      return out;
    }, `flip(${axis})`);
  }

  // ---------------------------------------------------------------- reading a height field
  /** Slope magnitude (how steep the surface is), 0..1. */
  edge(k: unknown = 8) {
    const s = num(k, "edge");
    return new Field((n) => {
      const h = this.eval(n), out = new Float32Array(n * n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const gx = (h[y * n + ((x + 1) % n)] - h[y * n + ((x + n - 1) % n)]) * n / 2;
        const gy = (h[((y + 1) % n) * n + x] - h[((y + n - 1) % n) * n + x]) * n / 2;
        out[y * n + x] = clamp(Math.hypot(gx, gy) / s);
      }
      return out;
    }, "edge");
  }
  /** Raised spots and ridges: how far this is above its surroundings within r (tile units). Edges for wear. */
  convex(r: unknown = 0.01, k: unknown = 12) {
    const rr = num(r, "convex"), kk = num(k, "convex"), bl = this.blur(rr);
    return map2(this, bl, (h, b) => clamp((h - b) * kk), "convex");
  }
  /** Hollows and creases: how far this is below its surroundings within r. Where grime collects. */
  cavity(r: unknown = 0.01, k: unknown = 12) {
    const rr = num(r, "cavity"), kk = num(k, "cavity"), bl = this.blur(rr);
    return map2(this, bl, (h, b) => clamp((b - h) * kk), "cavity");
  }
  /** Where the surface faces a direction ("up" = toward the top of the tile), 0..1. Moss on tops, dust on ledges. */
  facing(dir: unknown = "up", k: unknown = 6) {
    const dirs: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const d = typeof dir === "string" ? dirs[dir] : undefined;
    if (!d) throw new LoomError('facing("up" | "down" | "left" | "right")', locate());
    const s = num(k, "facing");
    return new Field((n) => {
      const h = this.eval(n), out = new Float32Array(n * n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        // the surface faces where the height falls away: minus the gradient
        const gx = (h[y * n + ((x + 1) % n)] - h[y * n + ((x + n - 1) % n)]) * n / 2;
        const gy = (h[((y + 1) % n) * n + x] - h[((y + n - 1) % n) * n + x]) * n / 2;
        out[y * n + x] = clamp((-gx * d[0] - gy * d[1]) / s);
      }
      return out;
    }, `facing(${dir})`);
  }
  /** Streaks running down from this mask (rain stains, rust runs), wrapping top to bottom. */
  drips(o: unknown = {}) {
    const opts = (o ?? {}) as Record<string, unknown>;
    const length = num(opts.length ?? 0.25, "drips length"), density = num(opts.density ?? 0.5, "drips density"), seed = num(opts.seed ?? 1, "drips seed");
    return new Field((n) => {
      const m = this.eval(n), out = new Float32Array(n * n);
      for (let x = 0; x < n; x++) {
        // each column gets its own streak length; some columns carry none
        const cell = Math.floor((x / n) * 64);
        const on = hashCol(cell, seed) < density ? 1 : 0.15;
        const decay = Math.exp(-1 / Math.max(1, length * n * (0.4 + 1.2 * hashCol(cell, seed + 7))));
        let acc = 0;
        for (let pass = 0; pass < 2; pass++)          // twice around, so streaks crossing the bottom edge continue at the top
          for (let y = 0; y < n; y++) {
            const i = y * n + x;
            acc = Math.max(m[i], acc * decay);
            if (pass === 1) out[i] = Math.max(m[i], acc * on);
          }
      }
      return out;
    }, "drips");
  }
}

/** Color over the tile: 3 floats (sRGB 0..1) per pixel. */
export class Tex {
  readonly kind = "tex";
  label: string;
  loc?: string;
  private readonly make: Make;
  private readonly memo = new Map<number, Float32Array>();

  constructor(make: Make, label: string, loc = locate()) {
    this.make = make;
    this.label = label;
    this.loc = loc;
  }

  eval(n: number): Float32Array {
    let b = this.memo.get(n);
    if (!b) {
      try { b = this.make(n); } catch (e) { throw wrap(e).within(this.label, this.loc); }
      this.memo.set(n, b);
    }
    return b;
  }

  as(label: unknown): this {
    if (typeof label !== "string" || !label) throw new LoomError('as("name"): a name for the viewer', locate());
    this.label = label;
    named.push({ label, loc: locate() ?? this.loc, node: this });
    return this;
  }

  /** Blend toward another color by t (a number or a mask field). */
  mix(b: unknown, t: unknown = 0.5) {
    const o = liftTex(b, "mix"), k = lift(t, "mix");
    return new Tex((n) => {
      const a = this.eval(n), c = o.eval(n), m = k.eval(n), out = new Float32Array(n * n * 3);
      for (let i = 0; i < n * n; i++) for (let j = 0; j < 3; j++) out[i * 3 + j] = a[i * 3 + j] + (c[i * 3 + j] - a[i * 3 + j]) * m[i];
      return out;
    }, "mix");
  }
  /** Multiply by a value or field (darken: shading, grime). */
  mul(f: unknown) {
    const k = lift(f, "mul");
    return new Tex((n) => {
      const a = this.eval(n), m = k.eval(n), out = new Float32Array(n * n * 3);
      for (let i = 0; i < n * n; i++) for (let j = 0; j < 3; j++) out[i * 3 + j] = a[i * 3 + j] * m[i];
      return out;
    }, "mul");
  }
  /** Shift hue (degrees), saturation and value (multipliers), each a number or a field. */
  hsv(o: unknown = {}) {
    const opts = (o ?? {}) as Record<string, unknown>;
    const H = lift(opts.h ?? 0, "hsv h"), S = lift(opts.s ?? 1, "hsv s"), V = lift(opts.v ?? 1, "hsv v");
    return new Tex((n) => {
      const a = this.eval(n), h = H.eval(n), s = S.eval(n), v = V.eval(n), out = new Float32Array(n * n * 3);
      for (let i = 0; i < n * n; i++) {
        const [hh, ss, vv] = rgb2hsv(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
        const c = hsv2rgb(mod(hh + h[i], 360), clamp(ss * s[i]), clamp(vv * v[i]));
        out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2];
      }
      return out;
    }, "hsv");
  }
  /** The color's brightness as a field (for deriving roughness or height from a painted texture). */
  luma() {
    return new Field((n) => {
      const a = this.eval(n), out = new Float32Array(n * n);
      for (let i = 0; i < n * n; i++) out[i] = 0.2126 * a[i * 3] + 0.7152 * a[i * 3 + 1] + 0.0722 * a[i * 3 + 2];
      return out;
    }, "luma");
  }
}

/** Every field/tex named with .as() in the current file, in order. */
export let named: { label: string; loc?: string; node: Field | Tex }[] = [];
export function resetNamed(): void { named = []; }

// ---------------------------------------------------------------- helpers

export const isField = (v: unknown): v is Field => v instanceof Field;
export const isTex = (v: unknown): v is Tex => v instanceof Tex;

export function constant(v: number): Field {
  return new Field((n) => new Float32Array(n * n).fill(v), String(v));
}

/** Numbers become constant fields; fields pass through. */
export function lift(v: unknown, what: string): Field {
  if (typeof v === "number" && Number.isFinite(v)) return constant(v);
  if (v instanceof Field) return v;
  if (v instanceof Tex) return v.luma();
  throw new LoomError(`${what}: expected a number or a field, got ${describe(v)}`, locate());
}

/** "#hex" and fields (as gray) become colors; colors pass through. */
export function liftTex(v: unknown, what: string): Tex {
  if (v instanceof Tex) return v;
  if (typeof v === "string") {
    const c = colorOf(v);
    if (!c) throw new LoomError(`${what}: '${v}' is not a color (use "#rrggbb" or a name from pal())`, locate());
    return new Tex((n) => { const out = new Float32Array(n * n * 3); for (let i = 0; i < n * n; i++) out.set(c, i * 3); return out; }, v);
  }
  if (v instanceof Field || typeof v === "number") {
    const f = lift(v, what);
    return new Tex((n) => { const a = f.eval(n), out = new Float32Array(n * n * 3); for (let i = 0; i < n * n; i++) out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = clamp(a[i]); return out; }, f.label);
  }
  throw new LoomError(`${what}: expected a color ("#rrggbb", a ramp or a texture), got ${describe(v)}`, locate());
}

export function num(v: unknown, what: string): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  throw new LoomError(`${what}: expected a number, got ${describe(v)}`, locate());
}

/** Whole numbers only: periods and repeats must be integers or the tile stops repeating. */
export function whole(v: unknown, what: string): number {
  const x = num(v, what);
  if (!Number.isInteger(x) || x < 1) throw new LoomError(`${what}: must be a whole number ≥ 1 (got ${x}), or the texture won't tile seamlessly`, locate());
  return x;
}

export function describe(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  if (typeof v === "object") return "an object";
  if (typeof v === "string") return `"${v}"`;
  return `${typeof v} ${String(v)}`;
}

export function map1(a: Field, f: (x: number) => number, label: string): Field {
  return new Field((n) => { const s = a.eval(n), out = new Float32Array(n * n); for (let i = 0; i < out.length; i++) out[i] = f(s[i]); return out; }, label);
}
export function map2(a: Field, b: Field, f: (x: number, y: number) => number, label: string): Field {
  return new Field((n) => { const s = a.eval(n), t = b.eval(n), out = new Float32Array(n * n); for (let i = 0; i < out.length; i++) out[i] = f(s[i], t[i]); return out; }, label);
}
export function map3(a: Field, b: Field, c: Field, f: (x: number, y: number, z: number) => number, label: string): Field {
  return new Field((n) => { const s = a.eval(n), t = b.eval(n), u = c.eval(n), out = new Float32Array(n * n); for (let i = 0; i < out.length; i++) out[i] = f(s[i], t[i], u[i]); return out; }, label);
}

/** Bilinear sample at tile coordinates (u, v), wrapping. */
export function sample(b: Float32Array, n: number, u: number, v: number): number {
  const x = mod(u * n - 0.5, n), y = mod(v * n - 0.5, n);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = (x0 + 1) % n, y1 = (y0 + 1) % n, fx = x - x0, fy = y - y0;
  return lerp(lerp(b[y0 * n + x0], b[y0 * n + x1], fx), lerp(b[y1 * n + x0], b[y1 * n + x1], fx), fy);
}

/** Three box blurs ≈ a gaussian; wraps around the tile. */
export function blurBuf(src: Float32Array, n: number, r: number): Float32Array {
  let a = src.slice(), b = new Float32Array(n * n);
  const box = Math.max(1, Math.round(r / Math.sqrt(3)));
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < n; y++) {                         // horizontal
      let acc = 0;
      for (let k = -box; k <= box; k++) acc += a[y * n + mod(k, n)];
      for (let x = 0; x < n; x++) {
        b[y * n + x] = acc / (2 * box + 1);
        acc += a[y * n + mod(x + box + 1, n)] - a[y * n + mod(x - box, n)];
      }
    }
    for (let x = 0; x < n; x++) {                         // vertical
      let acc = 0;
      for (let k = -box; k <= box; k++) acc += b[mod(k, n) * n + x];
      for (let y = 0; y < n; y++) {
        a[y * n + x] = acc / (2 * box + 1);
        acc += b[mod(y + box + 1, n) * n + x] - b[mod(y - box, n) * n + x];
      }
    }
  }
  return a;
}

const hashCol = (c: number, seed: number) => {
  let h = Math.imul(c | 0, 2654435761) ^ Math.imul(seed | 0, 40503);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

function rgb2hsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [mod(h * 60, 360), mx ? d / mx : 0, mx];
}
function hsv2rgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}
