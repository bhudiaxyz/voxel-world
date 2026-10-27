/**
 * ART BIBLE — the single source of truth for the look of VoxelWorld.
 *
 * Every module reads colour from here. Do not hardcode a hex anywhere else;
 * if you need a new colour, add it here so the whole world stays cohesive.
 *
 * All environmental colours (sky, atmosphere, grass, foliage, stone, water,
 * petals, grade) live in VOXEL_PALETTES. setVoxelPalette() is called at
 * module initialisation to apply the default palette, and again whenever the
 * player switches palettes at runtime.
 *
 * Non-palette colours (wood, accent blocks, UI chrome) may remain hardcoded
 * here — they are intentional constants, not palette choices.
 *
 * Every block is drawn with a thin ink outline (see core/voxel.ts): a
 * darker stroke of its own face colour along every voxel edge.
 */

import * as THREE from 'three';

// Hex input is sRGB; current Three.js converts it to the linear working space.
const c = (hex: any) => new THREE.Color(hex);
const z = () => new THREE.Color(0);   // placeholder — filled by setVoxelPalette

/* ------------------------------------------------------------------ *
 * Atmosphere  (initialised to zero; filled by setVoxelPalette)
 * ------------------------------------------------------------------ */
export const SKY = {
  zenith:  z(),
  horizon: z(),
  ground:  z(),
  haze:    z(),
  sunTint: z(),
};

export const LIGHT = {
  sunColor:      z(),
  sunIntensity:  0,
  sunDir:        new THREE.Vector3(-0.55, 0.78, -0.32).normalize(),
  skyColor:      z(),
  groundColor:   z(),
  hemiIntensity: 0,
  ambient:       0,
  fillColor:     z(),
  fillIntensity: 0,
};

export const FOG = {
  color:        SKY.haze,   // shared reference — always matches haze
  near:         74,
  far:          248,
  heightTop:    30,
  heightFalloff: 0.055,
  density:      0.92,
};

/* ------------------------------------------------------------------ *
 * Surface patterns — consumed by the voxel shader in core/voxel.ts
 * ------------------------------------------------------------------ */
export const PATTERN = {
  NONE:  0,
  BRICK: 1,
  STONE: 2,
  PLANK: 3,
  BARK:  4,
  GRASS: 5,
  TILE:  6,
};

/* ------------------------------------------------------------------ *
 * Block library
 * ------------------------------------------------------------------ */
const B = (id: any, def: any) => ({ id, pattern: PATTERN.NONE, fringe: 0, rough: 0.35, sway: false, ...def });

