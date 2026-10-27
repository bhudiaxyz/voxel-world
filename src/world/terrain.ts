/**
 * Terrain — composed, not simulated.
 *
 * The reference images are not "hills with a terrace post-process". They are a
 * *composition*: one dominant stepped massif, two or three secondary shelves,
 * a broad valley floor, a gorge with a river in it, and a plinth edge that
 * drops into haze. Every shelf is genuinely flat and wide enough to stand a
 * house on; every cliff is a decisive 3–6 block wall.
 *
 * So the height field is built the way a topographic map is drawn — as a stack
 * of hard-edged contour discs, each worth exactly one terrace step. Flatness is
 * therefore free (inside a disc the field is *exactly* constant) and the only
 * gradients in the world are the disc boundaries, which quantise to a single
 * clean cliff. The discs are domain-warped so the outlines are organic lobes
 * rather than circles.
 *
 * On top of that:
 *   - a river carved *after* terracing, so the gorge walls keep their terrace
 *     levels and the channel itself is smooth and un-stepped;
 *   - a ledge pass that splits the tallest cliffs with long horizontal shelves;
 *   - stairs cut into cliffs until the whole island is walk-connected;
 *   - large-scale biome fields for surface material, so meadow / rock / sand
 *     read as regions instead of per-column confetti.
 *
 * Exports consumed elsewhere: `heights` (Int16, absolute block y of each
 * column top), `wetness`, `riverX`, `riverW`, `size`, `grid`.
 */

import * as THREE from 'three';
import { BLOCKS, BLOCK_BY_ID, WATER, PATTERN, registerBlock } from '../core/palette';
import { LICHEN_PALE } from './vegetation';
import { VoxelGrid } from '../core/voxel';
import { makeNoise2D, fbm2, clamp, smoothstep, makeRng } from '../core/rng';
import { modeFilter, despeckle, carveStairs, riseAbove, dropBelow } from './terrain-shape';

export const WORLD = {
  /**
   * World edge, in blocks. Nine times the area of the 256 this was authored
   * at: ~440 regions, ~9 lakes, ~11 rivers, ~60 composed scenes.
   *
   * Everything downstream derives its counts from this and its feature sizes
   * from fixed lengths, so raising it adds places rather than stretching the
   * ones already here. Render meshes stream around the player; the remaining
   * scale ceiling is the dense CPU voxel grid used by collision and planning.
   */
  size: 768,
  height: 96,
  seaLevel: Math.floor(WATER.level), // 9
  step: 2, // terrace height — one contour disc (was 3: finer terraces = more detail)
  /**
   * Terrace edges snap to this lattice. The reference's shelves turn in long
   * straight runs and right angles, never in curves — a warped contour is a
   * smooth boundary, and quantising the field it is evaluated on is what turns
   * that boundary into masonry.
   */
  edgeGrid: 2,
};

/**
 * Wrap a single axis coordinate to [0, WORLD.size) using standard modulo so
 * the player exits one edge and enters the exact opposite edge.
 */
export function wrapAxis(v: number): number {
  const S = WORLD.size;
  return ((v % S) + S) % S;
}

/**
 * Falling water. The water surface itself is a plane at sea level, so a
 * cascade has to be voxels: a pale, faintly luminous column that catches the
 * bloom and reads as spray without introducing a second transparent pass.
 */
const lin = (hex: number) => new THREE.Color(hex);
export const CASCADE = registerBlock('CASCADE', {
  top: lin(0xeaf1ff),
  side: lin(0xdde8fb),
  bottom: lin(0xccdaf2),
  tint: lin(0xf7fbff),
  pattern: PATTERN.STONE,
  rough: 0.15,
  emissive: 0.14,
});

// River water: passable (isWater:true so isSolid skips it), teal-blue to match
// the water plane palette. Placed as voxels in river channels above sea level
// so the carved gorge looks wet rather than dry.
export const RIVER_WATER = registerBlock('RIVER_WATER', {
  top:    lin(0x4fa8bc),
  side:   lin(0x3d97ae),
  bottom: lin(0x2e8899),
  rough: 0.05,
  isWater: true,
});

