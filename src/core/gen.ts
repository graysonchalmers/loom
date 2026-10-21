// Generators: periodic over the unit tile. Lattices and cell grids use whole-number periods and
// look up their neighbours modulo the period, so the left edge continues into the right edge.
import { LoomError } from "./errors.ts";
import { Field, Tex, colorOf, describe, num, whole } from "./field.ts";
import { clamp, hash, lerp, mod, smooth } from "./util.ts";

type Opts = Record<string, unknown>;
const opts = (o: unknown, what: string, keys: string[]): Opts => {
  if (o === undefined) return {};
  if (typeof o !== "object" || o === null || Array.isArray(o)) throw new LoomError(`${what}: expected an options object { ${keys.join(", ")} }`);
  for (const k of Object.keys(o)) if (!keys.includes(k)) throw new LoomError(`${what}: unknown option '${k}'${suggest(k, keys)}`);
  return o as Opts;
};
const suggest = (k: string, keys: string[]) => {
  const near = keys.find((c) => c.startsWith(k.slice(0, 2)) || k.startsWith(c.slice(0, 2)));
  return near ? ` (did you mean '${near}'?)` : ` (options: ${keys.join(", ")})`;
};
/** A period: one whole number, or [x, y] for stretched noise (wood grain, streaks). */
const period = (v: unknown, def: number, what: string): [number, number] => {
  if (v === undefined) return [def, def];
  if (Array.isArray(v) && v.length === 2) return [whole(v[0], what), whole(v[1], what)];
  const s = whole(v, what);
  return [s, s];
};

// ---------------------------------------------------------------- gradient noise

function gradients(px: number, py: number, seed: number): Float32Array {
  const g = new Float32Array(px * py * 2);
  for (let j = 0; j < py; j++) for (let i = 0; i < px; i++) {
    const a = hash(i, j, seed) * Math.PI * 2;
    g[(j * px + i) * 2] = Math.cos(a); g[(j * px + i) * 2 + 1] = Math.sin(a);
  }
  return g;
}

/** One octave of periodic gradient noise at (x, y) in lattice units, about -0.7..0.7. */
function perlin(g: Float32Array, px: number, py: number, x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const dot = (i: number, j: number, dx: number, dy: number) => {
    const k = (mod(iy + j, py) * px + mod(ix + i, px)) * 2;
    return g[k] * dx + g[k + 1] * dy;
  };
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  return lerp(lerp(dot(0, 0, fx, fy), dot(1, 0, fx - 1, fy), u), lerp(dot(0, 1, fx, fy - 1), dot(1, 1, fx - 1, fy - 1), u), v);
}

const NOISE_KEYS = ["scale", "octaves", "gain", "lacunarity", "seed"];

function fractal(o: Opts, what: string, shape: (v: number) => number): Field {
  const [sx, sy] = period(o.scale, 4, `${what} scale`);
  const oct = Math.max(1, Math.min(10, whole(o.octaves ?? 4, `${what} octaves`)));
  const gain = num(o.gain ?? 0.5, `${what} gain`), lac = whole(o.lacunarity ?? 2, `${what} lacunarity`), seed = num(o.seed ?? 1, `${what} seed`);
  return new Field((n) => {
    const out = new Float32Array(n * n);
    let amp = 1, total = 0;
    for (let k = 0; k < oct; k++) {
      const px = sx * lac ** k, py = sy * lac ** k, g = gradients(px, py, seed * 131 + k * 17);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
        out[y * n + x] += shape(perlin(g, px, py, ((x + 0.5) / n) * px, ((y + 0.5) / n) * py)) * amp;
      total += amp;
      amp *= gain;
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
  }, what);
}

/** Fractal noise, 0..1 around 0.5: clouds, dirt, variation. */
export function noise(o?: unknown): Field {
  return fractal(opts(o, "noise", NOISE_KEYS), "noise", (v) => clamp(v * 0.85 + 0.5));
}

/** Ridged noise: sharp crests (cracks when inverted, veins, mountain ridges). */
export function ridged(o?: unknown): Field {
  return fractal(opts(o, "ridged", NOISE_KEYS), "ridged", (v) => 1 - Math.min(1, Math.abs(v) * 1.6));
}

// ---------------------------------------------------------------- cells

type CellOut = { f1: Float32Array; f2: Float32Array; id: Float32Array };

/** Worley over a periodic grid of feature points; distances in cell units. */
function worley(n: number, sx: number, sy: number, center: (i: number, j: number) => [number, number], metric = (dx: number, dy: number) => Math.hypot(dx, dy)): CellOut {
  const f1 = new Float32Array(n * n), f2 = new Float32Array(n * n), id = new Float32Array(n * n);
  const pts = new Float32Array(sx * sy * 2);
  for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) { const [cx, cy] = center(i, j); pts[(j * sx + i) * 2] = cx; pts[(j * sx + i) * 2 + 1] = cy; }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const X = ((x + 0.5) / n) * sx, Y = ((y + 0.5) / n) * sy, ci = Math.floor(X), cj = Math.floor(Y);
    let d1 = Infinity, d2 = Infinity, best = 0;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const i = ci + di, j = cj + dj, wi = mod(i, sx), wj = mod(j, sy), k = (wj * sx + wi) * 2;
      const d = metric(i + pts[k] - X, j + pts[k + 1] - Y);
      if (d < d1) { d2 = d1; d1 = d; best = wj * sx + wi; } else if (d < d2) d2 = d;
    }
    const o = y * n + x;
    f1[o] = d1; f2[o] = d2; id[o] = hash(best, 7, 3);
  }
  return { f1, f2, id };
}

