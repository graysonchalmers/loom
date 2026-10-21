// loom showcase: game-ready seamless materials, each built from patterns, noise and weathering.
pal({
  brick: "#8e4a35", brickL: "#b46a4c", brickD: "#5e2c22", mortar: "#9c968a", grime: "#2b2622", moss: "#4c6a2c",
  paint: "#3e6b78", paintL: "#5b8d99", steel: "#8d9399", rust: "#8a4422", rustL: "#c26a32", rustD: "#4a2312",
  stone: "#6f6c66", stoneL: "#a39b8e", stoneD: "#3f3b37", mud: "#3a3128", water: "#161b1f",
  wood: "#7a4f2e", woodL: "#b07b4c", woodD: "#3e2414",
  panel: "#3a4048", panelL: "#5a626c", panelD: "#22262c", glow: "#2ee6ff", glowD: "#0a4a5a",
  basalt: "#2a2524", basaltL: "#4a4240", lava: "#ff6a1a", lavaL: "#ffd84a", lavaD: "#8a1a0a",
  scale: "#1f5a4a", scaleL: "#4aa07a", scaleD: "#0e2a24", gold: "#c9a24a",
  conc: "#8a8780", concL: "#aaa69d", concD: "#5d5a55", stain: "#4a4238",
})

// ---------------------------------------------------------------- brick wall
{
  const b = bricks({ rows: 10, cols: 4, gap: 0.014, bevel: 0.02, wobble: 0.5, seed: 3 }).as("bricks")
  const grain = noise({ scale: 24, octaves: 4, seed: 2 })
  const chips = ridged({ scale: 12, octaves: 3, seed: 5 }).threshold(0.9, 0.05).mul(b.mask)
  const height = b.mul(0.85).add(grain.mul(0.1)).sub(chips.mul(0.18))
  const grime = height.cavity(0.006, 16).max(b.mask.invert().mul(0.5))
  const moss = height.facing("up", 4).mul(noise({ scale: 6, seed: 9 }).threshold(0.58, 0.2)).mul(b.mask).as("brick moss")
  material("brick_wall", { size: 512, depth: 0.03 }, {
    height,
    color: ramp(b.id.mix(grain, 0.35), ["brickD", "brick", "brickL"]).mix("mortar", b.mask.invert())
      .mix("grime", grime.mul(0.6)).mix("moss", moss.mul(0.85)),
    rough: grain.levels(0, 1, 0.75, 0.95).mix(0.6, moss),
  })
}

// ---------------------------------------------------------------- rusty painted metal panels
{
  const p = tiles({ rows: 2, cols: 2, gap: 0.006, bevel: 0.01, vary: 0.04, seed: 4 }).as("panels")
  const rivets = dots({ scale: 16, radius: 0.2, jitter: 0, soft: 0.07 }).mul(p.dist.threshold(0.2, 0.04).invert()).mul(p.mask).as("rivets")
  const wear = noise({ scale: 8, octaves: 5, seed: 7 }).warp(noise({ scale: 4, seed: 8 }), 0.08)
  // paint flakes off first at the panel edges and around the rivets
  const exposed = wear.add(p.dist.invert().mul(0.35)).add(rivets.mul(0.4)).threshold(0.78, 0.04).as("bare metal")
  const rustIn = p.mask.invert().max(exposed).blur(0.004).threshold(0.3, 0.3)
  const rust = rustIn.max(rustIn.drips({ length: 0.1, density: 0.3, seed: 3 }).mul(0.6)).mul(noise({ scale: 20, seed: 9 }).levels(0.2, 0.8, 0.4, 1)).as("rust")
  const height = p.mul(0.5).add(rivets.mul(0.35)).sub(exposed.mul(0.06)).add(rust.mul(noise({ scale: 48, seed: 3 }).mul(0.05)))
  material("rusty_panels", { size: 512, depth: 0.03 }, {
    height,
    color: ramp(wear, ["paint", "paintL"]).mix("steel", exposed).mix(ramp(noise({ scale: 32, seed: 5 }), ["rustD", "rust", "rustL"]), rust),
    rough: exposed.mix(0.55, 0.35).mix(0.9, rust),
    metal: exposed.mul(rust.invert()),
  })
}

// ---------------------------------------------------------------- wet cobblestone
{
  const c = cells({ scale: 7, jitter: 0.85, seed: 11 })
  const stones = c.edge.smooth(0.04, 0.24).as("stones")
  const bumps = noise({ scale: 16, octaves: 5, seed: 12 })
  const height = stones.mul(c.id.levels(0, 1, 0.75, 1)).mul(0.8).add(bumps.mul(0.15).mul(stones))
  const gaps = stones.invert()
  const puddle = gaps.blur(0.02).mul(1.6).add(noise({ scale: 3, seed: 13 }).sub(0.5).mul(1.2)).threshold(0.55, 0.06).as("puddles")
  material("wet_cobblestone", { size: 512, depth: 0.045 }, {
    height: height.mix(0.18, puddle),
    color: ramp(c.id.mix(bumps, 0.4), ["stoneD", "stone", "stoneL"]).hsv({ h: c.id.levels(0, 1, -12, 14), s: c.id.levels(0, 1, 0.8, 1.6) })
      .mul(height.convex(0.008, 10).levels(0, 1, 1, 1.25)).mix("mud", gaps.mul(0.85)).mix("water", puddle.mul(0.75)),
    rough: bumps.levels(0, 1, 0.55, 0.8).mix(0.05, puddle).mix(0.9, gaps.mul(puddle.invert())),
  })
}