export const BLOCKS = {
  AIR: { id: 0 },

  /* --- ground (palette-driven — colours zeroed, set by setVoxelPalette) --- */
  GRASS: B(1, {
    top: z(), side: z(), bottom: z(), tint: z(), topTint: z(), fringeColor: z(),
    pattern: PATTERN.NONE, topPattern: PATTERN.NONE, fringe: 0,
    grassCap: true, lightEdge: true, rough: 0.5,
  }),
  GRASS_LIGHT: B(2, {
    top: z(), side: z(), bottom: z(), tint: z(), topTint: z(), fringeColor: z(),
    pattern: PATTERN.NONE, topPattern: PATTERN.NONE, fringe: 0,
    grassCap: true, lightEdge: true, rough: 0.5,
  }),
  GRASS_DEEP: B(3, {
    top: z(), side: z(), bottom: z(), tint: z(), topTint: z(), fringeColor: z(),
    pattern: PATTERN.NONE, topPattern: PATTERN.NONE, fringe: 0,
    grassCap: true, lightEdge: true, rough: 0.5,
  }),
  GRASS_STONE: B(6, {
    top: z(), side: z(), bottom: z(), tint: z(), topTint: z(), fringeColor: z(),
    pattern: PATTERN.NONE, topPattern: PATTERN.NONE, fringe: 0,
    grassCap: true, stoneSubstrate: true, lightEdge: true, rough: 0.52,
  }),
  GRASS_LIGHT_STONE: B(7, {
    top: z(), side: z(), bottom: z(), tint: z(), topTint: z(), fringeColor: z(),
    pattern: PATTERN.NONE, topPattern: PATTERN.NONE, fringe: 0,
    grassCap: true, stoneSubstrate: true, lightEdge: true, rough: 0.52,
  }),
  GRASS_DEEP_STONE: B(8, {
    top: z(), side: z(), bottom: z(), tint: z(), topTint: z(), fringeColor: z(),
    pattern: PATTERN.NONE, topPattern: PATTERN.NONE, fringe: 0,
    grassCap: true, stoneSubstrate: true, lightEdge: true, rough: 0.52,
  }),
  SOIL: B(4, {
    top: z(), side: z(), bottom: z(), tint: z(),
    pattern: PATTERN.NONE, rough: 0.55,
  }),
  SAND: B(5, {
    top: z(), side: z(), bottom: z(), tint: z(),
    pattern: PATTERN.NONE, rough: 0.4,
  }),

  /* --- rock (palette-driven) ----------------------------------------- */
  STONE: B(10, {
    top: z(), side: z(), bottom: z(), tint: z(),
    pattern: PATTERN.NONE, rough: 0.6,
  }),
  STONE_PALE: B(11, {
    top: z(), side: z(), bottom: z(), tint: z(),
    pattern: PATTERN.NONE, rough: 0.5,
  }),
  STONE_WARM: B(12, {
    top: z(), side: z(), bottom: z(), tint: z(),
    pattern: PATTERN.NONE, rough: 0.55,
  }),

  /* --- path (neutral constant — not palette-driven) ------------------- */
  PATH: B(13, {
    top: c(0x8a8070), side: c(0x7e7464), bottom: c(0x6e6454), tint: c(0x847a68),
    pattern: PATTERN.NONE, rough: 0.45,
  }),

  /* --- wood (structural constants — not palette-driven) --------------- */
  PLANK: B(20, {
    top: c(0xb8824a), side: c(0xa87840), bottom: c(0x946830), tint: c(0xa07038),
    pattern: PATTERN.PLANK, rough: 0.5,
  }),
  PLANK_PALE: B(21, {
    top: c(0xc89060), side: c(0xb88450), bottom: c(0xa07040), tint: c(0xb07c48),
    pattern: PATTERN.PLANK, rough: 0.45,
  }),
  BEAM: B(22, {
    top: c(0x8a5a28), side: c(0x7a5020), bottom: c(0x6a4018), tint: c(0x724a18),
    pattern: PATTERN.BARK, rough: 0.5,
  }),
  TRUNK: B(23, {
    top: c(0x4a3020), side: c(0x3e2818), bottom: c(0x342010), tint: c(0x362212),
    pattern: PATTERN.BARK, rough: 0.65,
  }),
  TRUNK_PALE: B(24, {
    top: c(0x5a3828), side: c(0x4e3020), bottom: c(0x3e2818), tint: c(0x482a18),
    pattern: PATTERN.BARK, rough: 0.6,
  }),

  /* --- foliage (palette-driven) --------------------------------------- */
  LEAF_PINK:  B(30, { top: z(), side: z(), bottom: z(), tint: z(), pattern: PATTERN.NONE, rough: 0.22, sway: true }),
  LEAF_BLUSH: B(31, { top: z(), side: z(), bottom: z(), tint: z(), pattern: PATTERN.NONE, rough: 0.2,  sway: true }),
  LEAF_LILAC: B(32, { top: z(), side: z(), bottom: z(), tint: z(), pattern: PATTERN.NONE, rough: 0.22, sway: true }),
  LEAF_CREAM: B(33, { top: z(), side: z(), bottom: z(), tint: z(), pattern: PATTERN.NONE, rough: 0.2,  sway: true }),
  LEAF_MINT:  B(34, { top: z(), side: z(), bottom: z(), tint: z(), pattern: PATTERN.NONE, rough: 0.22, sway: true }),
  LEAF_ROSE:  B(35, { top: z(), side: z(), bottom: z(), tint: z(), pattern: PATTERN.NONE, rough: 0.22, sway: true }),

  /* --- accents (intentional constants — not palette-driven) ----------- */
  LANTERN: B(40, {
    top: c(0xffb050), side: c(0xffa040), bottom: c(0xf09030), tint: c(0xffc060),
    pattern: PATTERN.NONE, rough: 0.1, emissive: 0.75,
  }),
  CRYSTAL: B(41, {
    top: c(0xdfd0f7), side: c(0xd2c0f1), bottom: c(0xc2aee5), tint: c(0xeee5fd),
    pattern: PATTERN.NONE, rough: 0.1, emissive: 0.42,
  }),
  CLOTH_PINK: B(42, {
    top: c(0xc87858), side: c(0xb86c4e), bottom: c(0xa05c40), tint: c(0xd08060),
    pattern: PATTERN.NONE, rough: 0.3,
  }),
  CLOTH_CREAM: B(43, {
    top: c(0xe8d8b0), side: c(0xdecaa0), bottom: c(0xcaba88), tint: c(0xf0e0b8),
    pattern: PATTERN.NONE, rough: 0.3,
  }),
  ROOF_ROSE: B(44, {
    top: c(0xb85a38), side: c(0xa84e30), bottom: c(0x944228), tint: c(0xa04828),
    pattern: PATTERN.PLANK, rough: 0.4,
  }),
  ROOF_LILAC: B(45, {
    top: c(0x887868), side: c(0x7a6c5c), bottom: c(0x6a5c4e), tint: c(0x806e5c),
    pattern: PATTERN.PLANK, rough: 0.4,
  }),
};

