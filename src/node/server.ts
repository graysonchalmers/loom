// Live viewer server: watch material files, rebuild, push updates over SSE, render views on request.
import { readFileSync, unwatchFile, watchFile } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type LoomError, wrap } from "../core/errors.ts";
import { Tex } from "../core/field.ts";
import { seamScore } from "../core/material.ts";
import type { Project } from "../core/project.ts";
import { type MapName, renderBuffer, renderCube, renderMap, renderPlane, renderSphere } from "../core/render.ts";
import { FeedbackError, writeFeedback } from "./feedback.ts";
import { toHex } from "../core/util.ts";
import { loadProject } from "./load.ts";
import { writeOutputs } from "./output.ts";
import { pngOf } from "./preview.ts";

export interface ServeOptions { port?: number; out?: string | false; log?: (line: string) => void }

interface ErrInfo { message: string; loc?: string }
interface MatInfo { name: string; size?: number; seam?: { worst: number; map: string }; loc?: string; changed: boolean; error?: ErrInfo }
interface State { version: number; file: string; time: string; ms: number; error?: ErrInfo; materials: MatInfo[]; nodes: { label: string; loc?: string; kind: string }[]; palette: Record<string, string>; errors: ErrInfo[] }

const viewerDir = join(dirname(fileURLToPath(import.meta.url)), "..", "viewer");
const errInfo = (e: LoomError): ErrInfo => ({ message: e.message, loc: e.loc });
const MAPS = ["albedo", "normal", "height", "rough", "metal", "ao", "emit"];