export function generateTerrain(seed = 20260820, plan: any = null, onProgress: (p: number, s: string) => void = () => {}) {
  const S = WORLD.size;
  const L = WORLD.step;
  const SEA = WORLD.seaLevel;
  const BASE = SEA + 3; // the valley floor
  const grid = new VoxelGrid(S, WORLD.height, S);
  const rng = makeRng(seed);

  const nWarp = makeNoise2D(seed + 5);
  const nRiver = makeNoise2D(seed + 3);
  const nRock = makeNoise2D(seed + 4);
  const nTone = makeNoise2D(seed + 6);
  const nEdge = makeNoise2D(seed + 7);
  const nLedge = makeNoise2D(seed + 8);
  const nFine = makeNoise2D(seed + 9);

  const half = S / 2;
  /** Terrace steps between the lowest and highest planned region. */
  const MACRO_RELIEF = 12;
  /**
   * Feature scale — **fixed**, not proportional to the world.
   *
   * Every length below was authored against a 192-block world, and this was
   * `S / 192` so that the composition stayed constant as the map grew. That is
   * the right rule for scaling one island up to fill a bigger frame and the
   * wrong one for building a bigger *world*: at 1024 it gave massifs 160
   * blocks across and mid-scale "rooms" 90 blocks wide, so the terrain had
   * exactly as many features as before, each four times larger and four times
   * blander to walk over.
   *
   * Frozen at the 256-block tuning, a mountain stays a mountain and a shelf
   * stays a shelf. Feature *counts* scale with area instead — see `GX` below
   * and `AREA` further down.
   */
  const K = 256 / 192;
  /** How much bigger than the authored 256-block world this one is, by area. */
  const AREA = (S / 256) ** 2;

  onProgress(0.0, 'sculpting the terrain');
  /* ================================================================
   * 1. Contour composition
   * ================================================================
   * Each entry is one terrace step. Stacking shrinking discs on a shared
   * centre builds a stepped massif; the per-disc warp offset stops the steps
   * from looking concentric. Amplitude is always exactly one step so a cliff
   * is one disc edge — the *only* way to get a 6-block cliff is to make two
   * edges coincide, which is a decision rather than an accident.
   */
  const discs: any[] = [];
  const push = (cx: any, cz: any, r: any, o: any, opt: any = {}) =>
    discs.push({
      cx,
      cz,
      r,
      o,
      ax: opt.ax ?? 1,
      az: opt.az ?? 1,
      wAmp: opt.wAmp ?? 11,
      wFreq: opt.wFreq ?? 0.016,
      sign: opt.sign ?? 1,
    });

  /** A stepped massif: shrinking discs with a drifting centre. */
  const massif = (fx: any, fz: any, radii: any, opt: any = {}) => {
    let cx = fx * S,
      cz = fz * S;
    radii.forEach((r: any, k: any) => {
      cx += rng.bell() * (opt.drift ?? 6);
      cz += rng.bell() * (opt.drift ?? 6);
      push(cx, cz, r, 137 * (discs.length + 1), {
        ax: opt.ax,
        az: opt.az,
        wAmp: (opt.wAmp ?? 12) * (1 - k * 0.09),
        wFreq: opt.wFreq,
      });
    });
  };

  /* Macro relief comes from the PLAN, not from hand-placed discs.
   *
   * The six massifs that used to live here sat at fixed fractions of the map,
   * so every seed produced the same island with different noise scattered on
   * it — which is exactly why adding a planner changed nothing visible. The
   * plan's highland regions are the massifs now, so where the land rises is a
   * decision the plan made and the seed genuinely moves it.
   *
   * A crown is still stamped on the two highest regions, because a plateau
   * from a blended field alone has no summit and the composition needs
   * something to be subordinate to. */
  if (plan) {
    // One crown per ~65k blocks of map, so a large world gets a whole range
    // rather than the same two summits with more flat ground between them.
    const crowns = Math.max(2, Math.round(2 * AREA));
    const peaks = [...plan.regions].sort((a, b) => b.elevation - a.elevation).slice(0, crowns);
    peaks.forEach((r, k) => {
      // Alternating profiles so a range is not a row of identical cones.
      const radii = (k % 3 === 0 ? [30, 24, 18, 13, 8] : k % 3 === 1 ? [26, 19, 13] : [22, 16, 11, 7]).map(
        (v) => v * K,
      );
      massif(r.center[0] / S, r.center[1] / S, radii, { drift: 5 * K, wAmp: 12 * K });
    });
  }

  /* Mid-scale relief.
   *
   * The camera holds about 25 blocks across, so a 60-block shelf is two full
   * screens of nothing. These are small single-step discs — raised knolls and
   * sunken dells — spread on a jittered grid so that wherever the player
   * stands there is a terrace edge, a lip or a hollow somewhere in frame.
   * They are still contour discs, so they are still flat-topped with one clean
   * cliff; this adds *rooms*, not corrugation. */
  // Count grows with area; the discs themselves stay the size they were
  // authored at. One knoll per ~38 blocks of map edge reproduces the density
  // the 256-block world was tuned to.
  const GX = Math.max(4, Math.round(S / 38));
  for (let gz = 0; gz < GX; gz++) {
    for (let gx = 0; gx < GX; gx++) {
      const fx = (gx + 0.5) / GX + rng.bell() * 0.075;
      const fz = (gz + 0.5) / GX + rng.bell() * 0.075;
      if (fx < 0.1 || fx > 0.9 || fz < 0.1 || fz > 0.9) continue;
      const sign = rng.chance(0.34) ? -1 : 1;
      push(fx * S, fz * S, rng.range(14, 28) * K, 971 * (gx * 7 + gz + 3), {
        sign,
        wAmp: rng.range(8, 14) * K,
        ax: rng.range(0.65, 1.5),
        az: rng.range(0.65, 1.5),
      });
    }
  }

  /* Sunken glades on the shelf tops — a hollow reads far better than another
   * flat acre, and gives vegetation somewhere sheltered to sit.
   *
   * These were three hand-placed fractions of the map, which is fine for one
   * authored island and vanishes to nothing across a large one. Scattered by
   * count now, on the same jittered basis as everything else. */
  for (let k = 0, n = Math.round(3 * AREA); k < n; k++) {
    push(rng.range(0.08, 0.92) * S, rng.range(0.08, 0.92) * S, rng.range(9, 13) * K, 4441 + k, {
      sign: -1,
      wAmp: rng.range(4, 6) * K,
    });
  }

  /* Evaluated on a coarse lattice rather than per column.
   *
   * The field itself is smooth, so its contours are smooth, and the terraces
   * came out as rounded islands. Sampling it at the centre of each Q-block
   * cell makes it piecewise constant, so every shelf boundary is forced into
   * straight runs of at least Q blocks meeting at right angles — the blocky,
   * built look of the reference, from the same generator. */
  const Q = WORLD.edgeGrid;
  /** Centre of the edge-grid cell a coordinate falls in. */
  const qc = (v: any) => Math.floor(v / Q) * Q + Q * 0.5;
  /**
   * Stable pseudo-random value per edge-grid cell.
   *
   * Cell-keyed rather than continuous on purpose: this is what moves a whole
   * block at a time. Smooth noise shifts the surface by fractions and lets
   * rounding decide where the step falls, which is how you get long uniform
   * runs; a per-cell draw makes the step itself the unit of variation.
   */
  const cellHash = (x: any, z: any, salt: any, g = Q) => {
    const cx = Math.floor(x / g),
      cz = Math.floor(z / g);
    let h = (cx * 374761393 + cz * 668265263 + salt * 1442695040) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  /** Coarser than the terrace lattice, so breaks arrive in large patches. */
  const JQ = Q * 2;
  /**
   * -1, 0 or +1 blocks, chosen per cell.
   *
   * Deliberately RARE by default. Variation on most cells is what made the
   * banks read as jagged: the step size was never the problem, the frequency
   * was. Perturbing about one cell in six leaves long clean runs with the
   * occasional break, which is what the reference actually shows.
   */
  const cellStep = (x: any, z: any, salt: any, up = 0.1, down = 0.09, g = JQ) => {
    const a = cellHash(x, z, salt, g);
    if (a < up) return 1;
    if (a > 1 - down) return -1;
    return 0;
  };

  const discAt = (x0: any, z0: any, d: any) => {
    const x = Math.floor(x0 / Q) * Q + Q * 0.5;
    const z = Math.floor(z0 / Q) * Q + Q * 0.5;
    const w = fbm2(nWarp, (x + d.o) * d.wFreq, (z + d.o) * d.wFreq, 4) * d.wAmp;
    const dx = (x - d.cx) / d.ax,
      dz = (z - d.cz) / d.az;
    const dist = Math.sqrt(dx * dx + dz * dz) + w;
    return (1 - smoothstep(d.r - 1.0, d.r + 1.0, dist)) * d.sign;
  };

  /* ---- island outline --------------------------------------------
   * Multiple islands, each a lobed disc. Outside all of them the world is
   * seabed. `nearDist` replaces the old single-centre distance.              */
  const nearDist = plan
    ? (x: number, z: number) => plan.nearIsland(x, z)
    : (x: number, z: number) => Math.hypot(x - half, z - half);
  const islandRadius: number = plan ? plan.islandRadius : S * 0.427;
  const rimR = (x: any, z: any) => islandRadius + fbm2(nEdge, x * 0.011, z * 0.011, 4) * 15 * K;

  // Nearest main island biome index (0=tropical 1=temperate 2=arid 3=tundra)
  const nearestIslandBiome = (x: number, z: number): number => {
    if (!plan?.continentCenters?.length) return 1;
    let bestDist = Infinity, bestIdx = 0;
    for (let i = 0; i < plan.continentCenters.length; i++) {
      const [ix, iz] = plan.continentCenters[i];
      const d = Math.hypot(x - ix, z - iz);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return plan.islandBiomes?.[bestIdx] ?? 1;
  };

  /* ================================================================
   * The water network
   * ================================================================
   * The plan routes it; this rasterises it into fields the carve passes read.
   *
   * The centreline used to be `riverX[z] = 0.50*S + t*0.115*S + sin(...)`, one
   * x per row. That representation cannot express a channel that turns back on
   * itself, so the river was condemned to run roughly north-south whatever the
   * land did — and since it consulted no elevation at all, it carved straight
   * through planned summits. A polyline plus a distance field costs one
   * rasterisation pass and removes both limits at once.
   */
  const nLake = makeNoise2D(seed + 11);

  /** Moving average, endpoints pinned. Traced paths turn in 12-degree steps;
   *  this is what makes a bank curve instead of faceting. */
  const smoothPath = (pts: any, iters = 4) => {
    let p = pts;
    for (let it = 0; it < iters; it++) {
      if (p.length < 3) break;
      const q = [p[0]];
      for (let i = 1; i < p.length - 1; i++) {
        q.push([(p[i - 1][0] + 2 * p[i][0] + p[i + 1][0]) / 4, (p[i - 1][1] + 2 * p[i][1] + p[i + 1][1]) / 4]);
      }
      q.push(p[p.length - 1]);
      p = q;
    }
    return p;
  };

  /** Re-space a polyline to one point per block, so stamping discs along it
   *  approximates a swept channel rather than a string of beads. */
  const resamplePath = (pts: any, spacing = 1) => {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i],
        [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / spacing));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        out.push([ax + (bx - ax) * t, az + (bz - az) * t]);
      }
    }
    if (pts.length) out.push(pts[pts.length - 1]);
    return out;
  };

  /* Three fields, all nearest-point lookups: distance to the centreline, the
   * channel half-width there, and whether that stretch is the ford. Keeping
   * width in a field rather than recomputing it per column is what lets pools
   * and narrows exist without the bank test disagreeing with the bed test. */
  const rivD = new Float32Array(S * S).fill(1e4);
  const rivHalf = new Float32Array(S * S);
  const rivFord = new Uint8Array(S * S);
  /** Which bank a column is on, in the channel's own frame: -1 / +1. */
  const rivSide = new Int8Array(S * S);
  /** Ordered nodes of every channel, for cascades, bridges and stamps. */
  const riverPath = [];

  const REACH = 30; // covers every downstream `riverDist` threshold
  const stampNode = (px: any, pz: any, w: any, ford: any, nx: any, nz: any) => {
    const x0 = Math.max(0, Math.floor(px - REACH)),
      x1 = Math.min(S - 1, Math.ceil(px + REACH));
    const z0 = Math.max(0, Math.floor(pz - REACH)),
      z1 = Math.min(S - 1, Math.ceil(pz + REACH));
    for (let z = z0; z <= z1; z++) {
      const dz = z - pz;
      for (let x = x0; x <= x1; x++) {
        const dx = x - px;
        const d = Math.sqrt(dx * dx + dz * dz);
        const i = z * S + x;
        if (d < rivD[i]) {
          rivD[i] = d;
          rivHalf[i] = w;
          rivFord[i] = ford ? 1 : 0;
          rivSide[i] = dx * nx + dz * nz < 0 ? -1 : 1;
        }
      }
    }
  };

  // Without a plan (tests, tooling) fall back to a single diagonal so every
  // downstream pass still has a channel to work against.
  const channels = plan
    ? plan.rivers
    : [
        {
          order: 0,
          points: [
            [S * 0.42, S * 0.06],
            [S * 0.52, S * 0.5],
            [S * 0.62, S * 0.96],
          ],
        },
      ];

  for (const ch of channels) {
    const pts = resamplePath(smoothPath(ch.points), 1);
    const n = pts.length;
    if (n < 8) continue;
    // One ford per trunk, about two thirds of the way down — far enough from
    // the source that the channel is worth crossing, close enough to the sea
    // that the banks around it are low.
    const fordAt = ch.order === 0 ? Math.round(n * 0.62) : -1;
    const fordLen = Math.round(7 * K);

    for (let i = 0; i < n; i++) {
      const [px, pz] = pts[i];
      const t = i / (n - 1);
      /* Channels widen downstream. A river of constant width reads as a
       * canal however it meanders — the taper is most of what says "this
       * water is going somewhere". */
      let w = (ch.order === 0 ? 3.2 + t * 5.4 : ch.order === 1 ? 2.2 + t * 2.6 : 1.2 + t * 1.4) * K;
      w += fbm2(nRiver, px * 0.02, pz * 0.02, 2) * 1.6 * K;

      /* Pools on the outside of the hardest bends, measured from the path
       * itself rather than placed at hand-picked fractions. Meander pools
       * exist because a turning current scours the outer bank, so deriving
       * them from curvature puts them where the eye expects them. */
      const a = pts[Math.max(0, i - 9)],
        b = pts[Math.min(n - 1, i + 9)];
      const t1x = px - a[0],
        t1z = pz - a[1];
      const t2x = b[0] - px,
        t2z = b[1] - pz;
      const l1 = Math.hypot(t1x, t1z) || 1,
        l2 = Math.hypot(t2x, t2z) || 1;
      const turn = Math.abs((t1x / l1) * (t2z / l2) - (t1z / l1) * (t2x / l2));
      w += smoothstep(0.25, 0.75, turn) * 6.0 * K;

      const ford = fordAt >= 0 && Math.abs(i - fordAt) < fordLen;
      if (ford) w *= 0.55;

      // Unit normal, so anything crossing the channel (a bridge, a line of
      // stepping stones) knows which way "across" is.
      const nx = -t2z / l2,
        nz = t2x / l2;
      stampNode(px, pz, w, ford, nx, nz);
      if (i % 3 === 0) {
        riverPath.push({ x: px, z: pz, w, ford, order: ch.order, t, nx, nz });
      }
    }
  }

  const rivIndex = (x: any, z: any) => clamp(Math.round(z), 0, S - 1) * S + clamp(Math.round(x), 0, S - 1);
  const riverDist = (x: any, z: any) => {
    const i = rivIndex(x, z);
    return rivD[i] - rivHalf[i];
  };
  const isFord = (x: any, z: any) => rivFord[rivIndex(x, z)] === 1;

  /* ---- the lake ---------------------------------------------------
   * A broad still basin, and the counterweight to the river: the river is
   * all movement and narrow framing, the lake is open water you stand at the
   * edge of and look across. The reference leans on exactly that contrast —
   * a wide calm sheet ringed by blossom is a destination in a way that a
   * channel never is.
   *
   * The plan sites it on its lowest-lying region and routes an outflow to the
   * sea if the trunk river misses it, so the two read as one connected system
   * rather than a pond dropped next to a stream.
   */
  /* Every basin the plan sited, not just one.
   *
   * A single lake is a feature; a scatter of them is a landscape. The aspect
   * ratio and the noise offset vary per basin so they do not read as copies of
   * the same ellipse — from the air, repeated silhouettes are the fastest way
   * to give a generator away. */
  const LAKES = (plan ? plan.lakes : [{ center: [S * 0.335, S * 0.605], radius: S * 0.128 }]).map((l: any, k: any) => ({
    cx: l.center[0],
    cz: l.center[1],
    r: l.radius,
    ax: 0.86 + ((k * 0.37) % 0.6),
    az: 0.8 + ((k * 0.53) % 0.7),
    o: k * 311,
  }));
  const LAKE = LAKES[0];
  const lakeDistOf = (l: any, x: any, z: any) => {
    const dx = (x - l.cx) / l.ax,
      dz = (z - l.cz) / l.az;
    return Math.hypot(dx, dz) - l.r - fbm2(nLake, x * 0.017 + l.o, z * 0.017, 3) * 10 * K;
  };

  /* ================================================================
   * 2. Quantised land
   * ================================================================ */
  const lev = new Int16Array(S * S);
  const land = new Uint8Array(S * S);
  const seabed = new Int16Array(S * S);

  /* ---- the contour field, evaluated once per edge-grid cell ---------
   *
   * Every term in the sum is already sampled at the cell centre — `discAt`
   * quantises its own inputs — so computing it per column was doing identical
   * work thirty-six times over. Precomputing it per cell is *exact*, not an
   * approximation, and it is what makes a large world affordable at all: the
   * disc loop is the dominant cost in the whole generator and it drops by
   * 36x.
   *
   * The plan's elevation is quantised onto the same lattice for the same
   * reason it was worth quantising the discs. Sampled per column it varies
   * smoothly, so `Math.round` crosses its threshold along a smooth contour and
   * the terrace edge curves — which is precisely the rounded, un-built look
   * `edgeGrid` exists to prevent.
   *
   * Discs are bucketed by their bounding boxes. A column is inside only a
   * handful of the few hundred discs a large world stacks up, and testing it
   * against all of them made cost grow with area *squared*.
   */
  const CW = Math.ceil(S / Q) + 1;
  const DB = 32; // disc bucket size, blocks
  const dbw = Math.max(1, Math.ceil(S / DB));
  const discBuckets: any[][] = [];
  for (let i = 0; i < dbw * dbw; i++) discBuckets.push([]);
  for (const d of discs) {
    // Beyond r + 1 + wAmp the smoothstep is saturated and the disc adds zero.
    const ex = (d.r + 1 + d.wAmp) * d.ax,
      ez = (d.r + 1 + d.wAmp) * d.az;
    const x0 = Math.max(0, Math.floor((d.cx - ex) / DB));
    const x1 = Math.min(dbw - 1, Math.floor((d.cx + ex) / DB));
    const z0 = Math.max(0, Math.floor((d.cz - ez) / DB));
    const z1 = Math.min(dbw - 1, Math.floor((d.cz + ez) / DB));
    for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) discBuckets[bz * dbw + bx].push(d);
  }

  const cellLevel = new Int16Array(CW * CW);
  for (let cz = 0; cz < CW; cz++) {
    for (let cx = 0; cx < CW; cx++) {
      const wx = cx * Q + Q * 0.5,
        wz = cz * Q + Q * 0.5;
      /* The plan's elevation supplies the broad shape; the discs supply
       * rooms and punctuation on top of it. Centred on 0.34 so the median
       * region sits near the valley floor and only genuine highlands climb. */
      let sum = plan ? (plan.elevationAt(wx, wz) - 0.34) * MACRO_RELIEF : 0;
      const bx = clamp(Math.floor(wx / DB), 0, dbw - 1);
      const bz = clamp(Math.floor(wz / DB), 0, dbw - 1);
      const bucket = discBuckets[bz * dbw + bx];
      for (let k = 0; k < bucket.length; k++) sum += discAt(wx, wz, bucket[k]);
      // Gentle rolling hills: low-frequency FBM nudges the rounding threshold so
      // flat plateaus develop gradual undulations rather than staying pancake-flat.
      sum += fbm2(nFine, wx * 0.018, wz * 0.018, 3) * 1.6;
      cellLevel[cz * CW + cx] = BASE + L * Math.round(sum);
    }
  }

  for (let z = 0; z < S; z++) {
    for (let x = 0; x < S; x++) {
      const i = z * S + x;
      let h = cellLevel[Math.floor(z / Q) * CW + Math.floor(x / Q)];

      // Keep the outer band of each island low so the plinth is a readable
      // 9–12 block wall and no massif ever runs off the island edge.
      const r = nearDist(x, z);
      const R = rimR(x, z);
      if (r > R - 20 * K) h = Math.min(h, BASE + L);
      if (r > R - 9 * K) h = Math.min(h, BASE);

      seabed[i] = Math.max(1, Math.round(SEA - 5 - smoothstep(R, R + 26 * K, r) * 3));
      if (r > R) {
        lev[i] = seabed[i];
        land[i] = 0;
      } else {
        lev[i] = h;
        land[i] = 1;
      }
    }
  }

  // Tidy: kill slivers where two contour edges nearly coincide, and straighten
  // the ragged 1-column jitter the warp leaves on a boundary.
  let H = modeFilter(lev, S, 1, land, 2);
  H = despeckle(H, S, land, 16);

  /* ---- deliberate cliff ledges -------------------------------------
   * Only split very tall cliffs (4+ steps) — shorter drops are kept as-is so
   * hillside sudden drops and dramatic cliff faces can exist.               */
  const ledged = Int16Array.from(H);
  for (let z = 1; z < S - 1; z++) {
    for (let x = 1; x < S - 1; x++) {
      const i = z * S + x;
      if (!land[i]) continue;
      const rise = riseAbove(ledged, S, x, z);
      if (rise < 3 * L) continue;
      const n = fbm2(nLedge, qc(x) * 0.035, qc(z) * 0.035, 2);
      if (n < 0.1) continue;
      ledged[i] = ledged[i] + L;
    }
  }
  H = despeckle(ledged, S, land, 12);

  onProgress(0.45, 'carving the rivers');
  /* ================================================================
   * 3. River, banks and beaches — carved after terracing
   * ================================================================ */
  const wetness = new Float32Array(S * S);
  const fordMask = new Uint8Array(S * S);
  for (let z = 0; z < S; z++) {
    for (let x = 0; x < S; x++) {
      const i = z * S + x;
      const d = riverDist(x, z);
      /* The land/water boundary is decided per CELL, not per column.
       *
       * This is what was serrating every shoreline. The terraces are
       * quantised to the lattice, but the water test was still evaluated
       * against a smooth curve at every column — and rasterising a smooth
       * curve produces a sawtooth by definition, however the terrain around
       * it is built. Testing the cell centre makes a whole cell wet or dry
       * together, so the bank turns in large rectangles like the reference.
       *
       * The smooth distance is kept for everything continuous — wetness,
       * bed depth — where a stepped value would band. */
      const dCell = riverDist(qc(x), qc(z));

      if (!land[i]) continue;
      if (dCell > 16) continue;

      /* Only the lower course holds water.
       *
       * The water surface is one global plane, so a channel is only a river
       * where its bed is under that plane. The carve used to cut every column
       * within the channel down to sea level regardless — which was harmless
       * while the river was a parametric curve confined to the valley floor,
       * and became a forty-block slot canyon the moment rivers were allowed
       * to start on a summit. It put a bridge over dry ground at height 63.
       *
       * Above the waterline the channel becomes what it physically is up
       * there: a dry ravine, cut a terrace or two into the slope, feeding the
       * river below. The transition is where addCascades finds its falls, so
       * the two courses join with a waterfall rather than a seam. */
      if (H[i] > SEA + 7) {
        if (dCell <= 0) {
          // A notched valley floor, quantised like everything else, with the
          // deeper cut down the middle so it reads as carved by the water
          // that is no longer there.
          const cut = dCell < -Math.max(rivHalf[i] * 0.5, 1) ? 2 : 1;
          H[i] = Math.max(SEA + 1, H[i] - L * cut);
        }
        continue;
      }
      wetness[i] = 1 - smoothstep(0.0, 8.0, d);

      // Deep channel, shallower at the ford so the player can wade across.
      /* Cell-sampled, terrace-quantised, and pocketed.
       *
       * A channel of uniform depth reads as a canal. A low-frequency field
       * sampled on the same lattice opens occasional deep holes where the
       * meander swings wide, so the water above has somewhere to go dark.
       * Depth also tracks the channel's own width — a pool that is broad on
       * the surface but three blocks deep reads as a puddle. */
      const pool = Math.max(fbm2(nRiver, qc(x) * 0.03 + 60, qc(z) * 0.03, 3), 0);
      const wide = clamp((rivHalf[i] / K - 3.5) / 6, 0, 1);
      // Capped. Unbounded, the two terms stacked to 25 blocks and the deepest
      // pools punched through to the floor of the grid, which is a hole rather
      // than a pool — and the depth ramp has nothing left to say past ~15.
      const sink = Math.min(4 + pool * 12 + wide * 9, 16);
      let bed = SEA - Math.round(sink / L) * L;
      // The ford is a hard override, not a blend: a flat gravel bar one block
      // under the surface. Interpolating toward it reintroduces exactly the
      // fractional heights the quantisation exists to remove, and it is the
      // only place you can cross without a bridge, so it has to be reliable
      // rather than picturesque.
      const ford = isFord(qc(x), qc(z));
      if (ford) bed = SEA - 1;

      if (dCell <= 0) {
        H[i] = Math.max(3, Math.round(bed));
        // The ford counts as walkable ground even though it is under an inch
        // of water — the stair pass needs to know the banks are connected
        // there, otherwise it tries to bridge the gorge with earthworks.
        land[i] = ford ? 1 : 0;
        fordMask[i] = ford ? 1 : 0;
        continue;
      }

      // Beaches alternate with cliffs along the bank, in long stretches: a
      // slow sand slope on the inside of a meander, a bare wall on the outside.
      // The side term is read from the channel's own frame rather than from a
      // world axis, which is what keeps the asymmetry meaningful once the river
      // is free to run in any direction.
      const beach = fbm2(nRiver, x * 0.016 + 40, z * 0.016, 2) + rivSide[i] * 0.1;
      /* Most of the bank is a CLIFF, not a ramp.
       *
       * This is where the small steps were coming from: a continuous slope,
       * however gentle, quantises into a staircase, and at one-block terraces
       * that staircase has a tread every few blocks all the way round every
       * body of water. In the reference the land keeps its terrace height
       * right to the water's edge and drops in ONE face — which is also what
       * exposes the grass / brick / stone strata that make the cliff read.
       *
       * Only a minority of the shoreline shelves down, and where it does it
       * shelves by whole terraces with treads wide enough to stand on. */
      if (beach > 0.2) {
        H[i] = Math.min(H[i], SEA + 1 + Math.floor(Math.max(dCell, 0) / 7) * L);
      }
    }
  }

  /* ---- lake basins, carved on the same terms as the river ------------
   *
   * Iterated per basin over its own bounding box rather than per column over
   * the whole map. Sweeping the world and asking every column for its distance
   * to every lake is fine at one lake and is a dozen fbm evaluations per
   * column at twelve — tens of millions of them on a large map, for a feature
   * that covers a few percent of it. */
  for (const LAKE of LAKES) {
    const reach = LAKE.r + 24 * K;
    const zLo = Math.max(0, Math.floor(LAKE.cz - reach * LAKE.az));
    const zHi = Math.min(S - 1, Math.ceil(LAKE.cz + reach * LAKE.az));
    const xLo = Math.max(0, Math.floor(LAKE.cx - reach * LAKE.ax));
    const xHi = Math.min(S - 1, Math.ceil(LAKE.cx + reach * LAKE.ax));
    for (let z = zLo; z <= zHi; z++) {
      for (let x = xLo; x <= xHi; x++) {
        const i = z * S + x;
        const d = lakeDistOf(LAKE, x, z);
        // Cell-resolution boundary, as above: the lake rim is a ring of large
        // rectangles rather than a rasterised circle.
        const dCell = lakeDistOf(LAKE, qc(x), qc(z));
        if (dCell > 15 * K) continue;
        wetness[i] = Math.max(wetness[i], 1 - smoothstep(0.0, 9.0 * K, d));
        if (!land[i] && dCell > 0) continue;

        if (dCell <= 0) {
          // A dished floor: shelving at the rim, deepest in the middle. The
          // shelf is what lets the depth ramp in the water shader read at all —
          // a flat-bottomed basin is one tone everywhere.
          // From the CELL distance, like the boundary above. Using the smooth
          // one here was the reason the bed staircased while the shore did not:
          // the same masonry has to continue under the water, not stop at it.
          // Reaches full depth well inside the rim rather than three quarters of
          // the way across. A disc has most of its area near the edge, so a lazy
          // falloff leaves the majority of the lake sitting on the shelf — the
          // median depth barely moved however far the floor was pushed down.
          const deep = 1 - smoothstep(-LAKE.r * 0.34, 0, dCell);
          // Deep enough for the absorption ramp to actually travel. At five
          // blocks the whole basin sat in the shallow end of the curve and read
          // as one pale sheet however the water was tuned.
          // The bed is a voxel floor, not a dish. Per-cell steps give the
          // submerged blocks the varied depths the reference shows through its
          // water; a smooth bowl reads as one flat tone however the water above
          // it is tuned.
          // Quantised to whole terraces, so the floor descends in the same
          // shelves the land does — four clean steps rather than a smooth dish
          // rounded into a fine staircase.
          // Big water wants somewhere genuinely deep. The radial falloff alone
          // gives one smooth bowl and therefore one depth reading across the
          // whole middle; a low-frequency field on the same lattice sinks
          // basins within the basin, so the colour ramp has real range to
          // travel and parts of the lake go properly dark.
          const trench = Math.max(fbm2(nLake, qc(x) * 0.024 + 300, qc(z) * 0.024, 3), 0);
          H[i] =
            SEA -
            1 -
            Math.round((deep * 14 + deep * trench * 22) / L) * L +
            cellStep(x, z, 21, 0.16, 0.16) * L +
            (cellHash(x, z, 22, JQ * 2) < 0.1 ? L : 0);
          H[i] = Math.max(1, H[i]);
          land[i] = 0;
          continue;
        }
        /* The bank has to vary around the rim.
         *
         * A single slope all the way round quantises into perfectly concentric
         * rings and the lake reads as a machined amphitheatre. Alternating long
         * stretches of shallow beach and steep bank — chosen by a low-frequency
         * field, the same way the river's banks are — breaks the rings up into
         * headlands and shallows, which is what makes a shoreline. */
        // Same rule as the river: the lake is mostly rimmed by clean faces,
        // with occasional beaches shelving in whole terraces.
        const bank = fbm2(nLake, x * 0.021 + 90, z * 0.021, 2);
        if (bank > 0.1) {
          H[i] = Math.min(H[i], SEA + 1 + Math.floor(Math.max(dCell, 0) / 8) * L);
        }
      }
    }
  }

  /* ---- coastal beaches on part of the rim -------------------------- */
  for (let z = 0; z < S; z++) {
    for (let x = 0; x < S; x++) {
      const i = z * S + x;
      if (!land[i]) continue;
      const r = nearDist(x, z);
      const R = rimR(x, z);
      const gap = R - r;
      if (gap > 14) continue;
      const coastal = fbm2(nEdge, x * 0.014 + 200, z * 0.014, 2);
      if (coastal < 0.14) continue; // most of the rim stays a plinth
      const gapQ = Math.max(rimR(qc(x), qc(z)) - nearDist(qc(x), qc(z)), 0);
      H[i] = Math.min(H[i], SEA + Math.floor(gapQ / 6) * L);
      wetness[i] = Math.max(wetness[i], 1 - smoothstep(0, 9, gap));
      if (H[i] <= SEA) land[i] = 0;
    }
  }

  /* ---- settle the water's edge -------------------------------------
   * The three shore carves — river bank, lake bank, coastal beach — each run
   * per column against a smooth distance field, so against the quantised
   * terrace lattice they land as one-block stairs and the whole waterline
   * breaks into a field of isolated pillars.
   *
   * A radius-1 mode filter is the right tool precisely because it is not a
   * blur: it replaces a column only when its neighbours agree on a different
   * height, which erases lone spikes and leaves the long straight runs that
   * make the terraces read as built. */
  // Despeckle only. A mode filter was tried here to settle the shore against
  // the lattice and it worked far too well: it agreed every bank column with
  // its neighbours and ironed the waterline perfectly flat, which is the one
  // thing it must not be. The banks are blocky by construction above now, so
  // all that remains is dropping stray single-column spikes.
  // Larger threshold: anything under a couple of cells is noise, not form.
  H = despeckle(H, S, land, 20);

  /* ---- stepping stones and spits -----------------------------------
   * The reference's water is never empty: single blocks stand just clear of
   * the surface, others sit an inch under it, and short spits of bank run out
   * into the shallows. They are what stops open water reading as a hole in
   * the map, and they give the eye something to measure the surface against.
   *
   * Placed per edge-grid cell so each is a clean block or pair, and only in
   * genuinely shallow water — a stone in the middle of the channel would look
   * like a generation fault rather than a crossing.
   */
  for (let z = 2; z < S - 2; z++) {
    for (let x = 2; x < S - 2; x++) {
      const i = z * S + x;
      if (land[i]) continue;
      const bed = H[i];
      if (bed < SEA - 5 || bed > SEA - 1) continue; // shallows only
      // On the terrace lattice, so a stone is a proper block of masonry
      // rather than a lone column — the reference's water holds a few big
      // square islands, not a scatter of pixels.
      const roll = cellHash(x, z, 57, Q);
      if (roll > 0.022) continue;
      // Most break the surface; the rest stay just submerged, which is what
      // gives the water something to be transparent *over*.
      H[i] = roll < 0.013 ? SEA + 1 : SEA;
      if (H[i] > SEA) land[i] = 1;
    }
  }

  /* ---- landmark: an isolated butte in the valley -------------------
   * Added after the filters so nothing rounds it away. It is deliberately not
   * connected to anything — a thing to look at, not to stand on.             */
  const noStair = new Uint8Array(S * S);
  const butteX = Math.round(0.585 * S),
    butteZ = Math.round(0.845 * S);
  for (let z = butteZ - 8; z <= butteZ + 8; z++) {
    for (let x = butteX - 8; x <= butteX + 8; x++) {
      if (x < 1 || z < 1 || x >= S - 1 || z >= S - 1) continue;
      const i = z * S + x;
      const dx = x - butteX,
        dz = z - butteZ;
      const d = Math.sqrt(dx * dx + dz * dz) + fbm2(nWarp, x * 0.09, z * 0.09, 2) * 2.0;
      if (d > 6.2) continue;
      if (!land[i] && H[i] < SEA - 2) {
        land[i] = 1;
      }
      H[i] = BASE + L * (d > 3.6 ? 5 : 6);
      noStair[i] = 1;
    }
  }

  onProgress(0.7, 'shaping the banks');
  /* ================================================================
   * 4. Walkability
   * ================================================================ */
  for (let i = 0; i < S * S; i++) land[i] = H[i] > SEA || fordMask[i] ? 1 : 0;
  const { stairMask } = carveStairs(H, S, land, { minArea: 34, tread: 2, width: 3, skip: noStair });

  /* ---- boulders ---------------------------------------------------
   * The last piece of mid-scale relief, and the one that works at the closest
   * framing: chunky rocks sitting on the shelves. They go in after the stairs
   * so they never block a route, and they are part of the heightfield so the
   * player can climb them and vegetation knows to leave them alone.         */
  const rockMask = new Uint8Array(S * S);
  scatterBoulders(H, S, land, stairMask, noStair, rockMask, rng);

  const heights = new Int16Array(S * S);
  for (let i = 0; i < S * S; i++) {
    heights[i] = clamp(land[i] ? H[i] : Math.min(H[i], seabed[i]), 1, WORLD.height - 14);
  }

  /* ================================================================
   * 5. Surface materials — big soft regions, never per-column
   * ================================================================ */
  const {
    GRASS,
    GRASS_LIGHT,
    GRASS_DEEP,
    GRASS_STONE,
    GRASS_LIGHT_STONE,
    GRASS_DEEP_STONE,
    SOIL,
    SAND,
    STONE,
    STONE_PALE,
    STONE_WARM,
  } = BLOCKS;
  const surface = new Uint8Array(S * S);
  const subsoil = new Uint8Array(S * S);

  for (let z = 0; z < S; z++) {
    for (let x = 0; x < S; x++) {
      const i = z * S + x;
      const top = heights[i];
      // A little high-frequency wobble is added to the *field*, not to the
      // decision, so region borders interlock by a block or two instead of
      // following a clean contour — soft edges, big shapes.
      const jitter = fbm2(nFine, x * 0.13, z * 0.13, 3) * 0.1;
      const rockField =
        fbm2(nRock, x * 0.0082, z * 0.0082, 4) +
        jitter +
        smoothstep(BASE + L * 4, BASE + L * 7, top) * 0.34 +
        smoothstep(3, 9, dropBelow(heights, S, x, z)) * 0.1;
      const sandField = 1 - smoothstep(0.0, 6.0, riverDist(x, z));

      const biome = nearestIslandBiome(x, z);
      // Per-biome thresholds: arid extends sand inland; tundra makes pale rocky
      // ground; tropical prefers lush deep grass; temperate uses defaults.
      // biome: 0=tropical  1=temperate  2=arid  3=tundra
      const sandThreshold  = biome === 2 ? 0.55 : biome === 0 ? 0.05 : 0.15;
      const rockThreshold  = biome === 3 ? 0.32 : biome === 2 ? 0.38 : 0.42;
      const rockLightThreshold = biome === 3 ? 0.18 : biome === 2 ? 0.24 : 0.28;

      let s;
      if (!land[i]) s = SAND.id;
      else if (top <= SEA + 2 && (sandField > sandThreshold || wetness[i] > 0.3)) s = SAND.id;
      else if (biome === 2 && top <= SEA + 8 && sandField > 0.02) s = SAND.id; // arid: deep sandy shores
      else if (rockField > rockThreshold) {
        // tundra uses pale stone; arid uses warm stone; others mix
        const warmRock = biome === 2 || (biome === 1 && fbm2(nRock, x * 0.03 + 9, z * 0.03, 2) > 0.2);
        s = (biome === 3 ? STONE_PALE : warmRock ? STONE_WARM : fbm2(nRock, x * 0.03 + 9, z * 0.03, 2) > 0.0 ? STONE : STONE_PALE).id;
      } else {
        const g = fbm2(nTone, x * 0.0115 + 90, z * 0.0115 + 12, 2) + jitter;
        if (biome === 0) {
          // tropical: lush, mostly deep/mid green
          s = g > 0.18 ? GRASS.id : GRASS_DEEP.id;
        } else if (biome === 3) {
          // tundra: pale and muted
          s = g > -0.05 ? GRASS_LIGHT.id : GRASS.id;
        } else {
          // temperate / arid default grass band
          s = g > 0.13 ? GRASS_LIGHT.id : g < -0.14 ? GRASS_DEEP.id : GRASS.id;
        }
        if (rockField > rockLightThreshold) {
          s = s === GRASS_LIGHT.id ? GRASS_LIGHT_STONE.id : s === GRASS_DEEP.id ? GRASS_DEEP_STONE.id : GRASS_STONE.id;
        }
      }
      // Stairs get a paler, harder tread so the route reads from a distance.
      if (stairMask[i] && s !== SAND.id) s = STONE_PALE.id;
      if (rockMask[i]) s = rockMask[i] === 2 ? STONE_PALE.id : STONE.id;
      surface[i] = s;
      const material = BLOCK_BY_ID[s];
      subsoil[i] = material?.grassCap ? (material.stoneSubstrate ? STONE.id : SOIL.id) : s;
    }
  }

  onProgress(0.85, 'filling the voxels');
  /* ================================================================
   * 6. Voxel fill
   * ================================================================ */
  for (let z = 0; z < S; z++) {
    for (let x = 0; x < S; x++) {
      const i = z * S + x;
      const top = heights[i];
      const surf = surface[i];
      const substrate = subsoil[i];
      // The entire exposed turf block stays green. The next block down owns
      // the regional substrate (warm soil or cool stone), then deeper layers
      // transition into the varied stone foundation.
      for (let y = 0; y <= top; y++) {
        let id;
        if (y === top) id = surf;
        else if (y === top - 1) id = substrate;
        else {
          const n = fbm2(nRock, x * 0.035, (z + y * 5.3) * 0.035, 2);
          const n2 = fbm2(nFine, x * 0.09 + 4.1, (y + z * 1.7) * 0.06, 1) * 0.14;
          id = n + n2 > 0.21 ? STONE_WARM.id : n + n2 < -0.24 ? STONE_PALE.id : STONE.id;
        }
        grid.set(x, y, z, id);
      }
    }
  }

  /* Feature counts scale with area, never with nothing.
   *
   * Every count below was a literal tuned against a 192-block world. A fixed
   * number of outcrops or cascades spread over sixteen times the area is not
   * "the same world, bigger" — it is a sparser world, and the sparseness is
   * exactly what makes a large map feel like an empty one. */
  // Fill river channels above sea level with passable river-water voxels so
  // the carved gorge looks wet. Three blocks deep — enough to trigger swimming
  // and to show colour from walking level. Columns at or below sea level are
  // already flooded by the water plane and need no voxels.
  const RIVER_FILL = 3;
  for (let z = 0; z < S; z++) {
    for (let x = 0; x < S; x++) {
      const i = z * S + x;
      if (heights[i] <= SEA) continue;
      const d = rivD[i];
      const hw = rivHalf[i];
      if (hw <= 0 || d >= hw) continue; // outside channel
      for (let dy = 1; dy <= RIVER_FILL; dy++) {
        const wy = heights[i] + dy;
        if (wy < WORLD.height) grid.set(x, wy, z, RIVER_WATER.id);
      }
    }
  }

  decorateCliffs(grid, heights, land, S, rng, nRock, AREA);
  addCascades(grid, heights, land, S, riverPath, rng, CASCADE.id, AREA);

  // Bake normalised river proximity (0=land, 255=channel centre) for the water shader.
  const rivFlow = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const d = rivD[i];
    const hw = rivHalf[i];
    if (hw > 0 && d < hw) rivFlow[i] = Math.round((1 - d / hw) * 255);
  }

  return {
    grid,
    heights,
    wetness,
    land,
    riverPath,
    rng,
    size: S,
    stairMask,
    lake: LAKE,
    riverDist,
    rivFlow,
  };
}

