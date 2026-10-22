import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadProject, loadSource } from "../src/node/load.ts";
import { writeOutputs } from "../src/node/output.ts";
import { serve } from "../src/node/server.ts";

const throwsMsg = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: Error) => re.test(e.message), `expected ${re}`);
/** Build a one-channel field expression at n and return its buffer. */
const fieldOf = (expr: string, n = 64) => {
  const p = loadSource(`const f = ${expr}\nmaterial("m", { size: ${n}, ao: 0 }, { height: f })`, "t.tx.js");
  return p.build("m").height;
};
/** Worst step across the wrap-around seams vs the worst step inside: ~1 or less when it tiles. */
function seamRatio(b: Float32Array, n: number): number {
  let seam = 0, inner = 0;
  for (let i = 0; i < n; i++) {
    seam = Math.max(seam, Math.abs(b[i * n] - b[i * n + n - 1]), Math.abs(b[i] - b[(n - 1) * n + i]));
    for (let x = 1; x < n; x++) inner = Math.max(inner, Math.abs(b[i * n + x] - b[i * n + x - 1]));
    for (let y = 1; y < n; y++) inner = Math.max(inner, Math.abs(b[y * n + i] - b[(y - 1) * n + i]));
  }
  return seam / Math.max(inner, 1e-6);
}

test("every generator and spatial op tiles: the seam is no worse than the inside", () => {
  for (const expr of [
    "noise({ scale: 4 })", "noise({ scale: [2, 16], octaves: 5 })", "ridged({ scale: 6 })",
    "cells({ scale: 5 })", "cells({ scale: 5 }).edge", "dots({ scale: 6 })",
    "bricks({ rows: 6, cols: 3, wobble: 0.6 })", "tiles({ rows: 4, cols: 4 })", "hex({ cols: 5 })",
    "planks({ rows: 4 }).grain", "scales({ cols: 6 })", "stripes({ count: 5 })", "waves({ count: 4 })",
    "noise({ scale: 3 }).warp(noise({ scale: 2, seed: 3 }), 0.3)", "noise({ scale: 8 }).blur(0.05)",
    "noise({ scale: 4 }).offset(0.3, 0.71)", "noise({ scale: 3 }).repeat(2)", "noise({ scale: 4 }).rotate(90)",
    "noise({ scale: 8 }).threshold(0.7).drips({ length: 0.4 })", "noise({ scale: 6 }).facing('up')", "noise({ scale: 6 }).cavity(0.02)",
  ]) {
    const r = seamRatio(fieldOf(expr), 64);
    assert.ok(r <= 1.3, `${expr}: seam step is ${r.toFixed(2)}× the worst inner step`);
  }
});

test("a deliberately broken tile is caught by the seam check", () => {
  const p = loadSource(`material("m", { size: 32 }, { height: stripes({ count: 1, soft: 1 }).offset(0.25, 0), color: "#808080" })`, "t.tx.js");
  const b = p.build("m").height;
  // a plain gradient across the tile is the classic non-tiling texture: build one by hand
  const g = new Float32Array(32 * 32).map((_, i) => (i % 32) / 31);
  assert.ok(seamRatio(g, 32) > 20, "a ramp has a huge seam");
  assert.ok(seamRatio(b, 32) < 1.1, "periodic stripes do not");
});

test("normal map: flat is straight up, slopes lean away, dx flips green", () => {
  const flat = loadSource(`material("m", { size: 16 }, { height: 0.5 })`).build("m").normal;
  assert.deepEqual([...flat.slice(0, 3)].map((v) => Math.round(v * 100) / 100), [0.5, 0.5, 1]);
  // height rises toward +x: the surface faces -x, so red < 0.5; rising downward it faces up (green > 0.5 in GL)
  const src = (conv: string, dir: string) => `material("m", { size: 32, depth: 0.3, normal: "${conv}" }, { height: stripes({ count: 1, dir: "${dir}", soft: 1 }) })`;
  const gl = loadSource(src("gl", "v")).build("m"), dx = loadSource(src("dx", "v")).build("m");
  const i = (16 * 32 + 1) * 3;                      // the steepest rising part of the stripe
  assert.ok(gl.normal[i] < 0.4, `red should lean negative, got ${gl.normal[i]}`);
  const rot = loadSource(src("gl", "h")).build("m"), rotDx = loadSource(src("dx", "h")).build("m");
  const j = (1 * 32 + 16) * 3 + 1;
  assert.ok(rot.normal[j] > 0.6, `green should lean up in GL, got ${rot.normal[j]}`);
  assert.ok(Math.abs((rot.normal[j] - 0.5) + (rotDx.normal[j] - 0.5)) < 1e-6, "green flips between gl and dx");
  assert.ok(dx.normal[i] === gl.normal[i], "red is the same in both conventions");
});

