/**
 * Extra tree species, ported from voxel-planet (src/world/trees.ts).
 *
 * voxel-world's own forms (round, stack, oak, pine, …) are built by plantTree()
 * in vegetation.ts from hand-placed boxes. These are the species voxel-planet
 * added on top, built instead by stacking leaf DISCS on a trunk column, plus
 * the bark and leaf blocks they wear:
 *
 *   emergent   rainforest giant: tall (2×2) trunk, buttress roots, layered flat crown
 *   krummholz  treeline pine: short, gnarled, crown swept to one side by the wind
 *   maple      tall ellipsoid crown in autumn red/orange
 *   cherry     wide domed crown of pink blossom on a short kinked trunk
 *   redwood    very tall straight (2×2) trunk, short narrow cone of crown high up
 *   jacaranda  open umbrella of violet blossom on a leaning, forked trunk
 *   dragon     ringed trunk forking into arms, each ending in a stiff rosette
 *   aspen      slim white trunks with small crowns, in a clonal stand of 1–3
 *
 * Coordinates: voxel-planet's sphere helper set(du, dl, dv) writes at
 * (u+du, surface+1+dl, v+dv) on a cube face; here that is simply
 * (x+du, y+dl, z+dv) on the flat grid, with y the first air block above ground.
 * Every builder refuses to overwrite a non-air cell, as in voxel-planet.
 *
 * Bark style is carried per block (`barkStyle`) and read by the voxel shader's
 * bark pattern: 0 furrowed, 1 papery (birch), 2 scaly (conifer), 3 ringed
 * (palm), 4 smooth. See patBark in core/voxel.ts.
 */
import * as THREE from 'three';
import { BLOCKS, PATTERN, registerBlock } from '../core/palette';

const c = (hex: number) => new THREE.Color(hex);
const bark = (name: string, top: number, side: number, bottom: number, tint: number, style: number, rough: number) =>
    registerBlock(name, {
        top: c(top),
        side: c(side),
        bottom: c(bottom),
        tint: c(tint),
        pattern: PATTERN.BARK,
        barkStyle: style,
        rough,
    });

/* ---- bark ------------------------------------------------------------------ */
/** Dead, weathered wood: bleached grey-brown (snags, stumps). */
export const DEADWOOD = bark('DEADWOOD', 0x9a8c78, 0x857866, 0x6e6252, 0x6a5e4e, 0, 0.7);
/** Birch / aspen: pale papery bark with dark lenticel dashes. */
export const BIRCH = bark('BIRCH', 0xd8d2c4, 0xcac2b2, 0xa8a092, 0x5a5248, 1, 0.5);
/** Conifer: scaly reddish plates (fir, spruce, krummholz, juniper, pine). */
export const BARK_SCALY = bark('BARK_SCALY', 0x5a3424, 0x4a2a1c, 0x3a2014, 0x2a1610, 2, 0.7);
/** Palm / dragon tree: ringed leaf scars on a fibrous tan trunk. */
export const BARK_RINGED = bark('BARK_RINGED', 0x9a8462, 0x8a7454, 0x6e5c42, 0x4a3c2a, 3, 0.75);
/** Smooth grey-green bark (cherry, jacaranda, cypress, mangrove, willow, acacia). */
export const BARK_SMOOTH = bark('BARK_SMOOTH', 0x6e6a5a, 0x5e5a4c, 0x4a463a, 0x3a3a2e, 4, 0.55);
/** Redwood: deep red-brown fibrous bark. */
export const BARK_REDWOOD = bark('BARK_REDWOOD', 0x7a3420, 0x6a2a18, 0x4e1e10, 0x3a140a, 0, 0.75);

/** Which bark a voxel-world plantTree form should wear (overrides its random pick). */
export const FORM_BARK: Record<string, any> = {
    birch: BIRCH,
    tall: BIRCH,
    pine: BARK_SCALY,
    fir: BARK_SCALY,
    spruce: BARK_SCALY,
    spire: BARK_SCALY,
    juniper: BARK_SCALY,
    palm: BARK_RINGED,
    cypress: BARK_SMOOTH,
    mangrove: BARK_SMOOTH,
    willow: BARK_SMOOTH,
    acacia: BARK_SMOOTH,
    snag: DEADWOOD,
    dead: DEADWOOD,
};