const withParts = <T extends Record<string, Field>>(f: Field, parts: T): Field & T => Object.assign(f, parts);

/** Voronoi cells: returns the distance to the nearest point (0 at the point) with .edge (0 on the borders), .id (random per cell). */
export function cells(o?: unknown) {
  const p = opts(o, "cells", ["scale", "jitter", "seed"]);
  const [sx, sy] = period(p.scale, 6, "cells scale");
  const jit = clamp(num(p.jitter ?? 1, "cells jitter")), seed = num(p.seed ?? 1, "cells seed");
  const memo = new Map<number, CellOut>();
  const get = (n: number) => memo.get(n) ?? memo.set(n, worley(n, sx, sy, (i, j) => [0.5 + (hash(i, j, seed) - 0.5) * jit, 0.5 + (hash(i, j, seed + 99) - 0.5) * jit])).get(n)!;
  const f1 = new Field((n) => get(n).f1.map((d) => clamp(d)), "cells");
  return withParts(f1, {
    edge: new Field((n) => { const c = get(n); return c.f1.map((d, i) => clamp((c.f2[i] - d) * 2)); }, "cells.edge"),
    id: new Field((n) => get(n).id, "cells.id"),
  });
}

/** Round spots on a jittered grid, as a soft 0..1 height. */
export function dots(o?: unknown): Field {
  const p = opts(o, "dots", ["scale", "radius", "jitter", "soft", "seed"]);
  const c = cells({ scale: p.scale ?? 8, jitter: p.jitter ?? 0.6, seed: p.seed ?? 1 });
  const r = num(p.radius ?? 0.3, "dots radius"), s = Math.max(0.005, num(p.soft ?? 0.1, "dots soft"));
  return new Field((n) => c.eval(n).map((d) => 1 - smooth(r - s, r, d)), "dots");
}

// ---------------------------------------------------------------- built things