/**
 * Boulders, slabs and standing stones.
 *
 * Sited on a jittered grid so the spacing is even — a random scatter clumps,
 * and clumps leave big empty stretches, which is exactly the failure this pass
 * exists to fix. Each site must be genuinely flat and clear of stairs, cliff
 * lips and water, so a rock never turns into an accidental wall.
 */
function scatterBoulders(H: any, S: any, land: any, stairMask: any, noStair: any, rockMask: any, rng: any) {
  const SEA = WORLD.seaLevel;
  const SPACING = 15;
  const flatAround = (x: any, z: any, r: any) => {
    const h = H[z * S + x];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const i = (z + dz) * S + (x + dx);
        if (!land[i] || H[i] !== h || stairMask[i] || noStair[i]) return false;
      }
    }
    return h > SEA + 1;
  };

  for (let gz = SPACING; gz < S - SPACING; gz += SPACING) {
    for (let gx = SPACING; gx < S - SPACING; gx += SPACING) {
      if (rng.chance(0.3)) continue; // leave clearings
      const cx = gx + rng.int(-5, 5),
        cz = gz + rng.int(-5, 5);
      if (!flatAround(cx, cz, 4)) continue;
      const kind = rng();
      if (kind < 0.34) {
        // low slab — a flat rock shelf, reads as a place to sit
        const w = rng.int(1, 2),
          d = rng.int(1, 3);
        blob(H, S, rockMask, cx, cz, w, d, 1, 1, rng);
      } else if (kind < 0.78) {
        // rounded boulder, two tiers so the silhouette is not a box
        const r = rng.range(1.6, 2.8);
        round(H, S, rockMask, cx, cz, r, 1, 1, rng);
        round(H, S, rockMask, cx + rng.int(-1, 1), cz + rng.int(-1, 1), r * 0.55, 1, 2, rng);
      } else {
        // standing stone — a strong vertical accent at the closest framing
        blob(H, S, rockMask, cx, cz, rng.int(0, 1), 0, rng.int(3, 4), 2, rng);
        if (rng.chance(0.6)) blob(H, S, rockMask, cx + rng.int(2, 3), cz + rng.int(-1, 1), 0, 0, rng.int(1, 2), 2, rng);
      }
    }
  }
}