// ---------------------------------------------------------------- worn wood planks
{
  const w = planks({ rows: 6, per: 2, gap: 0.006, bevel: 0.012, seed: 21 }).as("planks")
  const rings = w.grain.as("grain")
  const scuffs = noise({ scale: 10, octaves: 4, seed: 22 }).threshold(0.7, 0.2).mul(w.mask)
  material("wood_planks", { size: 512, depth: 0.02 }, {
    height: w.mul(0.7).add(rings.mul(0.25)).sub(scuffs.mul(0.05)),
    color: ramp(rings.levels(0.25, 0.75).mix(w.id, 0.3), [[0, "woodD"], [0.45, "wood"], [1, "woodL"]]).hsv({ h: w.id.levels(0, 1, -6, 6), v: w.id.levels(0, 1, 0.8, 1.1) })
      .mul(w.mask.levels(0, 1, 0.3, 1)).hsv({ v: scuffs.levels(0, 1, 1, 1.15) }),
    rough: rings.levels(0, 1, 0.5, 0.75).mix(0.85, scuffs),
  })
}

// ---------------------------------------------------------------- sci-fi panel with glowing strips
{
  const t = tiles({ rows: 4, cols: 2, gap: 0.01, bevel: 0.008, vary: 0.05, seed: 31 }).as("plates")
  const grooves = stripes({ count: 16, dir: "h", soft: 0.05 }).threshold(0.92, 0.02).mul(t.dist.threshold(0.12, 0.02))
  const strip = t.dist.levels(0.08, 0.1).sub(t.dist.levels(0.12, 0.14)).max(0).mul(t.id.threshold(0.45)).as("light strips")
  const scratches = ridged({ scale: [2, 28], octaves: 3, seed: 32 }).threshold(0.88, 0.04).mul(noise({ scale: 6, seed: 34 }).threshold(0.55, 0.2))
  material("scifi_panel", { size: 512, depth: 0.025 }, {
    height: t.mul(0.6).sub(grooves.mul(0.08)).sub(strip.mul(0.1)),
    color: ramp(t.id.mix(noise({ scale: 12, seed: 33 }), 0.3), ["panelD", "panel", "panelL"]).mix("glowD", strip).mix("panelL", scratches.mul(0.5)),
    rough: scratches.mix(0.35, 0.6).mix(0.2, strip),
    metal: strip.invert().mul(0.85),
    emit: ramp(strip, ["#000000", "glow"]),
  })
}

// ---------------------------------------------------------------- lava rock
{
  const c = cells({ scale: 5, jitter: 1, seed: 41 })
  const crust = c.edge.smooth(0.02, 0.18).mul(noise({ scale: 10, octaves: 5, seed: 42 }).levels(0.2, 0.8, 0.7, 1)).as("crust")
  const heat = crust.invert().blur(0.01).max(crust.invert()).as("heat")
  material("lava_rock", { size: 512, depth: 0.05 }, {
    height: crust.mul(0.9).add(ridged({ scale: 20, octaves: 3, seed: 43 }).mul(0.1).mul(crust)),
    color: ramp(crust, ["lavaD", "basalt", "basaltL"]).mix("basalt", crust.mul(0.3)),
    rough: crust.levels(0, 1, 0.4, 0.92),
    emit: ramp(heat, [[0, "#000000"], [0.4, "lavaD"], [0.75, "lava"], [1, "lavaL"]]),
  })
}

// ---------------------------------------------------------------- dragon scales
{
  const s = scales({ cols: 8, seed: 51 }).as("scales")
  const sheen = s.id.mix(noise({ scale: 6, seed: 52 }), 0.5)
  material("dragon_scales", { size: 512, depth: 0.04 }, {
    height: s.mul(0.9).add(noise({ scale: 40, octaves: 3, seed: 53 }).mul(0.06)),
    color: ramp(s, ["scaleD", "scale", "scaleL"]).hsv({ h: sheen.levels(0, 1, -25, 25), s: s.levels(0, 1, 1.3, 0.9) }).mix("gold", s.edge(10).mul(0.35)),
    rough: s.levels(0, 1, 0.55, 0.25),
    metal: s.mul(0.35),
  })
}

// ---------------------------------------------------------------- stained concrete (the LAST CUP cafe floor)
{
  const pour = noise({ scale: 3, octaves: 6, gain: 0.55, seed: 61 }).as("pour")
  const pits = cells({ scale: 40, jitter: 1, seed: 62 }).threshold(0.08, 0.04).invert().mul(noise({ scale: 8, seed: 63 }).threshold(0.5, 0.3)).as("pits")
  const seams = tiles({ rows: 2, cols: 2, gap: 0.004, bevel: 0.003, vary: 0 }).mask.invert()
  const stains = noise({ scale: 4, octaves: 4, seed: 64 }).warp(noise({ scale: 2, seed: 65 }), 0.2).threshold(0.64, 0.2).as("stains")
  const wet = stains.blur(0.02).threshold(0.4, 0.2)
  material("stained_concrete", { size: 512, depth: 0.012 }, {
    height: pour.mul(0.3).add(0.5).sub(pits.mul(0.3)).sub(seams.mul(0.4)),
    color: ramp(pour, ["concD", "conc", "concL"]).mix("stain", stains.mul(0.55)).mix("concD", pits.mul(0.7)).mix("#2e2c2a", seams),
    rough: pour.levels(0, 1, 0.75, 0.92).mix(0.32, wet.mul(0.8)),
  })
}