/** Shared by bricks and tiles: rows of rectangles, each row shifted by `offset`. */
function masonry(p: Opts, what: string, defOffset: number) {
  const R = whole(p.rows ?? 8, `${what} rows`), C = whole(p.cols ?? 4, `${what} cols`);
  const gap = num(p.gap ?? 0.012, `${what} gap`), bevel = Math.max(1e-4, num(p.bevel ?? 0.02, `${what} bevel`));
  const off = num(p.offset ?? defOffset, `${what} offset`), vary = num(p.vary ?? 0.15, `${what} vary`), seed = num(p.seed ?? 1, `${what} seed`);
  const wob = num(p.wobble ?? 0, `${what} wobble`);
  if (Math.abs(R * off - Math.round(R * off)) > 1e-6) throw new LoomError(`${what}: rows × offset must be a whole number (${R} × ${off}), or the rows won't line up across the tile edge`);
  const bw = 1 / C, bh = 1 / R, half = Math.min(bw, bh) / 2;
  const wobble = wob ? noise({ scale: 16, octaves: 3, seed: seed + 5 }) : undefined;
  const memo = new Map<number, { h: Float32Array; m: Float32Array; id: Float32Array; d: Float32Array }>();
  const get = (n: number) => {
    let r = memo.get(n);
    if (r) return r;
    const h = new Float32Array(n * n), m = new Float32Array(n * n), id = new Float32Array(n * n), dd = new Float32Array(n * n);
    const w = wobble?.eval(n), px = 1 / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, v = (y + 0.5) / n, row = Math.floor(v * R), xs = u * C + row * off, col = Math.floor(xs);
      const fx = xs - col, fy = v * R - row;
      let d = Math.min(fx * bw, (1 - fx) * bw, fy * bh, (1 - fy) * bh);
      if (w) d += (w[y * n + x] - 0.5) * wob * half;
      const i = y * n + x, rnd = hash(mod(col, C), mod(row, R), seed);
      id[i] = rnd;
      m[i] = smooth(gap / 2 - px, gap / 2 + px, d);
      h[i] = smooth(gap / 2, gap / 2 + bevel, d) * (1 - vary * rnd);
      dd[i] = clamp(d / half);
    }
    memo.set(n, (r = { h, m, id, d: dd }));
    return r;
  };
  const height = new Field((n) => get(n).h, what);
  return withParts(height, {
    mask: new Field((n) => get(n).m, `${what}.mask`),
    id: new Field((n) => get(n).id, `${what}.id`),
    dist: new Field((n) => get(n).d, `${what}.dist`),
  });
}

const MASON_KEYS = ["rows", "cols", "gap", "bevel", "offset", "vary", "wobble", "seed"];

/** Running-bond bricks. Height (with bevels) plus .mask (1 brick, 0 mortar), .id (random per brick), .dist (0 at the edge, 1 at the middle). */
export function bricks(o?: unknown) { return masonry(opts(o, "bricks", MASON_KEYS), "bricks", 0.5); }

/** A grid of tiles (bricks without the offset). */
export function tiles(o?: unknown) { return masonry(opts(o, "tiles", MASON_KEYS), "tiles", 0); }

/** Hexagonal tiles; rows are chosen so the hexes stay regular and the tile repeats. */
export function hex(o?: unknown) {
  const p = opts(o, "hex", ["cols", "gap", "bevel", "vary", "seed"]);
  const C = whole(p.cols ?? 6, "hex cols");
  const R = Math.max(2, 2 * Math.round((C * 2) / Math.sqrt(3) / 2));            // even, so offset rows repeat
  const gap = num(p.gap ?? 0.04, "hex gap"), bevel = Math.max(1e-4, num(p.bevel ?? 0.08, "hex bevel")), vary = num(p.vary ?? 0.15, "hex vary"), seed = num(p.seed ?? 1, "hex seed");
  const k = (R / C) * (Math.sqrt(3) / 2);
  const memo = new Map<number, CellOut>();
  const get = (n: number) => memo.get(n) ?? memo.set(n, worley(n, C, R, (i, j) => [0.5 + (j & 1 ? 0.5 : 0), 0.5], (dx, dy) => Math.hypot(dx, dy * k))).get(n)!;
  const height = new Field((n) => { const c = get(n); return c.f1.map((d, i) => smooth(gap, gap + bevel, (c.f2[i] - d) / 2) * (1 - vary * c.id[i])); }, "hex");
  return withParts(height, {
    mask: new Field((n) => { const c = get(n); return c.f1.map((d, i) => smooth(gap * 0.8, gap * 1.2, (c.f2[i] - d) / 2)); }, "hex.mask"),
    id: new Field((n) => get(n).id, "hex.id"),
    dist: new Field((n) => { const c = get(n); return c.f1.map((d, i) => clamp(c.f2[i] - d)); }, "hex.dist"),
  });
}

