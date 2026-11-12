/**
 * Vegetation — blossom trees, bushes, scrub, and the fine ground detail.
 *
 * Shape language (Revision 3). A canopy is **an assembly of visibly distinct
 * cubes**, not a carved volume. Trees share the reference's architectural
 * grammar: compact asymmetric stacks of large blossom cuboids with a broad
 * lower mass and a smaller offset crown. Regional colour keeps a grove varied
 * without dissolving that confident silhouette into procedural noise.
 *
 * Colour: storybook pastel. Pink, rose, mauve, lilac and cream carry the
 * canopies while restrained sage stays in the terrain. Blade and drift colours
 * are read off palette blocks at build time so this layer tracks the art bible
 * instead of competing with it.
 *
 * A voxel is roughly a metre and the camera now holds ~25 of them across the
 * frame, so grass tufts, single flowers, pebbles and fallen petals cannot be
 * blocks. They live in one merged, wind-animated mesh built by `veg-detail.js`
 * and handed to `world.decorations`.
 */

import * as THREE from 'three';
import { WATER, BLOCKS, BLOCK_BY_ID, PATTERN, registerBlock } from '../core/palette';
import { clamp, smoothstep, makeNoise2D, fbm2, makeRng } from '../core/rng';
import { DetailField } from './veg-detail';
import { BIOME } from './planner';

const c = (hex: number) => new THREE.Color(hex);

/* ------------------------------------------------------------------ *
 * Blocks owned by this module.
 *
 * Bushes deliberately do NOT reuse the canopy palette. Canopy blossom is the
 * brightest thing in the world and there are only a few dozen canopies; a few
 * hundred shrubs in those same colours turned the meadows into scattered
 * candy. Bush tones are dusty rose / mauve / cream — the same family as the
 * ground, half a step deeper, so they read as mass rather than as sprinkles.
 * ------------------------------------------------------------------ */
const BUSH_ROSE = registerBlock('BUSH_ROSE', {
    top: c(0xdec3c8),
    side: c(0xd3b5bc),
    bottom: c(0xc1a3aa),
    tint: c(0xd0adb4),
    topTint: c(0xd6b9be),
    pattern: PATTERN.LEAF,
    topPattern: PATTERN.LEAF,
    rough: 0.45,
});
const BUSH_MAUVE = registerBlock('BUSH_MAUVE', {
    top: c(0xd2c3ca),
    side: c(0xc6b5be),
    bottom: c(0xb3a3ab),
    tint: c(0xc2afb8),
    topTint: c(0xcabac1),
    pattern: PATTERN.LEAF,
    topPattern: PATTERN.LEAF,
    rough: 0.45,
});
const BUSH_DUSK = registerBlock('BUSH_DUSK', {
    top: c(0xcbc1dc),
    side: c(0xbfb3d1),
    bottom: c(0xaca0bd),
    tint: c(0xbbaecb),
    topTint: c(0xc4b9d5),
    pattern: PATTERN.LEAF,
    topPattern: PATTERN.LEAF,
    rough: 0.45,
});
const BUSH_CREAM = registerBlock('BUSH_CREAM', {
    top: c(0xe6dac9),
    side: c(0xdbcdbb),
    bottom: c(0xc8baa8),
    tint: c(0xd6c7b4),
    topTint: c(0xdfd2c1),
    pattern: PATTERN.LEAF,
    topPattern: PATTERN.LEAF,
    rough: 0.45,
});
const BUSHES = [BUSH_ROSE, BUSH_MAUVE, BUSH_ROSE, BUSH_CREAM, BUSH_DUSK, BUSH_MAUVE];

/** Hardier, greyer low scrub for the exposed rocky tops — closest to stone. */
const SCRUB = registerBlock('SCRUB', {
    top: c(0xc6bcbe),
    side: c(0xbaafb2),
    bottom: c(0xa79ca0),
    tint: c(0xb5a9ad),
    topTint: c(0xbfb4b7),
    pattern: PATTERN.LEAF,
    topPattern: PATTERN.LEAF,
    rough: 0.6,
});

/**
 * Fallen blossom on the grass. This *replaces* the surface block rather than
 * sitting on top of it, so the drift stays perfectly flat — a raised layer of
 * petals would read as a pink kerb. Sides keep the soil courses so a drift
 * that reaches a terrace lip still cuts exactly like turf does.
 */
const BLOSSOM_DRIFT = registerBlock('BLOSSOM_DRIFT', {
    top: c(0xf0dade),
    side: c(0xd0a89e),
    bottom: c(0xbb9086),
    tint: c(0xc59d97),
    topTint: c(0xdfc7cb),
    fringeColor: c(0xe8ccd1),
    pattern: PATTERN.STONE,
    topPattern: PATTERN.GRASS,
    fringe: 0.16,
    rough: 0.42,
});

/**
 * Moss over a cliff lip. The one place green is allowed, and even here it is
 * pulled most of the way to a warm grey — it exists to break the hard line
 * where turf meets stone, not to add a hue.
 */
const MOSS = registerBlock('MOSS', {
    top: c(0xc3cfa2),
    side: c(0xbac697),
    bottom: c(0xa5b184),
    tint: c(0xaebb8c),
    fringeColor: c(0xccd8ab),
    pattern: PATTERN.GRASS,
    topPattern: PATTERN.GRASS,
    fringe: 0.55,
    rough: 0.55,
});

const FERN = registerBlock('FERN', {
    top: c(0x4a6b3e),
    side: c(0x3d5933),
    bottom: c(0x2e4226),
    tint: c(0x3f5f35),
    topTint: c(0x5a7a48),
    pattern: PATTERN.LEAF,
    topPattern: PATTERN.LEAF,
    rough: 0.55,
});
const FERN_RED = registerBlock('FERN_RED', {
    top: c(0x8b4a2e),
    side: c(0x7a3e26),
    bottom: c(0x612f1a),
    tint: c(0x7a3e26),
    topTint: c(0x9e5535),
    pattern: PATTERN.LEAF,
    topPattern: PATTERN.LEAF,
    rough: 0.55,
});
const MOSS_THICK = registerBlock('MOSS_THICK', {
    top: c(0x8ab068),
    side: c(0x7da05a),
    bottom: c(0x6a8a4c),
    tint: c(0x7aa058),
    topTint: c(0x99c075),
    fringeColor: c(0xb0d08a),
    pattern: PATTERN.GRASS,
    topPattern: PATTERN.GRASS,
    fringe: 0.45,
    rough: 0.5,
});
export const LICHEN_PALE = registerBlock('LICHEN_PALE', {
    top: c(0xc8cdb8),
    side: c(0xbcc1ab),
    bottom: c(0xadb295),
    tint: c(0xb8bda8),
    fringeColor: c(0xd4d9c8),
    pattern: PATTERN.STONE,
    rough: 0.65,
});
const SHRUB_TALL = registerBlock('SHRUB_TALL', {
    top: c(0xb8a0a8),
    side: c(0xac9298),
    bottom: c(0x9a8088),
    tint: c(0xa89098),
    topTint: c(0xb8a2a8),
    pattern: PATTERN.LEAF,
    topPattern: PATTERN.LEAF,
    rough: 0.5,
});
const GRASS_TALL = registerBlock('GRASS_TALL', {
    top: c(0x5a7245),
    side: c(0x4e643c),
    bottom: c(0x3f5230),
    tint: c(0x526e3f),
    topTint: c(0x6a8450),
    pattern: PATTERN.GRASS,
    topPattern: PATTERN.GRASS,
    rough: 0.48,
});

/** A mid-value plum for trunk variety — still among the darkest things around. */
const TRUNK_ROSE = registerBlock('TRUNK_ROSE', {
    top: c(0x9c7783),
    side: c(0x8d6875),
    bottom: c(0x7b5866),
    tint: c(0x775363),
    pattern: PATTERN.BARK,
    rough: 0.62,
});

/**
 * Canopy hues, keyed by a low-frequency region field so a whole stand shares a
 * species. Green belongs to the ground; blossom stays in the warm/cool pastel
 * range used by the references.
 */
const CANOPY_BANDS = [
    [BLOCKS.LEAF_PINK, BLOCKS.LEAF_BLUSH, BLOCKS.LEAF_ROSE],
    [BLOCKS.LEAF_BLUSH, BLOCKS.LEAF_CREAM, BLOCKS.LEAF_PINK],
    [BLOCKS.LEAF_LILAC, BLOCKS.LEAF_BLUSH, BLOCKS.LEAF_PINK],
    [BLOCKS.LEAF_CREAM, BLOCKS.LEAF_BLUSH, BLOCKS.LEAF_ROSE],
    [BLOCKS.LEAF_LILAC, BLOCKS.LEAF_LILAC, BLOCKS.LEAF_CREAM],
];

/**
 * What each biome actually grows.
 *
 * Biome used to drive *density* only, so a sakura province was the same forest
 * as a meadow with more of it — you could not tell one from the other by
 * looking, which defeats the point of having provinces at all. Species is what
 * makes a border legible from across a valley.
 *
 * `leaves` is the canopy palette, `bush` the undergrowth, `scale` the size
 * range, and `form` biases the silhouette: highland trees are small and
 * spired, wetland trees broad and low, sakura tall and heavy-crowned.
 */
const BIOME_FLORA = {
    [BIOME.SAKURA]: {
        leaves: [BLOCKS.LEAF_PINK, BLOCKS.LEAF_BLUSH, BLOCKS.LEAF_ROSE, BLOCKS.LEAF_PINK],
        forms: ['stack', 'round', 'broad', 'twin', 'weeping', 'weeping', 'tall'],
        scale: [0.42, 1.0],
        density: 1.65,
        bushes: [BUSH_ROSE, BUSH_ROSE, BUSH_MAUVE, BUSH_CREAM],
    },
    [BIOME.MEADOW]: {
        leaves: [BLOCKS.LEAF_CREAM, BLOCKS.LEAF_BLUSH, BLOCKS.LEAF_LILAC],
        forms: ['round', 'bunch', 'twin', 'stack', 'umbrella', 'tall', 'layered'],
        scale: [0.2, 0.92],
        density: 0.55,
        bushes: [BUSH_CREAM, BUSH_ROSE, BUSH_MAUVE],
    },
    [BIOME.WETLAND]: {
        leaves: [BLOCKS.LEAF_MINT, BLOCKS.LEAF_CREAM, BLOCKS.LEAF_MINT],
        // Mangrove/willow now come from SPECIES, which keeps them at the waterline.
        forms: ['broad', 'bunch', 'round', 'umbrella', 'weeping', 'tall'],
        scale: [0.26, 0.78],
        density: 0.75,
        bushes: [BUSH_DUSK, BUSH_MAUVE, BUSH_CREAM],
    },
    [BIOME.HIGHLAND]: {
        leaves: [BLOCKS.LEAF_LILAC, BLOCKS.LEAF_MINT],
        // Conifers and snags now come from SPECIES by altitude; these are the
        // few blossom forms that still read as highland.
        forms: ['nub', 'layered', 'nub'],
        scale: [0.14, 0.46],
        density: 0.28,
        bushes: [SCRUB, SCRUB, BUSH_DUSK],
    },
    [BIOME.SHORE]: {
        leaves: [BLOCKS.LEAF_CREAM, BLOCKS.LEAF_BLUSH],
        // Palms come from SPECIES (tropical/arid shores only).
        forms: ['bunch', 'round', 'nub', 'umbrella', 'layered', 'weeping'],
        scale: [0.16, 0.7],
        density: 0.22,
        bushes: [BUSH_CREAM, SCRUB],
    },
};
/* ================================================================== *
 * Named species, placed by altitude
 *
 * The blossom forms above (round, stack, twin…) are the signature look and
 * stay as they were. These are real-world silhouettes, each with the climate it
 * belongs to (the continent's climate from the planner) and an altitude band in
 * blocks above sea level. Placement picks from the species that fit the spot,
 * weighted, with soft band edges so treelines blur rather than stop dead.
 *
 * Climate: 0 tropical, 1 temperate, 2 arid, 3 tundra.
 * ================================================================== */
