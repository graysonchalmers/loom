// loom CLI: build materials, list them, inspect one, run the live viewer.
import { dirname, join, resolve } from "node:path";
import { wrap } from "../core/errors.ts";
import { seamScore } from "../core/material.ts";
import { loadProject } from "./load.ts";
import { writeOutputs } from "./output.ts";

const USAGE = `loom: seamless game textures and PBR materials as code

  loom build <materials.tx.js> [--out DIR] [--only a,b] [--size N] [--no-preview]
  loom serve <materials.tx.js> [--port 4350] [--no-out]
  loom list  <materials.tx.js>
  loom info  <materials.tx.js> <name> [--size N]

Outputs go to <file dir>/out: <name>/<name>_{albedo,normal,height,roughness,metallic,ao,orm,emissive}.png,
<name>/<name>.material.json and _preview/<name>.png (lit plane, sphere, cube, every map).`;

export async function main(argv: string[]): Promise<number> {
  const [cmd, file, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || !file) { console.log(USAGE); return cmd ? 0 : 1; }
  const flag = (k: string) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
  try {
    if (cmd === "build") {
      const p = loadProject(file);
      const out = flag("--out") ?? join(dirname(resolve(file)), "out");
      const r = writeOutputs(p, out, { only: flag("--only")?.split(","), size: flag("--size") ? Number(flag("--size")) : undefined, preview: !rest.includes("--no-preview") });
      for (const l of r.lines) console.log(l);
      for (const e of r.errors) console.error("error: " + e.message);
      console.log(`-> ${out}${r.errors.length ? ` (${r.errors.length} error${r.errors.length > 1 ? "s" : ""})` : ""}`);
      return r.errors.length ? 1 : 0;
    }
    if (cmd === "list") {
      const p = loadProject(file);
      for (const name of p.order) console.log(`material ${name}  ${p.materials.get(name)!.loc ?? ""}`);
      for (const n of p.nodes) console.log(`  node ${n.label}  ${n.loc ?? ""}`);
      return 0;
    }
    if (cmd === "info") {
      const p = loadProject(file), name = rest[0];
      if (!name) { console.error("loom info <file> <name>"); return 1; }
      const m = p.build(name, flag("--size") ? Number(flag("--size")) : undefined), seam = seamScore(m);
      const stat = (b: Float32Array, c = 1) => {
        let lo = Infinity, hi = -Infinity, sum = 0;
        for (let i = 0; i < b.length; i += c) { const v = c === 3 ? 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2] : b[i]; lo = Math.min(lo, v); hi = Math.max(hi, v); sum += v; }
        return `min ${lo.toFixed(2)}  mean ${(sum / (b.length / c)).toFixed(2)}  max ${hi.toFixed(2)}`;
      };
      console.log(`${name}: ${m.n}×${m.n}  ${seam.worst <= 1.5 ? "seamless" : `SEAM ${seam.worst}× in ${seam.map}`} (seam step / inner step, worst map: ${seam.map} ${seam.worst})`);
      console.log(`  albedo luma ${stat(m.albedo, 3)}`);
      for (const k of ["height", "rough", "metal", "ao"] as const) console.log(`  ${k.padEnd(6)} ${stat(m[k])}`);
      if (m.emit) console.log(`  emit luma ${stat(m.emit, 3)}`);
      return 0;
    }
    if (cmd === "serve") {
      const { serve } = await import("./server.ts");
      const s = await serve(file, { port: flag("--port") ? Number(flag("--port")) : undefined, out: rest.includes("--no-out") ? false : undefined });
      console.log(`loom live viewer: ${s.url}  (watching ${resolve(file)}; Ctrl+C to stop)`);
      await new Promise(() => {});
    }
    console.error(`unknown command '${cmd}'\n\n${USAGE}`);
    return 1;
  } catch (e) {
    console.error("error: " + wrap(e).message);
    return 1;
  }
}
