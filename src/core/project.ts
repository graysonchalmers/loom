// A project: the materials defined by one art file (and its includes), the DSL that file sees,
// and a build cache. Fields are lazy, so defining is cheap and building happens on demand.
import { LoomError, didYouMean, wrap } from "./errors.ts";
import { Field, Tex, describe, named, resetNamed, setLocator, setPalette } from "./field.ts";
import * as gen from "./gen.ts";
import { type Maps, type MaterialDef, MATERIAL_OPTS, buildMaps, defineMaterial } from "./material.ts";
import { parseHex } from "./util.ts";

/** A decoded raster for image(): straight 8-bit RGBA. */
export interface Rgba {
  w: number;
  h: number;
  rgba: Uint8Array;
}

const IMAGE_KEYS = ["seamless"];

/**
 * A photo or painted texture as a color: resampled to the tile size, and with `seamless` > 0 blended
 * at the edges with a half-tile-offset copy (which brings the image's middle to the seam), so it
 * tiles. The band is `seamless` tile units wide. `.luma()` turns it into a height or mask field.
 */
export function imageTex(img: Rgba, seamless: number, label: string): Tex {
  return new Tex((n) => {
    // box-prefilter big images so shrinking them doesn't alias, then sample bilinearly
    const k = Math.max(1, Math.floor(Math.min(img.w, img.h) / n));
    const sw = Math.floor(img.w / k), sh = Math.floor(img.h / k), small = new Float32Array(sw * sh * 3);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) { const o = ((y * k + j) * img.w + x * k + i) * 4; r += img.rgba[o]; g += img.rgba[o + 1]; b += img.rgba[o + 2]; }
      const o = (y * sw + x) * 3, d = 255 * k * k;
      small[o] = r / d; small[o + 1] = g / d; small[o + 2] = b / d;
    }
    // bilinear; the offset copy wraps (it is meant to cross the edges), the plain image clamps at its border
    const tap = (u: number, v: number, c: number, wrap: boolean) => {
      const x = u * sw - 0.5, y = v * sh - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      const ix = (xx: number) => (wrap ? ((xx % sw) + sw) % sw : Math.max(0, Math.min(sw - 1, xx)));
      const iy = (yy: number) => (wrap ? ((yy % sh) + sh) % sh : Math.max(0, Math.min(sh - 1, yy)));
      const at = (xx: number, yy: number) => small[(iy(yy) * sw + ix(xx)) * 3 + c];
      return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
    };
    const out = new Float32Array(n * n * 3);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, v = (y + 0.5) / n;
      const edge = Math.min(u, 1 - u, v, 1 - v), wgt = seamless > 0 ? 1 - smoothstep(0, seamless, edge) : 0;
      for (let c = 0; c < 3; c++) {
        const a = tap(u, v, c, false);
        out[(y * n + x) * 3 + c] = wgt > 0 ? a + (tap(u + 0.5, v + 0.5, c, true) - a) * wgt : a;
      }
    }
    return out;
  }, label);
}

const smoothstep = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a || 1e-9))); return t * t * (3 - 2 * t); };

export class Project {
  readonly files: string[] = [];
  readonly materials = new Map<string, MaterialDef>();
  readonly order: string[] = [];
  readonly palette = new Map<string, [number, number, number]>();
  includeHook?: (path: string) => void;
  /** Set by a loader: resolves a path written in a material file against that file. */
  pathHook: (path: string) => string = (p) => p;
  /** Set by a loader: reads and decodes a PNG by its resolved path. */
  imageHook?: (path: string) => Rgba;
  private images = new Map<string, Rgba>();
  private readonly cache = new Map<string, Maps>();
  nodes: { label: string; loc?: string; node: Field | Tex }[] = [];

  constructor() {
    resetNamed();
    setPalette(this.palette);
    setLocator(() => this.callerLoc());
  }

  addFile(file: string): void { if (!this.files.includes(file)) this.files.push(file); }

  locFromStack(stack: string): string | undefined {
    for (const line of stack.split("\n")) {
      for (const f of this.files) {
        const i = line.indexOf(f + ":");
        if (i < 0) continue;
        const m = /^:(\d+):(\d+)/.exec(line.slice(i + f.length));
        if (m) return `${f.replace(/^.*[\\/]/, "")}:${m[1]}:${m[2]}`;
      }
    }
    return undefined;
  }

  callerLoc(): string | undefined {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 60;
    const stack = new Error().stack ?? "";
    Error.stackTraceLimit = limit;
    return this.locFromStack(stack);
  }

