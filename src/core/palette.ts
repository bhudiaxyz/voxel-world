/**
 * ART BIBLE — the single source of truth for the look of VoxelWorld.
 *
 * Every module reads colour from here. Do not hardcode a hex anywhere else;
 * if you need a new colour, add it here so the whole world stays cohesive.
 *
 * Direction (Revision 4 — Autumn Woodland / Temperate Forest):
 *   EARTHY NATURALISM WITH INK. Ground is warm ochre and olive; cliffs are
 *   terracotta and grey-brown stone; grass is muted olive-green. Canopies
 *   are amber, russet, burnt orange, deep gold, and remnant forest green.
 *   Water is deep teal-grey. The sky cycles through burnt-orange sunrises
 *   and steel-blue middays. No pastels; no lavender. Warm, earthy, damp.
 *
 *   Every block is drawn with a thin ink outline (see core/voxel.ts): a
 *   darker stroke of its own face colour along every voxel edge.
 */

import * as THREE from 'three';

// Hex input is sRGB; current Three.js converts it to the linear working space.
const c = (hex: any) => new THREE.Color(hex);

/* ------------------------------------------------------------------ *
 * Atmosphere
 * ------------------------------------------------------------------ */
export const SKY = {
  zenith: c(0x6070a0), // lifted blue overhead
  horizon: c(0xb8a888), // warm haze at skyline, lighter
  ground: c(0x8a7a60), // earthy bounce colour under the world
  haze: c(0xb8a888), // warm haze
  sunTint: c(0xffd8b0),
};

export const LIGHT = {
  sunColor: c(0xffd090),
  sunIntensity: 2.2,
  sunDir: new THREE.Vector3(-0.55, 0.78, -0.32).normalize(),
  skyColor: c(0x7a8a9a),
  groundColor: c(0x8a7060),
  hemiIntensity: 1.2,
  ambient: 0.2,
  fillColor: c(0xc8b090),
  fillIntensity: 0.58,
};

export const FOG = {
  color: SKY.haze,
  near: 74,
  far: 248,
  heightTop: 30,
  heightFalloff: 0.055,
  density: 0.92,
};

/* ------------------------------------------------------------------ *
 * Surface patterns — consumed by the voxel shader in core/voxel.ts
 * ------------------------------------------------------------------ */
export const PATTERN = {
  NONE: 0,
  BRICK: 1,
  STONE: 2,
  PLANK: 3,
  BARK: 4,
  GRASS: 5,
  TILE: 6,
};

/* ------------------------------------------------------------------ *
 * Block library
 * ------------------------------------------------------------------ */
const B = (id: any, def: any) => ({ id, pattern: PATTERN.NONE, fringe: 0, rough: 0.35, ...def });

