/**
 * Shrubs, cacti and dead snags, ported from voxel-planet (src/world/plants.ts).
 *
 *   SHRUB_*      leaf-green bush blocks (sway shading, an obstacle unlike a canopy);
 *                used alongside the blossom bushes so undergrowth reads as foliage
 *   plantCactus  saguaro / barrel / prickly pear / organ pipe, for arid climates
 *   plantSnag    a dead trunk: a broken column with stubs, or a stump + fallen log
 *
 * Coordinates as trees.ts: (x, y, z) is the first air block above level ground;
 * every builder refuses to overwrite a non-air cell.
 */
import * as THREE from 'three';
import { PATTERN, registerBlock } from '../core/palette';
import { DEADWOOD } from './trees';

const c = (hex: number) => new THREE.Color(hex);

/* ---- shrubs ---------------------------------------------------------------- */
const shrub = (name: string, top: number, side: number) =>
    registerBlock(name, {
        top: c(top),
        side: c(side),
        bottom: c(side).multiplyScalar(0.78),
        tint: c(top).lerp(c(0xd8e8a0), 0.25),
        pattern: PATTERN.LEAF,
        rough: 0.4,
        sway: true,
    });
export const SHRUB_SAGE = shrub('SHRUB_SAGE', 0x8aa070, 0x748a5c);
export const SHRUB_OLIVE = shrub('SHRUB_OLIVE', 0x7a8a3c, 0x66752f);
export const SHRUB_DEEP = shrub('SHRUB_DEEP', 0x3f6a32, 0x325627);
export const SHRUB_FOREST = shrub('SHRUB_FOREST', 0x4f7d3a, 0x41692f);
export const SHRUB_BLUEGREEN = shrub('SHRUB_BLUEGREEN', 0x5a8a74, 0x4a7461);
export const SHRUB_LIME = shrub('SHRUB_LIME', 0x9cb84a, 0x84a03c);
export const SHRUB_RUSSET = shrub('SHRUB_RUSSET', 0x9a6a3a, 0x7e562e);

/**
 * Shrub palette per climate (0 tropical, 1 temperate, 2 arid, 3 tundra). Mixed
 * with the biome's blossom bushes in scatterVegetation so undergrowth is mostly
 * green with flowering accents, rather than all pastel lumps.
 */
export const CLIMATE_SHRUBS: any[][] = [
    [SHRUB_LIME, SHRUB_FOREST, SHRUB_SAGE, SHRUB_DEEP],
    [SHRUB_FOREST, SHRUB_DEEP, SHRUB_OLIVE, SHRUB_SAGE],
    [SHRUB_OLIVE, SHRUB_SAGE, SHRUB_RUSSET],
    [SHRUB_BLUEGREEN, SHRUB_DEEP, SHRUB_RUSSET],
];

/* ---- cacti ------------------------------------------------------------------- */
export const CACTUS = registerBlock('CACTUS', {
    top: c(0x9cc064),
    side: c(0x84ae52),
    bottom: c(0x6a9040),
    tint: c(0x5e8a3c),
    pattern: PATTERN.CACTUS,
    rough: 0.5,
});
const CACTUS_CROWN = registerBlock('CACTUS_CROWN', {
    top: c(0xd8e0a8),
    side: c(0xb8cc80),
    bottom: c(0x9cb468),
    tint: c(0x8aa858),
    pattern: PATTERN.CACTUS,
    rough: 0.6,
});
const CACTUS_FLOWER = registerBlock('CACTUS_FLOWER', {
    top: c(0xffe066),
    side: c(0xf2c94c),
    bottom: c(0xd4a52c),
    tint: c(0xfff2a8),
    rough: 0.3,
});
const CACTUS_FLOWER_PINK = registerBlock('CACTUS_FLOWER_PINK', {
    top: c(0xff7eb3),
    side: c(0xf06292),
    bottom: c(0xc2185b),
    tint: c(0xffb3d1),
    rough: 0.3,
});
const CACTUS_FRUIT = registerBlock('CACTUS_FRUIT', {
    top: c(0xd6336c),
    side: c(0xb02a5b),
    bottom: c(0x8a1f47),
    tint: c(0xe85d8a),
    rough: 0.35,
});