  /** Call when the file has finished running: captures the fields named with .as(). */
  finish(): void { this.nodes = [...named]; }

  build(name: string, size?: number): Maps {
    const def = this.materials.get(name);
    if (!def) throw new LoomError(`unknown material '${name}'${didYouMean(name, this.order)}`);
    const key = `${name}@${size ?? def.opts.size ?? 512}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    try {
      const m = buildMaps(def, size);
      this.cache.set(key, m);
      return m;
    } catch (e) {
      throw wrap(e, (s) => this.locFromStack(s)).within(`material '${name}'`, def.loc);
    }
  }

  // ---------------------------------------------------------------- DSL

  env(): Record<string, unknown> {
    const guard = <A extends unknown[], R>(name: string, fn: (...a: A) => R) => (...a: A): R => {
      try { return fn(...a); } catch (e) { throw wrap(e, (s) => this.locFromStack(s)).within(name, this.callerLoc()); }
    };
    const env: Record<string, unknown> = {
      pal: (colors: unknown) => {
        if (typeof colors !== "object" || colors === null || Array.isArray(colors)) throw new LoomError('pal({ stone: "#7a7f86", moss: "#4f6b2f" })', this.callerLoc());
        for (const [k, v] of Object.entries(colors)) {
          const c = typeof v === "string" ? parseHex(v) ?? this.palette.get(v) : undefined;
          if (!c) throw new LoomError(`pal: '${k}' must be "#rrggbb" or another name, got ${describe(v)}`, this.callerLoc());
          this.palette.set(k, c);
        }
      },
      material: (name: unknown, a?: unknown, b?: unknown) => {
        const loc = this.callerLoc();
        if (typeof name !== "string" || !name) throw new LoomError('material("name", { size }, { height, color, rough, metal, emit, ao })', loc);
        const [opts, ch] = b === undefined ? [{}, a] : [a, b];
        if (typeof opts !== "object" || opts === null) throw new LoomError(`material '${name}': options must be an object`, loc);
        if (typeof ch !== "object" || ch === null || ch instanceof Field || ch instanceof Tex) throw new LoomError(`material '${name}': channels must be an object { height, color, rough, ... }`, loc);
        for (const k of Object.keys(opts)) if (!MATERIAL_OPTS.includes(k)) throw new LoomError(`material '${name}': unknown option '${k}'${didYouMean(k, MATERIAL_OPTS)}`, loc);
        if (this.materials.has(name)) throw new LoomError(`material '${name}' is defined twice`, loc);
        try {
          this.materials.set(name, defineMaterial(name, opts as never, ch as never, loc));
        } catch (e) { throw wrap(e, (s) => this.locFromStack(s)).within(`material '${name}'`, loc); }
        this.order.push(name);
      },
      image: (src: unknown, o: unknown = {}) => {
        const loc = this.callerLoc();
        if (typeof src !== "string" || !src) throw new LoomError('image("photo.png", { seamless: 0.25 }): a PNG relative to the material file', loc);
        if (typeof o !== "object" || o === null || Array.isArray(o)) throw new LoomError("image options must be an object", loc);
        for (const k of Object.keys(o)) if (!IMAGE_KEYS.includes(k)) throw new LoomError(`image: unknown option '${k}'${didYouMean(k, IMAGE_KEYS)}`, loc);
        const seamless = (o as Record<string, unknown>).seamless ?? 0;
        if (typeof seamless !== "number" || !(seamless >= 0 && seamless <= 0.5)) throw new LoomError("image seamless: the edge blend width, 0..0.5 tile units", loc);
        const abs = this.pathHook(src);
        let img = this.images.get(abs);
        if (!img) {
          if (!this.imageHook) throw new LoomError("image() is not available here (no image loader)", loc);
          try { img = this.imageHook(abs); } catch (e) { throw wrap(e).within("image", loc); }
          this.images.set(abs, img);
        }
        return imageTex(img, seamless, `image(${src.replace(/^.*[\\/]/, "")})`);
      },
      include: (path: unknown) => {
        if (typeof path !== "string") throw new LoomError('include("other.tx.js")', this.callerLoc());
        if (!this.includeHook) throw new LoomError("include() is not available here", this.callerLoc());
        this.includeHook(path);
      },
    };
    for (const [name, fn] of Object.entries(gen)) env[name] = guard(name, fn as (...a: unknown[]) => unknown);
    return env;
  }
}