/** id -> block record, built once. */
export const BLOCK_BY_ID = (() => {
  const t: any[] = [];
  for (const k of Object.keys(BLOCKS)) {
    const b = (BLOCKS as any)[k];
    b.name = k;
    t[b.id] = b;
  }
  return t;
})();

/**
 * Add a block at runtime.
 * Ids are Uint8 — 60..250 is the free range.
 */
let _nextBlockId = 60;
export function registerBlock(name: any, def: any) {
  if ((BLOCKS as any)[name]) return (BLOCKS as any)[name];
  if (_nextBlockId > 250) throw new Error('block id space exhausted');
  const b = { id: _nextBlockId++, pattern: PATTERN.NONE, fringe: 0, rough: 0.35, ...def, name };
  (BLOCKS as any)[name] = b;
  BLOCK_BY_ID[b.id] = b;
  return b;
}

/* ------------------------------------------------------------------ *
 * Water  (colours initialised to zero; filled by setVoxelPalette)
 * ------------------------------------------------------------------ */
export const WATER = {
  shoal:   z(),
  shallow: z(),
  deep:    z(),
  warm:    c(0xc8a878),   // warm shallows — constant across palettes
  sheen:   c(0x8aaa9a),
  edge:    c(0x283a3a),
  level:      24.35,
  opacity:    0.88,
  extinction: [0.95, 0.72, 0.42],
  density:    0.23,
  saturation: 1.2,
  cellTone:   0.055,
  caustic:    0.6,
  reflect:    0.85,
};

/* ------------------------------------------------------------------ *
 * Petals & motes  (petals palette-driven; motes constant)
 * ------------------------------------------------------------------ */
export const PETAL_COLORS = [z(), z(), z(), z(), z(), z()];
export const MOTE_COLORS  = [c(0xfff0c0), c(0xffd880), c(0xf0c840), c(0xffffff)];

/* ------------------------------------------------------------------ *
 * Grading — applied in postfx  (initialised to zero; filled by setVoxelPalette)
 * ------------------------------------------------------------------ */
export const GRADE = {
  exposure:   0,
  lift:       new THREE.Vector3(),
  gamma:      new THREE.Vector3(),
  gain:       new THREE.Vector3(),
  saturation: 0,
  contrast:   0,
  vignette:   0,
  bloom: { strength: 0, radius: 0, threshold: 0 },
};

/* ------------------------------------------------------------------ *
 * Swappable colour palettes — single source of truth for all colours
 * ------------------------------------------------------------------ */