const DIRS: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
];

function setter(grid: any, x: number, y: number, z: number) {
    return (du: number, dl: number, dv: number, id: number) => {
        const nx = x + du,
            ny = y + dl,
            nz = z + dv;
        if (nx < 1 || nz < 1 || nx >= grid.sx - 1 || nz >= grid.sz - 1 || ny < 1 || ny >= grid.sy) return false;
        if (grid.get(nx, ny, nz) !== 0) return false;
        grid.set(nx, ny, nz, id);
        return true;
    };
}

/**
 * A voxel cactus, shaped after the real plants:
 *   saguaro      tall ribbed column (2×2 lower third when big), arms out and up, pale crown
 *   barrel       squat plus-shaped body bulging in the middle, a ring of flowers
 *   prickly pear 2×2×1 paddles, each growing off the last at 90°, fruit on the rims
 *   organ pipe   4–7 slim stems from one shared base, leaning outward partway up
 * Only where the ground under every cell is level. Returns true if built.
 */
export function plantCactus(grid: any, heights: Int16Array, S: number, x: number, z: number, rng: any) {
    const ground = heights[z * S + x];
    const y = ground + 1;
    const setId = setter(grid, x, y, z);
    const set = (du: number, dl: number, dv: number) => setId(du, dl, dv, CACTUS.id);
    const level = (cells: Array<[number, number]>) =>
        cells.every(([du, dv]) => heights[(z + dv) * S + (x + du)] === ground);
    const kind = rng.pick(['saguaro', 'saguaro', 'saguaro', 'barrel', 'barrel', 'pear', 'pear', 'organ']);

    if (kind === 'barrel') {
        const big = rng.chance(0.5);
        const cells: Array<[number, number]> = big ? [[0, 0], ...DIRS] : [[0, 0]];
        if (!level(cells)) return false;
        const h = big ? rng.int(2, 3) : rng.int(1, 2);
        for (let l = 0; l < h; l++) set(0, l, 0);
        if (big) for (const [du, dv] of DIRS) for (let l = 0; l < h - 1; l++) set(du, l, dv);
        const flower = rng.pick([CACTUS_FLOWER, CACTUS_FLOWER_PINK]);
        if (big) for (const [du, dv] of DIRS) if (rng.chance(0.6)) setId(du, h - 1, dv, flower.id);
        setId(0, h, 0, rng.chance(0.5) ? flower.id : CACTUS_CROWN.id);
        return true;
    }
    if (kind === 'pear') {
        if (!level([[0, 0]])) return false;
        let ou = 0,
            ol = 0,
            ov = 0;
        let alongU = rng.chance(0.5);
        const pads = rng.int(3, 6);
        for (let k = 0; k < pads; k++) {
            const cells: Array<[number, number]> = alongU
                ? [
                      [ou, ov],
                      [ou + 1, ov],
                  ]
                : [
                      [ou, ov],
                      [ou, ov + 1],
                  ];
            for (const [cu, cv] of cells) for (let l = 0; l < 2; l++) set(cu, ol + l, cv);
            if (rng.chance(0.35)) setId(cells[1][0], ol + 2, cells[1][1], CACTUS_FRUIT.id);
            const [nu, nv] = rng.pick(cells);
            ou = nu;
            ov = nv;
            ol += 2;
            alongU = !alongU;
            if (ol > 7) break;
        }
        return true;
    }
    if (kind === 'organ') {
        if (!level([[0, 0], ...DIRS])) return false;
        set(0, 0, 0);
        for (const [du, dv] of DIRS) set(du, 0, dv);
        const stems: Array<[number, number]> = [[0, 0], ...DIRS, [1, 1], [-1, -1], [1, -1], [-1, 1]];
        const n = rng.int(4, 7);
        for (let k = 0; k < n; k++) {
            let [su, sv] = stems[k];
            const h = rng.int(3, 7);
            for (let l = 1; l <= h; l++) {
                if (l === Math.floor(h / 2) && (su || sv) && rng.chance(0.5)) {
                    set(su, l, sv); // joint
                    su += Math.sign(su);
                    sv += Math.sign(sv);
                }
                set(su, l, sv);
            }
            setId(su, h + 1, sv, CACTUS_CROWN.id);
        }
        return true;
    }
    // Saguaro
    const height = rng.int(5, 11);
    if (!level([[0, 0]])) return false;
    const thick =
        height >= 8 &&
        level([
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
        ]);
    for (let l = 0; l < height; l++) {
        if (!set(0, l, 0)) return false;
        if (thick && l < height / 3) {
            set(1, l, 0);
            set(0, l, 1);
            set(1, l, 1);
        }
    }
    setId(0, height, 0, rng.chance(0.3) ? CACTUS_FLOWER.id : CACTUS_CROWN.id);
    const dirs = DIRS.slice();
    for (let i = dirs.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }
    const arms = height >= 6 ? rng.int(1, Math.min(4, height - 4)) : 0;
    const used = new Set<number>();
    for (let a = 0; a < arms; a++) {
        const [du, dv] = dirs[a];
        let at = rng.int(Math.ceil(height * 0.35), height - 3);
        while (used.has(at) && at < height - 2) at++; // stagger the arm heights
        used.add(at);
        const off = thick && at < height / 3 && (du > 0 || dv > 0) ? 1 : 0; // clear the 2×2 base
        const reach = 1 + off + (rng.chance(0.25) ? 1 : 0);
        const rise = rng.int(2, Math.max(2, height - at - 1));
        let ok = true;
        for (let r = 1; r <= reach && ok; r++) ok = set(du * r, at, dv * r);
        for (let l = 1; l <= rise && ok; l++) ok = set(du * reach, at + l, dv * reach);
        if (ok) setId(du * reach, at + rise + 1, dv * reach, CACTUS_CROWN.id);
    }
    return true;
}