type Species = {
    name: string;
    climates: number[];
    /** [lo, hi] blocks above sea; weight fades over `soft` blocks outside. */
    alt: [number, number];
    weight: number;
    /** Needs damp ground (wetness > 0.3). */
    wet?: boolean;
    /** Scale range for this species. */
    scale: [number, number];
};
/*
 * Bands are fitted to the terrain as generated, not to an idealised mountain:
 * land above sea level is ~36% 0–6 blocks, ~30% 6–12, ~21% 12–18 and only ~13%
 * above 18 (peaks reach the low 30s). So: shore 0–5, lowland 3–12, upland
 * 9–18, alpine 15+, treeline 20+. Retune these if WORLD.step or MACRO_RELIEF
 * changes the relief.
 */
const SPECIES: Species[] = [
    { name: 'mangrove', climates: [0, 1], alt: [0, 3], weight: 1.4, wet: true, scale: [0.4, 0.8] },
    { name: 'palm', climates: [0, 2], alt: [0, 5], weight: 1.2, scale: [0.45, 0.9] },
    { name: 'willow', climates: [0, 1, 2, 3], alt: [0, 8], weight: 1.3, wet: true, scale: [0.55, 0.9] },
    { name: 'cypress', climates: [1, 2], alt: [2, 10], weight: 0.7, scale: [0.4, 0.9] },
    { name: 'kapok', climates: [0], alt: [2, 10], weight: 0.6, scale: [0.75, 1.0] },
    { name: 'baobab', climates: [2], alt: [3, 11], weight: 0.6, scale: [0.5, 0.95] },
    { name: 'acacia', climates: [2, 0], alt: [3, 13], weight: 1.0, scale: [0.45, 0.9] },
    { name: 'oak', climates: [1], alt: [3, 12], weight: 1.2, scale: [0.55, 1.0] },
    { name: 'birch', climates: [1, 3], alt: [7, 16], weight: 1.0, scale: [0.35, 0.8] },
    { name: 'pine', climates: [1, 3], alt: [10, 20], weight: 1.1, scale: [0.4, 0.9] },
    { name: 'fir', climates: [1, 3], alt: [13, 24], weight: 1.1, scale: [0.35, 0.85] },
    { name: 'spruce', climates: [3, 1], alt: [16, 30], weight: 1.2, scale: [0.35, 0.85] },
    { name: 'juniper', climates: [2, 3], alt: [14, 30], weight: 0.9, scale: [0.2, 0.5] },
    { name: 'snag', climates: [0, 1, 2, 3], alt: [20, 40], weight: 0.6, scale: [0.3, 0.7] },
];
const ALT_SOFT = 3;
/** Forms whose silhouette the generic foliage tufts would blur, or that have no leaves. */
const NO_TUFTS = new Set(['snag', 'dead', 'fir', 'spruce', 'cypress', 'willow', 'pine', 'palm']);

/** Bare-trunk height per species: [min, + scale × extra]. */
const SPECIES_TRUNK: Record<string, [number, number]> = {
    mangrove: [1, 2],
    palm: [6, 8],
    cypress: [1, 2],
    willow: [2, 3],
    kapok: [7, 7],
    baobab: [3, 4],
    acacia: [4, 4],
    oak: [2, 3],
    birch: [5, 7],
    pine: [6, 8],
    fir: [1, 2],
    spruce: [1, 2],
    juniper: [1, 2],
    snag: [4, 6],
};

/**
 * Weighted species pick for a site, or null when none suits (then the biome's
 * blossom forms are used). Altitude weight is 1 inside the band and fades
 * linearly to 0 over ALT_SOFT blocks outside it.
 */
function pickSpecies(climate: number, alt: number, wet: boolean, rng: any): Species | null {
    let total = 0;
    const w: number[] = [];
    for (const s of SPECIES) {
        let k = s.climates.includes(climate) ? s.weight : 0;
        if (k && s.wet && !wet) k = 0;
        if (k) {
            const out = alt < s.alt[0] ? s.alt[0] - alt : alt > s.alt[1] ? alt - s.alt[1] : 0;
            k *= Math.max(0, 1 - out / ALT_SOFT);
        }
        w.push(k);
        total += k;
    }
    if (total <= 0) return null;
    let r = rng() * total;
    for (let i = 0; i < SPECIES.length; i++) if ((r -= w[i]) <= 0) return SPECIES[i];
    return SPECIES[SPECIES.length - 1];
}

/** Paler partner used for the sunlit patches within one canopy. */
const CANOPY_LIGHT = new Map([
    [BLOCKS.LEAF_PINK, BLOCKS.LEAF_BLUSH],
    [BLOCKS.LEAF_ROSE, BLOCKS.LEAF_PINK],
    [BLOCKS.LEAF_LILAC, BLOCKS.LEAF_BLUSH],
    [BLOCKS.LEAF_CREAM, BLOCKS.LEAF_BLUSH],
    [BLOCKS.LEAF_BLUSH, BLOCKS.LEAF_CREAM],
]);

const GRASS_IDS = new Set(
    Object.values(BLOCKS)
        .filter((block: any) => block.grassCap)
        .map((block: any) => block.id),
);
const STONE_IDS = new Set([BLOCKS.STONE.id, BLOCKS.STONE_PALE.id, BLOCKS.STONE_WARM.id]);

/* ================================================================== *
 * Canopy construction
 * ================================================================== */

/**
 * Trunk. Chunky by design — a 1-block trunk under a 9-block canopy is the
 * mushroom failure mode the first two passes kept producing. `lean` drifts the
 * column sideways as it rises; the previous footprint is refilled at every
 * step so the trunk stays watertight.
 */
function buildTrunk(
    grid: any,
    x: number,
    y: number,
    z: number,
    h: number,
    w: number,
    id: number,
    leanX: number,
    leanZ: number,
) {
    const o = -Math.floor((w - 1) / 2);
    let px = 0,
        pz = 0;
    for (let ty = 0; ty < h; ty++) {
        const t = h > 1 ? ty / (h - 1) : 0;
        const ax = Math.round(leanX * t),
            az = Math.round(leanZ * t);
        for (let dx = 0; dx < w; dx++)
            for (let dz = 0; dz < w; dz++) {
                grid.set(x + o + dx + ax, y + ty, z + o + dz + az, id);
                if (ax !== px || az !== pz) grid.set(x + o + dx + px, y + ty, z + o + dz + pz, id);
            }
        px = ax;
        pz = az;
    }
    return [px, pz];
}

function pickForm(scale: number, rng: any) {
    if (scale > 0.72)
        return rng.pick([
            'stack',
            'round',
            'twin',
            'bunch',
            'broad',
            'umbrella',
            'weeping',
            'layered',
            'stack',
            'round',
            'palm',
        ]);
    if (scale > 0.46)
        return rng.pick(['round', 'bunch', 'spire', 'twin', 'stack', 'umbrella', 'tall', 'layered', 'mangrove']);
    if (scale > 0.26) return rng.pick(['round', 'bunch', 'spire', 'nub', 'tall', 'layered', 'dead']);
    return 'nub';
}

/**
 * Place a blossom tree with its base at (x, y, z).
 * Returns the record consumed by particles and the capture rig.
 *
 * `form` drives silhouette; `scale` drives overall size within each form.
 * Previously `form` was selected but ignored — every tree was the same
 * stacked-box architecture at different scales.
 */