export interface VoxelPalette {
  label: string;
  // --- blocks ---
  grass: number; grassLight: number; grassDeep: number;
  soil: number; sand: number;
  stone: number; stonePale: number; stoneWarm: number;
  /** Foliage blocks LEAF_PINK..LEAF_ROSE */
  foliage: [number, number, number, number, number, number];
  // --- water ---
  water: { shoal: number; shallow: number; deep: number };
  // --- atmosphere ---
  sky: { zenith: number; horizon: number; ground: number; haze: number; sunTint: number };
  light: {
    sunColor: number; sunIntensity: number;
    skyColor: number; groundColor: number; hemiIntensity: number;
    ambient: number; fillColor: number; fillIntensity: number;
  };
  // --- petals ---
  petals: [number, number, number, number, number, number];
  // --- grade ---
  grade: {
    exposure: number;
    lift: [number, number, number]; gamma: [number, number, number]; gain: [number, number, number];
    saturation: number; contrast: number; vignette: number;
    bloom: { strength: number; radius: number; threshold: number };
  };
}

/** The active palette name — read by map.ts and any future palette-aware systems. */
export let activePaletteName = 'Autumn';

export const VOXEL_PALETTES: Record<string, VoxelPalette> = {
  Autumn: {
    label: 'Autumn Woodland',
    grass: 0x8a9e4a, grassLight: 0x9aae5e, grassDeep: 0x7a8e3e,
    soil: 0xa07848, sand: 0xc4a882,
    stone: 0x9a9088, stonePale: 0xaaa098, stoneWarm: 0xa89890,
    foliage: [0xe8973a, 0xf0b840, 0xd06040, 0xeacc78, 0x7a9848, 0xe07040],
    water: { shoal: 0x6a8888, shallow: 0x3a5a5a, deep: 0x203838 },
    sky: { zenith: 0x6070a0, horizon: 0xb8a888, ground: 0x8a7a60, haze: 0xb8a888, sunTint: 0xffd8b0 },
    light: { sunColor: 0xffd090, sunIntensity: 2.2, skyColor: 0x7a8a9a, groundColor: 0x8a7060, hemiIntensity: 1.2, ambient: 0.2, fillColor: 0xc8b090, fillIntensity: 0.58 },
    petals: [0xe8a040, 0xd4882a, 0xc87030, 0xd49840, 0xe8b848, 0xc86828],
    grade: { exposure: 1.12, lift: [0.010, 0.006, 0.002], gamma: [1.0, 1.005, 0.99], gain: [1.03, 1.02, 1.0], saturation: 1.22, contrast: 1.12, vignette: 0.08, bloom: { strength: 0.42, radius: 0.95, threshold: 0.68 } },
  },
  Spring: {
    label: 'Spring Blossom',
    grass: 0x82b840, grassLight: 0x9ccc58, grassDeep: 0x6aa030,
    soil: 0x7a5830, sand: 0xd4c090,
    stone: 0x9a9088, stonePale: 0xaaa098, stoneWarm: 0xa89890,
    foliage: [0xf0a0b8, 0xf8ccd8, 0x88cc48, 0xc8dc78, 0x70b840, 0xc8a0d0],
    water: { shoal: 0x68aaa8, shallow: 0x3878a0, deep: 0x183860 },
    sky: { zenith: 0x4878c0, horizon: 0xa8c8e0, ground: 0x7a9c60, haze: 0xb8d0e4, sunTint: 0xfff0e0 },
    light: { sunColor: 0xffe8c0, sunIntensity: 2.0, skyColor: 0x80a8d0, groundColor: 0x7a9060, hemiIntensity: 1.2, ambient: 0.22, fillColor: 0xd0e4f8, fillIntensity: 0.65 },
    petals: [0xf8b0c8, 0xffd8e8, 0xf090b4, 0xffe0f0, 0xf8c8d8, 0xe880b0],
    grade: { exposure: 1.10, lift: [0.008, 0.008, 0.006], gamma: [1.0, 1.0, 0.995], gain: [1.02, 1.03, 1.01], saturation: 1.26, contrast: 1.08, vignette: 0.06, bloom: { strength: 0.38, radius: 0.90, threshold: 0.70 } },
  },
  Alpine: {
    label: 'Alpine Snow',
    grass: 0x8ab0c8, grassLight: 0xa0c0d8, grassDeep: 0x7098b0,
    soil: 0x8090a8, sand: 0xe8e8f0,
    stone: 0xb0b8c4, stonePale: 0xc8d0d8, stoneWarm: 0xa0a8b4,
    foliage: [0x587898, 0x8090a8, 0x486878, 0xd8e8f0, 0x405870, 0x506880],
    water: { shoal: 0x8ab0cc, shallow: 0x4878a0, deep: 0x223868 },
    sky: { zenith: 0x5080b8, horizon: 0xc8d8e8, ground: 0x909aaa, haze: 0xc8d8e8, sunTint: 0xfff8f0 },
    light: { sunColor: 0xfff0e0, sunIntensity: 1.8, skyColor: 0xa0b8d0, groundColor: 0x909aa8, hemiIntensity: 1.3, ambient: 0.28, fillColor: 0xe0eaf8, fillIntensity: 0.7 },
    petals: [0xd0e8f8, 0xe8f4ff, 0xa8c8e8, 0xf0f8ff, 0xc0d8f0, 0xb0d0f0],
    grade: { exposure: 1.15, lift: [0.012, 0.012, 0.014], gamma: [0.99, 0.995, 1.005], gain: [1.0, 1.01, 1.03], saturation: 0.95, contrast: 1.05, vignette: 0.06, bloom: { strength: 0.55, radius: 1.0, threshold: 0.60 } },
  },
  Desert: {
    label: 'Desert Dunes',
    grass: 0xa09058, grassLight: 0xb0a870, grassDeep: 0x887848,
    soil: 0xc07840, sand: 0xe0c080,
    stone: 0xb08870, stonePale: 0xc8a888, stoneWarm: 0xa87858,
    foliage: [0x907040, 0xb09858, 0xc86030, 0xd8c070, 0x789040, 0xa07840],
    water: { shoal: 0x5888a0, shallow: 0x306880, deep: 0x184050 },
    sky: { zenith: 0x6878b0, horizon: 0xe0c890, ground: 0xa09060, haze: 0xe0c890, sunTint: 0xffe8a0 },
    light: { sunColor: 0xffd060, sunIntensity: 2.6, skyColor: 0x8898b0, groundColor: 0xa08860, hemiIntensity: 1.1, ambient: 0.18, fillColor: 0xe8d0a0, fillIntensity: 0.5 },
    petals: [0xf8c060, 0xe8a030, 0xf0b040, 0xffe070, 0xe09020, 0xd87020],
    grade: { exposure: 1.18, lift: [0.014, 0.010, 0.002], gamma: [1.005, 1.0, 0.985], gain: [1.05, 1.02, 0.95], saturation: 1.18, contrast: 1.15, vignette: 0.10, bloom: { strength: 0.45, radius: 0.90, threshold: 0.72 } },
  },
  Alien: {
    label: 'Alien Biome',
    grass: 0x40a878, grassLight: 0x58c890, grassDeep: 0x309060,
    soil: 0x8040a8, sand: 0xc0e8c0,
    stone: 0x506870, stonePale: 0x7090a0, stoneWarm: 0x407068,
    foliage: [0xa028d8, 0xd040e8, 0x4080c0, 0xe060a0, 0x30b870, 0x8030c0],
    water: { shoal: 0x30c0a8, shallow: 0x18908c, deep: 0x0e4848 },
    sky: { zenith: 0x182840, horizon: 0x304858, ground: 0x284038, haze: 0x304858, sunTint: 0xa0ffd0 },
    light: { sunColor: 0x80ffc0, sunIntensity: 1.8, skyColor: 0x406880, groundColor: 0x305848, hemiIntensity: 1.0, ambient: 0.15, fillColor: 0x60a8c0, fillIntensity: 0.45 },
    petals: [0xc040f0, 0xe060ff, 0x8040d0, 0xf080ff, 0xa030e0, 0x7020c0],
    grade: { exposure: 1.08, lift: [0.002, 0.008, 0.010], gamma: [0.99, 1.0, 1.01], gain: [0.95, 1.02, 1.05], saturation: 1.45, contrast: 1.18, vignette: 0.12, bloom: { strength: 0.65, radius: 1.0, threshold: 0.58 } },
  },
};