export function serve(file: string, opts: ServeOptions = {}): Promise<{ url: string; close: () => void }> {
  const abs = resolve(file);
  const out = opts.out === false ? undefined : opts.out ?? join(dirname(abs), "out");
  const log = opts.log ?? ((l: string) => console.log(l));
  const clients = new Set<ServerResponse>();
  let project: Project | undefined;
  let state: State = { version: 0, file: basename(abs), time: "", ms: 0, materials: [], nodes: [], palette: {}, errors: [] };
  const last = new Map<string, string>();
  let watched = new Set<string>();
  let timer: NodeJS.Timeout | undefined;

  const rebuild = () => {
    const t0 = performance.now();
    const next: State = { version: state.version + 1, file: basename(abs), time: new Date().toLocaleTimeString(), ms: 0, materials: [], nodes: [], palette: {}, errors: [] };
    try { project = loadProject(abs); } catch (e) { project = undefined; next.error = errInfo(wrap(e)); }
    if (project) {
      for (const name of project.order) {
        const def = project.materials.get(name)!;
        const info: MatInfo = { name, loc: def.loc, changed: false };
        try {
          const m = project.build(name);
          info.size = m.n;
          info.seam = seamScore(m);
          let h = 0;
          for (let i = 0; i < m.albedo.length; i += 61) h = (h * 31 + Math.round(m.albedo[i] * 1e4 + m.height[Math.floor(i / 3)] * 1e3)) | 0;
          const fp = `${m.n}:${h}`;
          info.changed = last.get(name) !== fp;
          last.set(name, fp);
        } catch (e) { info.error = errInfo(wrap(e, (s) => project!.locFromStack(s))); info.changed = true; last.delete(name); }
        next.materials.push(info);
      }
      next.palette = Object.fromEntries([...project.palette].map(([k, c]) => [k, toHex(...c)]));
      next.nodes = project.nodes.map((n) => ({ label: n.label, loc: n.loc, kind: n.node instanceof Tex ? "tex" : "field" }));
      if (out) {
        const r = writeOutputs(project, out);
        next.errors = r.errors.filter((e) => !next.materials.some((m) => m.error?.message === e.message)).map(errInfo);
      }
      watch(project.files);
    } else watch([abs]);
    next.ms = Math.round(performance.now() - t0);
    state = next;
    const bad = next.error ? 1 : next.materials.filter((m) => m.error).length + next.errors.length;
    log(`[loom] v${next.version} ${next.ms}ms: ${next.materials.length} materials, ${bad} error(s)` + (next.error ? `\n  ${next.error.message}` : ""));
    const msg = `event: build\ndata: ${JSON.stringify(state)}\n\n`;
    for (const c of clients) c.write(msg);
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(rebuild, 80); };
  function watch(files: string[]) {
    const nextSet = new Set(files);
    for (const f of watched) if (!nextSet.has(f)) unwatchFile(f);
    for (const f of nextSet) if (!watched.has(f)) watchFile(f, { interval: 150 }, (a, b) => { if (a.mtimeMs !== b.mtimeMs) schedule(); });
    watched = nextSet;
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x"), q = url.searchParams;
    const int = (k: string, d: number, lo: number, hi: number) => { const v = Number(q.get(k) ?? d); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d; };
    const sendPng = (w: number, h: number, rgba: Uint8Array) => { res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" }); res.end(pngOf(w, h, rgba)); };
    try {
      if (url.pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(readFileSync(join(viewerDir, "index.html"))); }
      else if (url.pathname === "/app.js") { res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" }); res.end(readFileSync(join(viewerDir, "app.js"))); }
      else if (url.pathname === "/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(`event: build\ndata: ${JSON.stringify(state)}\n\n`);
        clients.add(res);
        req.on("close", () => clients.delete(res));
      } else if (url.pathname === "/api/view" && project) {
        const name = q.get("name") ?? "", def = project.materials.get(name);
        if (!def) { res.writeHead(404); res.end("unknown material"); return; }
        const m = project.build(name), size = int("size", 512, 32, 1400), tiles = int("tiles", 3, 1, 8), mode = q.get("mode") ?? "plane";
        const lx = Number(q.get("lx") ?? NaN), ly = Number(q.get("ly") ?? NaN);
        const light = Number.isFinite(lx) && Number.isFinite(ly) ? { dir: [lx, ly, Math.sqrt(Math.max(0.05, 1 - lx * lx - ly * ly))] as [number, number, number] } : {};
        const flipG = def.opts.normal === "dx" ? -1 : 1;
        if (mode === "sphere") sendPng(size, size, renderSphere(m, size, light, flipG));
        else if (mode === "cube") sendPng(size, size, renderCube(m, size, light, flipG));
        else if (mode === "map" && MAPS.includes(q.get("map") ?? "")) sendPng(size, size, renderMap(m, q.get("map") as MapName, size, tiles));
        else sendPng(size, size, renderPlane(m, size, tiles, light, flipG));
      } else if (url.pathname === "/api/node" && project) {
        const node = project.nodes.find((n) => n.label === q.get("label"));
        if (!node) { res.writeHead(404); res.end("unknown node"); return; }
        const size = int("size", 512, 32, 1400), tiles = int("tiles", 3, 1, 8), n = int("n", 256, 16, 1024);
        sendPng(size, size, renderBuffer(node.node.eval(n), n, node.node instanceof Tex ? 3 : 1, size, tiles));
      } else if (url.pathname === "/api/feedback" && req.method === "POST") {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on("data", (d: Buffer) => { size += d.length; if (size > 32 << 20) req.destroy(); else chunks.push(d); });
        req.on("end", () => {
          const reply = (code: number, j: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
          if (!project) return reply(409, { error: "the material file does not build right now" });
          try {
            const r = writeFeedback(project, out ?? join(dirname(abs), "out"), JSON.parse(Buffer.concat(chunks).toString("utf8")));
            log(`[loom] feedback: ${r.summary} -> ${r.files.find((f) => f.endsWith(".json"))}`);
            reply(200, { ok: true, ...r });
          } catch (e) { reply(e instanceof FeedbackError || e instanceof SyntaxError ? 400 : 500, { error: (e as Error).message }); }
        });
        return;
      } else { res.writeHead(404); res.end("not found"); }
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  const ping = setInterval(() => { for (const c of clients) c.write(": ping\n\n"); }, 15000);

  return new Promise((ok, fail) => {
    server.on("error", fail);
    server.listen(opts.port ?? 4350, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : opts.port;
      rebuild();
      ok({ url: `http://127.0.0.1:${port}/`, close: () => { clearInterval(ping); clearTimeout(timer); for (const f of watched) unwatchFile(f); for (const c of clients) c.end(); server.close(); } });
    });
  });
}
