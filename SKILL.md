---
name: loom-textures
description: Create seamless game textures and PBR materials (bricks, stone, cobblestone, wood, metal, rust, concrete, scales, sci-fi panels, lava, ground) with loom, a compact JavaScript DSL that writes albedo, normal, height, roughness, metallic, AO, ORM and emissive maps plus lit previews, with a live viewer. Use when asked to make, design or iterate on textures or materials for a game or a 3D scene.
---

# loom: textures and materials as code

You write a small `.tx.js` file of fields (noise, cells, bricks, planks, ...) combined with
operators and weathering masks; loom writes every map a game engine needs and a preview you can
read. Every generator and operator tiles, so **materials are seamless by construction**. Needs
Node ≥ 22.18 and `npm install` once in this skill's directory.

`LOOM` below means `node <this skill's directory>/bin/loom.js`.

## Workflow

1. Write `materials.tx.js` (template below; more in `examples/` and `showcase/`).
2. Build: `LOOM build materials.tx.js --only brick_wall`. It prints `seamless` or `SEAM n× in map`
   (the jump across the tile edge vs the worst step inside; anything over ~1.5 is a real seam).
3. **Look at it**: read `out/_preview/<name>.png`: tiled 3×3 under a raking light (repeats and
   relief), a lit sphere and cube (how it reads on a model), and every map. `LOOM info file <name>`
   prints value ranges per map: check roughness isn't flat 0.7 everywhere and albedo isn't too dark
   (keep the luma mean around 0.25–0.6 for most real materials).
4. Name intermediate fields with `.as("grime")`: they show up in the viewer and in `LOOM list`, and
   feedback reports their values.
5. If the user wants to watch: start `LOOM serve materials.tx.js` in the background and give them
   the URL. It rebuilds on save; views: lit plane, sphere, cube, each map, each named field; drag to
   move the light. **Feedback**: annotate mode (`a`) lets the user draw on the texture and pin notes,
   then send them. When they say "check the feedback", read `out/_feedback/<material>.json`: notes
   and strokes are in texture pixels; each note's `at` holds the albedo, height, rough, metal, AO and
   the value of every named field at that pixel (so you can see which layer to change). Strokes with
   `kind: "palette"` and a `key` mean "make this that color". Look at `<material>.annotated.png` too.
   Comments persist between sends: check `time`.

Errors name file:line:col and suggest fixes ("did you mean 'cols'?"). Periods, repeats and row
counts must be whole numbers: anything else would break the tiling, and loom refuses it.

## Template

```js
pal({ brick: "#8e4a35", brickL: "#b46a4c", brickD: "#5e2c22", mortar: "#9c968a", grime: "#2b2622" })

const b = bricks({ rows: 10, cols: 4, gap: 0.014, bevel: 0.02, wobble: 0.5, seed: 3 }).as("bricks")
const grain = noise({ scale: 24, octaves: 4 })
const height = b.mul(0.85).add(grain.mul(0.1))
const grime = height.cavity(0.006, 16).max(b.mask.invert().mul(0.5)).as("grime")

material("brick_wall", { size: 512, depth: 0.03 }, {
  height,
  color: ramp(b.id.mix(grain, 0.35), ["brickD", "brick", "brickL"]).mix("mortar", b.mask.invert()).mix("grime", grime.mul(0.6)),
  rough: grain.levels(0, 1, 0.75, 0.95),
})
```

## Essentials

- **Fields** are values over the tile (u, v in 0..1, v down). Generators: `noise ridged cells dots
  bricks tiles hex planks scales stripes waves weave checker shape`. Patterns expose parts: `b.mask` (1 brick, 0 mortar),
  `b.id` (random per piece: vary tone/height per brick), `b.dist` (0 at the edge, 1 in the middle),
  `planks().grain`, `cells().edge`, `weave().mask`. `shape({ kind: "star", r: 0.3 })` is a decal mask
  (circle, rect, ngon, star, ring, line) for markings, rims, runes and logos.
- **From an image**: `image("photo.png", { seamless: 0.25 })` is a photo or painted texture as a color
  (blended at the edges so it tiles); `image("h.png").luma()` is a height map. Mix them with generated
  detail (`.mix(ramp(...), mask)`, grime in `cavity()` of the luma) for photo-based PBR materials.
- **Ops** chain: `add sub mul div min max mix(b, t) pow abs invert clamp levels smooth threshold
  normalize`, space: `blur(r) warp(f, amount) offset repeat(k) rotate flip`, reading height:
  `edge() convex(r) cavity(r) facing("up") drips({ length })`. Numbers are accepted anywhere.
- **Color**: `ramp(field, ["#a", "#b", "#c"])` or `[[0, "#a"], [0.7, "#b"], [1, "#c"]]`, `color("#x")`,
  then `.mix(other, mask) .mul(field) .hsv({ h, s, v }) .luma()`; strings can be `pal()` names.
- **material(name, { size, depth, normal, ao }, { height, color, rough, metal, emit, ao })**: normal
  and AO come from height. `depth` is how deep the relief reads (0.01 flat concrete … 0.05 bricks).
  `normal: "dx"` for Unreal/DirectX (default "gl": Blender, Godot, Unity).

## Habits that give good materials

- **Build height first, then derive everything from it.** Color, roughness and grime should follow
  the same shapes: mortar is darker *and* rougher *and* lower; worn edges are lighter and shinier.
- **Weathering has causes.** Grime in `cavity()`, wear on `convex()` / `b.dist` edges, moss and dust
  on `facing("up")`, rust `drips()` below seams, puddles where `blur()` of the gaps is high. Mask
  every effect with noise so it's patchy, never uniform.
- **Vary per piece** with `.id`: each brick/plank/stone gets its own tone (`ramp(b.id.mix(noise, 0.3))`),
  small hue shifts (`hsv({ h: id.levels(0, 1, -8, 8) })`) and height (`vary`).
- **Three scales of detail**: big shapes (the pattern), medium (chips, stains, `warp`ed noise) and fine
  (high-`scale` noise at low amplitude). Missing the middle looks plastic; only fine looks like noise.
- **Roughness is not constant.** Wet, polished and metal areas go down (0.05–0.35), dust and mortar up
  (0.85–0.95). Metal is 0 or 1 in a material (rust and paint are not metal).
- Albedo carries no lighting: don't paint shadows into color beyond a little cavity darkening; the
  normal and AO maps do the shading.

Full API: [reference.md](reference.md).
