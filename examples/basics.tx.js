// loom basics: a brick wall built up from a pattern, noise and weathering masks.
pal({ brick: "#8e4a35", brickL: "#b46a4c", brickD: "#5e2c22", mortar: "#9c968a", grime: "#2b2622", moss: "#4c6a2c" })

const b = bricks({ rows: 10, cols: 4, gap: 0.014, bevel: 0.018, wobble: 0.5, seed: 3 }).as("bricks")
const grain = noise({ scale: 24, octaves: 4, seed: 2 }).as("grain")
const chips = ridged({ scale: 12, octaves: 3, seed: 5 }).threshold(0.86, 0.06).mul(b.mask).as("chips")

const height = b.mul(0.85).add(grain.mul(0.12)).sub(chips.mul(0.25)).as("height")
const grime = height.cavity(0.006, 18).max(b.mask.invert().mul(0.6)).as("grime")
const moss = height.facing("up", 4).mul(noise({ scale: 6, seed: 9 }).threshold(0.55, 0.2)).mul(b.mask).as("moss")

material("brick_wall", { size: 512, depth: 0.05 }, {
  height,
  color: ramp(b.id.mix(grain, 0.35), ["brickD", "brick", "brickL"]).mix("mortar", b.mask.invert())
    .mix("grime", grime.mul(0.7)).mix("moss", moss.mul(0.85)),
  rough: grain.levels(0, 1, 0.75, 0.95).mix(0.6, moss),
})