/**
 * Dead trunk (snag): a bare weathered column broken off at the top with a few
 * stubs (3–9 tall, a quarter leaning one step partway up), or — one in five — a
 * low stump with a fallen section lying beside it.
 */
export function plantSnag(grid: any, heights: Int16Array, S: number, x: number, z: number, rng: any) {
    const ground = heights[z * S + x];
    const setId = setter(grid, x, ground + 1, z);
    const set = (du: number, dl: number, dv: number) => setId(du, dl, dv, DEADWOOD.id);
    if (rng.chance(0.2)) {
        const h = rng.int(1, 2);
        for (let l = 0; l < h; l++) set(0, l, 0);
        if (rng.chance(0.5)) {
            const [du, dv] = rng.pick(DIRS);
            const len = rng.int(2, 3);
            for (let r = 2; r < 2 + len; r++)
                if (heights[(z + dv * r) * S + (x + du * r)] === ground) set(du * r, 0, dv * r);
        }
        return;
    }
    const height = rng.int(3, 9);
    const leanAt = rng.chance(0.25) ? rng.int(2, height - 1) : height + 1;
    const [lu, lv] = rng.pick(DIRS);
    let ou = 0,
        ov = 0;
    for (let l = 0; l < height; l++) {
        if (l === leanAt) {
            set(ou + lu, l - 1, ov + lv); // joint, so the lean reads as one trunk
            ou += lu;
            ov += lv;
        }
        if (!set(ou, l, ov)) return;
    }
    const stubs = height >= 5 ? rng.int(1, 3) : rng.int(0, 1);
    for (let s = 0; s < stubs; s++) {
        const [du, dv] = DIRS[Math.floor(rng() * 4)];
        const at = rng.int(Math.max(2, Math.floor(height / 3)), height - 1);
        const base = at >= leanAt ? [ou, ov] : [0, 0];
        const len = rng.chance(0.35) ? 2 : 1;
        for (let r = 1; r <= len; r++) set(base[0] + du * r, at, base[1] + dv * r);
    }
}