/** Wooden floor boards: rows of planks of random length, with .grain (lines along each board), .id and .mask. */
export function planks(o?: unknown) {
  const p = opts(o, "planks", ["rows", "per", "gap", "bevel", "vary", "grain", "seed"]);
  const R = whole(p.rows ?? 6, "planks rows"), per = whole(p.per ?? 2, "planks per");
  const gap = num(p.gap ?? 0.006, "planks gap"), bevel = Math.max(1e-4, num(p.bevel ?? 0.01, "planks bevel"));
  const vary = num(p.vary ?? 0.2, "planks vary"), seed = num(p.seed ?? 1, "planks seed"), gs = whole(p.grain ?? 40, "planks grain");
  const grainNoise = noise({ scale: [2, gs], octaves: 4, seed: seed + 11 }), knots = noise({ scale: 6, octaves: 2, seed: seed + 23 });
  const memo = new Map<number, { h: Float32Array; m: Float32Array; id: Float32Array; g: Float32Array }>();
  const get = (n: number) => {
    let r = memo.get(n);
    if (r) return r;
    const h = new Float32Array(n * n), m = new Float32Array(n * n), id = new Float32Array(n * n), g = new Float32Array(n * n);
    const gn = grainNoise.eval(n), kn = knots.eval(n), px = 1 / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, v = (y + 0.5) / n, row = Math.floor(v * R), shift = hash(row % R, 0, seed);
      const xs = u * per + shift, col = Math.floor(xs), fx = xs - col, fy = v * R - row;
      const d = Math.min(fx / per, (1 - fx) / per, fy / R, (1 - fy) / R);
      const i = y * n + x, rnd = hash(mod(col, per), row % R, seed + 1);
      id[i] = rnd;
      m[i] = smooth(gap / 2 - px, gap / 2 + px, d);
      h[i] = smooth(gap / 2, gap / 2 + bevel, d) * (1 - vary * rnd);
      // grain: the stretched noise, shifted per plank so neighbours don't line up, bent around knots
      const gx = mod(x + Math.round(rnd * n * 0.37), n);
      g[i] = clamp(gn[y * n + gx] * 0.8 + (kn[i] - 0.5) * 0.6 + 0.1);
    }
    memo.set(n, (r = { h, m, id, g }));
    return r;
  };
  const height = new Field((n) => get(n).h, "planks");
  return withParts(height, {
    mask: new Field((n) => get(n).m, "planks.mask"),
    id: new Field((n) => get(n).id, "planks.id"),
    grain: new Field((n) => get(n).g, "planks.grain"),
  });
}

/** Overlapping scales (fish, dragon, roof shingles): rows sit closer than a scale is tall, and each
 *  row covers the bottom of the one above, so only the lower crescent of every scale shows.
 *  Height rises toward each scale's free edge; .id per scale. Rows default to 2 × cols. */
export function scales(o?: unknown) {
  const p = opts(o, "scales", ["rows", "cols", "size", "seed"]);
  const C = whole(p.cols ?? 8, "scales cols"), R0 = whole(p.rows ?? C * 2, "scales rows"), R = R0 + (R0 & 1);   // even for the offset rows
  const size = num(p.size ?? 0.62, "scales size"), seed = num(p.seed ?? 1, "scales seed"), asp = C / R;           // row step in column widths
  const memo = new Map<number, { h: Float32Array; id: Float32Array }>();
  const get = (n: number) => {
    let r = memo.get(n);
    if (r) return r;
    const h = new Float32Array(n * n), id = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const X = ((x + 0.5) / n) * C, Y = ((y + 0.5) / n) * R, row = Math.floor(Y);
      let bh = 0, bid = 0;
      const reach = Math.ceil(size / asp) + 1;
      for (let dr = -reach; dr <= 1; dr++) {                // lower rows are in front: the last one that covers wins
        const rr = row + dr, sh = rr & 1 ? 0.5 : 0;
        for (const dc of [-1, 0, 1]) {
          const cc = Math.floor(X - sh) + dc, cx = cc + 0.5 + sh, cy = rr + 0.5;
          const dx = X - cx, dy = (Y - cy) * asp, d = Math.hypot(dx, dy) / size;
          if (d < 1) { bh = Math.sqrt(1 - d * d) * (0.55 + 0.45 * clamp(dy / size * 0.5 + 0.5)); bid = hash(mod(cc, C), mod(rr, R), seed); }
        }
      }
      h[y * n + x] = bh; id[y * n + x] = bid;
    }
    memo.set(n, (r = { h, id }));
    return r;
  };
  return withParts(new Field((n) => get(n).h, "scales"), { id: new Field((n) => get(n).id, "scales.id") });
}