function blob(H: any, S: any, mask: any, cx: any, cz: any, wx: any, wz: any, rise: any, tone: any, _rng: any) {
  const base = H[cz * S + cx];
  for (let dz = -wz; dz <= wz; dz++) {
    for (let dx = -wx; dx <= wx; dx++) {
      const x = cx + dx,
        z = cz + dz;
      if (x < 1 || z < 1 || x >= S - 1 || z >= S - 1) continue;
      const i = z * S + x;
      H[i] = Math.max(H[i], base + rise);
      mask[i] = tone;
    }
  }
}

function round(H: any, S: any, mask: any, cx: any, cz: any, r: any, rise: any, tone: any, _rng: any) {
  const base = H[cz * S + cx];
  const ri = Math.ceil(r);
  for (let dz = -ri; dz <= ri; dz++) {
    for (let dx = -ri; dx <= ri; dx++) {
      if (dx * dx + dz * dz > r * r) continue;
      const x = cx + dx,
        z = cz + dz;
      if (x < 1 || z < 1 || x >= S - 1 || z >= S - 1) continue;
      const i = z * S + x;
      H[i] = Math.max(H[i], base + rise);
      mask[i] = tone;
    }
  }
}

/**
 * Cliff articulation.
 *
 * A perfectly flat wall is clean but dead. A handful of protruding outcrops
 * and bitten-out cave mouths give the big faces scale and shadow without
 * touching the heightfield, so walkability and every downstream consumer are
 * unaffected — these only ever add or remove blocks *below* a column top.
 */