export function plantTree(grid: any, x: number, y: number, z: number, rng: any, opts: Record<string, any> = {}) {
    const scale = opts.scale ?? rng.range(0.26, 1.0);
    const form = opts.form ?? pickForm(scale, rng);
    const leaf = opts.leaf ?? rng.pick(CANOPY_BANDS[0]);
    const pale = CANOPY_LIGHT.get(leaf) || leaf;
    const twoTone = opts.twoTone ?? rng.chance(0.62);

    // Birch and snag trunks are pale; baobab, kapok and juniper are dark and
    // characterful. Everything else keeps the old mixed bark.
    const trunkBlock =
        form === 'birch' || form === 'snag'
            ? BLOCKS.TRUNK_PALE
            : form === 'baobab' || form === 'kapok' || form === 'juniper'
              ? BLOCKS.TRUNK
              : rng.chance(0.55)
                ? BLOCKS.TRUNK
                : rng.chance(0.5)
                  ? BLOCKS.TRUNK_PALE
                  : TRUNK_ROSE;

    const unit = scale >= 0.42 ? 2 : 1;
    const large = scale >= 0.72;
    // Baobab and kapok are defined by massive trunks; birch and cypress by slim ones.
    const tw =
        form === 'baobab'
            ? scale >= 0.5
                ? 3
                : 2
            : form === 'kapok'
              ? 2
              : form === 'birch' || form === 'cypress' || form === 'juniper'
                ? 1
                : scale >= 0.82
                  ? 2
                  : 1;

    // Form-specific trunk height: spire/umbrella = taller trunk, broad = shorter.
    // Named species (SPECIES table) carry their own trunk proportions.
    const sp = SPECIES_TRUNK[form];
    const bare = sp
        ? Math.max(sp[0], Math.round(sp[0] + scale * sp[1]))
        : form === 'spire'
          ? Math.max(3, Math.round(3 + scale * 5))
          : form === 'umbrella'
            ? Math.max(3, Math.round(3 + scale * 3.5))
            : form === 'broad'
              ? Math.max(1, Math.round(1 + scale * 2))
              : form === 'tall'
                ? Math.max(6, Math.round(6 + scale * 9))
                : form === 'layered'
                  ? Math.max(3, Math.round(3 + scale * 4))
                  : form === 'weeping'
                    ? Math.max(2, Math.round(2 + scale * 3))
                    : form === 'palm'
                      ? Math.max(5, Math.round(5 + scale * 7))
                      : form === 'dead'
                        ? Math.max(3, Math.round(3 + scale * 5))
                        : form === 'mangrove'
                          ? Math.max(1, Math.round(1 + scale * 2))
                          : Math.max(2, Math.round(2.5 + scale * 3.5));

    const canopyY = y + bare;
    const [ax, az] = buildTrunk(grid, x, y, z, bare + unit, tw, trunkBlock.id, 0, 0);
    const cx = x + ax,
        cz = z + az;

    const lightId = twoTone ? pale.id : leaf.id;
    const dx = rng.pick([-1, 1]),
        dz = rng.pick([-1, 1]);
    let minX = Infinity,
        maxX = -Infinity,
        minZ = Infinity,
        maxZ = -Infinity;
    let topY = canopyY;
    const fillBox = (ox: any, oy: any, oz: any, sx: any, sy: any, sz: any, id: any) => {
        const px = cx + ox - Math.floor(sx / 2);
        const py = canopyY + oy;
        const pz = cz + oz - Math.floor(sz / 2);
        for (let by = 0; by < sy; by++)
            for (let bz = 0; bz < sz; bz++) for (let bx = 0; bx < sx; bx++) grid.set(px + bx, py + by, pz + bz, id);
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px + sx - 1);
        minZ = Math.min(minZ, pz);
        maxZ = Math.max(maxZ, pz + sz - 1);
        topY = Math.max(topY, py + sy - 1);
    };

    switch (form) {
        case 'round': {
            // Spherical mounded crown — even silhouette, good contrast to stack.
            if (large) {
                fillBox(0, 0, 0, 5, 2, 5, leaf.id);
                fillBox(3 * dx, 0, dz, 2, 2, 3, leaf.id);
                fillBox(-2 * dx, 0, 3 * dz, 3, 2, 2, leaf.id);
                fillBox(dx, 2, -dz, 4, 2, 4, lightId);
                fillBox(-2 * dx, 2, dz, 2, 2, 2, leaf.id);
                fillBox(dx, 4, dz, 2, 2, 2, lightId);
            } else if (unit === 2) {
                fillBox(0, 0, 0, 4, 2, 4, leaf.id);
                fillBox(2 * dx, 0, dz, 2, 2, 2, leaf.id);
                fillBox(-dx, 2, 2 * dz, 2, 2, 2, lightId);
                fillBox(0, 3, 0, 3, 1, 3, lightId);
                fillBox(dx, 4, dz, 2, 1, 2, lightId);
            } else {
                fillBox(0, 0, 0, 3, 1, 3, leaf.id);
                fillBox(dx, 1, dz, 2, 1, 2, lightId);
                fillBox(0, 2, 0, 2, 1, 2, lightId);
            }
            break;
        }
        case 'broad': {
            // Wide flat spreading crown — Japanese maple / spreading oak.
            if (large) {
                fillBox(0, 0, 0, 7, 1, 5, leaf.id);
                fillBox(4 * dx, 0, dz, 2, 1, 3, leaf.id);
                fillBox(-3 * dx, 0, -2 * dz, 3, 1, 2, leaf.id);
                fillBox(dx, 1, -dz, 4, 1, 4, lightId);
                fillBox(-2 * dx, 1, 2 * dz, 2, 1, 2, lightId);
                fillBox(0, 2, 0, 3, 1, 3, lightId);
            } else if (unit === 2) {
                fillBox(0, 0, 0, 5, 1, 4, leaf.id);
                fillBox(3 * dx, 0, dz, 2, 1, 2, leaf.id);
                fillBox(dx, 1, 0, 3, 1, 3, lightId);
                fillBox(-dx, 1, 2 * dz, 2, 1, 2, lightId);
            } else {
                fillBox(0, 0, 0, 4, 1, 3, leaf.id);
                fillBox(2 * dx, 0, dz, 2, 1, 2, leaf.id);
                fillBox(dx, 1, dz, 2, 1, 2, lightId);
            }
            break;
        }
        case 'spire': {
            // Narrow conical — pine / cypress / fir.
            if (large) {
                fillBox(0, 0, 0, 4, 2, 4, leaf.id);
                fillBox(dx, 2, dz, 3, 2, 3, lightId);
                fillBox(0, 4, 0, 2, 2, 2, leaf.id);
                fillBox(dx, 6, 0, 2, 2, 2, lightId);
                fillBox(0, 8, 0, 1, 2, 1, leaf.id);
                fillBox(0, 10, 0, 1, 1, 1, lightId);
            } else if (unit === 2) {
                fillBox(0, 0, 0, 3, 2, 3, leaf.id);
                fillBox(dx, 2, dz, 2, 2, 2, lightId);
                fillBox(0, 4, 0, 2, 2, 2, leaf.id);
                fillBox(0, 6, 0, 1, 2, 1, lightId);
            } else {
                fillBox(0, 0, 0, 2, 2, 2, leaf.id);
                fillBox(dx, 2, dz, 1, 2, 1, lightId);
                fillBox(0, 4, 0, 1, 1, 1, leaf.id);
            }
            break;
        }
        case 'twin': {
            // Two crown masses side by side — forked canopy.
            if (large) {
                fillBox(-3 * dx, 0, 0, 4, 2, 4, leaf.id);
                fillBox(3 * dx, 1, dz, 3, 2, 3, lightId);
                fillBox(-dx, 2, -dz, 2, 2, 2, lightId);
                fillBox(2 * dx, 3, 0, 2, 2, 2, lightId);
            } else if (unit === 2) {
                fillBox(-2 * dx, 0, 0, 3, 2, 3, leaf.id);
                fillBox(2 * dx, 1, dz, 3, 2, 3, lightId);
                fillBox(0, 2, 0, 2, 1, 2, lightId);
            } else {
                fillBox(-dx, 0, 0, 2, 1, 2, leaf.id);
                fillBox(dx, 1, dz, 2, 1, 2, lightId);
            }
            break;
        }
        case 'bunch': {
            // Loose cluster of smaller irregular blobs.
            if (large) {
                fillBox(0, 0, 0, 3, 2, 3, leaf.id);
                fillBox(4 * dx, 0, dz, 3, 2, 3, leaf.id);
                fillBox(-2 * dx, 1, 3 * dz, 2, 2, 2, lightId);
                fillBox(dx, 2, -2 * dz, 2, 2, 2, lightId);
                fillBox(-dx, 3, dz, 2, 1, 2, lightId);
            } else if (unit === 2) {
                fillBox(0, 0, 0, 2, 2, 2, leaf.id);
                fillBox(3 * dx, 0, dz, 2, 2, 2, leaf.id);
                fillBox(-dx, 1, 2 * dz, 2, 2, 2, lightId);
                fillBox(dx, 2, 0, 2, 1, 2, lightId);
            } else {
                fillBox(0, 0, 0, 2, 1, 2, leaf.id);
                fillBox(2 * dx, 0, dz, 1, 1, 2, leaf.id);
                fillBox(dx, 1, dz, 1, 1, 1, lightId);
            }
            break;
        }
        case 'nub': {
            // Tiny rounded cap — mostly for small/highland scrub trees.
            if (unit === 2) {
                fillBox(0, 0, 0, 3, 1, 3, leaf.id);
                fillBox(dx, 1, dz, 2, 1, 2, lightId);
            } else {
                fillBox(0, 0, 0, 2, 1, 2, leaf.id);
                fillBox(dx, 1, dz, 1, 1, 1, lightId);
            }
            break;
        }
        case 'umbrella': {
            // Wide flat disc crown — acacia / lone savanna tree.
            // Tall trunk, then a very flat broad canopy.
            const w = large ? 7 : unit === 2 ? 5 : 4;
            fillBox(0, 0, 0, w, 1, w, leaf.id);
            fillBox(dx * 2, 0, dz, Math.ceil(w / 2), 1, Math.ceil(w / 3), leaf.id);
            fillBox(-dx, 1, -dz, Math.ceil(w / 2), 1, Math.ceil(w / 2), lightId);
            if (unit === 2) fillBox(dx, 2, dz, 2, 1, 2, lightId);
            break;
        }
        case 'tall': {
            // Birch/poplar: very tall bare trunk, small airy crown.
            if (large) {
                fillBox(0, 0, 0, 3, 2, 3, leaf.id);
                fillBox(dx * 2, 1, dz, 2, 2, 2, lightId);
                fillBox(0, 3, 0, 2, 1, 2, lightId);
            } else if (unit === 2) {
                fillBox(0, 0, 0, 3, 2, 3, leaf.id);
                fillBox(dx, 2, dz, 2, 1, 2, lightId);
            } else {
                fillBox(0, 0, 0, 2, 1, 2, leaf.id);
                fillBox(dx, 1, dz, 1, 1, 1, lightId);
            }
            break;
        }
        case 'layered': {
            // Tiered horizontal discs: pagoda / cedar silhouette.
            const tiers = large ? 4 : unit === 2 ? 3 : 2;
            const baseW = large ? 7 : unit === 2 ? 5 : 3;
            const gap = unit === 2 ? 3 : 2;
            for (let t = 0; t < tiers; t++) {
                const w = Math.max(1, baseW - t * 2);
                const oy = t * gap;
                fillBox(t & 1 ? dx : 0, oy, t & 1 ? dz : 0, w, 1, w, t === 0 ? leaf.id : lightId);
            }
            break;
        }
        case 'weeping': {
            // Wide drooping skirt with a lifted central crown — weeping cherry.
            if (large) {
                fillBox(0, 0, 0, 7, 1, 7, leaf.id);
                fillBox(3 * dx, 0, dz, 3, 2, 2, leaf.id);
                fillBox(-2 * dx, 0, 3 * dz, 2, 2, 3, leaf.id);
                fillBox(0, 2, 0, 4, 2, 4, lightId);
                fillBox(dx, 4, dz, 2, 1, 2, lightId);
            } else if (unit === 2) {
                fillBox(0, 0, 0, 5, 1, 5, leaf.id);
                fillBox(2 * dx, 0, dz, 2, 2, 2, leaf.id);
                fillBox(0, 2, 0, 3, 2, 3, lightId);
                fillBox(dx, 3, dz, 2, 1, 2, lightId);
            } else {
                fillBox(0, 0, 0, 4, 1, 3, leaf.id);
                fillBox(dx, 1, dz, 2, 1, 2, lightId);
            }
            break;
        }
        case 'palm': {
            // Coastal palm — tall bare trunk, flat radiating frond disc at the top.
            const frondW = large ? 9 : unit === 2 ? 7 : 5;
            fillBox(0, 0, 0, frondW, 1, frondW, leaf.id);
            fillBox(3 * dx, 0, dz, 2, 2, 2, leaf.id);
            fillBox(-2 * dx, 0, 2 * dz, 2, 2, 2, leaf.id);
            fillBox(dx, 1, -dz, Math.ceil(frondW / 2), 1, Math.ceil(frondW / 2), lightId);
            break;
        }
        case 'dead': {
            // Dead bleached tree — bare trunk, short stub branches, no leaf canopy.
            const stubLen = large ? 3 : 2;
            fillBox(2 * dx, 0, 0, stubLen, 1, 1, trunkBlock.id);
            fillBox(0, 1, 2 * dz, 1, 1, stubLen, trunkBlock.id);
            if (large) fillBox(-dx, 2, -dz, 2, 1, 1, trunkBlock.id);
            break;
        }
        case 'mangrove': {
            // Wetland mangrove — exposed stilt roots near base, broad low crown.
            // Stilt root struts fanning out at y+1
            for (const [rx, rz] of [
                [2 * dx, 0],
                [0, 2 * dz],
                [-dx, dz],
                [dx, -dz],
            ] as [number, number][]) {
                grid.set(cx + rx, y + 1, cz + rz, trunkBlock.id);
            }
            // Broad low crown
            if (large) {
                fillBox(0, 0, 0, 5, 1, 5, leaf.id);
                fillBox(3 * dx, 0, dz, 2, 2, 2, leaf.id);
                fillBox(-2 * dx, 0, -2 * dz, 2, 1, 3, leaf.id);
                fillBox(dx, 1, -dz, 3, 1, 3, lightId);
            } else if (unit === 2) {
                fillBox(0, 0, 0, 4, 1, 4, leaf.id);
                fillBox(2 * dx, 0, dz, 2, 1, 2, leaf.id);
                fillBox(dx, 1, 0, 3, 1, 3, lightId);
            } else {
                fillBox(0, 0, 0, 3, 1, 3, leaf.id);
                fillBox(dx, 1, dz, 2, 1, 2, lightId);
            }
            break;
        }
        /* ---- named species (placed by altitude; see SPECIES) ------------ */
        case 'oak': {
            // Broad, heavy, irregular crown wider than tall, on a short thick trunk.
            const w = large ? 9 : unit === 2 ? 7 : 5;
            fillBox(0, 0, 0, w, 2, w - 1, leaf.id);
            fillBox(3 * dx, 1, -2 * dz, 3, 2, 3, leaf.id);
            fillBox(-3 * dx, 1, 2 * dz, 3, 2, 3, leaf.id);
            fillBox(dx, 2, dz, w - 3, 2, w - 3, lightId);
            fillBox(-dx, 4, 0, Math.max(2, w - 5), 1, Math.max(2, w - 5), lightId);
            break;
        }
        case 'birch': {
            // Slim pale trunk, narrow airy crown of small loose clumps.
            const h = large ? 6 : unit === 2 ? 5 : 3;
            for (let k = 0; k < h; k += 2) {
                const ox = k % 4 === 0 ? dx : -dx;
                fillBox(ox, k, k % 4 === 0 ? 0 : dz, 2, 2, 2, k % 4 === 0 ? leaf.id : lightId);
            }
            fillBox(0, h, 0, 1, 1, 1, lightId);
            break;
        }
        case 'pine': {
            // Tall bare trunk (bare is long), a compact rounded-flat crown on top
            // with a couple of short side whorls just below it.
            const w = large ? 5 : unit === 2 ? 4 : 3;
            fillBox(0, 0, 0, w, 1, w, leaf.id);
            fillBox(2 * dx, -2, 0, 2, 1, 2, leaf.id);
            fillBox(-2 * dx, -3, dz, 2, 1, 2, leaf.id);
            fillBox(0, 1, 0, w - 1, 1, w - 1, lightId);
            fillBox(dx, 2, dz, Math.max(1, w - 3), 1, Math.max(1, w - 3), lightId);
            break;
        }
        case 'fir': {
            // Dense symmetric cone, skirts almost to the ground.
            const tiers = large ? 6 : unit === 2 ? 5 : 3;
            const base = large ? 7 : unit === 2 ? 5 : 3;
            for (let t = 0; t < tiers; t++) {
                const w = Math.max(1, base - Math.floor((t * base) / tiers) - (t > tiers - 2 ? 1 : 0));
                fillBox(0, t * 2, 0, w, 2, w, t & 1 ? lightId : leaf.id);
            }
            fillBox(0, tiers * 2, 0, 1, 1, 1, lightId);
            break;
        }
        case 'spruce': {
            // Taller and narrower than fir, with visible gaps between drooping tiers.
            const tiers = large ? 7 : unit === 2 ? 6 : 4;
            const base = large ? 5 : unit === 2 ? 4 : 3;
            for (let t = 0; t < tiers; t++) {
                const w = Math.max(1, base - Math.floor((t * base) / (tiers + 1)));
                fillBox(t & 1 ? dx : 0, t * 2, 0, w, 1, w, t & 1 ? lightId : leaf.id);
                if (w >= 3) fillBox(0, t * 2 + 1, 0, w - 2, 1, w - 2, leaf.id);
            }
            fillBox(0, tiers * 2, 0, 1, 2, 1, leaf.id);
            break;
        }
        case 'cypress': {
            // Tall narrow column (Mediterranean / Italian cypress).
            const h = large ? 12 : unit === 2 ? 9 : 6;
            fillBox(0, 0, 0, 2, h - 2, 2, leaf.id);
            fillBox(dx, 2, 0, 1, h - 5, 1, lightId);
            fillBox(0, h - 2, 0, 1, 2, 1, lightId);
            break;
        }
        case 'acacia': {
            // Savanna umbrella: trunk forks into two leaning limbs, very flat
            // wide crown, with a second smaller flat layer offset beside it.
            const w = large ? 9 : unit === 2 ? 7 : 5;
            grid.set(cx + dx, canopyY - 1, cz, trunkBlock.id);
            grid.set(cx - dx, canopyY - 1, cz + dz, trunkBlock.id);
            fillBox(0, 0, 0, w, 1, w - 2, leaf.id);
            fillBox(dx * Math.ceil(w / 3), -1, dz * 2, Math.ceil(w / 2), 1, Math.ceil(w / 2), leaf.id);
            fillBox(-dx, 1, 0, w - 3, 1, Math.max(2, w - 5), lightId);
            break;
        }
        case 'willow': {
            // Rounded crown with long hanging strands around the rim reaching
            // most of the way to the ground.
            const w = large ? 7 : unit === 2 ? 5 : 4;
            fillBox(0, 0, 0, w, 2, w, leaf.id);
            fillBox(0, 2, 0, w - 2, 1, w - 2, lightId);
            const r = Math.floor(w / 2);
            const drop = Math.max(2, bare - 1);
            for (let a = 0; a < 12; a++) {
                if (!rng.chance(0.7)) continue;
                const th = (a / 12) * Math.PI * 2;
                const sx = cx + Math.round(Math.cos(th) * r),
                    sz = cz + Math.round(Math.sin(th) * r);
                const len = rng.int(Math.ceil(drop * 0.5), drop);
                for (let k = 1; k <= len; k++) grid.set(sx, canopyY - k, sz, k & 1 ? leaf.id : lightId);
            }
            break;
        }
        case 'kapok': {
            // Rainforest emergent: very tall trunk with plank buttress roots,
            // a high flat spreading crown.
            for (const [rx, rz] of [
                [2, 0],
                [-2, 0],
                [0, 2],
                [0, -2],
            ] as [number, number][]) {
                grid.set(cx + rx, y, cz + rz, trunkBlock.id);
                grid.set(cx + rx / 2, y + 1, cz + rz / 2, trunkBlock.id);
                grid.set(cx + rx / 2, y, cz + rz / 2, trunkBlock.id);
            }
            const w = large ? 11 : 9;
            fillBox(0, 0, 0, w, 1, w, leaf.id);
            fillBox(3 * dx, 1, -2 * dz, 4, 1, 4, lightId);
            fillBox(-3 * dx, 1, 2 * dz, 4, 1, 4, lightId);
            fillBox(0, 2, 0, 5, 1, 5, leaf.id);
            break;
        }
        case 'baobab': {
            // Fat bottle trunk (tw = 2–3, widened again mid-height), a sparse
            // small crown of stubby branch tips on top.
            const o = -Math.floor((tw + 1) / 2);
            for (let ty = 1; ty < bare - 1; ty++)
                for (let ddx = 0; ddx < tw + 2; ddx++)
                    for (let ddz = 0; ddz < tw + 2; ddz++) {
                        const edge = ddx === 0 || ddz === 0 || ddx === tw + 1 || ddz === tw + 1;
                        const corner = (ddx === 0 || ddx === tw + 1) && (ddz === 0 || ddz === tw + 1);
                        if (edge && (corner || ty === 1 || ty === bare - 2)) continue;
                        grid.set(cx + o + ddx, y + ty, cz + o + ddz, trunkBlock.id);
                    }
            for (const [bx, bz] of [
                [2, 0],
                [-2, 1],
                [1, -2],
                [-1, 2],
            ] as [number, number][]) {
                grid.set(cx + bx, canopyY, cz + bz, trunkBlock.id);
                fillBox(bx, 1, bz, 2, 1, 2, rng.chance(0.5) ? leaf.id : lightId);
            }
            fillBox(0, 1, 0, 3, 1, 3, leaf.id);
            break;
        }
        case 'juniper': {
            // Wind-twisted scrub: short leaning trunk, a few lopsided dense pads.
            grid.set(cx + dx, canopyY, cz, trunkBlock.id);
            grid.set(cx + 2 * dx, canopyY + 1, cz + dz, trunkBlock.id);
            fillBox(2 * dx, 1, dz, unit === 2 ? 4 : 3, 2, unit === 2 ? 3 : 2, leaf.id);
            fillBox(-dx, 0, -dz, 2, 2, 2, leaf.id);
            fillBox(3 * dx, 3, dz, 2, 1, 2, lightId);
            break;
        }
        case 'snag': {
            // Dead standing tree: pale bare trunk, a broken top, two or three
            // angled dead limbs. No foliage at all.
            const limbs = large ? 3 : 2;
            for (let k = 0; k < limbs; k++) {
                const ldx = k & 1 ? dx : -dx,
                    ldz = k === 2 ? dz : 0;
                const ly = canopyY - 1 - k * 2;
                for (let s = 1; s <= (large ? 3 : 2); s++)
                    grid.set(cx + ldx * s, ly + Math.floor(s / 2), cz + ldz * s, trunkBlock.id);
            }
            // Broken jagged top
            grid.set(cx, canopyY + 1, cz, trunkBlock.id);
            if (rng.chance(0.5)) grid.set(cx + dx, canopyY + 2, cz, trunkBlock.id);
            topY = Math.max(topY, canopyY + 2);
            minX = Math.min(minX, cx - 3);
            maxX = Math.max(maxX, cx + 3);
            minZ = Math.min(minZ, cz - 1);
            maxZ = Math.max(maxZ, cz + 1);
            break;
        }

        case 'stack':
        default: {
            // Original architecture: broad lower mass + asymmetric shoulders + offset crown.
            if (large) {
                fillBox(0, 0, 0, 6, 2, 4, leaf.id);
                fillBox(-4 * dx, 0, 0, 2, 2, 2, leaf.id);
                fillBox(4 * dx, 1, dz, 2, 2, 2, lightId);
                fillBox(-dx, 0, -3 * dz, 2, 2, 2, leaf.id);
                fillBox(dx, 1, 3 * dz, 2, 2, 2, lightId);
                fillBox(dx, 2, -dz, 4, 2, 4, lightId);
                fillBox(-3 * dx, 2, dz, 2, 2, 2, leaf.id);
                fillBox(3 * dx, 3, -dz, 2, 2, 2, lightId);
                fillBox(-dx, 4, dz, 2, 2, 2, lightId);
            } else if (unit === 2) {
                fillBox(0, 0, 0, 4, 2, 4, leaf.id);
                fillBox(-3 * dx, 0, 0, 2, 2, 2, leaf.id);
                fillBox(3 * dx, 1, dz, 2, 2, 2, lightId);
                fillBox(0, 0, -3 * dz, 2, 2, 2, leaf.id);
                fillBox(dx, 2, 0, 4, 2, 2, lightId);
                fillBox(-dx, 4, dz, 2, 2, 2, lightId);
            } else {
                fillBox(0, 0, 0, 3, 1, 3, leaf.id);
                fillBox(-2 * dx, 0, 0, 1, 1, 2, leaf.id);
                fillBox(2 * dx, 1, dz, 1, 1, 1, lightId);
                fillBox(dx, 1, 0, 2, 1, 2, lightId);
                fillBox(-dx, 2, dz, 1, 1, 1, lightId);
            }
        }
    }

    // Scatter extra foliage tufts around the crown to break the uniform silhouette
    // and add height variation — smaller clusters at random heights and offsets.
    // Skipped where the silhouette IS the species (conifers, columns, hanging
    // strands) and for dead trees, which have no foliage to scatter.
    if (!NO_TUFTS.has(form)) {
        const spread = large ? 3 : unit === 2 ? 2 : 1;
        const crownH = topY - canopyY;
        const count = large ? rng.int(5, 9) : unit === 2 ? rng.int(3, 6) : rng.int(2, 4);
        for (let k = 0; k < count; k++) {
            const ox = rng.int(-spread, spread);
            const oz = rng.int(-spread, spread);
            const oy = rng.int(0, Math.max(1, crownH + 1)); // distribute across full crown height
            const sw = rng.chance(0.55) ? 2 : 1;
            fillBox(ox, oy, oz, sw, 1, sw, rng.chance(0.55) ? lightId : leaf.id);
        }
    }

    // Keep the visible trunk perfectly vertical and terminate it at the crown.
    const trunkOffset = -Math.floor((tw - 1) / 2);
    for (let ty = 0; ty < bare; ty++)
        for (let ddx = 0; ddx < tw; ddx++)
            for (let ddz = 0; ddz < tw; ddz++)
                grid.set(cx + trunkOffset + ddx, y + ty, cz + trunkOffset + ddz, trunkBlock.id);

    const width = Math.max(maxX - minX + 1, maxZ - minZ + 1);
    const R = width * 0.5;
    return {
        x: cx,
        y: canopyY,
        z: cz,
        w: width,
        leaf,
        height: topY - y + 1,
        form,
        trunkY: y,
        trunkW: tw,
        topY,
        R,
    };
}