export const BLOCKS = {
  AIR: { id: 0 },

  /* --- ground ------------------------------------------------------- */
  GRASS: B(1, {
    top: c(0x8a9e4a),
    side: c(0x8a9e4a),
    bottom: c(0x7e9040),
    tint: c(0x7e9040),
    topTint: c(0x7e9040),
    fringeColor: c(0x809244),
    pattern: PATTERN.NONE,
    topPattern: PATTERN.NONE,
    fringe: 0,
    grassCap: true,
    lightEdge: true,
    rough: 0.5,
  }),
  GRASS_LIGHT: B(2, {
    top: c(0x9aae5e),
    side: c(0x9aae5e),
    bottom: c(0x8ea052),
    tint: c(0x8ea052),
    topTint: c(0x8ea052),
    fringeColor: c(0x90a254),
    pattern: PATTERN.NONE,
    topPattern: PATTERN.NONE,
    fringe: 0,
    grassCap: true,
    lightEdge: true,
    rough: 0.5,
  }),
  GRASS_DEEP: B(3, {
    top: c(0x7a8e3e),
    side: c(0x7a8e3e),
    bottom: c(0x6e8034),
    tint: c(0x6e8034),
    topTint: c(0x6e8034),
    fringeColor: c(0x708238),
    pattern: PATTERN.NONE,
    topPattern: PATTERN.NONE,
    fringe: 0,
    grassCap: true,
    lightEdge: true,
    rough: 0.5,
  }),
  GRASS_STONE: B(6, {
    top: c(0x8a9e4a),
    side: c(0x8a9e4a),
    bottom: c(0x7e9040),
    tint: c(0x7e9040),
    topTint: c(0x7e9040),
    fringeColor: c(0x809244),
    pattern: PATTERN.NONE,
    topPattern: PATTERN.NONE,
    fringe: 0,
    grassCap: true,
    stoneSubstrate: true,
    lightEdge: true,
    rough: 0.52,
  }),
  GRASS_LIGHT_STONE: B(7, {
    top: c(0x9aae5e),
    side: c(0x9aae5e),
    bottom: c(0x8ea052),
    tint: c(0x8ea052),
    topTint: c(0x8ea052),
    fringeColor: c(0x90a254),
    pattern: PATTERN.NONE,
    topPattern: PATTERN.NONE,
    fringe: 0,
    grassCap: true,
    stoneSubstrate: true,
    lightEdge: true,
    rough: 0.52,
  }),
  GRASS_DEEP_STONE: B(8, {
    top: c(0x7a8e3e),
    side: c(0x7a8e3e),
    bottom: c(0x6e8034),
    tint: c(0x6e8034),
    topTint: c(0x6e8034),
    fringeColor: c(0x708238),
    pattern: PATTERN.NONE,
    topPattern: PATTERN.NONE,
    fringe: 0,
    grassCap: true,
    stoneSubstrate: true,
    lightEdge: true,
    rough: 0.52,
  }),
  SOIL: B(4, {
    top: c(0xa07848),
    side: c(0xb08050),
    bottom: c(0x906840),
    tint: c(0x907048),
    pattern: PATTERN.NONE,
    rough: 0.55,
  }),
  SAND: B(5, {
    top: c(0xc4a882),
    side: c(0xb89a74),
    bottom: c(0xa08860),
    tint: c(0xb09070),
    pattern: PATTERN.NONE,
    rough: 0.4,
  }),

  /* --- rock ---------------------------------------------------------- */
  STONE: B(10, {
    top: c(0x9a9088),
    side: c(0x8e8480),
    bottom: c(0x7e7470),
    tint: c(0xa29890),
    pattern: PATTERN.NONE,
    rough: 0.6,
  }),
  STONE_PALE: B(11, {
    top: c(0xaaa098),
    side: c(0x9e9490),
    bottom: c(0x8e8480),
    tint: c(0xb2a8a2),
    pattern: PATTERN.NONE,
    rough: 0.5,
  }),
  STONE_WARM: B(12, {
    top: c(0xa89890),
    side: c(0x9c8c84),
    bottom: c(0x8c7c74),
    tint: c(0xb09890),
    pattern: PATTERN.NONE,
    rough: 0.55,
  }),
  PATH: B(13, {
    top: c(0x8a8070),
    side: c(0x7e7464),
    bottom: c(0x6e6454),
    tint: c(0x847a68),
    pattern: PATTERN.NONE,
    rough: 0.45,
  }),

  /* --- wood ---------------------------------------------------------- */
  PLANK: B(20, {
    top: c(0xb8824a),
    side: c(0xa87840),
    bottom: c(0x946830),
    tint: c(0xa07038),
    pattern: PATTERN.PLANK,
    rough: 0.5,
  }),
  PLANK_PALE: B(21, {
    top: c(0xc89060),
    side: c(0xb88450),
    bottom: c(0xa07040),
    tint: c(0xb07c48),
    pattern: PATTERN.PLANK,
    rough: 0.45,
  }),
  BEAM: B(22, {
    top: c(0x8a5a28),
    side: c(0x7a5020),
    bottom: c(0x6a4018),
    tint: c(0x724a18),
    pattern: PATTERN.BARK,
    rough: 0.5,
  }),
  TRUNK: B(23, {
    top: c(0x4a3020),
    side: c(0x3e2818),
    bottom: c(0x342010),
    tint: c(0x362212),
    pattern: PATTERN.BARK,
    rough: 0.65,
  }),
  TRUNK_PALE: B(24, {
    top: c(0x5a3828),
    side: c(0x4e3020),
    bottom: c(0x3e2818),
    tint: c(0x482a18),
    pattern: PATTERN.BARK,
    rough: 0.6,
  }),

  /* --- foliage — autumn palette -------------------------------------- */
  LEAF_PINK: B(30, {
    // amber
    top: c(0xe8973a),
    side: c(0xd88830),
    bottom: c(0xc07820),
    tint: c(0xf0a040),
    pattern: PATTERN.NONE,
    rough: 0.22,
  }),
  LEAF_BLUSH: B(31, {
    // bright gold
    top: c(0xf0b840),
    side: c(0xe0a830),
    bottom: c(0xc89020),
    tint: c(0xf8c048),
    pattern: PATTERN.NONE,
    rough: 0.2,
  }),
  LEAF_LILAC: B(32, {
    // russet — lifted slightly
    top: c(0xd06040),
    side: c(0xc05438),
    bottom: c(0xa84828),
    tint: c(0xd86848),
    pattern: PATTERN.NONE,
    rough: 0.22,
  }),
  LEAF_CREAM: B(33, {
    // warm straw
    top: c(0xeacc78),
    side: c(0xdabc68),
    bottom: c(0xc8a850),
    tint: c(0xf0d480),
    pattern: PATTERN.NONE,
    rough: 0.2,
  }),
  LEAF_MINT: B(34, {
    // forest green
    top: c(0x7a9848),
    side: c(0x708c40),
    bottom: c(0x607830),
    tint: c(0x82a050),
    pattern: PATTERN.NONE,
    rough: 0.22,
  }),
  LEAF_ROSE: B(35, {
    // burnt orange
    top: c(0xe07040),
    side: c(0xd06438),
    bottom: c(0xb85828),
    tint: c(0xe87848),
    pattern: PATTERN.NONE,
    rough: 0.22,
  }),

  /* --- accents ------------------------------------------------------- */
  LANTERN: B(40, {
    top: c(0xffb050),
    side: c(0xffa040),
    bottom: c(0xf09030),
    tint: c(0xffc060),
    pattern: PATTERN.NONE,
    rough: 0.1,
    emissive: 0.75,
  }),
  CRYSTAL: B(41, {
    top: c(0xdfd0f7),
    side: c(0xd2c0f1),
    bottom: c(0xc2aee5),
    tint: c(0xeee5fd),
    pattern: PATTERN.NONE,
    rough: 0.1,
    emissive: 0.42,
  }),
  CLOTH_PINK: B(42, {
    // earthy rust
    top: c(0xc87858),
    side: c(0xb86c4e),
    bottom: c(0xa05c40),
    tint: c(0xd08060),
    pattern: PATTERN.NONE,
    rough: 0.3,
  }),
  CLOTH_CREAM: B(43, {
    // warm linen
    top: c(0xe8d8b0),
    side: c(0xdecaa0),
    bottom: c(0xcaba88),
    tint: c(0xf0e0b8),
    pattern: PATTERN.NONE,
    rough: 0.3,
  }),
  ROOF_ROSE: B(44, {
    // terracotta
    top: c(0xb85a38),
    side: c(0xa84e30),
    bottom: c(0x944228),
    tint: c(0xa04828),
    pattern: PATTERN.PLANK,
    rough: 0.4,
  }),
  ROOF_LILAC: B(45, {
    // warm slate
    top: c(0x887868),
    side: c(0x7a6c5c),
    bottom: c(0x6a5c4e),
    tint: c(0x806e5c),
    pattern: PATTERN.PLANK,
    rough: 0.4,
  }),
};

