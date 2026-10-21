// Preview renderer: the material lit on a tiled plane, a sphere and an isometric cube, plus plain
// map views. A small PBR-ish model (Lambert + normalized Blinn-Phong, Schlick Fresnel, AO-scaled
// ambient, emission) using the normal map in a proper tangent frame. It's the agent's eyes.
import type { Maps } from "./material.ts";
import { clamp, mod } from "./util.ts";

type V3 = [number, number, number];
const norm = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lin = (c: number) => c ** 2.2;
const tone = (c: number) => clamp((c / (1 + c)) * 1.25) ** (1 / 2.2);

export interface Light { dir?: V3 }
const DEFAULT_LIGHT: V3 = norm([-0.55, 0.6, 0.6]);

/** Bilinear lookup with wrap; c channels. */
function tap(b: Float32Array, n: number, c: number, u: number, v: number, out: number[]): number[] {
  const x = mod(u * n - 0.5, n), y = mod(v * n - 0.5, n), x0 = Math.floor(x), y0 = Math.floor(y), x1 = (x0 + 1) % n, y1 = (y0 + 1) % n, fx = x - x0, fy = y - y0;
  for (let k = 0; k < c; k++) {
    const a = b[(y0 * n + x0) * c + k], bb = b[(y0 * n + x1) * c + k], cc = b[(y1 * n + x0) * c + k], d = b[(y1 * n + x1) * c + k];
    out[k] = (a + (bb - a) * fx) + ((cc + (d - cc) * fx) - (a + (bb - a) * fx)) * fy;
  }
  return out;
}

/** Shade one point: albedo/emit sRGB, world normal, view and light directions. Returns linear RGB. */
function shade(m: Maps, u: number, v: number, T: V3, B: V3, N: V3, V: V3, L: V3, flipG: number): V3 {
  const n = m.n, al = tap(m.albedo, n, 3, u, v, [0, 0, 0]), nm = tap(m.normal, n, 3, u, v, [0, 0, 0]);
  const r = tap(m.rough, n, 1, u, v, [0])[0], me = tap(m.metal, n, 1, u, v, [0])[0], ao = tap(m.ao, n, 1, u, v, [0])[0];
  const tx = nm[0] * 2 - 1, ty = (nm[1] * 2 - 1) * flipG, tz = nm[2] * 2 - 1;
  const Nw = norm([T[0] * tx + B[0] * ty + N[0] * tz, T[1] * tx + B[1] * ty + N[1] * tz, T[2] * tx + B[2] * ty + N[2] * tz]);
  const H = norm([L[0] + V[0], L[1] + V[1], L[2] + V[2]]);
  const nl = Math.max(0, dot(Nw, L)), nh = Math.max(0, dot(Nw, H)), vh = Math.max(0, dot(V, H)), nv = Math.max(0, dot(Nw, V));
  const a = Math.max(0.03, r * r), shin = Math.min(2048, 2 / (a * a) - 2);
  const out: V3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const c = lin(al[k]), f0 = 0.04 + (c - 0.04) * me, F = f0 + (1 - f0) * (1 - vh) ** 5;
    const diff = c * (1 - me) * nl * 2.2;
    const spec = nl > 0 ? ((shin + 2) / 8) * nh ** shin * F * 1.6 : 0;
    const amb = (c * (1 - me) * 0.22 + (f0 + (1 - f0) * (1 - nv) ** 5) * 0.12 * (1 - r * 0.6)) * ao;
    out[k] = diff + spec + amb;
  }
  if (m.emit) { const e = tap(m.emit, n, 3, u, v, [0, 0, 0]); for (let k = 0; k < 3; k++) out[k] += lin(e[k]) * 2.2; }
  return out;
}

const put = (img: Uint8Array, i: number, c: V3, a = 255) => {
  img[i * 4] = Math.round(tone(c[0]) * 255); img[i * 4 + 1] = Math.round(tone(c[1]) * 255); img[i * 4 + 2] = Math.round(tone(c[2]) * 255); img[i * 4 + 3] = a;
};

/** The material on a flat surface, tiled k×k, under a raking light (shows the relief and any seams). */
export function renderPlane(m: Maps, size: number, k = 3, light: Light = {}, flipG = 1): Uint8Array {
  const img = new Uint8Array(size * size * 4), L = light.dir ? norm(light.dir) : DEFAULT_LIGHT, V: V3 = [0, 0, 1];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
    put(img, y * size + x, shade(m, ((x + 0.5) / size) * k, ((y + 0.5) / size) * k, [1, 0, 0], [0, 1, 0], [0, 0, 1], V, L, flipG));
  return img;
}