/* ================================================================== *
 * Bushes & scrub
 * ================================================================== */

type BushForm = 'mound' | 'spread' | 'tall' | 'cluster';

/**
 * A low bush in one of four silhouettes. Every voxel is checked against the
 * column height to prevent cantilevering over terrace lips.
 *
 * @param size  0 = tiny (1-wide), 1 = small, 2 = medium
 * @param form  shape variant; defaults to random
 */
export function plantBush(
    grid: any,
    heights: any,
    S: number,
    x: number,
    z: number,
    rng: any,
    block: any,
    size: number,
    form: BushForm = rng.pick(['mound', 'mound', 'spread', 'tall', 'cluster']) as BushForm,
) {
    const top = heights[z * S + x];

    /** Place one voxel only if it sits on a column matching `top` and is unoccupied. */
    const put = (xx: number, yy: number, zz: number) => {
        if (xx < 1 || zz < 1 || xx >= S - 1 || zz >= S - 1) return;
        if (heights[zz * S + xx] !== top) return; // no cantilevering
        if (grid.isSolid(xx, top + 1, zz)) return;
        grid.set(xx, top + yy, zz, block.id);
    };

    switch (form) {
        case 'spread': {
            // Very flat and wide — single layer, larger footprint.
            const w = size + 1;
            for (let dz = -w; dz <= w; dz++)
                for (let dx = -w; dx <= w; dx++) {
                    if (Math.abs(dx) + Math.abs(dz) > w + 1) continue;
                    put(x + dx, 1, z + dz);
                }
            // Low raised centre
            if (size >= 1) put(x, 2, z);
            break;
        }
        case 'tall': {
            // Narrow at base, taller — upright shrub / small hedge.
            const w = Math.max(0, size - 1);
            const h = size >= 2 ? rng.int(3, 4) : size === 1 ? rng.int(2, 3) : 2;
            for (let dz = -w; dz <= w; dz++)
                for (let dx = -w; dx <= w; dx++) {
                    const e = Math.abs(dx) + Math.abs(dz);
                    if (e > w) continue;
                    const hh = Math.max(1, h - e);
                    for (let dy = 1; dy <= hh; dy++) put(x + dx, dy, z + dz);
                }
            // Slightly wider cap at mid-height
            if (size >= 1) {
                const capH = Math.floor(h / 2);
                for (let dz = -1; dz <= 1; dz++)
                    for (let dx = -1; dx <= 1; dx++) {
                        if (Math.abs(dx) + Math.abs(dz) > 1) continue;
                        put(x + dx, capH, z + dz);
                    }
            }
            break;
        }
        case 'cluster': {
            // Two offset blobs — forked shrub / twin tufts.
            const ox = rng.pick([-1, 1]) * (size + 1);
            const oz = rng.pick([-1, 1]);
            const h = size >= 2 ? 2 : 1;
            // Primary blob
            for (let dz = -1; dz <= 1; dz++)
                for (let dx = -1; dx <= 1; dx++) {
                    if (Math.abs(dx) + Math.abs(dz) > 1 + (size >= 2 ? 1 : 0)) continue;
                    for (let dy = 1; dy <= h; dy++) put(x + dx, dy, z + dz);
                }
            // Secondary blob — offset, slightly shorter
            for (let dz = -1; dz <= 1; dz++)
                for (let dx = -1; dx <= 1; dx++) {
                    if (Math.abs(dx) + Math.abs(dz) > 1) continue;
                    put(x + ox + dx, 1, z + oz + dz);
                }
            break;
        }
        case 'mound':
        default: {
            // Original diamond-taper mound — the reliable baseline.
            const w = size;
            const h = size >= 2 ? rng.int(2, 3) : size === 1 ? rng.int(1, 2) : 1;
            for (let dz = -w; dz <= w; dz++)
                for (let dx = -w; dx <= w; dx++) {
                    const xx = x + dx,
                        zz = z + dz;
                    if (xx < 1 || zz < 1 || xx >= S - 1 || zz >= S - 1) continue;
                    if (heights[zz * S + xx] !== top) continue;
                    if (grid.isSolid(xx, top + 1, zz)) continue;
                    const e = Math.abs(dx) + Math.abs(dz);
                    if (e > w + (w >= 2 ? 1 : 0)) continue;
                    const hh = Math.max(1, h - (e >= w ? 1 : 0));
                    for (let dy = 0; dy < hh; dy++) grid.set(xx, top + 1 + dy, zz, block.id);
                }
        }
    }
}

