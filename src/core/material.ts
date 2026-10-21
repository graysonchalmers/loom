// A material: channels (height, color, roughness, metalness, emission, AO) evaluated at a size
// and turned into game-ready maps. Normal and AO are derived from height, wrapping at the edges.
import { LoomError } from "./errors.ts";
import { Field, Tex, blurBuf, lift, liftTex } from "./field.ts";
import { clamp } from "./util.ts";

export interface MaterialOpts {
  size?: number;
  /** Height range in tile units: how deep the relief reads in the normal map (default 0.04). */
  depth?: number;
  /** Green up (OpenGL, Blender, Godot, Unity) or down (DirectX, Unreal). */
  normal?: "gl" | "dx";
  /** AO strength (0 = off). */
  ao?: number;
}

export interface Channels {
  height?: unknown;
  color?: unknown;
  rough?: unknown;
  metal?: unknown;
  emit?: unknown;
  ao?: unknown;
}

export const CHANNEL_KEYS = ["height", "color", "rough", "metal", "emit", "ao"];
export const MATERIAL_OPTS = ["size", "depth", "normal", "ao"];

export interface MaterialDef {
  name: string;
  opts: MaterialOpts;
  height: Field;
  color: Tex;
  rough: Field;
  metal: Field;
  emit?: Tex;
  aoIn?: Field;
  loc?: string;
}

/** The maps, all n×n: albedo/normal/emit are RGB (0..1), the rest one channel. */
export interface Maps {
  n: number;
  albedo: Float32Array;
  height: Float32Array;
  normal: Float32Array;
  rough: Float32Array;
  metal: Float32Array;
  ao: Float32Array;
  emit?: Float32Array;
}

export function defineMaterial(name: string, opts: MaterialOpts, ch: Channels, loc?: string): MaterialDef {
  for (const k of Object.keys(ch)) if (!CHANNEL_KEYS.includes(k)) throw new LoomError(`material '${name}': unknown channel '${k}' (channels: ${CHANNEL_KEYS.join(", ")})`, loc);
  if (opts.size !== undefined && (!Number.isInteger(opts.size) || opts.size < 16 || opts.size > 4096 || (opts.size & (opts.size - 1)) !== 0))
    throw new LoomError(`material '${name}': size must be a power of two from 16 to 4096 (got ${opts.size})`, loc);
  if (opts.normal !== undefined && opts.normal !== "gl" && opts.normal !== "dx") throw new LoomError(`material '${name}': normal "gl" or "dx"`, loc);
  return {
    name, opts, loc,
    height: lift(ch.height ?? 0.5, "height"),
    color: liftTex(ch.color ?? "#808080", "color"),
    rough: lift(ch.rough ?? 0.7, "rough"),
    metal: lift(ch.metal ?? 0, "metal"),
    emit: ch.emit === undefined ? undefined : liftTex(ch.emit, "emit"),
    aoIn: ch.ao === undefined ? undefined : lift(ch.ao, "ao"),
  };
}

export function buildMaps(def: MaterialDef, size?: number): Maps {
  const n = size ?? def.opts.size ?? 512;
  const height = def.height.eval(n).map((v) => clamp(v));
  const albedo = def.color.eval(n).map((v) => clamp(v));
  const rough = def.rough.eval(n).map((v) => clamp(v)), metal = def.metal.eval(n).map((v) => clamp(v));
  const depth = def.opts.depth ?? 0.04, flipG = def.opts.normal === "dx" ? -1 : 1;

  // normal from height: central differences in tile units, wrapping
  const normal = new Float32Array(n * n * 3);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (height[y * n + ((x + 1) % n)] - height[y * n + ((x + n - 1) % n)]) * (n / 2) * depth;
    const dy = (height[((y + 1) % n) * n + x] - height[((y + n - 1) % n) * n + x]) * (n / 2) * depth;
    // image y runs down; with green up (GL) the normal leans toward +y where height drops going down
    const nx = -dx, ny = dy * flipG, nz = 1, l = Math.hypot(nx, ny, nz), o = (y * n + x) * 3;
    normal[o] = nx / l * 0.5 + 0.5; normal[o + 1] = ny / l * 0.5 + 0.5; normal[o + 2] = nz / l * 0.5 + 0.5;
  }

  // AO: how far each point sits below its surroundings at a few radii
  const ao = new Float32Array(n * n).fill(1), strength = def.opts.ao ?? 1;
  if (strength > 0) {
    const radii = [0.004, 0.012, 0.03, 0.07].map((r) => Math.max(1, Math.round(r * n)));
    const blurs = radii.map((r) => blurBuf(height, n, r));
    for (let i = 0; i < n * n; i++) {
      let occ = 0;
      for (let k = 0; k < blurs.length; k++) occ += Math.max(0, blurs[k][i] - height[i]) / (radii[k] / n + depth) * depth;
      ao[i] = clamp(1 - occ * 2.2 * strength);
    }
  }
  if (def.aoIn) { const a = def.aoIn.eval(n); for (let i = 0; i < n * n; i++) ao[i] *= clamp(a[i]); }
  const emit = def.emit?.eval(n).map((v) => clamp(v));
  return { n, albedo, height, normal, rough, metal, ao, emit };
}

/** The biggest jump across the tile's wrap-around seams, compared with the typical step inside (1 = no worse). */
export function seamScore(m: Maps): { worst: number; map: string } {
  const one = (b: Float32Array, c: number) => {
    const n = m.n, at = (x: number, y: number, k: number) => b[(y * n + x) * c + k];
    // the worst step across the wrap-around seams vs the worst step across 7 interior lines
    let seam = 0, inner = 0;
    for (let k = 0; k < c; k++) for (let i = 0; i < n; i++) {
      seam = Math.max(seam, Math.abs(at(0, i, k) - at(n - 1, i, k)), Math.abs(at(i, 0, k) - at(i, n - 1, k)));
      for (let q = 1; q < 8; q++) {
        const j = Math.round((q * n) / 8);
        inner = Math.max(inner, Math.abs(at(j, i, k) - at(j - 1, i, k)), Math.abs(at(i, j, k) - at(i, j - 1, k)));
      }
    }
    return seam / Math.max(inner, 1e-3);
  };
  const scores: [string, number][] = [["albedo", one(m.albedo, 3)], ["height", one(m.height, 1)], ["rough", one(m.rough, 1)], ["normal", one(m.normal, 3)]];
  scores.sort((a, b) => b[1] - a[1]);
  return { worst: Math.round(scores[0][1] * 100) / 100, map: scores[0][0] };
}
