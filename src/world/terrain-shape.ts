/**
 * Terrain shaping operators.
 *
 * These are the tools that turn a continuous field into *plateaus* rather than
 * a corrugated staircase. The lesson learned the hard way: you cannot blur a
 * heightfield into terraces. Blurring a step spreads it over ~2 sigma columns
 * and quantising that spread produces exactly the 1-block staircase we are
 * trying to avoid. Broad shelves only happen if the field is already
 * piecewise-flat *by construction*, and these operators exist to keep it that
 * way — clean up slivers, straighten cliff lines, and then cut walkable stairs
 * back into the result on purpose.
 *
 * Everything works on absolute block heights (Int16), not level indices, so
 * the river and the beaches can sit off-lattice while the land stays on it.
 */

import { clamp } from '../core/rng';

/**
 * Majority (mode) filter — the workhorse.
 *
 * Replaces each column with the most common height in its neighbourhood. On a
 * quantised field this is a morphological "open + close": it deletes slivers
 * narrower than the kernel, rounds off ragged contour edges into decisive
 * lines, and grows the dominant shelf outward. Ties resolve toward the
 * column's own value so stable regions never drift.
 */
export function modeFilter(lev: any, S: any, radius: any, land: any, iterations = 1) {
  let src = lev;
  const counts = new Map();
  for (let it = 0; it < iterations; it++) {
    const out = Int16Array.from(src);
    for (let z = 0; z < S; z++) {
      for (let x = 0; x < S; x++) {
        const i = z * S + x;
        if (!land[i]) continue;
        counts.clear();
        const self = src[i];
        for (let dz = -radius; dz <= radius; dz++) {
          const zz = clamp(z + dz, 0, S - 1);
          for (let dx = -radius; dx <= radius; dx++) {
            const j = zz * S + clamp(x + dx, 0, S - 1);
            if (!land[j]) continue;
            const v = src[j];
            counts.set(v, (counts.get(v) || 0) + 1);
          }
        }
        let best = self,
          bestC = -1;
        for (const [v, c] of counts) {
          if (c > bestC || (c === bestC && Math.abs(v - self) < Math.abs(best - self))) {
            best = v;
            bestC = c;
          }
        }
        out[i] = best;
      }
    }
    src = out;
  }
  return src;
}

/**
 * Label walk-connected regions.
 *
 * Two neighbouring land columns belong to the same region when the player can
 * step between them freely — a height difference of at most `maxStep` (the
 * character auto-steps 1). This is a connectivity map, not a flatness map, so
 * a shelf plus its own access stair count as one region.
 */
export function labelWalk(lev: any, S: any, land: any, maxStep = 1) {
  const label = new Int32Array(S * S).fill(-1);
  const sizes = [];
  const stack = new Int32Array(S * S);
  let next = 0;
  for (let start = 0; start < S * S; start++) {
    if (!land[start] || label[start] >= 0) continue;
    const id = next++;
    let sp = 0,
      size = 0;
    stack[sp++] = start;
    label[start] = id;
    while (sp > 0) {
      const i = stack[--sp];
      size++;
      const x = i % S,
        z = (i / S) | 0;
      const h = lev[i];
      for (let d = 0; d < 4; d++) {
        const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0);
        const nz = z + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (nx < 0 || nz < 0 || nx >= S || nz >= S) continue;
        const j = nz * S + nx;
        if (!land[j] || label[j] >= 0) continue;
        if (Math.abs(lev[j] - h) > maxStep) continue;
        label[j] = id;
        stack[sp++] = j;
      }
    }
    sizes.push(size);
  }
  return { label, sizes, count: next };
}

/**
 * Delete regions smaller than `minArea` by flooding them to the most common
 * height on their border. Kills leftover single-column pimples and one-block
 * moats that survive the mode filter, both of which read as noise.
 */
export function despeckle(lev: any, S: any, land: any, minArea = 14) {
  const out = Int16Array.from(lev);
  const { label, sizes } = labelWalk(lev, S, land, 0);
  const border = new Map();
  const members = [];
  for (let id = 0; id < sizes.length; id++) {
    if (sizes[id] >= minArea) continue;
    border.clear();
    members.length = 0;
    for (let i = 0; i < S * S; i++) {
      if (label[i] !== id) continue;
      members.push(i);
      const x = i % S,
        z = (i / S) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0);
        const nz = z + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (nx < 0 || nz < 0 || nx >= S || nz >= S) continue;
        const j = nz * S + nx;
        if (!land[j] || label[j] === id) continue;
        border.set(lev[j], (border.get(lev[j]) || 0) + 1);
      }
    }
    let best = null,
      bestC = 0;
    for (const [v, c] of border)
      if (c > bestC) {
        best = v;
        bestC = c;
      }
    if (best === null) continue;
    for (const i of members) out[i] = best;
  }
  return out;
}

/**
 * Cut walkable stairs into cliffs until the land is one connected region.
 *
 * Terrace steps are 3 blocks, so *every* shelf boundary is a wall the player
 * cannot climb. Rather than softening the cliffs (which is how you get mush)
 * we leave them sharp and carve a small number of deliberate notched
 * staircases — the same move the reference images make. Each stair is a slot
 * bitten into the *high* side, 3 columns wide with 2-deep treads, so from the
 * playing camera it reads as a cut path rather than as terrain noise.
 *
 * Returns the list of stair sites so the surface pass can dress them.
 */