/* ================================================================== *
 * Scatter
 * ================================================================== */

/**
 * Noise seeds are constants, not derived from the shared world rng. The grove
 * layout is art direction: it must not shift because another generator
 * upstream happened to draw a different number of randoms this week.
 */
const N_GROVE = makeNoise2D(0x6c17);
const N_HUE = makeNoise2D(0x2f83);
const N_MEAD = makeNoise2D(0x91ab);
const N_FLOW = makeNoise2D(0x4d5e);

export function scatterVegetation(world: any, rng: any) {
    const { grid, heights, wetness, size: S, plan } = world;
    /* Every dart-throwing budget below was a constant tuned against a 256-block
     * world. Left constant, a 1024-block map gets a sixteenth of the planting
     * per acre — the single fastest way to make a large world feel abandoned. */
    const AREA = (S / 256) ** 2;

    /* ---- what each biome grows ---------------------------------------
     * The plan decides where the forests ARE; the noise below decides only how
     * they thin out inside their own region. Before this the grove field alone
     * chose everything, so blossom spread at one average density across the
     * whole island and the map had no places in it — just more trees, then
     * slightly fewer trees.
     *
     * Multipliers rather than gates: a hard cutoff at a biome edge draws a
     * visible line on the ground, and the warped Voronoi boundary is meant to
     * be felt, not seen.
     */
    /* Species, not just density.
     *
     * Multipliers rather than gates: a hard cutoff at a biome edge draws a
     * visible line on the ground, and the warped Voronoi boundary is meant to be
     * felt, not seen. The palette does change at the border, but a stand thins
     * across it rather than stopping dead. */
    const FALLBACK = BIOME_FLORA[BIOME.MEADOW];
    const floraAt = (x: any, z: any) => (plan ? BIOME_FLORA[plan.biomeAt(x, z)] : null) || FALLBACK;
    const biomeTrees = (x: any, z: any) => floraAt(x, z).density;
    // Scene trees are already in the ground; they belong in the same list so
    // petals fall from them and the capture rig can frame them.
    const trees = world.stampTrees ? world.stampTrees.slice() : [];
    const occupied = new Uint8Array(S * S);
    // Read from the palette, never restated. This was a literal 9.35 — correct
    // when it was written and silently wrong the moment the waterline moved to
    // 24.35, which put every shoreline test fifteen blocks below the shoreline.
    const sea = Math.floor(WATER.level);

    const claim = (x: any, z: any, r: any) => {
        for (let dz = -r; dz <= r; dz++)
            for (let dx = -r; dx <= r; dx++) {
                const xx = x + dx,
                    zz = z + dz;
                if (xx < 0 || zz < 0 || xx >= S || zz >= S) continue;
                occupied[zz * S + xx] = 1;
            }
    };
    const free = (x: any, z: any, r: any) => {
        for (let dz = -r; dz <= r; dz++)
            for (let dx = -r; dx <= r; dx++) {
                const xx = x + dx,
                    zz = z + dz;
                if (xx < 0 || zz < 0 || xx >= S || zz >= S) return false;
                if (occupied[zz * S + xx]) return false;
            }
        return true;
    };

    /* ---- reserve everything props already built -------------------- */
    /* Scene clearings first. These are the one thing this pass cannot infer:
     * a swept floor with nothing on it looks exactly like ordinary open ground,
     * and the scatter would plant it out and destroy the composition that
     * emptiness was there to create. */
    if (world.reserved) occupied.set(world.reserved);

    // props.js and stamps.js run before this pass, so anything standing above
    // the heightfield (bridge decks, piers, lanterns, gates) or paved into it is
    // off limits.
    for (let z = 0; z < S; z++)
        for (let x = 0; x < S; x++) {
            const i = z * S + x;
            const top = heights[i];
            const id = grid.get(x, top, z);
            if (
                id === BLOCKS.PATH.id ||
                id === BLOCKS.PLANK.id ||
                id === BLOCKS.BEAM.id ||
                grid.columnTop(x, z) > top
            ) {
                occupied[i] = 1;
            }
        }
    const reserved = occupied.slice();
    for (let z = 2; z < S - 2; z++)
        for (let x = 2; x < S - 2; x++)
            if (reserved[z * S + x])
                for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) occupied[(z + dz) * S + (x + dx)] = 1;

    /* ---- fields ---------------------------------------------------- */
    /** -1..1, feature size ~90 blocks: which parts of the map are woodland. */
    const grove = (x: any, z: any) => fbm2(N_GROVE, x * 0.0115, z * 0.0115, 3);
    // Species picks and species builders draw from their own stream, so adding
    // or retuning a species never moves the rest of the world (DESIGN.md,
    // Determinism). The shared rng still decides *where* a tree goes.
    const speciesRng = makeRng(0x5bec ^ S);
    /** 0..1, drives blossom hue by region so a stand reads as one species. */
    const hue = (x: any, z: any) => (fbm2(N_HUE, x * 0.0085 + 40, z * 0.0085 - 17, 2) + 1) * 0.5;

    const siteOk = (x: any, z: any, needFlat: any, tol: any) => {
        const i = z * S + x;
        if (!GRASS_IDS.has(grid.get(x, heights[i], z))) return false;
        if (wetness[i] > 0.5) return false;
        return flatEnough(heights, S, x, z, needFlat, tol);
    };

    const plant = (x: any, z: any, scale: any, form?: any) => {
        const i = z * S + x;
        const flora = floraAt(x, z);
        /* The hue field still runs, but only to pick *within* the biome's palette,
         * so neighbouring stands in one province differ without ever crossing into
         * another province's species. Before, hue chose everything and a sakura
         * region could come out mint. */
        const band = flora.leaves;
        const leaf = band[clamp(Math.floor(hue(x, z) * band.length), 0, band.length - 1)];
        const t = plantTree(grid, x, heights[i] + 1, z, rng, {
            scale,
            leaf,
            form: form || rng.pick(flora.forms),
        });
        trees.push(t);
        claim(x, z, Math.max(2, Math.floor(t.w / 2)));
        return t;
    };

    /* ---- the hero tree ---------------------------------------------
     * One large specimen standing alone on the broadest high plateau. Every
     * good diorama has a place the eye goes first; without this the map is a
     * texture of trees with no focal point.                                  */
    {
        let best = null,
            bestScore = -1;
        for (let z = 16; z < S - 16; z += 2)
            for (let x = 16; x < S - 16; x += 2) {
                const i = z * S + x;
                if (!siteOk(x, z, 5, 0)) continue;
                const dx = (x - S / 2) / (S / 2),
                    dz = (z - S / 2) / (S / 2);
                const score = (heights[i] - sea) * (1 - Math.hypot(dx, dz) * 0.8);
                if (score > bestScore) {
                    bestScore = score;
                    best = [x, z];
                }
            }
        if (best) {
            world.heroTree = plant(best[0], best[1], 1.0, 'stack');
            claim(best[0], best[1], 12); // a clearing so it stands alone
        }
    }

    /* ---- grove cores ------------------------------------------------
     * Seed the densest points of the grove field with big trees first, so the
     * woodland has structure before the dart-throwing fills in around it.    */
    for (let attempt = 0, n = Math.round(900 * AREA); attempt < n; attempt++) {
        const x = rng.int(10, S - 11),
            z = rng.int(10, S - 11);
        if (grove(x, z) < 0.34) continue;
        if (!siteOk(x, z, 3, 1)) continue;
        if (!free(x, z, 7)) continue;
        plant(x, z, rng.range(0.78, 1.0));
    }

    /* ---- the woodland ----------------------------------------------- */
    for (let attempt = 0, n = Math.round(9000 * AREA); attempt < n; attempt++) {
        const x = rng.int(5, S - 6),
            z = rng.int(5, S - 6);
        const i = z * S + x;
        if (!siteOk(x, z, 2, 1)) continue;

        const g = grove(x, z);
        const elev01 = clamp((heights[i] - sea) / 34, 0, 1);
        // Sheltered valley floors get the richest blossom; the exposed tops get
        // much less, which is what makes the plateaus read as plateaus. Spread
        // over the full relief (~34 blocks; was 26) and eased (was ×0.82), so
        // the alpine bands carry a sparse treeline of conifers and snags.
        let dens = smoothstep(-0.2, 0.3, g);
        dens *= 1 - smoothstep(0.4, 1.0, elev01) * 0.65;
        dens *= 1 - smoothstep(0.3, 0.5, wetness[i]) * 0.5;
        /* Capped BEFORE the biome multiplier, which is the whole point.
         *
         * The grove field already exceeds 1 in its cores, and `chance` saturates
         * there — so multiplying by 1.65 added no trees at all and the biomes
         * arrived with a 1.3x spread instead of the 3x they specify. Leaving
         * headroom is what lets the plan actually be visible on the ground. */
        dens = Math.min(dens, 0.55) * biomeTrees(x, z);
        if (!rng.chance(dens * 0.85)) continue;

        // Trees run large in the grove cores and thin to saplings at the fringe.
        const core = smoothstep(0.0, 0.45, g);
        // Size range comes from the biome too — highland scrub-trees and sakura
        // giants are the same code path with different bounds.
        const [lo, hi] = floraAt(x, z).scale;
        const scale = clamp(rng.range(lo, hi) + core * (hi - lo) * 0.55, 0.1, 1.0);
        const rad = scale > 0.72 ? 6 : scale > 0.46 ? 4 : scale > 0.26 ? 3 : 2;
        if (!free(x, z, rad)) continue;

        /* Altitude decides the species.
         *
         * A real-world species is chosen from those that suit this continent's
         * climate and this height above the sea (see SPECIES), so a walk uphill
         * passes from palms or willows at the shore, through oaks and birches,
         * into pine, fir and spruce, and out to juniper scrub and dead snags at
         * the top. Sakura and meadow keep their blossom forms most of the time —
         * they are the world's signature — and every biome keeps some, so a
         * province never loses its colour entirely. */
        const alt = heights[i] - sea;
        const biome = plan ? plan.biomeAt(x, z) : BIOME.MEADOW;
        const blossomShare =
            biome === BIOME.SAKURA ? 0.85 : biome === BIOME.MEADOW ? 0.45 : biome === BIOME.HIGHLAND ? 0.08 : 0.2;
        const species =
            speciesRng() >= blossomShare
                ? pickSpecies(plan ? plan.climateAt(x, z) : 1, alt, wetness[i] > 0.3, speciesRng)
                : null;
        if (species) {
            const [slo, shi] = species.scale;
            // Keep the grove-core size boost, but within the species' own range.
            const sScale = clamp(slo + (shi - slo) * (0.35 * speciesRng() + core * 0.65), 0.1, 1.0);
            const band = floraAt(x, z).leaves;
            const leaf = band[clamp(Math.floor(hue(x, z) * band.length), 0, band.length - 1)];
            const t = plantTree(grid, x, heights[i] + 1, z, speciesRng, { scale: sScale, leaf, form: species.name });
            trees.push(t);
            claim(x, z, Math.max(2, Math.floor(t.w / 2)));
        } else {
            plant(x, z, scale);
        }
    }

    /* ---- the treeline ------------------------------------------------
     * The woodland pass wants flat grass, and high ground is mostly stone and
     * steep — so without this the alpine species (fir, spruce, juniper, snag)
     * barely ever got a site. A sparse dedicated pass above 12 blocks accepts
     * rock and a 1-block slope, and picks *only* by altitude and climate:
     * up here the blossom forms would look out of place. Thins with height so
     * the very tops stay bare. */
    for (let attempt = 0, n = Math.round(2600 * AREA); attempt < n; attempt++) {
        const x = speciesRng.int(5, S - 6),
            z = speciesRng.int(5, S - 6);
        const i = z * S + x;
        const alt = heights[i] - sea;
        if (alt < 12) continue;
        const top = grid.get(x, heights[i], z);
        if (!GRASS_IDS.has(top) && !STONE_IDS.has(top)) continue;
        if (grid.isSolid(x, heights[i] + 1, z) || !flatEnough(heights, S, x, z, 1, 1)) continue;
        if (!speciesRng.chance(0.55 * (1 - smoothstep(22, 34, alt) * 0.8))) continue;
        if (!free(x, z, 3)) continue;
        const sp = pickSpecies(plan ? plan.climateAt(x, z) : 1, alt, wetness[i] > 0.3, speciesRng);
        if (!sp) continue;
        const band = floraAt(x, z).leaves;
        const leaf = band[clamp(Math.floor(hue(x, z) * band.length), 0, band.length - 1)];
        const sScale = speciesRng.range(sp.scale[0], sp.scale[1]);
        const t = plantTree(grid, x, heights[i] + 1, z, speciesRng, { scale: sScale, leaf, form: sp.name });
        trees.push(t);
        claim(x, z, Math.max(2, Math.floor(t.w / 2)));
    }

    /* ---- the waterside -----------------------------------------------
     * The woodland pass rejects wet ground (wetness > 0.5) and thins anything
     * damp, so the two species that belong in it — mangrove and willow — had
     * nowhere to grow. A sparse pass along the low, wet margins of rivers and
     * lakes gives them their place. */
    const WET_SPECIES = SPECIES.filter((s) => s.wet);
    for (let attempt = 0, n = Math.round(1400 * AREA); attempt < n; attempt++) {
        const x = speciesRng.int(5, S - 6),
            z = speciesRng.int(5, S - 6);
        const i = z * S + x;
        const alt = heights[i] - sea;
        if (alt < 0 || alt > 8 || wetness[i] <= 0.3) continue;
        const top = grid.get(x, heights[i], z);
        if (!GRASS_IDS.has(top) && top !== BLOCKS.SAND.id) continue;
        if (grid.isSolid(x, heights[i] + 1, z) || !flatEnough(heights, S, x, z, 1, 1)) continue;
        if (!speciesRng.chance(0.35) || !free(x, z, 3)) continue;
        const climate = plan ? plan.climateAt(x, z) : 1;
        const fits = WET_SPECIES.filter((s) => s.climates.includes(climate) && alt <= s.alt[1] + ALT_SOFT);
        if (!fits.length) continue;
        const sp = speciesRng.pick(fits);
        const band = floraAt(x, z).leaves;
        const leaf = band[clamp(Math.floor(hue(x, z) * band.length), 0, band.length - 1)];
        const t = plantTree(grid, x, heights[i] + 1, z, speciesRng, {
            scale: speciesRng.range(sp.scale[0], sp.scale[1]),
            leaf,
            form: sp.name,
        });
        trees.push(t);
        claim(x, z, Math.max(2, Math.floor(t.w / 2)));
    }

    /* ---- bushes -----------------------------------------------------
     * An order of magnitude fewer than the earlier pass, clustered into
     * thickets at the feet of the groves rather than dart-thrown over the whole
     * map. Sizes and tones vary within a clump so it reads as undergrowth.   */
    for (let attempt = 0, n = Math.round(300 * AREA); attempt < n; attempt++) {
        const x = rng.int(4, S - 5),
            z = rng.int(4, S - 5);
        const i = z * S + x;
        const sid = grid.get(x, heights[i], z);
        if (!GRASS_IDS.has(sid) && sid !== BLOSSOM_DRIFT.id) continue;
        if (!flatEnough(heights, S, x, z, 2, 0)) continue;
        if (!free(x, z, 3)) continue;
        if (!rng.chance(smoothstep(-0.35, 0.3, grove(x, z)) * 0.75 + 0.12)) continue;

        const palette = floraAt(x, z).bushes;
        const base = rng.chance(0.78) ? rng.pick(palette) : rng.pick(BUSHES);
        const n = rng.int(1, 3);
        for (let k = 0; k < n; k++) {
            const bx = x + rng.int(-2, 2),
                bz = z + rng.int(-2, 2);
            if (bx < 2 || bz < 2 || bx >= S - 2 || bz >= S - 2) continue;
            if (occupied[bz * S + bx]) continue;
            const blk = rng.chance(0.75) ? base : rng.pick(palette);
            plantBush(grid, heights, S, bx, bz, rng, blk, rng.chance(0.3) ? 2 : rng.chance(0.7) ? 1 : 0);
            occupied[bz * S + bx] = 1;
        }
        claim(x, z, 3);
    }

    /* ---- scrub on the rocky tops ------------------------------------ */
    for (let attempt = 0, n = Math.round(700 * AREA); attempt < n; attempt++) {
        const x = rng.int(3, S - 4),
            z = rng.int(3, S - 4);
        const i = z * S + x;
        if (!STONE_IDS.has(grid.get(x, heights[i], z))) continue;
        if (grid.isSolid(x, heights[i] + 1, z)) continue;
        if (!rng.chance(0.24)) continue;
        plantBush(grid, heights, S, x, z, rng, rng.chance(0.8) ? SCRUB : BUSH_MAUVE, rng.chance(0.25) ? 1 : 0);
    }

    /* ---- ferns, thick moss, tall shrubs, tall grass ----------------- */
    for (let attempt = 0, n = Math.round(2000 * AREA); attempt < n; attempt++) {
        const x = rng.int(3, S - 4),
            z = rng.int(3, S - 4);
        const i = z * S + x;
        const top = heights[i];
        const sid = grid.get(x, top, z);
        if (grid.isSolid(x, top + 1, z)) continue;

        // Ferns: near water, damp areas, moderate altitude
        if (wetness[i] > 0.25 && top > sea + 1 && top < sea + 9 && GRASS_IDS.has(sid)) {
            if (rng.chance(0.22)) {
                const fernKind = rng.chance(0.15) ? FERN_RED : FERN;
                grid.set(x, top + 1, z, fernKind.id);
            }
            continue;
        }

        // Thick moss: flat rock / stone surfaces
        if (STONE_IDS.has(sid) && top > sea + 3) {
            if (rng.chance(0.3)) grid.set(x, top + 1, z, MOSS_THICK.id);
            continue;
        }

        // Tall shrubs: mid-altitude grass areas
        if (GRASS_IDS.has(sid) && top > sea + 5 && top < sea + 18) {
            if (rng.chance(0.12)) grid.set(x, top + 1, z, SHRUB_TALL.id);
            continue;
        }

        // Tall grass: low wetness, valley floors
        if (GRASS_IDS.has(sid) && wetness[i] < 0.1 && top >= sea + 1 && top <= sea + 5) {
            if (rng.chance(0.2)) grid.set(x, top + 1, z, GRASS_TALL.id);
        }
    }

    /* ---- moss over the cliff lips ------------------------------------
     * Only the block *below* the turf cap is swapped, so the moss shows on the
     * exposed cliff face and nowhere else — its own top is covered.          */
    for (let z = 1; z < S - 1; z++)
        for (let x = 1; x < S - 1; x++) {
            const i = z * S + x;
            const top = heights[i];
            const sid = grid.get(x, top, z);
            if (!GRASS_IDS.has(sid) && sid !== BLOSSOM_DRIFT.id) continue;
            const drop = Math.max(
                top - heights[i - 1],
                top - heights[i + 1],
                top - heights[i - S],
                top - heights[i + S],
            );
            if (drop < 3) continue;
            // Full green blocks down a cliff became vertical stripes. The material
            // fringe already draws the fine turf lip, so keep only a rare one-block
            // moss note at especially tall drops.
            if (!rng.chance(0.035)) continue;
            const n = 1;
            for (let k = 1; k <= n; k++) grid.set(x, top - k, z, MOSS.id);
        }

    /* ---- the sub-voxel layer ---------------------------------------- */
    // Ground blossom belongs in this layer as individual paper-like petals,
    // not as metre-wide replacement turf blocks.
    world.trees = trees;
    world.decorations.push(buildGroundDetail(world, rng, occupied));

    world.occupied = occupied;
    return trees;
}