/** id -> block record, built once. */
export const BLOCK_BY_ID = (() => {
  const t = [];
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
 * Water
 * ------------------------------------------------------------------ */
export const WATER = {
  shoal: c(0x6a8888),
  shallow: c(0x3a5a5a),
  deep: c(0x2a4040),
  warm: c(0xc8a878),
  sheen: c(0x8aaa9a),
  edge: c(0x283a3a),
  level: 24.35,
  opacity: 0.88,
  extinction: [0.62, 0.5, 0.26],
  density: 0.23,
  saturation: 1.2,
  cellTone: 0.055,
  caustic: 0.6,
  reflect: 0.85,
};

/* ------------------------------------------------------------------ *
 * Petals & motes
 * ------------------------------------------------------------------ */
export const PETAL_COLORS = [c(0xe8a040), c(0xd4882a), c(0xc87030), c(0xd49840), c(0xe8b848), c(0xc86828)];
export const MOTE_COLORS = [c(0xfff0c0), c(0xffd880), c(0xf0c840), c(0xffffff)];

/* ------------------------------------------------------------------ *
 * Swappable colour palettes
 * ------------------------------------------------------------------ */

/**
 * A VoxelPalette defines the key semantic colours for the world. Derived
 * block colours (side, bottom, tint, fringeColor) are darkened automatically
 * from the top face colour.
 */
export interface VoxelPalette {
  label: string;
  /** Grass block faces */
  grass: number; grassLight: number; grassDeep: number;
  soil: number; sand: number;
  stone: number; stonePale: number; stoneWarm: number;
  /** Foliage blocks (maps to LEAF_PINK..LEAF_ROSE in order) */
  foliage: [number, number, number, number, number, number];
  water: { shoal: number; shallow: number; deep: number };
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
    water: { shoal: 0x6a8888, shallow: 0x3a5a5a, deep: 0x2a4040 },
  },
  Alpine: {
    label: 'Alpine Snow',
    grass: 0x8ab0c8, grassLight: 0xa0c0d8, grassDeep: 0x7098b0,
    soil: 0x8090a8, sand: 0xe8e8f0,
    stone: 0xb0b8c4, stonePale: 0xc8d0d8, stoneWarm: 0xa0a8b4,
    foliage: [0x587898, 0x8090a8, 0x486878, 0xd8e8f0, 0x405870, 0x506880],
    water: { shoal: 0x8ab0cc, shallow: 0x4878a0, deep: 0x305878 },
  },
  Desert: {
    label: 'Desert Dunes',
    grass: 0xa09058, grassLight: 0xb0a870, grassDeep: 0x887848,
    soil: 0xc07840, sand: 0xe0c080,
    stone: 0xb08870, stonePale: 0xc8a888, stoneWarm: 0xa87858,
    foliage: [0x907040, 0xb09858, 0xc86030, 0xd8c070, 0x789040, 0xa07840],
    water: { shoal: 0x5888a0, shallow: 0x306880, deep: 0x205060 },
  },
  Alien: {
    label: 'Alien Biome',
    grass: 0x40a878, grassLight: 0x58c890, grassDeep: 0x309060,
    soil: 0x8040a8, sand: 0xc0e8c0,
    stone: 0x506870, stonePale: 0x7090a0, stoneWarm: 0x407068,
    foliage: [0xa028d8, 0xd040e8, 0x4080c0, 0xe060a0, 0x30b870, 0x8030c0],
    water: { shoal: 0x30c0a8, shallow: 0x18908c, deep: 0x106060 },
  },
};

/** Darken a Three.js Color by a factor (0..1 = darker) in linear space. */
function darken(src: THREE.Color, factor: number): THREE.Color {
  return new THREE.Color(src.r * factor, src.g * factor, src.b * factor);
}

/** Apply a VoxelPalette by mutating BLOCK_BY_ID colors in place. */
export function setVoxelPalette(name: string): void {
  const p = VOXEL_PALETTES[name];
  if (!p) return;
  activePaletteName = name;

  // Helper: set a block's face colours from a single top hex, with derived darkenings.
  const applyBlock = (id: number, topHex: number, sideFactor = 0.88, bottomFactor = 0.78) => {
    const blk = BLOCK_BY_ID[id];
    if (!blk) return;
    blk.top.set(topHex);
    blk.side.copy(darken(blk.top, sideFactor));
    blk.bottom.copy(darken(blk.top, bottomFactor));
    if (blk.tint) blk.tint.copy(darken(blk.top, sideFactor));
    if (blk.topTint) blk.topTint.copy(darken(blk.top, sideFactor));
    if (blk.fringeColor) blk.fringeColor.copy(darken(blk.top, sideFactor));
  };

  applyBlock(BLOCKS.GRASS.id, p.grass);
  applyBlock(BLOCKS.GRASS_LIGHT.id, p.grassLight);
  applyBlock(BLOCKS.GRASS_DEEP.id, p.grassDeep);
  applyBlock(BLOCKS.GRASS_STONE.id, p.grass);
  applyBlock(BLOCKS.GRASS_LIGHT_STONE.id, p.grassLight);
  applyBlock(BLOCKS.GRASS_DEEP_STONE.id, p.grassDeep);
  applyBlock(BLOCKS.SOIL.id, p.soil, 0.9, 0.8);
  applyBlock(BLOCKS.SAND.id, p.sand, 0.9, 0.8);
  applyBlock(BLOCKS.STONE.id, p.stone, 0.9, 0.8);
  applyBlock(BLOCKS.STONE_PALE.id, p.stonePale, 0.9, 0.8);
  applyBlock(BLOCKS.STONE_WARM.id, p.stoneWarm, 0.9, 0.8);
  const leaves = [BLOCKS.LEAF_PINK, BLOCKS.LEAF_BLUSH, BLOCKS.LEAF_LILAC,
                  BLOCKS.LEAF_CREAM, BLOCKS.LEAF_MINT, BLOCKS.LEAF_ROSE];
  for (let i = 0; i < leaves.length; i++) applyBlock(leaves[i].id, p.foliage[i], 0.88, 0.78);

  // Water
  WATER.shoal.set(p.water.shoal);
  WATER.shallow.set(p.water.shallow);
  WATER.deep.set(p.water.deep);
}

/* ------------------------------------------------------------------ *
 * Grading — applied in postfx
 * ------------------------------------------------------------------ */
export const GRADE = {
  exposure: 1.12,
  lift: new THREE.Vector3(0.01, 0.006, 0.002),
  gamma: new THREE.Vector3(1.0, 1.005, 0.99),
  gain: new THREE.Vector3(1.03, 1.02, 1.0),
  saturation: 1.22,
  contrast: 1.12,
  vignette: 0.08,
  bloom: { strength: 0.42, radius: 0.95, threshold: 0.68 },
};