export function carveStairs(lev: any, S: any, land: any, opts: any = {}) {
  const {
    minArea = 30, // regions smaller than this are scenery, not destinations
    tread = 2, // columns per 1-block rise
    width = 3,
    maxStairs = 90,
    skip = null, // columns that must never be cut (landmark pillars)
  } = opts;

  const stairMask = new Uint8Array(S * S);
  const sites = [];
  const dead = new Set();

  for (let iter = 0; iter < maxStairs; iter++) {
    const { label, sizes } = labelWalk(lev, S, land, 1);
    if (sizes.length <= 1) break;

    // Everything that is big enough to be worth reaching.
    let mainId = 0;
    for (let id = 1; id < sizes.length; id++) if (sizes[id] > sizes[mainId]) mainId = id;
    let pending = 0;
    for (let id = 0; id < sizes.length; id++) {
      if (id !== mainId && sizes[id] >= minArea && !dead.has(id)) pending++;
    }
    if (pending === 0) break;

    // Cheapest boundary between two different regions, at least one of which
    // is a real destination. Cheapest == shortest climb == least scarring.
    let best = null;
    for (let z = 1; z < S - 1; z++) {
      for (let x = 1; x < S - 1; x++) {
        const i = z * S + x;
        if (!land[i]) continue;
        const a = label[i];
        if (sizes[a] < minArea || dead.has(a)) continue;
        for (let d = 0; d < 4; d++) {
          const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0);
          const nz = z + (d === 2 ? 1 : d === 3 ? -1 : 0);
          const j = nz * S + nx;
          if (!land[j] || label[j] === a) continue;
          if (skip && (skip[i] || skip[j])) continue;
          const dh = Math.abs(lev[j] - lev[i]);
          if (dh < 2) continue;
          // prefer short climbs, and prefer joining onto the main region
          const cost = dh * 4 + (label[j] === mainId || a === mainId ? 0 : 6);
          if (!best || cost < best.cost) best = { cost, i, j, x, z, nx, nz };
        }
      }
    }
    if (!best) {
      // Nothing reachable — mark the stranded destinations as scenery islands.
      for (let id = 0; id < sizes.length; id++) if (id !== mainId) dead.add(id);
      break;
    }

    const hi =
      lev[best.i] > lev[best.j]
        ? { x: best.x, z: best.z, o: { x: best.nx, z: best.nz } }
        : { x: best.nx, z: best.nz, o: { x: best.x, z: best.z } };
    cutStair(lev, S, land, stairMask, hi.o.x, hi.o.z, hi.x - hi.o.x, hi.z - hi.o.z, tread, width, skip);
    sites.push({ x: hi.o.x, z: hi.o.z, ux: hi.x - hi.o.x, uz: hi.z - hi.o.z });
  }
  return { stairMask, sites };
}

/** One staircase: from the low column, biting up into the high ground. */
function cutStair(
  lev: any,
  S: any,
  land: any,
  mask: any,
  lx: any,
  lz: any,
  ux: any,
  uz: any,
  tread: any,
  width: any,
  skip: any,
) {
  const lo = lev[lz * S + lx];
  const px = uz,
    pz = ux; // perpendicular, for the stair width
  const half = (width - 1) / 2;
  for (let s = 1; s < 96; s++) {
    const x = lx + ux * s,
      z = lz + uz * s;
    if (x < 1 || z < 1 || x >= S - 1 || z >= S - 1) break;
    const i = z * S + x;
    if (!land[i] || (skip && skip[i])) break;
    const target = lo + Math.ceil(s / tread);
    if (lev[i] <= target) break; // we have reached the upper shelf
    for (let w = -half; w <= half; w++) {
      const wx = x + px * w,
        wz = z + pz * w;
      if (wx < 0 || wz < 0 || wx >= S || wz >= S) continue;
      const j = wz * S + wx;
      if (!land[j] || (skip && skip[j])) continue;
      if (lev[j] > target) {
        lev[j] = target;
        mask[j] = 1;
      } else if (w === 0) mask[j] = 1;
    }
  }
}

/**
 * Height difference to the tallest 4-neighbour. Positive means this column is
 * at the foot of a cliff; used for ledges, beaches and material choice.
 */
export function riseAbove(lev: any, S: any, x: any, z: any) {
  const at = (xx: any, zz: any) => lev[clamp(zz, 0, S - 1) * S + clamp(xx, 0, S - 1)];
  const c = at(x, z);
  return Math.max(at(x + 1, z), at(x - 1, z), at(x, z + 1), at(x, z - 1)) - c;
}

/** How far this column stands above its lowest 4-neighbour (cliff height). */
export function dropBelow(lev: any, S: any, x: any, z: any) {
  const at = (xx: any, zz: any) => lev[clamp(zz, 0, S - 1) * S + clamp(xx, 0, S - 1)];
  const c = at(x, z);
  return c - Math.min(at(x + 1, z), at(x - 1, z), at(x, z + 1), at(x, z - 1));
}
