// Feedback from the live viewer: strokes and notes on a material, in texture pixels. Each note
// carries what the material is at that pixel (color, height, roughness, ...) and the value of every
// named field there, so an agent can tell which layer to change.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Tex } from "../core/field.ts";
import type { Project } from "../core/project.ts";
import { toHex } from "../core/util.ts";

export class FeedbackError extends Error {}

const MAX_ITEMS = 400, MAX_POINTS = 20000, MAX_TEXT = 4000;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Validate and write `<out>/_feedback/<name>.{json,annotated.png}`. */
export function writeFeedback(p: Project, out: string, body: unknown): { files: string[]; summary: string } {
  if (typeof body !== "object" || body === null) throw new FeedbackError("feedback must be a JSON object");
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" && p.materials.has(b.name) ? b.name : undefined;
  if (!name) throw new FeedbackError(`unknown material ${JSON.stringify(b.name)}`);
  const m = p.build(name), n = m.n;
  const inTile = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n;
  const text = (s: unknown) => (typeof s === "string" ? s.slice(0, MAX_TEXT) : "");
  const color = (s: unknown) => (typeof s === "string" && /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : "#ff3df0");

  const notes = (Array.isArray(b.notes) ? b.notes : []).slice(0, MAX_ITEMS).flatMap((q) =>
    q && num(q.x) && num(q.y) && inTile(q.x, q.y) && typeof q.text === "string" ? [{ x: Math.floor(q.x), y: Math.floor(q.y), text: text(q.text) }] : []);
  let total = 0;
  const strokes = (Array.isArray(b.strokes) ? b.strokes : []).slice(0, MAX_ITEMS).flatMap((s) => {
    if (!s || !Array.isArray(s.points)) return [];
    const pts = (s.points as unknown[]).filter((q): q is number[] => Array.isArray(q) && num(q[0]) && num(q[1]) && inTile(q[0], q[1])).map((q) => [Math.floor(q[0]), Math.floor(q[1])]);
    if (!pts.length || (total += pts.length) > MAX_POINTS) return [];
    return [{ color: color(s.color), width: num(s.width) ? Math.max(1, Math.min(n, s.width)) : 2, points: pts }];
  });
  const comment = text(b.comment);

  // what the material and each named field are at a pixel
  const nodeBufs = p.nodes.map((nd) => ({ label: nd.label, loc: nd.loc ?? null, tex: nd.node instanceof Tex, buf: nd.node.eval(n) }));
  const at = (x: number, y: number) => {
    const i = y * n + x, a = m.albedo;
    return {
      albedo: toHex(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]), height: r3(m.height[i]), rough: r3(m.rough[i]), metal: r3(m.metal[i]), ao: r3(m.ao[i]),
      fields: nodeBufs.map((f) => ({ label: f.label, loc: f.loc, value: f.tex ? toHex(f.buf[i * 3], f.buf[i * 3 + 1], f.buf[i * 3 + 2]) : r3(f.buf[i]) })),
    };
  };
  const keyOf = new Map([...p.palette].map(([k, c]) => [toHex(...c), k]));

  const dir = join(out, "_feedback");
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  const put = (file: string, data: string | Buffer) => { const path = join(dir, file); writeFileSync(path, data); files.push(path); };
  const hasPng = typeof b.annotated === "string" && b.annotated.startsWith("data:image/png;base64,");
  if (hasPng) put(`${name}.annotated.png`, Buffer.from((b.annotated as string).slice(22), "base64"));
  put(`${name}.json`, JSON.stringify({
    material: name, size: n, units: "texture pixels (0..size); uv = pixel / size, v down", time: new Date().toISOString(), comment,
    notes: notes.map((q, i) => ({ n: i + 1, x: q.x, y: q.y, uv: [r3((q.x + 0.5) / n), r3((q.y + 0.5) / n)], text: q.text, at: at(q.x, q.y) })),
    strokes: strokes.map((s, i) => {
      const xs = s.points.map((q) => q[0]), ys = s.points.map((q) => q[1]), key = keyOf.get(s.color) ?? null;
      const mid = s.points[Math.floor(s.points.length / 2)];
      return { n: i + 1, color: s.color, key, kind: key === null ? "markup" : "palette", width: s.width,
        bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], points: s.points, middle: at(mid[0], mid[1]) };
    }),
    images: { annotated: hasPng ? `${name}.annotated.png` : null },
  }, null, 1) + "\n");
  return { files, summary: `${notes.length} note${notes.length === 1 ? "" : "s"}, ${strokes.length} stroke${strokes.length === 1 ? "" : "s"}${comment ? ", a comment" : ""}` };
}