/* ================================================================== *
 * Ground detail
 *
 * Tuned for the ~25-blocks-across framing: fewer, larger and more deliberate
 * than a fine dusting. At this camera distance a metre of ground is ~64px, so
 * a scatter dense enough to read as "texture" from far away reads as literal
 * clutter up close. Everything here is meant to be countable.
 * ================================================================== */

function buildGroundDetail(world: any, rng: any, occupied?: Uint8Array) {
    const { grid, heights, wetness, size: S } = world;
    const F = new DetailField();
    // Read from the palette, never restated. This was a literal 9.35 — correct
    // when it was written and silently wrong the moment the waterline moved to
    // 24.35, which put every shoreline test fifteen blocks below the shoreline.
    const sea = Math.floor(WATER.level);

    // Colours come off palette blocks, never invented here, so this layer tracks
    // whatever the materials owner does to the ground next.
    const tuftDark = new THREE.Color();
    const tuftLite = new THREE.Color();
    const pebbleCols = [BLOCKS.STONE.top, BLOCKS.STONE_PALE.top, BLOCKS.STONE_WARM.top];
    const flowerTops = [
        BLOCKS.LEAF_PINK.top,
        BLOCKS.LEAF_BLUSH.top,
        BLOCKS.LEAF_LILAC.top,
        BLOCKS.LEAF_CREAM.top,
        BLOCKS.LEAF_ROSE.top,
    ];
    const petalCols = [BLOCKS.LEAF_BLUSH.top, BLOCKS.LEAF_PINK.top, BLOCKS.LEAF_ROSE.top];
    const reedBase = BLOCKS.GRASS_DEEP.topTint,
        reedTip = BLOCKS.GRASS_LIGHT.top;

    /** 0..1 meadow field: some shelves are lush, some are close-cropped. */
    const meadow = (x: any, z: any) => (fbm2(N_MEAD, x * 0.026, z * 0.026, 2) + 1) * 0.5;
    const flowerField = (x: any, z: any) => (fbm2(N_FLOW, x * 0.055 + 7, z * 0.055 - 3, 2) + 1) * 0.5;

    const blockFor = (id: any) =>
        id === BLOSSOM_DRIFT.id ? BLOSSOM_DRIFT : BLOCK_BY_ID[id]?.grassCap ? BLOCK_BY_ID[id] : BLOCKS.GRASS;

    // Tier-scaled density of the extra sprite layer (meadow blades, wildflowers).
    // 0 keeps only the sparse authored tufts; render cost is bounded separately
    // by the per-batch draw distance in DetailField.build().
    const dd: number = world.detail?.density ?? 1;
    // Own stream: the extra layer must not shift the authored detail (or
    // anything after it), or each tier would grow a different world.
    const r2 = makeRng(0x9e37 ^ S);
    const seedTip = BLOCKS.STONE_PALE.top;
    const wildCols = [...flowerTops, BLOCKS.LEAF_MINT.top];
    const centreCol = BLOCKS.LEAF_CREAM.top;

    for (let z = 1; z < S - 1; z++) {
        for (let x = 1; x < S - 1; x++) {
            const i = z * S + x;
            const top = heights[i];
            const id = grid.get(x, top, z);
            if (grid.isSolid(x, top + 1, z)) continue; // something already stands here

            const y = top + 1;
            const fx = x + 0.5,
                fz = z + 0.5;

            /* --- reeds & rushes at the waterline ------------------------- */
            // Rushes stand in the SHALLOWS, so the bed has to be near the surface —
            // not merely below it. Without the lower bound the lake basin qualifies
            // all the way to its deepest point and the open water fills with reeds
            // standing ten blocks under.
            if (wetness[i] > 0.3 && top <= sea + 2 && top >= sea - 2 && (id === BLOCKS.SAND.id || GRASS_IDS.has(id))) {
                // Reeds used to stand 1-2 whole voxels tall at 34% density. Once the
                // camera came in close that read as a field of dead sticks rather than
                // as rushes, so they are now knee-high to the player and much sparser.
                if (rng.chance(smoothstep(0.3, 0.75, wetness[i]) * 0.15)) {
                    const n = rng.int(2, 4);
                    for (let k = 0; k < n; k++) {
                        F.tuft(
                            fx + rng.range(-0.3, 0.3),
                            y - 0.03,
                            fz + rng.range(-0.3, 0.3),
                            rng.range(0.1, 0.17),
                            rng.range(0.38, 0.76),
                            reedBase,
                            reedTip,
                            rng() * 6.28,
                            rng.range(-0.18, 0.18),
                            rng.range(-0.18, 0.18),
                            1.0,
                        );
                    }
                }
                continue;
            }

            /* --- fern fronds --------------------------------------------- */
            if (id === FERN.id || id === FERN_RED.id) {
                const fernBot = id === FERN_RED.id ? FERN_RED.top : FERN.top;
                const fernTop = (id === FERN_RED.id ? FERN_RED.topTint : FERN.topTint) ?? fernBot;
                F.fern(fx, y - 0.03, fz, fernBot, fernTop, rng() * 6.28, rng);
                continue;
            }

            /* --- grass tufts, flowers, pebbles --------------------------- */
            if (GRASS_IDS.has(id) || id === BLOSSOM_DRIFT.id) {
                const blk = blockFor(id);
                tuftDark.copy(blk.topTint || blk.top).multiplyScalar(0.86);
                tuftLite.copy(blk.top).multiplyScalar(1.08);

                const lush = meadow(x, z);
                if (rng.chance(0.018 + lush * 0.055)) {
                    const n = rng.int(1, 3);
                    for (let k = 0; k < n; k++) {
                        F.tuft(
                            fx + rng.range(-0.32, 0.32),
                            y - 0.03,
                            fz + rng.range(-0.32, 0.32),
                            rng.range(0.16, 0.3),
                            rng.range(0.26, 0.52),
                            tuftDark,
                            tuftLite,
                            rng() * 6.28,
                            rng.range(-0.14, 0.14),
                            rng.range(-0.14, 0.14),
                        );
                    }
                }

                // Flowers gather into drifts rather than dusting evenly.
                const ff = flowerField(x, z);
                if (ff > 0.66 && rng.chance((ff - 0.66) * 0.3)) {
                    const col = rng.pick(flowerTops);
                    const n = rng.int(1, 3);
                    for (let k = 0; k < n; k++) {
                        const ox = rng.range(-0.3, 0.3),
                            oz = rng.range(-0.3, 0.3);
                        const h = rng.range(0.24, 0.42);
                        F.tuft(fx + ox, y - 0.03, fz + oz, 0.07, h, tuftDark, tuftDark, 0, 0, 0, 0.6);
                        F.box(fx + ox, y + h - 0.04, fz + oz, 0.2, 0.16, 0.2, col, 0.9, rng() * 6.28);
                    }
                }

                // Meadow blades: clumps of thin single blades, densest on lush shelves.
                // Kept off the drift so petal carpets stay readable.
                if (dd > 0 && id !== BLOSSOM_DRIFT.id && r2.chance(dd * (0.06 + lush * lush * 0.34))) {
                    const n = r2.int(3, 6);
                    for (let k = 0; k < n; k++) {
                        const tall = r2.chance(0.18);
                        F.blade(
                            fx + r2.range(-0.42, 0.42),
                            y - 0.03,
                            fz + r2.range(-0.42, 0.42),
                            r2.range(0.05, 0.09),
                            tall ? r2.range(0.6, 0.9) : r2.range(0.22, 0.48),
                            r2() * Math.PI,
                            tuftDark,
                            tall ? seedTip : tuftLite,
                            r2() * 6.28,
                            r2.range(-0.16, 0.16),
                            r2.range(-0.16, 0.16),
                        );
                    }
                }

                // Lone wildflowers between the drifts: a stem with a flat star of
                // petals and a pale centre, so fields read as dotted, not empty.
                if (dd > 0 && ff <= 0.66 && r2.chance(dd * 0.03 * (0.4 + lush))) {
                    const h = r2.range(0.2, 0.4);
                    const ox = r2.range(-0.3, 0.3),
                        oz = r2.range(-0.3, 0.3);
                    F.tuft(fx + ox, y - 0.03, fz + oz, 0.06, h, tuftDark, tuftDark, 0, 0, 0, 0.6);
                    F.flowerHead(
                        fx + ox,
                        y - 0.03 + h,
                        fz + oz,
                        r2.range(0.16, 0.26),
                        r2.pick(wildCols),
                        centreCol,
                        r2() * 1.57,
                    );
                }

                // Pebbles and clods. Never animated — they are the still notes.
                if (rng.chance(0.0055)) {
                    F.box(
                        fx + rng.range(-0.25, 0.25),
                        y - 0.05,
                        fz + rng.range(-0.25, 0.25),
                        rng.range(0.24, 0.46),
                        rng.range(0.14, 0.28),
                        rng.range(0.24, 0.46),
                        rng.pick(pebbleCols),
                    );
                }

                // Fallen petals lying on the drift under the big canopies.
                if (id === BLOSSOM_DRIFT.id && rng.chance(0.3)) {
                    const n = rng.int(1, 2);
                    for (let k = 0; k < n; k++) {
                        F.petal(
                            fx + rng.range(-0.36, 0.36),
                            y + 0.02,
                            fz + rng.range(-0.36, 0.36),
                            rng.range(0.24, 0.4),
                            rng() * 1.57,
                            rng.pick(petalCols),
                        );
                    }
                }
                continue;
            }

            /* --- lichen flecks on bare stone ----------------------------- */
            if (STONE_IDS.has(id) && rng.chance(0.007)) {
                F.box(
                    fx + rng.range(-0.25, 0.25),
                    y - 0.06,
                    fz + rng.range(-0.25, 0.25),
                    rng.range(0.22, 0.4),
                    rng.range(0.1, 0.2),
                    rng.range(0.22, 0.4),
                    SCRUB.top,
                );
            }
        }
    }

    /* --- mushrooms in forested, damp spots ----------------------------- */
    {
        const mushroomCaps = [
            BLOCKS.LEAF_ROSE.top,
            BLOCKS.LEAF_BLUSH.top,
            BLOCKS.LEAF_CREAM.top,
            BLOCKS.LEAF_LILAC.top,
        ];
        const stemCol = BLOCKS.STONE_PALE.top;
        for (let z = 2; z < S - 2; z++) {
            for (let x = 2; x < S - 2; x++) {
                const i = z * S + x;
                const top = heights[i];
                const id = grid.get(x, top, z);
                if (!GRASS_IDS.has(id)) continue;
                if (grid.isSolid(x, top + 1, z)) continue;
                if (wetness[i] < 0.08) continue;
                // Only in forested areas
                const g = fbm2(N_GROVE, x * 0.0115, z * 0.0115, 3);
                if (g < 0.05) continue;
                // More likely near a tree base
                const nearTree =
                    occupied &&
                    (occupied[(z - 1) * S + x] ||
                        occupied[(z + 1) * S + x] ||
                        occupied[z * S + x - 1] ||
                        occupied[z * S + x + 1]);
                if (!rng.chance(nearTree ? 0.055 : 0.018)) continue;

                const fx = x + 0.5,
                    fz = z + 0.5,
                    y = top + 1;
                const n = rng.int(1, 3);
                const capCol = rng.pick(mushroomCaps);
                for (let k = 0; k < n; k++) {
                    const ox = rng.range(-0.28, 0.28),
                        oz = rng.range(-0.28, 0.28);
                    const stemH = rng.range(0.16, 0.3);
                    const capW = rng.range(0.26, 0.44);
                    // stem — same narrow tuft style as flowers
                    F.tuft(fx + ox, y - 0.03, fz + oz, 0.06, stemH, stemCol, stemCol, rng() * 6.28, 0, 0, 0);
                    // cap — flat box sitting on tip of stem
                    F.box(fx + ox, y - 0.03 + stemH, fz + oz, capW, capW * 0.3, capW, capCol, 0.9, rng() * 6.28);
                }
            }
        }
    }

    /* --- crystals: narrow glowing shards, near landmarks and on high ground -- */
    {
        // Precompute a set of "near landmark" grid cells (within radius 14)
        const LANDMARK_R = 14;
        const nearLandmark = new Uint8Array(S * S);
        for (const stamp of world.stamps || []) {
            const lx = stamp.at[0] | 0,
                lz = stamp.at[1] | 0;
            for (let dz = -LANDMARK_R; dz <= LANDMARK_R; dz++)
                for (let dx = -LANDMARK_R; dx <= LANDMARK_R; dx++) {
                    if (dx * dx + dz * dz > LANDMARK_R * LANDMARK_R) continue;
                    const nx = lx + dx,
                        nz = lz + dz;
                    if (nx >= 0 && nz >= 0 && nx < S && nz < S) nearLandmark[nz * S + nx] = 1;
                }
        }
        // HDR-boosted copies: bloom threshold is 1.25 linear — scale palette colours
        // ~2× so the crystals exceed it and pick up a bloom halo.
        const crystalCols = [
            BLOCKS.LEAF_LILAC.top,
            BLOCKS.LEAF_ROSE.top,
            BLOCKS.LEAF_MINT.top,
            BLOCKS.LEAF_BLUSH.top,
        ].map((c) => c.clone().multiplyScalar(2.2));
        for (let z = 2; z < S - 2; z++) {
            for (let x = 2; x < S - 2; x++) {
                const i = z * S + x;
                const top = heights[i];
                const id = grid.get(x, top, z);
                if (!GRASS_IDS.has(id) && id !== BLOCKS.STONE.id && id !== BLOCKS.STONE_PALE.id) continue;
                if (grid.isSolid(x, top + 1, z)) continue;
                const isNearLandmark = nearLandmark[i];
                const elev = top - sea;
                // Crystals prefer elevated rocky ground and landmark proximity
                if (!isNearLandmark && elev < 8) continue;
                const chance = isNearLandmark ? 0.028 : elev > 16 ? 0.014 : 0.005;
                if (!rng.chance(chance)) continue;
                const col = rng.pick(crystalCols);
                const n = rng.int(1, isNearLandmark ? 4 : 3);
                const fx = x + 0.5,
                    fz = z + 0.5,
                    y = top + 1;
                for (let k = 0; k < n; k++) {
                    const ox = rng.range(-0.35, 0.35),
                        oz = rng.range(-0.35, 0.35);
                    const w = rng.range(0.07, 0.12);
                    const h2 = rng.range(0.32, 0.68);
                    F.box(fx + ox, y - 0.02, fz + oz, w, h2, w, col, 0.95, rng() * 6.28);
                    if (rng.chance(0.5)) {
                        const w2 = w * 0.6,
                            h3 = h2 * 0.6;
                        const sa = rng() * 6.28;
                        F.box(
                            fx + ox + Math.cos(sa) * 0.16,
                            y - 0.02,
                            fz + oz + Math.sin(sa) * 0.16,
                            w2,
                            h3,
                            w2,
                            col,
                            0.95,
                            sa,
                        );
                    }
                }
            }
        }
    }

    // Countable fallen petals gather below the larger crowns. Each is smaller
    // than a voxel and lies flush to the grass, as in the painted reference.
    for (const t of world.trees || []) {
        if (t.w < 6) continue;
        const radius = t.w * 0.58;
        const count = Math.round(5 + t.w * 0.9);
        for (let k = 0; k < count; k++) {
            const a = rng() * Math.PI * 2;
            const rr = Math.sqrt(rng()) * radius;
            const px = t.x + Math.cos(a) * rr;
            const pz = t.z + Math.sin(a) * rr;
            const x = Math.round(px),
                z = Math.round(pz);
            if (x < 1 || z < 1 || x >= S - 1 || z >= S - 1) continue;
            const top = heights[z * S + x];
            if (!GRASS_IDS.has(grid.get(x, top, z)) || grid.isSolid(x, top + 1, z)) continue;
            F.petal(px, top + 1.025, pz, rng.range(0.2, 0.34), rng() * 1.57, rng.pick(petalCols));
        }
    }

    return F.build({ windAmp: 0.09, windSpeed: 0.8, drawDistance: world.detail?.distance ?? 140 });
}

function flatEnough(h: any, S: number, x: number, z: number, r: number, tol: number) {
    const c0 = h[z * S + x];
    for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
            const xx = clamp(x + dx, 0, S - 1),
                zz = clamp(z + dz, 0, S - 1);
            if (Math.abs(h[zz * S + xx] - c0) > tol) return false;
        }
    return true;
}