/* ---- species leaves (their own colours, not the palette foliage slots) ---- */
const leafBlock = (name: string, top: number, side: number) =>
    registerBlock(name, {
        top: c(top),
        side: c(side),
        bottom: c(side).multiplyScalar(0.8),
        tint: c(top).lerp(c(0xffffff), 0.2),
        pattern: PATTERN.LEAF,
        rough: 0.22,
        sway: true,
    });
const LEAF_MAPLE = [
    leafBlock('LEAF_MAPLE_RED', 0xc8402a, 0xa8331f),
    leafBlock('LEAF_MAPLE_ORANGE', 0xe07a2c, 0xc06420),
];
const LEAF_CHERRY = [leafBlock('LEAF_CHERRY', 0xf4b6c8, 0xe39ab0), leafBlock('LEAF_CHERRY_PALE', 0xfad4de, 0xecbccb)];
const LEAF_JACARANDA = [
    leafBlock('LEAF_JACARANDA', 0x9b7fd8, 0x8268c0),
    leafBlock('LEAF_JACARANDA_PALE', 0xb9a4e6, 0x9f88d2),
];
const LEAF_ASPEN = [leafBlock('LEAF_ASPEN', 0xd8c84a, 0xbfae3a), leafBlock('LEAF_ASPEN_GREEN', 0x9cbf52, 0x84a744)];

/**
 * Greens for every tree. The palette's six foliage slots are themed (the
 * default Autumn palette has one green among oranges, golds and reds), so most
 * crowns read as autumnal. These are real leaf greens, dark to bright, that the
 * scatter mixes into every biome — most trees green, the palette colours as
 * accents. Constant across palettes, like the species leaves above.
 */
export const LEAF_GREENS = [
    leafBlock('LEAF_GREEN_DEEP', 0x2f6b2a, 0x255822), // dark forest green
    leafBlock('LEAF_GREEN', 0x4a8c34, 0x3c752a), // mid leaf green
    leafBlock('LEAF_GREEN_FRESH', 0x6bb03c, 0x5a9832), // fresh spring green
    leafBlock('LEAF_GREEN_LIME', 0x9ccc3c, 0x86b232), // bright lime
    leafBlock('LEAF_GREEN_YELLOW', 0xb8c848, 0x9fae3c), // sunny yellow-green
    leafBlock('LEAF_GREEN_BLUE', 0x3c8a6a, 0x317458), // cool blue-green
    leafBlock('LEAF_GREEN_SAGE', 0x7a9c5c, 0x67854c), // soft sage
];

const DIRS: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
];

/** Names of the species this module builds (registered in vegetation.ts's SPECIES table). */
export const PORTED_SPECIES = ['emergent', 'krummholz', 'maple', 'cherry', 'redwood', 'jacaranda', 'dragon', 'aspen'];

/**
 * Build one ported species with its base (first air block) at (x, y, z).
 * `leaves` are the palette leaf blocks the caller would use for a broadleaf /
 * conifer (species with their own colours ignore them). Returns the record the
 * rest of the world uses for trees (petals, map, capture rig), or null if the
 * species is unknown.
 */
