// Renders docs/media/gallery.png (every showcase material on a lit sphere) and docs/media/tiled.png
// (each one tiled 3×3 under a raking light). Run: node scripts/gallery.ts
import { writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { renderPlane, renderSphere } from "../src/core/render.ts";
import { loadProject } from "../src/node/load.ts";
import { pngOf } from "../src/node/preview.ts";

const p = loadProject("showcase/materials.tx.js"), names = p.order;
const uri = (w: number, h: number, rgba: Uint8Array) => "data:image/png;base64," + pngOf(w, h, rgba).toString("base64");
const sheet = (file: string, cell: number, cols: number, draw: (name: string) => Uint8Array) => {
  const rows = Math.ceil(names.length / cols), gap = 14, lab = 22, W = gap + cols * (cell + gap), H = gap + rows * (cell + lab + gap);
  let body = "";
  names.forEach((n, i) => {
    const x = gap + (i % cols) * (cell + gap), y = gap + Math.floor(i / cols) * (cell + lab + gap);
    body += `<image x="${x}" y="${y}" width="${cell}" height="${cell}" href="${uri(cell, cell, draw(n))}"/>` +
      `<text x="${x + cell / 2}" y="${y + cell + 16}" fill="#c9c3dd" font-size="13" font-family="monospace" text-anchor="middle">${n}</text>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#14131b"/>${body}</svg>`;
  writeFileSync(file, new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng());
  console.log(file);
};
const flip = (n: string) => (p.materials.get(n)!.opts.normal === "dx" ? -1 : 1);
sheet("docs/media/gallery.png", 280, 4, (n) => renderSphere(p.build(n), 280, {}, flip(n)));
sheet("docs/media/tiled.png", 280, 4, (n) => renderPlane(p.build(n), 280, 3, {}, flip(n)));