test("same seed, same texture; another seed, another texture", () => {
  const a = fieldOf("noise({ scale: 5, seed: 3 })"), b = fieldOf("noise({ scale: 5, seed: 3 })"), c = fieldOf("noise({ scale: 5, seed: 4 })");
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test("errors point at the art file and suggest fixes", () => {
  throwsMsg(() => loadSource(`\nmaterial("m", { height: noise({ scale: 2.5 }) })`, "t.tx.js"), /t\.tx\.js:2:.*scale: must be a whole number/);
  throwsMsg(() => loadSource(`bricks({ rows: 4, colz: 2 })`, "t.tx.js"), /unknown option 'colz' \(did you mean 'cols'\?\)/);
  throwsMsg(() => loadSource(`material("m", { sise: 64 }, {})`, "t.tx.js"), /unknown option 'sise' \(did you mean 'size'\?\)/);
  throwsMsg(() => loadSource(`material("m", { size: 100 }, {})`, "t.tx.js"), /power of two/);
  throwsMsg(() => loadSource(`material("m", { colour: "#fff" })`, "t.tx.js"), /unknown channel 'colour'/);
  throwsMsg(() => loadSource(`material("m", { color: "brikc" })`, "t.tx.js"), /'brikc' is not a color/);
  throwsMsg(() => loadSource(`bricks({ rows: 5, offset: 0.5 })`, "t.tx.js"), /rows × offset must be a whole number/);
  throwsMsg(() => loadSource(`material("m", { height: noise().rotate(45) })`, "t.tx.js"), /90, 180 or 270/);
  throwsMsg(() => loadSource(`material("brick", {})`).build("brik"), /unknown material 'brik' \(did you mean 'brick'\?\)/);
});

test("palette names work anywhere a color does", () => {
  const p = loadSource(`pal({ moss: "#406020", alias: "moss" })\nmaterial("m", { size: 16 }, { color: ramp(noise(), ["moss", "alias"]) })`);
  const a = p.build("m").albedo;
  assert.deepEqual([a[0], a[1], a[2]].map((v) => Math.round(v * 255)), [0x40, 0x60, 0x20]);
});

test("build writes every map, a 16-bit height, the ORM pack, a manifest and a preview", () => {
  const dir = mkdtempSync(join(tmpdir(), "loom-"));
  try {
    const p = loadSource(`material("tile", { size: 64 }, { height: tiles({ rows: 2, cols: 2 }), color: "#806040", rough: 0.4, emit: "#000000" })`);
    const r = writeOutputs(p, dir);
    assert.equal(r.errors.length, 0);
    for (const m of ["albedo", "normal", "height", "roughness", "metallic", "ao", "orm", "emissive"]) assert.ok(existsSync(join(dir, "tile", `tile_${m}.png`)), m);
    const h = readFileSync(join(dir, "tile", "tile_height.png"));
    assert.deepEqual([h.readUInt32BE(16), h.readUInt32BE(20), h[24], h[25]], [64, 64, 16, 0], "64×64, 16-bit gray");
    const man = JSON.parse(readFileSync(join(dir, "tile", "tile.material.json"), "utf8"));
    assert.equal(man.maps.orm, "tile_orm.png");
    assert.ok(man.seam.worst <= 1.5);
    assert.ok(existsSync(join(dir, "_preview", "tile.png")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("serve: feedback notes carry the material and every named field at that pixel", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loom-fb-"));
  const file = join(dir, "a.tx.js");
  writeFileSync(file, `pal({ red: "#ff0000" })\nconst t = tiles({ rows: 2, cols: 2 }).as("tiles")\nmaterial("floor", { size: 32 }, { height: t, color: "red", rough: 0.25 })`);
  const s = await serve(file, { port: 0, out: join(dir, "out"), log: () => {} });
  const post = (body: unknown) => fetch(s.url + "api/feedback", { method: "POST", body: JSON.stringify(body) });
  try {
    const r = await post({ name: "floor", comment: "c", notes: [{ x: 8, y: 8, text: "here" }, { x: 99, y: 0, text: "outside" }],
      strokes: [{ color: "#ff0000", width: 2, points: [[1, 1], [2, 2]] }] });
    assert.equal(r.status, 200);
    const fb = JSON.parse(readFileSync(join(dir, "out", "_feedback", "floor.json"), "utf8"));
    assert.equal(fb.notes.length, 1, "notes outside the tile are dropped");
    assert.deepEqual([fb.notes[0].at.albedo, fb.notes[0].at.rough], ["#ff0000", 0.25]);
    assert.deepEqual(fb.notes[0].at.fields.map((f: { label: string }) => f.label), ["tiles"]);
    assert.deepEqual([fb.strokes[0].key, fb.strokes[0].kind], ["red", "palette"]);
    assert.equal((await post({ name: "nope" })).status, 400);
    const view = await fetch(s.url + "api/view?name=floor&mode=sphere&size=64");
    assert.equal(view.headers.get("content-type"), "image/png");
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("weave, checker and shape tile; shape kinds give decals that wrap at the edges", () => {
  for (const expr of ["weave({ threads: 6 })", "weave({ threads: 4 }).mask", "checker({ cols: 4, rows: 2 })",
    "shape({ kind: 'circle', cx: 0.95, cy: 0.5, r: 0.2 })", "shape({ kind: 'rect', w: 0.4, h: 0.2, rot: 30, round: 0.03 })",
    "shape({ kind: 'ngon', sides: 5, r: 0.3 })", "shape({ kind: 'star', sides: 5, r: 0.3, inner: 0.12 })", "shape({ kind: 'ring', r: 0.3, w: 0.05 })",
    "shape({ kind: 'line', x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.8, w: 0.04 })"]) {
    const r = seamRatio(fieldOf(expr), 64);
    assert.ok(r <= 1.3, `${expr}: seam step is ${r.toFixed(2)}× the worst inner step`);
  }
  const c = fieldOf("shape({ kind: 'circle', cx: 0.5, cy: 0.5, r: 0.25, soft: 0.002 })");
  assert.equal(c[32 * 64 + 32], 1, "inside");
  assert.equal(c[0], 0, "outside");
  assert.equal(c[32 * 64 + 5], 0);
  const edge = fieldOf("shape({ kind: 'circle', cx: 0.0, cy: 0.5, r: 0.2 })");
  assert.ok(edge[32 * 64 + 2] > 0.99 && edge[32 * 64 + 61] > 0.99, "a shape at the edge wraps to the other side");
  const ck = fieldOf("checker({ cols: 2 })", 16);
  assert.deepEqual([ck[0], ck[8], ck[8 * 16], ck[8 * 16 + 8]], [0, 1, 1, 0]);
  const wv = fieldOf("weave({ threads: 4, gap: 0.2 })", 32);
  let lo = 1, hi = 0;
  for (const v of wv) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  assert.ok(lo === 0 && hi > 0.9, `weave spans gaps and raised threads: ${lo}..${hi}`);
  throwsMsg(() => fieldOf("checker({ cols: 3 })"), /must be even/);
  throwsMsg(() => fieldOf("weave({ threads: 5 })"), /must be even/);
  throwsMsg(() => fieldOf("shape({ kind: 'blob' })"), /shape kind/);
  throwsMsg(() => fieldOf("shape({ kind: 'circle', radius: 1 })"), /unknown option 'radius'/);
});

test("image() brings a PNG in as a color; seamless blends its edges so it tiles", async () => {
  const { png } = await import("../src/core/png.ts");
  const { deflateSync } = await import("node:zlib");
  const dir = mkdtempSync(join(tmpdir(), "loom-img-"));
  // a 16x16 horizontal gradient: red on the left, blue on the right (a hard seam when tiled)
  const w = 16, rgba = new Uint8Array(w * w * 4);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) rgba.set([Math.round(255 - (x * 255) / 15), 40, Math.round((x * 255) / 15), 255], (y * w + x) * 4);
  writeFileSync(join(dir, "g.png"), png(w, w, rgba, 4, (b) => deflateSync(b)));
  writeFileSync(join(dir, "m.tx.js"), `material("raw", { size: 32, ao: 0 }, { color: image("g.png"), height: image("g.png").luma() })
material("fixed", { size: 32, ao: 0 }, { color: image("g.png", { seamless: 0.3 }) })`);
  const p = loadProject(join(dir, "m.tx.js"));
  const raw = p.build("raw"), fixed = p.build("fixed");
  assert.ok(raw.albedo[0] > 0.9 && raw.albedo[2] < 0.1, "left edge is red");
  assert.ok(raw.albedo[(31) * 3] < 0.1 && raw.albedo[31 * 3 + 2] > 0.9, "right edge is blue");
  assert.ok(seamRatio(raw.height, 32) > 3, "a gradient has a hard seam");
  const seam = (a: Float32Array) => { let s = 0, inner = 0; for (let y = 0; y < 32; y++) { s = Math.max(s, Math.abs(a[(y * 32) * 3] - a[(y * 32 + 31) * 3])); for (let x = 1; x < 32; x++) inner = Math.max(inner, Math.abs(a[(y * 32 + x) * 3] - a[(y * 32 + x - 1) * 3])); } return s / inner; };
  assert.ok(seam(fixed.albedo) <= 1.3, `seamless: ${seam(fixed.albedo)}`);
  assert.equal(p.materials.get("raw")!.color.label, "image(g.png)");
  throwsMsg(() => loadSource(`material("m", { color: image("missing.png") })`), /cannot read image/);
  throwsMsg(() => loadSource(`material("m", { color: image("g.png", { seamless: 2 }) })`), /0\.\.0\.5/);
});