export function plantPortedTree(
    grid: any,
    x: number,
    y: number,
    z: number,
    rng: any,
    species: string,
    size: number,
    leaves: any[],
) {
    let minX = x,
        maxX = x,
        minZ = z,
        maxZ = z,
        topY = y;
    const set = (du: number, dl: number, dv: number, id: number) => {
        const nx = x + du,
            ny = y + dl,
            nz = z + dv;
        if (nx < 1 || nz < 1 || nx >= grid.sx - 1 || nz >= grid.sz - 1 || ny < 1 || ny >= grid.sy) return false;
        if (grid.get(nx, ny, nz) !== 0) return false;
        grid.set(nx, ny, nz, id);
        if (nx < minX) minX = nx;
        if (nx > maxX) maxX = nx;
        if (nz < minZ) minZ = nz;
        if (nz > maxZ) maxZ = nz;
        if (ny > topY) topY = ny;
        return true;
    };
    // Crown lean: about a third of the open-crowned species drift their canopy
    // one or two columns as it rises (the trunk stays vertical).
    const LEANS = species === 'emergent' || species === 'maple' || species === 'cherry' || species === 'jacaranda';
    const leaning = LEANS && rng() < 0.33;
    const [leanU, leanV] = leaning ? DIRS[Math.floor(rng() * 4)] : [0, 0];
    const leanK = leaning ? rng.range(0.05, 0.11) : 0;
    /** A flat disc of leaves (rounded square, radius r) at height dl; rim cells dropped with p = ragged. */
    const disc = (cu: number, dl: number, cv: number, r: number, id: number, ragged = 0.0) => {
        const drift = Math.round(Math.max(0, dl) * leanK);
        cu += leanU * drift;
        cv += leanV * drift;
        for (let dv = -r; dv <= r; dv++)
            for (let du = -r; du <= r; du++) {
                const d = Math.abs(du) + Math.abs(dv);
                if (d > r + Math.floor(r / 2)) continue;
                if (ragged && d >= r && rng() < ragged) continue;
                set(cu + du, dl, cv + dv, id);
            }
    };
    const pick = (arr: any[]) => arr[Math.floor(rng() * arr.length)].id;
    const broad = leaves.length ? leaves : [BLOCKS.LEAF_MINT];

    switch (species) {
        case 'emergent': {
            const h = Math.round(11 + size * 9);
            const thick = size > 0.55;
            const trunk = BLOCKS.TRUNK.id;
            for (let l = 0; l < h; l++) {
                set(0, l, 0, trunk);
                if (thick) {
                    set(1, l, 0, trunk);
                    set(0, l, 1, trunk);
                    set(1, l, 1, trunk);
                }
            }
            for (const [du, dv] of DIRS) set(du * (thick ? 2 : 1), 0, dv * (thick ? 2 : 1), trunk); // buttresses
            const leaf = pick(broad),
                leaf2 = pick(broad);
            const r = Math.round(3 + size * 3);
            disc(0, h, 0, r, leaf, 0.35);
            disc(rng.int(-1, 1), h + 1, rng.int(-1, 1), r - 1, leaf2, 0.25);
            disc(0, h + 2, 0, Math.max(1, r - 3), leaf, 0.2);
            const mid = Math.round(h * 0.6);
            const [bu, bv] = DIRS[Math.floor(rng() * 4)];
            disc(bu * 2, mid, bv * 2, Math.max(1, r - 3), leaf2, 0.3); // lower tier: the layered canopy look
            break;
        }
        case 'krummholz': {
            const h = Math.round(2 + size * 3);
            const [wu, wv] = DIRS[Math.floor(rng() * 4)];
            for (let l = 0; l < h; l++) set(0, l, 0, BARK_SCALY.id);
            const leaf = pick(broad);
            for (let l = 1; l <= h; l++) {
                set(0, l, 0, leaf);
                for (let r = 1; r <= 1 + (l < h ? 1 : 0); r++) set(wu * r, l, wv * r, leaf); // downwind flag
            }
            break;
        }
        case 'maple': {
            const h = Math.round(4 + size * 4);
            for (let l = 0; l < h; l++) set(0, l, 0, BLOCKS.TRUNK.id);
            const r = Math.max(2, Math.round(2 + size * 2));
            const [a, b] = LEAF_MAPLE;
            const H = Math.round(r * 3); // tall ellipsoid, ~1.5× as tall as wide
            for (let l = 0; l <= H; l++) {
                const t = (l - H / 2) / (H / 2 + 0.5);
                const rr = Math.round(r * Math.sqrt(Math.max(0, 1 - t * t)));
                disc(0, h - 1 + l, 0, Math.max(1, rr), rng() < 0.5 ? a.id : b.id, 0.18);
            }
            break;
        }
        case 'cherry': {
            const h = Math.round(3 + size * 2);
            const [lu, lv] = DIRS[Math.floor(rng() * 4)];
            for (let l = 0; l < h; l++) set(l > h - 2 ? lu : 0, l, l > h - 2 ? lv : 0, BARK_SMOOTH.id);
            const r = Math.round(3 + size * 3);
            const [a, b] = LEAF_CHERRY;
            const tiers = 4 + Math.round(size * 2);
            for (let k = 0; k < tiers; k++)
                disc(
                    lu,
                    h + k,
                    lv,
                    Math.max(1, Math.round(r * (1 - (k / tiers) ** 1.6))),
                    k & 1 ? b.id : a.id,
                    0.3 + k * 0.03,
                );
            break;
        }
        case 'redwood': {
            const h = Math.round(16 + size * 12);
            const thick = size > 0.5;
            for (let l = 0; l < h; l++) {
                set(0, l, 0, BARK_REDWOOD.id);
                if (thick) {
                    set(1, l, 0, BARK_REDWOOD.id);
                    set(0, l, 1, BARK_REDWOOD.id);
                    set(1, l, 1, BARK_REDWOOD.id);
                }
            }
            const leaf = pick(broad);
            const crown = Math.round(5 + size * 4);
            for (let k = 0; k < crown; k++) {
                const r = Math.max(1, Math.round((crown - k) * 0.45) + (thick ? 1 : 0));
                disc(0, h - crown + k + 2, 0, r, leaf, 0.12);
            }
            set(0, h + 2, 0, leaf);
            break;
        }
        case 'jacaranda': {
            const h = Math.round(5 + size * 3);
            const [lu, lv] = DIRS[Math.floor(rng() * 4)];
            for (let l = 0; l < h; l++) set(l > h / 2 ? lu : 0, l, l > h / 2 ? lv : 0, BARK_SMOOTH.id);
            set(lu + lv, h - 1, lv - lu, BARK_SMOOTH.id); // fork
            set(lu - lv, h - 1, lv + lu, BARK_SMOOTH.id);
            const r = Math.round(4 + size * 3);
            const [a, b] = LEAF_JACARANDA;
            disc(lu, h, lv, r, a.id, 0.4);
            disc(lu, h + 1, lv, Math.max(2, r - 2), b.id, 0.45);
            break;
        }
        case 'dragon': {
            const h = Math.round(3 + size * 3);
            for (let l = 0; l < h; l++) set(0, l, 0, BARK_RINGED.id);
            const leaf = pick(broad);
            const arms: Array<[number, number]> = [...DIRS, [1, 1], [-1, 1], [1, -1], [-1, -1]];
            const reach = Math.round(2 + size * 2);
            for (const [du, dv] of arms) {
                if (rng() < 0.25) continue;
                for (let k = 1; k <= reach; k++) set(du * k, h + k, dv * k, BARK_RINGED.id);
                disc(du * reach, h + reach + 1, dv * reach, 1, leaf, 0.1);
            }
            break;
        }
        case 'aspen': {
            const n = 1 + Math.floor(rng() * 3);
            for (let t = 0; t < n; t++) {
                const ou = t === 0 ? 0 : Math.round((rng() - 0.5) * 6),
                    ov = t === 0 ? 0 : Math.round((rng() - 0.5) * 6);
                const h = Math.round(6 + size * 6 + (rng() - 0.5) * 3);
                for (let l = 0; l < h; l++) set(ou, l, ov, BIRCH.id);
                const leaf = LEAF_ASPEN[rng() < 0.6 ? 0 : 1].id;
                for (let l = Math.round(h * 0.6); l <= h; l++)
                    disc(ou, l, ov, l === h ? 0 : 1, leaf, l === h ? 0 : 0.3);
                set(ou, h + 1, ov, leaf);
            }
            break;
        }
        default:
            return null;
    }
    const w = Math.max(maxX - minX + 1, maxZ - minZ + 1);
    return { x, y, z, w, leaf: broad[0], height: topY - y + 1, form: species, trunkY: y, trunkW: 1, topY, R: w * 0.5 };
}

