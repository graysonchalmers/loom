// Editor support for loom material files (.tx.ts / .tx.js with // @ts-check).
declare global {
  type Num = number | LoomField;
  type ColorLike = string | LoomTex | LoomField;
  type Scale = number | [number, number];

  interface LoomField {
    add(b: Num): LoomField; sub(b: Num): LoomField; mul(b: Num): LoomField; div(b: Num): LoomField;
    min(b: Num): LoomField; max(b: Num): LoomField; mix(b: Num, t?: Num): LoomField;
    pow(k: number): LoomField; abs(): LoomField; invert(): LoomField; clamp(lo?: number, hi?: number): LoomField;
    levels(inLo?: number, inHi?: number, outLo?: number, outHi?: number): LoomField;
    smooth(lo?: number, hi?: number): LoomField; threshold(t?: number, soft?: number): LoomField; normalize(): LoomField;
    blur(r?: number): LoomField; warp(by: Num, amount?: number, by2?: Num): LoomField;
    offset(du?: number, dv?: number): LoomField; repeat(k: number): LoomField; rotate(deg?: 90 | 180 | 270): LoomField; flip(axis?: "x" | "y"): LoomField;
    edge(k?: number): LoomField; convex(r?: number, k?: number): LoomField; cavity(r?: number, k?: number): LoomField;
    facing(dir?: "up" | "down" | "left" | "right", k?: number): LoomField;
    drips(o?: { length?: number; density?: number; seed?: number }): LoomField;
    as(name: string): this;
  }
  interface LoomTex {
    mix(b: ColorLike, t?: Num): LoomTex; mul(f: Num): LoomTex;
    hsv(o?: { h?: Num; s?: Num; v?: Num }): LoomTex; luma(): LoomField; as(name: string): this;
  }
  interface Pieces extends LoomField { mask: LoomField; id: LoomField; dist: LoomField }

  function pal(colors: Record<string, string>): void;
  function include(path: string): void;
  function material(name: string, channels: Channels): void;
  function material(name: string, opts: { size?: number; depth?: number; normal?: "gl" | "dx"; ao?: number }, channels: Channels): void;
  interface Channels { height?: Num; color?: ColorLike; rough?: Num; metal?: Num; emit?: ColorLike; ao?: Num }

  interface NoiseOpts { scale?: Scale; octaves?: number; gain?: number; lacunarity?: number; seed?: number }
  function noise(o?: NoiseOpts): LoomField;
  function ridged(o?: NoiseOpts): LoomField;
  function cells(o?: { scale?: Scale; jitter?: number; seed?: number }): LoomField & { edge: LoomField; id: LoomField };
  function dots(o?: { scale?: Scale; radius?: number; jitter?: number; soft?: number; seed?: number }): LoomField;
  interface MasonOpts { rows?: number; cols?: number; gap?: number; bevel?: number; offset?: number; vary?: number; wobble?: number; seed?: number }
  function bricks(o?: MasonOpts): Pieces;
  function tiles(o?: MasonOpts): Pieces;
  function hex(o?: { cols?: number; gap?: number; bevel?: number; vary?: number; seed?: number }): Pieces;
  function planks(o?: { rows?: number; per?: number; gap?: number; bevel?: number; vary?: number; grain?: number; seed?: number }): LoomField & { mask: LoomField; id: LoomField; grain: LoomField };
  function scales(o?: { rows?: number; cols?: number; size?: number; seed?: number }): LoomField & { id: LoomField };
  function stripes(o?: { count?: number; dir?: "h" | "v"; soft?: number }): LoomField;
  function waves(o?: { count?: number; dir?: "h" | "v"; warp?: number; scale?: Scale; seed?: number }): LoomField;
  function weave(o?: { threads?: number; gap?: number; seed?: number }): LoomField & { mask: LoomField };
  function checker(o?: { cols?: number; rows?: number }): LoomField;
  function shape(o?: { kind?: "circle" | "rect" | "ngon" | "star" | "ring" | "line"; cx?: number; cy?: number; r?: number; w?: number; h?: number; sides?: number; inner?: number; round?: number; rot?: number; soft?: number; x0?: number; y0?: number; x1?: number; y1?: number }): LoomField;
  function image(src: string, o?: { seamless?: number }): LoomTex;
  function color(hex: string): LoomTex;
  function ramp(f: LoomField, stops: (string | [number, string])[]): LoomTex;
}
export {};