function decorateCliffs(grid: any, heights: any, land: any, S: any, rng: any, _nRock: any, area = 1) {
  const { STONE, STONE_PALE, STONE_WARM } = BLOCKS;
  const at = (x: any, z: any) => heights[clamp(z, 0, S - 1) * S + clamp(x, 0, S - 1)];

  // Collect cliff feet: a low column with a much taller neighbour.
  const feet = [];
  for (let z = 3; z < S - 3; z++) {
    for (let x = 3; x < S - 3; x++) {
      const i = z * S + x;
      if (!land[i]) continue;
      const c = at(x, z);
      for (let d = 0; d < 4; d++) {
        const ux = d === 0 ? 1 : d === 1 ? -1 : 0;
        const uz = d === 2 ? 1 : d === 3 ? -1 : 0;
        const nh = at(x + ux, z + uz);
        if (nh - c >= 5) feet.push({ x, z, ux, uz, base: c, wall: nh });
      }
    }
  }
  if (!feet.length) return;

  // Outcrops — chunky ledges shouldered out of the wall.
  for (let k = 0, n = Math.round(46 * area); k < n; k++) {
    const f = feet[rng.int(0, feet.length - 1)];
    const y0 = f.base + 1 + rng.int(0, Math.max(0, f.wall - f.base - 3));
    const th = rng.int(1, 2);
    const w = rng.int(1, 3);
    const px = f.uz,
      pz = f.ux;
    const id = rng.chance(0.5) ? STONE.id : rng.chance(0.5) ? STONE_WARM.id : STONE_PALE.id;
    for (let a = -w; a <= w; a++) {
      const dep = 1 + Math.round((1 - Math.abs(a) / (w + 0.6)) * rng.range(0.6, 1.9));
      for (let e = 0; e < dep; e++) {
        const x = f.x + px * a - f.ux * e;
        const z = f.z + pz * a - f.uz * e;
        for (let y = y0; y < y0 + th; y++) {
          if (y > at(x, z)) grid.set(x, y, z, id);
        }
      }
    }
  }

  // Cave mouths — a rectangular bite into the base of a tall wall. Cheap depth.
  let cut = 0;
  const caves = Math.round(9 * area);
  for (let k = 0, n = Math.round(400 * area); k < n && cut < caves; k++) {
    const f = feet[rng.int(0, feet.length - 1)];
    if (f.wall - f.base < 8) continue;
    const w = rng.int(1, 2),
      hgt = rng.int(3, 4),
      depth = rng.int(3, 6);
    const px = f.uz,
      pz = f.ux;
    let ok = true;
    for (let a = -w; a <= w && ok; a++) {
      for (let e = 1; e <= depth && ok; e++) {
        const x = f.x + f.ux * e + px * a,
          z = f.z + f.uz * e + pz * a;
        if (at(x, z) < f.base + hgt + 2) ok = false;
      }
    }
    if (!ok) continue;
    cut++;
    for (let a = -w; a <= w; a++) {
      const taper = Math.abs(a) === w ? 1 : 0;
      for (let e = 1; e <= depth - Math.abs(a); e++) {
        const x = f.x + f.ux * e + px * a,
          z = f.z + f.uz * e + pz * a;
        for (let y = f.base + 1; y <= f.base + hgt - taper; y++) grid.set(x, y, z, 0);
      }
    }
  }

  // Lichen on cliff faces — pale crust on the lower half of tall walls
  for (let k = 0, n = Math.round(80 * area); k < n; k++) {
    const f = feet[rng.int(0, feet.length - 1)];
    if (f.wall - f.base < 5) continue;
    const lw = rng.int(1, 3);
    const px = f.uz,
      pz = f.ux;
    const yStart = f.base + 1;
    const yEnd = f.base + Math.floor((f.wall - f.base) * 0.55);
    for (let a = -lw; a <= lw; a++) {
      if (!rng.chance(0.55)) continue;
      for (let y = yStart; y <= yEnd; y++) {
        const lx = f.x + px * a,
          lz = f.z + pz * a;
        if (grid.get(lx, y, lz) !== 0) grid.set(lx, y, lz, LICHEN_PALE.id);
      }
    }
  }
}