/**
 * Dome pass (voxel-planet): many box forms are wide but only 1–2 layers deep,
 * so a forest reads as a sea of flat tops. Over half the trees of the forms that
 * aren't meant to be flat get a tapering dome of 1–5 layers on the crown.
 * `fill` is plantTree's crown box helper; `topOff` is the crown top relative to
 * the canopy base.
 */
export const DOMED = new Set(['round', 'stack', 'twin', 'bunch', 'broad', 'weeping', 'oak', 'nub']);
export function addDome(
    fill: (ox: number, oy: number, oz: number, sx: number, sy: number, sz: number, id: number) => void,
    rng: any,
    topOff: number,
    large: boolean,
    unit: number,
    dx: number,
    dz: number,
    leafId: number,
    lightId: number,
) {
    if (rng() >= 0.55) return;
    const layers = large ? rng.int(3, 5) : unit === 2 ? rng.int(2, 4) : rng.int(1, 3);
    const w0 = large ? 5 : unit === 2 ? 4 : 3;
    for (let k = 0; k < layers; k++) {
        const w = Math.max(1, Math.round(w0 * (1 - k / (layers + 0.5))));
        fill(k & 1 ? dx : 0, topOff + 1 + k, k & 1 ? dz : 0, w, 1, w, k === layers - 1 ? lightId : leafId);
    }
}