/** A lit sphere, the texture wrapped twice around it. */
export function renderSphere(m: Maps, size: number, light: Light = {}, flipG = 1): Uint8Array {
  const img = new Uint8Array(size * size * 4), L = light.dir ? norm(light.dir) : DEFAULT_LIGHT, V: V3 = [0, 0, 1], R = size * 0.46, c = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = (x + 0.5 - c) / R, ny = -(y + 0.5 - c) / R, d = nx * nx + ny * ny;
    if (d >= 1) continue;
    const N: V3 = [nx, ny, Math.sqrt(1 - d)];
    const T = norm([N[2], 0, -N[0]]), B = cross(N, T);
    const u = (0.5 + Math.atan2(N[0], N[2]) / (2 * Math.PI)) * 2, v = (Math.acos(clamp(N[1], -1, 1)) / Math.PI) * 1;
    const edge = clamp((1 - Math.sqrt(d)) * R);           // 1-px antialiased rim
    put(img, y * size + x, shade(m, u, v, T, B, N, V, L, flipG), Math.round(edge * 255));
  }
  return img;
}

/** An isometric cube: one tile on each visible face. */
export function renderCube(m: Maps, size: number, light: Light = {}, flipG = 1): Uint8Array {
  const img = new Uint8Array(size * size * 4), L = light.dir ? norm(light.dir) : norm([-0.35, 0.8, 0.55]), V = norm([0.7, 0.75, 0.9]);
  const s = size * 0.33, ox = size / 2, oy = size * 0.5;
  const proj = (p: V3): [number, number] => [ox + (p[0] - p[2]) * 0.866 * s, oy + ((p[0] + p[2]) * 0.5 - p[1]) * s];
  // [origin, u axis, v axis (image-down), normal]
  const faces: [V3, V3, V3, V3][] = [
    [[-1, 1, -1], [2, 0, 0], [0, 0, 2], [0, 1, 0]],     // top
    [[-1, 1, 1], [2, 0, 0], [0, -2, 0], [0, 0, 1]],     // front-left (+z)
    [[1, 1, 1], [0, 0, -2], [0, -2, 0], [1, 0, 0]],     // front-right (+x)
  ];
  for (const [o, a, b, N] of faces) {
    const p0 = proj(o), pa = proj([o[0] + a[0], o[1] + a[1], o[2] + a[2]]), pb = proj([o[0] + b[0], o[1] + b[1], o[2] + b[2]]);
    const ax = pa[0] - p0[0], ay = pa[1] - p0[1], bx = pb[0] - p0[0], by = pb[1] - p0[1], det = ax * by - ay * bx;
    const T = norm(a), Bn = norm([-b[0], -b[1], -b[2]]);
    const xs = [p0[0], pa[0], pb[0], pa[0] + bx], ys = [p0[1], pa[1], pb[1], pa[1] + by];
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y < Math.min(size, Math.ceil(Math.max(...ys))); y++)
      for (let x = Math.max(0, Math.floor(Math.min(...xs))); x < Math.min(size, Math.ceil(Math.max(...xs))); x++) {
        const px = x + 0.5 - p0[0], py = y + 0.5 - p0[1], u = (px * by - py * bx) / det, v = (ax * py - ay * px) / det;
        if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
        put(img, y * size + x, shade(m, u, v, T, Bn, N, V, L, flipG));
      }
  }
  return img;
}

export type MapName = "albedo" | "normal" | "height" | "rough" | "metal" | "ao" | "emit";

/** One map as an image, tiled k×k (gray maps as gray). */
export function renderMap(m: Maps, which: MapName, size: number, k = 1): Uint8Array {
  const img = new Uint8Array(size * size * 4);
  const src = which === "albedo" ? m.albedo : which === "normal" ? m.normal : which === "emit" ? m.emit : m[which];
  const c = which === "albedo" || which === "normal" || which === "emit" ? 3 : 1, px = [0, 0, 0];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    if (!src) { img[i * 4 + 3] = 255; continue; }
    tap(src, m.n, c, ((x + 0.5) / size) * k, ((y + 0.5) / size) * k, px);
    for (let j = 0; j < 3; j++) img[i * 4 + j] = Math.round(clamp(c === 3 ? px[j] : px[0]) * 255);
    img[i * 4 + 3] = 255;
  }
  return img;
}

/** A field or texture buffer (from a named node) as an image, tiled k×k. */
export function renderBuffer(b: Float32Array, n: number, channels: 1 | 3, size: number, k = 1): Uint8Array {
  const img = new Uint8Array(size * size * 4), px = [0, 0, 0];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    tap(b, n, channels, ((x + 0.5) / size) * k, ((y + 0.5) / size) * k, px);
    for (let j = 0; j < 3; j++) img[i * 4 + j] = Math.round(clamp(channels === 3 ? px[j] : px[0]) * 255);
    img[i * 4 + 3] = 255;
  }
  return img;
}