/**
 * Waterfalls. Where a bank sits well above the waterline right at the channel
 * edge, run a pale cascade down the face and a short spill shelf at the top —
 * a vertical accent in an otherwise horizontal world.
 */
function addCascades(grid: any, heights: any, land: any, S: any, riverPath: any, rng: any, cascadeId: any, area = 1) {
  const SEA = WORLD.seaLevel;
  // Both banks of every node, found along the channel's own normal rather than
  // along +X — the river no longer runs down the map, so an axis-aligned probe
  // would walk along the bank instead of across it.
  const candidates = [];
  for (const p of riverPath) {
    for (const side of [-1, 1]) {
      const bx = Math.round(p.x + side * p.nx * (p.w + 1.5));
      const bz = Math.round(p.z + side * p.nz * (p.w + 1.5));
      if (bx < 4 || bz < 4 || bx > S - 5 || bz > S - 5) continue;
      const i = bz * S + bx;
      if (!land[i]) continue;
      const h = heights[i];
      if (h < SEA + 7 || h > SEA + 20) continue;
      candidates.push({ x: bx, z: bz, ux: -side * p.nx, uz: -side * p.nz, h });
    }
  }
  if (!candidates.length) return;
  let made = 0,
    guard = 0;
  const used: any[] = [];
  const want = Math.round(3 * area);
  while (made < want && guard++ < 100 * want + 200) {
    const c = candidates[rng.int(0, candidates.length - 1)];
    if (used.some((u) => Math.hypot(u.x - c.x, u.z - c.z) < 26)) continue;
    used.push(c);
    made++;
    // Spread along the lip, i.e. perpendicular to the fall direction.
    const px = -c.uz,
      pz = c.ux;
    const w = rng.int(1, 2);
    for (let a = -w; a <= w; a++) {
      const x = Math.round(c.x + px * a),
        z = Math.round(c.z + pz * a);
      // carve a notch in the lip so the water has somewhere to leave from
      for (let y = c.h; y > c.h - 2; y--) grid.set(x, y, z, 0);
      for (let y = SEA; y <= c.h - 1; y++) grid.set(x, y, z, cascadeId);
      // a thin sheet standing just off the face, so it reads as falling water
      const fx = Math.round(x + c.ux),
        fz = Math.round(z + c.uz);
      for (let y = SEA; y <= c.h - 2; y++) grid.set(fx, y, fz, cascadeId);
    }
  }
}