/** Darken a Three.js Color by a factor (0..1 = darker) in linear space. */
function darken(src: THREE.Color, factor: number): THREE.Color {
  return new THREE.Color(src.r * factor, src.g * factor, src.b * factor);
}

/** Apply a VoxelPalette — mutates all palette-driven exports in place. */
export function setVoxelPalette(name: string): void {
  const p = VOXEL_PALETTES[name];
  if (!p) return;
  activePaletteName = name;

  // Blocks — derive side/bottom/tint from the top hex with darkening factors.
  const applyBlock = (id: number, topHex: number, sideFactor = 0.88, bottomFactor = 0.78) => {
    const blk = BLOCK_BY_ID[id];
    if (!blk) return;
    blk.top.set(topHex);
    blk.side.copy(darken(blk.top, sideFactor));
    blk.bottom.copy(darken(blk.top, bottomFactor));
    if (blk.tint)       blk.tint.copy(darken(blk.top, sideFactor));
    if (blk.topTint)    blk.topTint.copy(darken(blk.top, sideFactor));
    if (blk.fringeColor) blk.fringeColor.copy(darken(blk.top, sideFactor));
  };

  applyBlock(BLOCKS.GRASS.id,            p.grass);
  applyBlock(BLOCKS.GRASS_LIGHT.id,      p.grassLight);
  applyBlock(BLOCKS.GRASS_DEEP.id,       p.grassDeep);
  applyBlock(BLOCKS.GRASS_STONE.id,      p.grass);
  applyBlock(BLOCKS.GRASS_LIGHT_STONE.id, p.grassLight);
  applyBlock(BLOCKS.GRASS_DEEP_STONE.id, p.grassDeep);
  applyBlock(BLOCKS.SOIL.id,       p.soil,      0.9, 0.8);
  applyBlock(BLOCKS.SAND.id,       p.sand,      0.9, 0.8);
  applyBlock(BLOCKS.STONE.id,      p.stone,     0.9, 0.8);
  applyBlock(BLOCKS.STONE_PALE.id, p.stonePale, 0.9, 0.8);
  applyBlock(BLOCKS.STONE_WARM.id, p.stoneWarm, 0.9, 0.8);
  const leaves = [BLOCKS.LEAF_PINK, BLOCKS.LEAF_BLUSH, BLOCKS.LEAF_LILAC,
                  BLOCKS.LEAF_CREAM, BLOCKS.LEAF_MINT, BLOCKS.LEAF_ROSE];
  for (let i = 0; i < leaves.length; i++) applyBlock(leaves[i].id, p.foliage[i], 0.88, 0.78);

  // Water
  WATER.shoal.set(p.water.shoal);
  WATER.shallow.set(p.water.shallow);
  WATER.deep.set(p.water.deep);

  // Sky & atmosphere
  SKY.zenith.set(p.sky.zenith);
  SKY.horizon.set(p.sky.horizon);
  SKY.ground.set(p.sky.ground);
  SKY.haze.set(p.sky.haze);
  SKY.sunTint.set(p.sky.sunTint);
  // FOG.color is the same object as SKY.haze — no copy needed.

  // Light
  LIGHT.sunColor.set(p.light.sunColor);
  LIGHT.sunIntensity  = p.light.sunIntensity;
  LIGHT.skyColor.set(p.light.skyColor);
  LIGHT.groundColor.set(p.light.groundColor);
  LIGHT.hemiIntensity = p.light.hemiIntensity;
  LIGHT.ambient       = p.light.ambient;
  LIGHT.fillColor.set(p.light.fillColor);
  LIGHT.fillIntensity = p.light.fillIntensity;

  // Petals
  for (let i = 0; i < PETAL_COLORS.length; i++) PETAL_COLORS[i].set(p.petals[i]);

  // Grade
  GRADE.exposure   = p.grade.exposure;
  GRADE.lift.set(...p.grade.lift);
  GRADE.gamma.set(...p.grade.gamma);
  GRADE.gain.set(...p.grade.gain);
  GRADE.saturation = p.grade.saturation;
  GRADE.contrast   = p.grade.contrast;
  GRADE.vignette   = p.grade.vignette;
  GRADE.bloom.strength  = p.grade.bloom.strength;
  GRADE.bloom.radius    = p.grade.bloom.radius;
  GRADE.bloom.threshold = p.grade.bloom.threshold;
}

// Initialise all palette-driven exports with the default palette.
setVoxelPalette('Autumn');
