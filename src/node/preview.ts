// Agent-facing preview sheet: the material lit on a tiled plane, a sphere and a cube, and every
// map in a strip, with the name, size and seam check in the header.
import { deflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";
import type { Maps } from "../core/material.ts";
import { png } from "../core/png.ts";
import { type MapName, renderCube, renderMap, renderPlane, renderSphere } from "../core/render.ts";

export const pngOf = (w: number, h: number, rgba: Uint8Array) => Buffer.from(png(w, h, rgba, 4, (b) => deflateSync(b)));
const uri = (w: number, h: number, rgba: Uint8Array) => "data:image/png;base64," + pngOf(w, h, rgba).toString("base64");

export function previewSheet(name: string, m: Maps, seam: { worst: number; map: string }, flipG = 1): Buffer {
  const big = 360, thumb = 112, gap = 10, top = 34;
  const maps: MapName[] = ["albedo", "normal", "height", "rough", "metal", "ao", ...(m.emit ? ["emit" as MapName] : [])];
  const W = gap + (big + gap) * 3, H = top + big + gap + 18 + thumb + gap;
  let body = "";
  [["tiled 3×3, raking light", renderPlane(m, big, 3, {}, flipG)], ["sphere", renderSphere(m, big, {}, flipG)], ["cube", renderCube(m, big, {}, flipG)]].forEach(([label, img], i) => {
    const x = gap + i * (big + gap);
    body += `<image x="${x}" y="${top}" width="${big}" height="${big}" href="${uri(big, big, img as Uint8Array)}"/>` +
      `<text x="${x + 8}" y="${top + 18}" fill="#e9e5f2" font-size="12" font-family="monospace" style="paint-order:stroke" stroke="#000" stroke-width="3">${label}</text>`;
  });
  maps.forEach((mp, i) => {
    const x = gap + i * (thumb + gap), y = top + big + gap + 18;
    body += `<image x="${x}" y="${y}" width="${thumb}" height="${thumb}" href="${uri(thumb, thumb, renderMap(m, mp, thumb, 1))}"/>` +
      `<text x="${x}" y="${y - 5}" fill="#b9b3c9" font-size="11" font-family="monospace">${mp}</text>`;
  });
  const seamTxt = seam.worst <= 1.5 ? `seamless (${seam.worst})` : `SEAM ${seam.worst}× in ${seam.map}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#14131b"/>` +
    `<text x="${gap}" y="22" fill="#e9e5f2" font-size="14" font-weight="bold" font-family="monospace">${name}</text>` +
    `<text x="${W - gap}" y="22" fill="${seam.worst <= 1.5 ? "#b9b3c9" : "#ff6b7a"}" font-size="12" font-family="monospace" text-anchor="end">${m.n}×${m.n}  ${seamTxt}</text>` +
    body + `</svg>`;
  return Buffer.from(new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng());
}
