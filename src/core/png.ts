// PNG encoder: 8-bit RGB/RGBA/gray and 16-bit gray (for height maps). zlib comes from the host.
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
}

/** channels: 1 (gray), 3 (RGB) or 4 (RGBA); depth 8 or 16. `px` holds w*h*channels samples. */
export function png(w: number, h: number, px: Uint8Array | Uint16Array, channels: 1 | 3 | 4, deflate: (b: Uint8Array) => Uint8Array, depth: 8 | 16 = 8): Uint8Array {
  const bpp = channels * (depth / 8), row = w * bpp, raw = new Uint8Array(h * (row + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (row + 1)] = 0;
    for (let i = 0; i < w * channels; i++) {
      const v = px[y * w * channels + i], o = y * (row + 1) + 1 + i * (depth / 8);
      if (depth === 16) { raw[o] = v >>> 8; raw[o + 1] = v & 255; } else raw[o] = v;
    }
  }
  const ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer);
  v.setUint32(0, w); v.setUint32(4, h);
  ihdr[8] = depth; ihdr[9] = channels === 1 ? 0 : channels === 3 ? 2 : 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflate(raw)), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