/** Parallel stripes ("h" = horizontal bands, "v" = vertical), softness 0 (hard) .. 1 (sine). */
export function stripes(o?: unknown): Field {
  const p = opts(o, "stripes", ["count", "dir", "soft"]);
  const c = whole(p.count ?? 8, "stripes count"), soft = clamp(num(p.soft ?? 0.3, "stripes soft"), 0.001, 1);
  if (p.dir !== undefined && p.dir !== "h" && p.dir !== "v") throw new LoomError(`stripes dir: "h" or "v", got ${describe(p.dir)}`);
  const vert = p.dir === "v";
  return new Field((n) => {
    const out = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const s = 0.5 + 0.5 * Math.sin((((vert ? x : y) + 0.5) / n) * c * Math.PI * 2);
      out[y * n + x] = smooth(0.5 - soft / 2, 0.5 + soft / 2, s);
    }
    return out;
  }, "stripes");
}

/** Wavy bands: stripes bent by noise (sand ripples, water, wood rings). */
export function waves(o?: unknown): Field {
  const p = opts(o, "waves", ["count", "dir", "warp", "scale", "seed"]);
  const c = whole(p.count ?? 6, "waves count"), warp = num(p.warp ?? 0.4, "waves warp"), vert = p.dir === "v";
  const nz = noise({ scale: p.scale ?? 3, octaves: 3, seed: p.seed ?? 1 });
  return new Field((n) => {
    const w = nz.eval(n), out = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const t = ((vert ? x : y) + 0.5) / n + (w[y * n + x] - 0.5) * warp / c;
      out[y * n + x] = 0.5 + 0.5 * Math.sin(t * c * Math.PI * 2);
    }
    return out;
  }, "waves");
}

// ---------------------------------------------------------------- color

/** A flat color. */
export function color(hex: unknown): Tex {
  const c = typeof hex === "string" ? colorOf(hex) : undefined;
  if (!c) throw new LoomError(`color("#rrggbb" or a pal() name), got ${describe(hex)}`);
  return new Tex((n) => { const out = new Float32Array(n * n * 3); for (let i = 0; i < n * n; i++) out.set(c, i * 3); return out; }, hex as string);
}

/** Map a field through a gradient: ["#dark", "#mid", "#light"] evenly, or [[0, "#a"], [0.7, "#b"], [1, "#c"]]. */
export function ramp(f: unknown, stops: unknown): Tex {
  if (!(f instanceof Field)) throw new LoomError(`ramp(field, colors): the first argument must be a field, got ${describe(f)}`);
  if (!Array.isArray(stops) || stops.length < 2) throw new LoomError('ramp(field, ["#a", "#b", ...]): at least two colors');
  const st = stops.map((s, i) => {
    const [pos, hex] = Array.isArray(s) ? s : [i / (stops.length - 1), s];
    const c = typeof hex === "string" ? colorOf(hex) : undefined;
    if (!c || typeof pos !== "number") throw new LoomError(`ramp: stop ${i} must be a color ("#rrggbb" or a pal() name) or [position, color], got ${describe(s)}`);
    return { pos, c };
  });
  for (let i = 1; i < st.length; i++) if (st[i].pos < st[i - 1].pos) throw new LoomError("ramp: stop positions must increase");
  return new Tex((n) => {
    const a = f.eval(n), out = new Float32Array(n * n * 3);
    for (let i = 0; i < n * n; i++) {
      const v = a[i];
      let k = 0;
      while (k < st.length - 2 && v > st[k + 1].pos) k++;
      const s0 = st[k], s1 = st[k + 1], t = clamp((v - s0.pos) / (s1.pos - s0.pos || 1e-9));
      for (let j = 0; j < 3; j++) out[i * 3 + j] = lerp(s0.c[j], s1.c[j], t);
    }
    return out;
  }, "ramp");
}
