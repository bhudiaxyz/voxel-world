/**
 * Scene stamps — the composition layer.
 *
 * Everything below this file distributes things: terrain distributes relief,
 * vegetation distributes trees, props distribute bridges. Distribution gives
 * you a world that is evenly interesting, which is not the same as a world
 * with anywhere worth standing. A screenshot of evenly-interesting terrain
 * looks *sampled*. This is the pass that makes some places look chosen.
 *
 * A stamp holds RULES, not voxels. `WATERFALL_GARDEN` does not paste a
 * waterfall; it finds a real cliff with real water at its foot, cuts the notch
 * where the lip actually is, and hangs the composition off that. So every
 * instance differs while the arrangement holds — which is the only way a
 * handful of grammars can furnish a whole map without the repeats showing.
 *
 * Composition inside a stamp is hierarchical, and the ratios matter more than
 * the contents:
 *
 *     1        hero          the cascade, the gate, the great tree
 *     2-3      secondary     framing trees, the deck, the jetty
 *     5-15     supporting    rocks, saplings, lanterns, reeds
 *     many     micro-detail  scrub, pads, petals
 *
 * Sites come from `plan.scenic`, already scored and ranked. Each grammar
 * re-checks the plan's claim about the terrain before it builds: a `waterfall`
 * site whose cliff turned out too short downgrades to a `crossing` rather than
 * running a cascade down flat ground.
 */

import { BLOCKS, WATER } from '../core/palette';
import { makeRng } from '../core/rng';
import { plantTree } from './vegetation';
import { CASCADE, RIVER_WATER } from './terrain';

/**
 * How many scenes the map gets, per 256x256 blocks of it.
 *
 * A count rather than a constant. Nine scenes is a good number for a small
 * island and a rounding error across a large continent — fixed counts are the
 * same mistake as fractional spacing, and they are what make a big world feel
 * emptier than a small one rather than richer.
 */
const STAMPS_PER_AREA = 9;
/**
 * Scenes must not overlap, or two compositions read as one mess.
 *
 * In **blocks**. As a fraction of world size it meant a larger map pushed its
 * scenes further apart instead of fitting more in — 768 blocks produced fewer
 * scenes than 512 did, because the quota rose while the spacing rule rose
 * faster. How close is too close is a fact about how far you can see, which
 * does not change when the map does.
 */
const MIN_SEPARATION = 34;
/**
 * How many of each kind the map may have.
 *
 * Without this the ranking eats itself. Waterfall sites score highest by
 * construction — water proximity and relief are the two heaviest terms — so
 * taking the top nine gave eight waterfalls and one grove, and a map with
 * eight waterfalls has no waterfall in it. The quota is art direction
 * overruling the score, which is the entire reason the score is only allowed
 * to *rank* rather than to decide.
 */
const QUOTA = { waterfall: 2, crossing: 2, pond: 2, overlook: 2, grove: 3, hotspring: 2 };
/** How far from the region centre a grammar may hunt for its feature. */
const SEARCH_R = 30;

const LEAVES = [BLOCKS.LEAF_PINK, BLOCKS.LEAF_BLUSH, BLOCKS.LEAF_LILAC, BLOCKS.LEAF_CREAM, BLOCKS.LEAF_ROSE];

/* ================================================================== *
 * Shared toolkit
 *
 * Every grammar edits the heightfield as well as the voxel grid. Anything
 * that changes a column top and does not update `heights` desynchronises the
 * collision, the vegetation pass and the water depth map from what is drawn —
 * so raising and carving go through here rather than touching `grid` directly.
 * ================================================================== */
function toolkit(world: any) {
  const { grid, heights, size: S } = world;
  const SEA = Math.floor(WATER.level);
  const reserved = world.reserved || (world.reserved = new Uint8Array(S * S));

  const inb = (x: any, z: any) => x >= 2 && z >= 2 && x < S - 2 && z < S - 2;
  const idx = (x: any, z: any) => z * S + x;
  const top = (x: any, z: any) => (inb(x, z) ? heights[idx(x, z)] : -9999);
  const wet = (x: any, z: any) => inb(x, z) && heights[idx(x, z)] <= SEA;
  const dry = (x: any, z: any) => inb(x, z) && heights[idx(x, z)] > SEA;

  /** Move a column top to `ny`, filling or clearing as required. */
  const ground = (x: any, z: any, ny: any, surf: any, fill = surf) => {
    if (!inb(x, z)) return;
    const i = idx(x, z),
      cur = heights[i];
    if (ny > cur) {
      for (let y = cur + 1; y <= ny; y++) grid.set(x, y, z, y === ny ? surf : fill);
    } else if (ny < cur) {
      for (let y = cur; y > ny; y--) grid.set(x, y, z, 0);
      grid.set(x, ny, z, surf);
    } else {
      grid.set(x, ny, z, surf);
    }
    heights[i] = ny;
  };

  /** Put a block above the ground without disturbing the heightfield — decks,
   *  posts, lanterns. Vegetation already treats anything standing proud of the
   *  terrain as occupied, so these reserve themselves. */
  const put = (x: any, z: any, y: any, id: any) => {
    if (inb(x, z)) grid.set(x, y, z, id);
  };

  /** Keep vegetation out. A clearing is a deliberate absence and the scatter
   *  pass will happily fill it in otherwise. */
  const reserve = (cx: any, cz: any, r: any) => {
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r) continue;
        const x = cx + dx,
          z = cz + dz;
        if (inb(x, z)) reserved[idx(x, z)] = 1;
      }
  };

  /* Where scenes already stand.
   *
   * Site *centres* were far enough apart, but two neighbouring regions can
   * easily find the same cliff and both build on it — the finders below all
   * hunt within 30 blocks of a centre. Rejecting a feature, rather than a
   * site, is what actually keeps compositions off one another. */
  const claims: any[] = [];
  const claimed = (x: any, z: any) => claims.some((c) => Math.hypot(c[0] - x, c[1] - z) < MIN_SEPARATION);

  /** True if a patch is flat, dry and unclaimed — a place to build. */
  const flat = (cx: any, cz: any, r: any, tol = 0) => {
    if (!dry(cx, cz)) return false;
    const h = top(cx, cz);
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx,
          z = cz + dz;
        if (!inb(x, z) || Math.abs(top(x, z) - h) > tol) return false;
        if (reserved[idx(x, z)]) return false;
      }
    return true;
  };

  /* `T.rng` is swapped per scene by buildStamps, so a stamp draws from its own
   * stream. Sharing the world rng meant a scene shifted whenever an earlier
   * scene happened to draw a different number of randoms — which turns any
   * tuning pass into whack-a-mole. */
  const T = { rng: null };

  const tree = (x: any, z: any, scale: any, leaf: any, form: any) => {
    if (!dry(x, z)) return null;
    const t = plantTree(grid, x, top(x, z) + 1, z, T.rng, { scale, leaf, form });
    world.stampTrees.push(t);
    reserve(x, z, Math.max(2, Math.floor(t.w / 2)));
    return t;
  };

  /** A lamp post. Three blocks of timber, a lantern, a cap. */
  const lantern = (x: any, z: any) => {
    if (!dry(x, z)) return;
    const y = top(x, z) + 1;
    put(x, z, y, BLOCKS.BEAM.id);
    put(x, z, y + 1, BLOCKS.BEAM.id);
    put(x, z, y + 2, BLOCKS.LANTERN.id);
    put(x, z, y + 3, BLOCKS.BEAM.id);
  };

  /** Reeds — a few uneven stalks. The cheapest thing that makes a shoreline
   *  read as a shoreline rather than as the edge of a texture. */
  const reeds = (x: any, z: any, rng: any) => {
    if (!dry(x, z)) return;
    const y = top(x, z) + 1;
    const h = rng.int(2, 3);
    for (let k = 0; k < h; k++) put(x, z, y + k, BLOCKS.LEAF_MINT.id);
  };

  return Object.assign(T, {
    S,
    SEA,
    grid,
    heights,
    inb,
    idx,
    top,
    wet,
    dry,
    ground,
    put,
    reserve,
    reserved,
    flat,
    tree,
    lantern,
    reeds,
    claims,
    claimed,
  });
}

/* ================================================================== *
 * Feature finders
 *
 * These are what make a stamp a rule rather than a paste. Each one asks the
 * finished terrain a question and returns the best answer near a site, or
 * null — and a null is a downgrade, never a fudge.
 * ================================================================== */

/** The tallest cliff face near a site that has water at its foot. */
function findCascadeCliff(T: any, cx: any, cz: any, r: any) {
  let best = null,
    bestScore = 0;
  for (let dz = -r; dz <= r; dz += 2) {
    for (let dx = -r; dx <= r; dx += 2) {
      const x = cx + dx,
        z = cz + dz;
      if (!T.dry(x, z) || T.claimed(x, z)) continue;
      const h = T.top(x, z);
      for (let d = 0; d < 4; d++) {
        const ux = d === 0 ? 1 : d === 1 ? -1 : 0;
        const uz = d === 2 ? 1 : d === 3 ? -1 : 0;
        // Look a little way out, so a one-block kerb never qualifies.
        const fx = x + ux * 2,
          fz = z + uz * 2;
        const drop = h - T.top(fx, fz);
        if (drop < 6) continue;
        // Water at the foot is what turns a cliff into a waterfall.
        let water = 0;
        for (let k = 2; k <= 7; k++) if (T.wet(x + ux * k, z + uz * k)) water++;
        if (!water) continue;
        const score = drop + water * 2.5 - Math.hypot(dx, dz) * 0.15;
        if (score > bestScore) {
          bestScore = score;
          best = { x, z, ux, uz, hi: h, lo: T.top(fx, fz) };
        }
      }
    }
  }
  return best;
}

/**
 * The most *crossable* river node near a site.
 *
 * Nearest was the wrong question. The nearest node to a coastal region is the
 * river mouth, which is where the channel is widest and merges into open
 * water — so the first version laid a line of stepping stones out into the
 * sea. Narrow beats close: a crossing belongs where the river can actually be
 * crossed.
 */
function findChannel(world: any, T: any, cx: any, cz: any, r: any) {
  let best = null,
    bestScore = -Infinity;
  for (const p of world.riverPath) {
    if (T.claimed(p.x, p.z)) continue;
    // The upper course is a dry ravine, not a river — nothing to cross there.
    if (!T.wet(Math.round(p.x), Math.round(p.z))) continue;
    const d = Math.hypot(p.x - cx, p.z - cz);
    if (d > r) continue;
    const score = -p.w * 2.0 - d * 0.12;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

/**
 * The widest stretch of open, level ground near a site.
 *
 * Tries the ideal footprint first and shrinks. Terraces are wide but not
 * unlimited, and demanding a perfect 15x15 shelf simply returned null on most
 * seeds — a slightly smaller grove is always better than no grove.
 */
function findClearing(T: any, cx: any, cz: any, r: any, want: any) {
  for (const need of [want, want - 2, want - 3]) {
    if (need < 2) break;
    let best = null,
      bestScore = -1;
    for (let dz = -r; dz <= r; dz += 2) {
      for (let dx = -r; dx <= r; dx += 2) {
        const x = cx + dx,
          z = cz + dz;
        if (T.claimed(x, z) || !T.flat(x, z, need, 0)) continue;
        const score = T.top(x, z) - Math.hypot(dx, dz) * 0.4;
        if (score > bestScore) {
          bestScore = score;
          best = [x, z];
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/** A lip: dry, level, with a long drop on one side. Where a view is from. */
function findLip(T: any, cx: any, cz: any, r: any) {
  let best = null,
    bestScore = 0;
  for (let dz = -r; dz <= r; dz += 2) {
    for (let dx = -r; dx <= r; dx += 2) {
      const x = cx + dx,
        z = cz + dz;
      if (T.claimed(x, z) || !T.flat(x, z, 3, 0)) continue;
      const h = T.top(x, z);
      for (let d = 0; d < 4; d++) {
        const ux = d === 0 ? 1 : d === 1 ? -1 : 0;
        const uz = d === 2 ? 1 : d === 3 ? -1 : 0;
        const drop = h - T.top(x + ux * 6, z + uz * 6);
        if (drop < 7) continue;
        const score = drop - Math.hypot(dx, dz) * 0.2;
        if (score > bestScore) {
          bestScore = score;
          best = { x, z, ux, uz, h };
        }
      }
    }
  }
  return best;
}

/* ================================================================== *
 * The grammars
 * ================================================================== */

/**
 * WATERFALL_GARDEN — the map's set piece.
 *
 *   requires   a cliff of 6+ blocks with water at its foot
 *   generates  cascade · plunge pool · spray rocks · viewing deck
 *              · two framing trees · lanterns · reeds
 */
function waterfallGarden(_world: any, T: any, site: any, rng: any) {
  const c = findCascadeCliff(T, site.at[0] | 0, site.at[1] | 0, SEARCH_R);
  if (!c) return null;

  const { ux, uz } = c;
  const px = -uz,
    pz = ux; // along the lip
  const w = rng.int(1, 2);

  /* 1 — the hero. Notch the lip so the water has somewhere to leave from,
   * then hang a sheet down the face and a second, thinner sheet standing off
   * it. Two planes at slightly different depths is what stops a cascade
   * reading as a painted stripe on the wall. */
  for (let a = -w; a <= w; a++) {
    const x = c.x + px * a,
      z = c.z + pz * a;
    T.ground(x, z, c.hi - 1, CASCADE.id, BLOCKS.STONE_PALE.id);
    for (let y = c.lo; y <= c.hi - 1; y++) T.put(x, z, y, CASCADE.id);
    for (let y = c.lo; y <= c.hi - 2; y++) T.put(x + ux, z + uz, y, CASCADE.id);
  }

  /* 2 — the plunge pool. A real basin, dug where the water lands, so the
   * depth ramp in the water shader has somewhere to run. */
  const bx = c.x + ux * 5,
    bz = c.z + uz * 5;
  for (let dz = -5; dz <= 5; dz++)
    for (let dx = -5; dx <= 5; dx++) {
      const d = Math.hypot(dx, dz);
      if (d > 5) continue;
      const x = bx + dx,
        z = bz + dz;
      if (!T.inb(x, z)) continue;
      if (T.top(x, z) > T.SEA + 3) continue; // never cut into the cliff
      const depth = Math.round(6 - d);
      T.ground(x, z, T.SEA - 1 - depth, BLOCKS.STONE.id, BLOCKS.STONE.id);
    }

  /* 3 — spray rocks in the pool, and a stone apron round the rim. Broken
   * water needs something to break on. */
  for (let k = 0; k < 5; k++) {
    const a = rng.range(0, Math.PI * 2),
      d = rng.range(2, 6);
    const x = Math.round(bx + Math.cos(a) * d),
      z = Math.round(bz + Math.sin(a) * d);
    if (!T.inb(x, z)) continue;
    T.ground(x, z, T.SEA + rng.int(0, 1), rng.chance(0.5) ? BLOCKS.STONE_PALE.id : BLOCKS.STONE.id, BLOCKS.STONE.id);
  }

  /* 4 — the viewing deck, set to one side of the fall on the lip above, so
   * there is a place the scene is composed *from*. */
  const dx0 = c.x + px * (w + 3),
    dz0 = c.z + pz * (w + 3);
  if (T.dry(dx0, dz0)) {
    const y = T.top(dx0, dz0) + 1;
    for (let a = -1; a <= 1; a++)
      for (let b = 0; b <= 2; b++) {
        const x = dx0 + px * a - ux * b,
          z = dz0 + pz * a - uz * b;
        T.put(x, z, y, BLOCKS.PLANK.id);
        if (a === -1 || a === 1) T.put(x, z, y + 1, BLOCKS.BEAM.id);
      }
    T.put(dx0 - ux, dz0 - uz, y + 1, BLOCKS.PLANK_PALE.id);
    T.reserve(dx0, dz0, 4);
    T.lantern(dx0 + px * 2, dz0 + pz * 2);
  }

  /* 5 — framing. Two trees on the lip, unequal, because a symmetrical pair
   * reads as a gateway rather than as foliage. */
  T.tree(c.x + px * (w + 5) - ux * 2, c.z + pz * (w + 5) - uz * 2, 0.95, rng.pick(LEAVES), 'stack');
  T.tree(c.x - px * (w + 4) - ux * 3, c.z - pz * (w + 4) - uz * 3, 0.6, rng.pick(LEAVES));

  /* 6 — micro-detail round the pool. */
  for (let k = 0; k < 14; k++) {
    const a = rng.range(0, Math.PI * 2),
      d = rng.range(5, 9);
    T.reeds(Math.round(bx + Math.cos(a) * d), Math.round(bz + Math.sin(a) * d), rng);
  }

  T.reserve(c.x, c.z, 6);
  return { kind: 'waterfall', at: [c.x, c.z] };
}

/**
 * STONE_CROSSING — a place the river is meant to be crossed on foot.
 *
 *   requires   a river node with dry land on both banks
 *   generates  stepping stones · a plank jetty · lanterns · bank trees · reeds
 */
function stoneCrossing(world: any, T: any, site: any, rng: any) {
  const node = findChannel(world, T, site.at[0], site.at[1], SEARCH_R);
  if (!node) return null;
  const cx = Math.round(node.x),
    cz = Math.round(node.z);
  const nx = node.nx,
    nz = node.nz;
  const reach = Math.ceil(node.w) + 4;
  // Nobody hops twenty blocks of open water. Past this it wants a bridge, and
  // props.js is the pass that builds those.
  if (reach > 14) return null;

  // Both banks have to exist, or this is a riverside scene, not a crossing.
  // The scan starts at the far side and walks in, so it finds the true bank
  // rather than the first stepping stone that happens to break the surface.
  const bank = (s: any) => {
    for (let k = reach; k >= 1; k--) {
      const x = Math.round(cx + s * nx * k),
        z = Math.round(cz + s * nz * k);
      if (T.dry(x, z)) return { at: [x, z], k: s * k };
    }
    return null;
  };
  const near = bank(-1),
    far = bank(1);
  if (!near || !far) return null;

  /* 1 — the hero: a line of stones from bank to bank, staggered off the
   * straight so it reads as a route someone picked rather than a row of
   * pillars.
   *
   * Spanning the measured banks rather than a fixed ±reach is what makes it a
   * crossing. Laid over a fixed span it stopped in open water wherever the
   * channel was wider than the guess, which is a line of pillars going
   * nowhere. */
  const px = -nz,
    pz = nx;
  for (let k = near.k; k <= far.k; k++) {
    const jitter = ((k + 99) % 3) - 1;
    const x = Math.round(cx + nx * k + px * jitter);
    const z = Math.round(cz + nz * k + pz * jitter);
    if (!T.inb(x, z) || T.dry(x, z)) continue;
    // Proud of the surface, not flush with it. A block topped at SEA sits
    // under the waterline and the whole line vanished into the lavender.
    T.ground(x, z, T.SEA + 1, BLOCKS.STONE_PALE.id, BLOCKS.STONE.id);
  }

  /* 2 — a jetty on the near bank, running out over the water. Something
   * built, so the crossing reads as used. */
  {
    const [jx, jz] = near.at;
    const y = T.top(jx, jz) + 1;
    for (let k = 0; k < 4; k++) {
      const x = Math.round(jx + nx * k),
        z = Math.round(jz + nz * k);
      for (let a = -1; a <= 1; a++) T.put(x + px * a, z + pz * a, y, BLOCKS.PLANK.id);
      if (k === 3) for (let dy = y - 1; dy > T.SEA - 4; dy--) T.put(x, z, dy, BLOCKS.BEAM.id);
    }
    T.reserve(jx, jz, 3);
    T.lantern(Math.round(jx - nx * 2 + px * 2), Math.round(jz - nz * 2 + pz * 2));
  }

  /* 3 — framing trees, one per bank, leaning the scene shut. */
  T.tree(Math.round(near.at[0] - nx * 4 + px * 3), Math.round(near.at[1] - nz * 4 + pz * 3), 0.8, rng.pick(LEAVES));
  T.tree(Math.round(far.at[0] + nx * 4 - px * 3), Math.round(far.at[1] + nz * 4 - pz * 3), 0.55, rng.pick(LEAVES));

  /* 4 — reeds down both banks. */
  for (let k = 0; k < 16; k++) {
    const s = rng.chance(0.5) ? -1 : 1;
    const along = rng.int(-9, 9),
      out = rng.int(1, 3);
    T.reeds(
      Math.round(cx + px * along + nx * s * (reach - out)),
      Math.round(cz + pz * along + nz * s * (reach - out)),
      rng,
    );
  }
  return { kind: 'crossing', at: [cx, cz] };
}

/**
 * LILY_POND — a small still water, dug rather than found.
 *
 *   requires   a level clearing above the waterline
 *   generates  basin · sand rim · lily pads · a leaning tree · reeds · a rock
 */
function lilyPond(_world: any, T: any, site: any, rng: any) {
  const spot = findClearing(T, site.at[0] | 0, site.at[1] | 0, SEARCH_R, 7);
  if (!spot) return null;
  const [cx, cz] = spot;
  // A pond only holds water if the ground around it is near the waterline;
  // higher up it would be a hole with a view of the sky in it.
  if (T.top(cx, cz) > T.SEA + 6) return null;

  const rx = rng.range(6, 8),
    rz = rng.range(5, 7.5);
  const pads = [];
  for (let dz = -9; dz <= 9; dz++)
    for (let dx = -9; dx <= 9; dx++) {
      const q = (dx / rx) ** 2 + (dz / rz) ** 2;
      if (q > 1.25) continue;
      const x = cx + dx,
        z = cz + dz;
      if (!T.inb(x, z)) continue;
      if (q > 1.0) {
        // 1 — the sand rim
        T.ground(x, z, T.SEA + 1, BLOCKS.SAND.id, BLOCKS.SOIL.id);
        continue;
      }
      const depth = Math.round((1 - q) * 5) + 1; // 2 — the basin
      T.ground(x, z, T.SEA - depth, BLOCKS.SAND.id, BLOCKS.SOIL.id);
      if (q < 0.7) pads.push([x, z]);
    }

  // 3 — pads, sitting flush on the surface.
  for (let k = 0; k < 7 && pads.length; k++) {
    const [x, z] = pads[rng.int(0, pads.length - 1)];
    T.ground(x, z, T.SEA, rng.chance(0.6) ? BLOCKS.LEAF_MINT.id : BLOCKS.LEAF_CREAM.id, BLOCKS.SOIL.id);
  }

  // 4 — one tree leaning over the water, and a sitting rock opposite it.
  const a = rng.range(0, Math.PI * 2);
  T.tree(
    Math.round(cx + Math.cos(a) * (rx + 3)),
    Math.round(cz + Math.sin(a) * (rz + 3)),
    0.85,
    rng.pick(LEAVES),
    'broad',
  );
  const b = a + Math.PI;
  const sx = Math.round(cx + Math.cos(b) * (rx + 2)),
    sz = Math.round(cz + Math.sin(b) * (rz + 2));
  if (T.dry(sx, sz)) T.ground(sx, sz, T.top(sx, sz) + 1, BLOCKS.STONE_PALE.id, BLOCKS.STONE.id);

  // 5 — reeds around the rim.
  for (let k = 0; k < 18; k++) {
    const t = rng.range(0, Math.PI * 2),
      s = rng.range(1.02, 1.22);
    T.reeds(Math.round(cx + Math.cos(t) * rx * s), Math.round(cz + Math.sin(t) * rz * s), rng);
  }

  T.reserve(cx, cz, Math.round(rx) + 2);
  return { kind: 'pond', at: [cx, cz] };
}

/**
 * BLOSSOM_GROVE — a clearing with a gate in it.
 *
 *   requires   level open ground
 *   generates  a torii gate · one great tree · 3 secondary · 8-14 supporting
 *              · a lantern pair · a swept clearing
 *
 * The clearing is the point. A grove that is merely denser than the woodland
 * around it is invisible; a grove with a hole in the middle of it is a place.
 */
function blossomGrove(_world: any, T: any, site: any, rng: any) {
  const spot = findClearing(T, site.at[0] | 0, site.at[1] | 0, SEARCH_R, 5);
  if (!spot) return null;
  const [cx, cz] = spot;
  const y = T.top(cx, cz) + 1;
  const leaf = rng.pick(LEAVES);

  // 1 — the hero: a gate, two posts and a lintel. Human-made, small, and the
  // only right-angle in a hundred blocks of foliage.
  const ax = rng.chance(0.5) ? 1 : 0,
    az = ax ? 0 : 1;
  for (const s of [-2, 2]) {
    for (let k = 0; k < 4; k++) T.put(cx + ax * s, cz + az * s, y + k, BLOCKS.BEAM.id);
  }
  for (let s = -3; s <= 3; s++) {
    T.put(cx + ax * s, cz + az * s, y + 4, BLOCKS.PLANK_PALE.id);
    if (Math.abs(s) <= 2) T.put(cx + ax * s, cz + az * s, y + 3, BLOCKS.PLANK.id);
  }
  T.put(cx, cz, y + 5, BLOCKS.CLOTH_PINK.id);

  // 2 — the swept floor, so the gate stands on something.
  for (let dz = -4; dz <= 4; dz++)
    for (let dx = -4; dx <= 4; dx++) {
      if (dx * dx + dz * dz > 16) continue;
      const x = cx + dx,
        z = cz + dz;
      if (T.dry(x, z)) T.ground(x, z, T.top(x, z), BLOCKS.PATH.id);
    }
  T.reserve(cx, cz, 5);

  // 3 — the great tree, off-centre. Dead centre would fight the gate.
  const ga = rng.range(0, Math.PI * 2);
  T.tree(Math.round(cx + Math.cos(ga) * 8), Math.round(cz + Math.sin(ga) * 8), 1.0, leaf, 'stack');

  // 4 — secondaries at the edge of the clearing, then a supporting ring
  // thinning outward. One species, so the stand reads as one stand.
  for (let k = 0; k < 3; k++) {
    const a = ga + Math.PI * 0.6 + k * 1.5 + rng.bell() * 0.3;
    const d = rng.range(9, 12);
    T.tree(Math.round(cx + Math.cos(a) * d), Math.round(cz + Math.sin(a) * d), rng.range(0.62, 0.8), leaf);
  }
  for (let k = 0; k < 14; k++) {
    const a = rng.range(0, Math.PI * 2),
      d = rng.range(12, 19);
    T.tree(Math.round(cx + Math.cos(a) * d), Math.round(cz + Math.sin(a) * d), rng.range(0.22, 0.55), leaf);
  }

  // 5 — a lantern each side of the approach.
  T.lantern(cx + az * 3 + ax * 5, cz + ax * 3 + az * 5);
  T.lantern(cx - az * 3 + ax * 5, cz - ax * 3 + az * 5);

  return { kind: 'grove', at: [cx, cz] };
}

/**
 * CLIFF_OVERLOOK — somewhere to stand and look down.
 *
 *   requires   level ground with a 7+ block drop beside it
 *   generates  a paved terrace · a low parapet · a bench · lanterns · one tree
 */
function cliffOverlook(_world: any, T: any, site: any, rng: any) {
  const lip = findLip(T, site.at[0] | 0, site.at[1] | 0, SEARCH_R);
  if (!lip) return null;
  const { ux, uz, h } = lip;
  const px = -uz,
    pz = ux;
  // Sit the terrace back from the edge so the parapet has ground under it.
  const cx = lip.x - ux,
    cz = lip.z - uz;

  // 1 — the terrace.
  for (let a = -3; a <= 3; a++)
    for (let b = -3; b <= 1; b++) {
      const x = cx + px * a - ux * b,
        z = cz + pz * a - uz * b;
      if (!T.dry(x, z) || Math.abs(T.top(x, z) - h) > 2) continue;
      T.ground(x, z, h, BLOCKS.PATH.id, BLOCKS.STONE.id);
    }

  // 2 — the parapet, one course of pale stone along the drop.
  for (let a = -3; a <= 3; a++) {
    const x = cx + px * a + ux,
      z = cz + pz * a + uz;
    if (T.top(x, z) >= h) continue;
    T.ground(x, z, h + 1, BLOCKS.STONE_PALE.id, BLOCKS.STONE.id);
  }

  // 3 — a bench slab and a pair of lanterns flanking the view.
  T.ground(cx - ux * 2 + px, cz - uz * 2 + pz, h + 1, BLOCKS.PLANK.id, BLOCKS.BEAM.id);
  T.lantern(cx + px * 4, cz + pz * 4);
  T.lantern(cx - px * 4, cz - pz * 4);

  // 4 — one tree behind, holding the composition down.
  T.tree(Math.round(cx - ux * 5 + px * 2), Math.round(cz - uz * 5 + pz * 2), 0.8, rng.pick(LEAVES));

  T.reserve(cx, cz, 5);
  return { kind: 'overlook', at: [cx, cz] };
}

/* ================================================================== *
 * Landmarks — ancient structures scattered across continents
 * ================================================================== */

/**
 * TWISTED_SPIRE — a tall column that drifts off-centre as it rises.
 *
 *   requires   dry inland ground
 *   generates  3×3 stone base · drifting 1×1 shaft 14-22 blocks · cap
 */
function twistedSpire(_world: any, T: any, site: any, rng: any) {
  const cx = site.at[0] | 0, cz = site.at[1] | 0;
  if (!T.dry(cx, cz) || T.claimed(cx, cz)) return null;
  const baseY = T.top(cx, cz);

  // PATH clearing radius 4
  for (let dz = -4; dz <= 4; dz++)
    for (let dx = -4; dx <= 4; dx++) {
      if (dx * dx + dz * dz > 16) continue;
      if (T.dry(cx + dx, cz + dz)) T.ground(cx + dx, cz + dz, T.top(cx + dx, cz + dz), BLOCKS.PATH.id);
    }

  // 3×3 STONE_WARM footing (2 courses)
  for (let dy = 1; dy <= 2; dy++)
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        T.put(cx + dx, cz + dz, baseY + dy, BLOCKS.STONE_WARM.id);

  // Twisted shaft: drifts 1 block in a cardinal each 4 levels
  const totalH = 14 + rng.int(0, 8);
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  let ox = 0, oz = 0;
  for (let dy = 3; dy <= totalH; dy++) {
    T.put(cx + ox, cz + oz, baseY + dy, BLOCKS.STONE_PALE.id);
    if (dy % 4 === 2) {
      const [ddx, ddz] = dirs[rng.int(0, 3)];
      ox = Math.max(-2, Math.min(2, ox + ddx));
      oz = Math.max(-2, Math.min(2, oz + ddz));
    }
  }
  T.put(cx + ox, cz + oz, baseY + totalH + 1, BLOCKS.STONE_WARM.id);

  T.reserve(cx, cz, 6);
  return { kind: 'spire', at: [cx, cz] };
}

/**
 * OBELISK — a tall narrow monolith with a wide base.
 *
 *   requires   dry inland ground
 *   generates  3×3 STONE_WARM base · 1×1 STONE_PALE shaft 8-13 blocks · cap
 */
function obelisk(_world: any, T: any, site: any, rng: any) {
  const cx = site.at[0] | 0, cz = site.at[1] | 0;
  if (!T.dry(cx, cz) || T.claimed(cx, cz)) return null;
  const baseY = T.top(cx, cz);

  // PATH clearing
  for (let dz = -4; dz <= 4; dz++)
    for (let dx = -4; dx <= 4; dx++) {
      if (dx * dx + dz * dz > 16) continue;
      if (T.dry(cx + dx, cz + dz)) T.ground(cx + dx, cz + dz, T.top(cx + dx, cz + dz), BLOCKS.PATH.id);
    }

  // 3×3 STONE_WARM base (2 courses)
  for (let dy = 1; dy <= 2; dy++)
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        T.put(cx + dx, cz + dz, baseY + dy, BLOCKS.STONE_WARM.id);

  // 1×1 STONE_PALE shaft
  const shaftH = 8 + rng.int(0, 5);
  for (let dy = 3; dy <= shaftH; dy++)
    T.put(cx, cz, baseY + dy, BLOCKS.STONE_PALE.id);
  T.put(cx, cz, baseY + shaftH + 1, BLOCKS.STONE_WARM.id);

  T.lantern(cx + 3, cz);
  T.lantern(cx - 3, cz);

  T.reserve(cx, cz, 5);
  return { kind: 'obelisk', at: [cx, cz] };
}

/**
 * MONOLITH_RING — standing stones in a circle, Stonehenge-style.
 *
 *   requires   dry inland ground
 *   generates  7-8 STONE_PALE standing columns radius 10-13 · lintels · PATH floor
 */
function monolithRing(_world: any, T: any, site: any, rng: any) {
  const cx = site.at[0] | 0, cz = site.at[1] | 0;
  if (!T.dry(cx, cz) || T.claimed(cx, cz)) return null;
  const count = 7 + rng.int(0, 1);
  const ringR = 10 + rng.int(0, 3);

  // PATH inside the ring
  for (let dz = -(ringR + 2); dz <= ringR + 2; dz++)
    for (let dx = -(ringR + 2); dx <= ringR + 2; dx++) {
      if (dx * dx + dz * dz > (ringR + 2) * (ringR + 2)) continue;
      if (T.dry(cx + dx, cz + dz)) T.ground(cx + dx, cz + dz, T.top(cx + dx, cz + dz), BLOCKS.PATH.id);
    }

  // Standing stones
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const sx = Math.round(cx + Math.cos(a) * ringR);
    const sz = Math.round(cz + Math.sin(a) * ringR);
    if (!T.dry(sx, sz)) continue;
    const sy = T.top(sx, sz);
    const sh = 5 + rng.int(0, 3);
    for (let dy = 1; dy <= sh; dy++)
      T.put(sx, sz, sy + dy, BLOCKS.STONE_PALE.id);

    // Lintel connecting every other pair
    if (i % 2 === 0) {
      const a2 = ((i + 1) / count) * Math.PI * 2;
      const ex = Math.round(cx + Math.cos(a2) * ringR);
      const ez = Math.round(cz + Math.sin(a2) * ringR);
      if (!T.dry(ex, ez)) continue;
      const lintelY = sy + sh + 1;
      const steps = Math.max(Math.abs(ex - sx), Math.abs(ez - sz));
      if (steps > 0 && steps < 8) {
        for (let k = 0; k <= steps; k++) {
          const lx = Math.round(sx + (ex - sx) * k / steps);
          const lz = Math.round(sz + (ez - sz) * k / steps);
          T.put(lx, lz, lintelY, BLOCKS.STONE_PALE.id);
        }
      }
    }
  }

  T.reserve(cx, cz, ringR + 3);
  return { kind: 'ring', at: [cx, cz] };
}

/**
 * TOMBSTONE_FIELD — a scattering of ancient upright slabs.
 *
 *   requires   dry inland ground
 *   generates  14-22 STONE/STONE_PALE columns 2-4 blocks tall in a radius-14 field
 */
function tombstoneField(_world: any, T: any, site: any, rng: any) {
  const cx = site.at[0] | 0, cz = site.at[1] | 0;
  if (!T.dry(cx, cz) || T.claimed(cx, cz)) return null;

  // PATH clearing in the centre
  for (let dz = -5; dz <= 5; dz++)
    for (let dx = -5; dx <= 5; dx++) {
      if (dx * dx + dz * dz > 25) continue;
      if (T.dry(cx + dx, cz + dz)) T.ground(cx + dx, cz + dz, T.top(cx + dx, cz + dz), BLOCKS.PATH.id);
    }

  const count = 14 + rng.int(0, 8);
  const fieldR = 14;
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(2, fieldR);
    const sx = Math.round(cx + Math.cos(a) * d);
    const sz = Math.round(cz + Math.sin(a) * d);
    if (!T.dry(sx, sz) || T.claimed(sx, sz)) continue;
    const sy = T.top(sx, sz);
    const sh = 2 + rng.int(0, 2);
    for (let dy = 1; dy <= sh; dy++)
      T.put(sx, sz, sy + dy, rng.chance(0.55) ? BLOCKS.STONE_PALE.id : BLOCKS.STONE.id);
    // Random lean: add a cap block to one side at the top
    if (rng.chance(0.35)) {
      const lean = [[1, 0], [0, 1], [-1, 0], [0, -1]][rng.int(0, 3)];
      T.put(sx + lean[0], sz + lean[1], sy + sh, BLOCKS.STONE.id);
    }
  }

  T.reserve(cx, cz, fieldR + 2);
  return { kind: 'tombs', at: [cx, cz] };
}

/**
 * FLOATING_BIOSPHERE — a small island of earth and stone that hangs in the air
 * above the terrain, with stalactite drips below and a tree or crystal cluster on top.
 *
 *   requires   dry inland ground
 *   generates  ovoid voxel body 20-32 blocks above terrain · stalactites · cap tree
 */
function floatingBiosphere(_world: any, T: any, site: any, rng: any) {
  const cx = site.at[0] | 0, cz = site.at[1] | 0;
  if (!T.dry(cx, cz) || T.claimed(cx, cz)) return null;
  const baseY = T.top(cx, cz);
  const floatY = baseY + 20 + rng.int(0, 12);
  const rx = 5 + rng.int(0, 3), rz = rx;
  const ry = 3;

  // Ovoid body — grass cap on the very top, soil below, warm stone core
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dz = -rz; dz <= rz; dz++) {
      for (let dx = -rx; dx <= rx; dx++) {
        const q = (dx / rx) ** 2 + (dy / ry) ** 2 + (dz / rz) ** 2;
        if (q > 1.0) continue;
        const qTop = (dx / rx) ** 2 + ((dy + 1) / ry) ** 2 + (dz / rz) ** 2;
        const isTop = qTop > 1.0;
        let id: number;
        if (isTop && dy > 0) id = BLOCKS.LEAF_CREAM.id;       // turf cap
        else if (isTop) id = BLOCKS.STONE_PALE.id;             // pale underside
        else if (dy > 0) id = BLOCKS.SOIL.id;                  // soil layer
        else id = BLOCKS.STONE_WARM.id;                        // warm stone core
        T.put(cx + dx, cz + dz, floatY + dy, id);
      }
    }
  }

  // Stalactite drips hanging below
  for (let k = 0; k < 8; k++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(1, rx - 1);
    const sx = cx + Math.round(Math.cos(a) * d);
    const sz = cz + Math.round(Math.sin(a) * d);
    const len = rng.int(3, 9);
    for (let dy = 1; dy <= len; dy++) {
      const id = dy <= 2 ? BLOCKS.STONE_WARM.id : (dy <= 5 ? BLOCKS.STONE_PALE.id : BLOCKS.STONE.id);
      T.put(sx, sz, floatY - ry - dy, id);
    }
  }

  // A small tree on the flat top surface
  const topY = floatY + ry + 1;
  const leaf = rng.pick(LEAVES);
  const form = rng.pick(['nub', 'round', 'spire', 'round']);
  // plant directly into the floating grid — put a soil block as base then tree
  T.put(cx, cz, topY, BLOCKS.SOIL.id);
  const t = plantTree(T.grid, cx, topY + 1, cz, (T as any).rng, { scale: 0.35, leaf, form });
  _world.stampTrees.push(t);

  T.reserve(cx, cz, rx + 3);
  return { kind: 'biosphere', at: [cx, cz] };
}

/**
 * ANCIENT_WELL — a stone-rimmed well with a simple crossbeam, surrounded by worn path.
 *
 *   requires   dry inland ground
 *   generates  stone rim 3x3, STONE_PALE cap, WOOD crossbeam, PATH clearing radius 5
 */
function ancientWell(_world: any, T: any, site: any, rng: any) {
  const cx = site.at[0] | 0, cz = site.at[1] | 0;
  if (!T.dry(cx, cz) || T.claimed(cx, cz)) return null;
  const baseY = T.top(cx, cz);

  // Path clearing
  for (let dz = -5; dz <= 5; dz++)
    for (let dx = -5; dx <= 5; dx++) {
      if (dx * dx + dz * dz > 25) continue;
      if (T.dry(cx + dx, cz + dz)) T.ground(cx + dx, cz + dz, T.top(cx + dx, cz + dz), BLOCKS.PATH.id);
    }

  // Stone rim — 3x3 ring, hollow centre
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      T.put(cx + dx, cz + dz, baseY + 1, BLOCKS.STONE.id);
      T.put(cx + dx, cz + dz, baseY + 2, BLOCKS.STONE_PALE.id);
    }

  // Crossbeam over the opening
  const beamBlock = rng.chance(0.6) ? BLOCKS.STONE_WARM.id : BLOCKS.STONE_PALE.id;
  T.put(cx - 1, cz, baseY + 3, beamBlock);
  T.put(cx,     cz, baseY + 3, beamBlock);
  T.put(cx + 1, cz, baseY + 3, beamBlock);

  // A few scattered worn stones nearby
  for (let i = 0; i < 4 + rng.int(0, 3); i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(3, 6);
    const sx = Math.round(cx + Math.cos(a) * d);
    const sz = Math.round(cz + Math.sin(a) * d);
    if (T.dry(sx, sz)) T.put(sx, sz, T.top(sx, sz) + 1, BLOCKS.STONE_PALE.id);
  }

  T.reserve(cx, cz, 8);
  return { kind: 'well', at: [cx, cz] };
}

/**
 * RUINED_ARCH — two stone pillars with a fractured lintel, a relic of a forgotten gate.
 *
 *   requires   dry inland ground, minimum height relief
 *   generates  2 pillars 5-7 blocks tall, partial lintel, rubble scatter
 */
function ruinedArch(_world: any, T: any, site: any, rng: any) {
  const cx = site.at[0] | 0, cz = site.at[1] | 0;
  if (!T.dry(cx, cz) || T.claimed(cx, cz)) return null;
  const baseY = T.top(cx, cz);

  const span = 3 + rng.int(0, 2);     // half-gap from centre to each pillar
  const pillarH = 5 + rng.int(0, 2);

  // Two pillars on the X axis
  for (const side of [-span, span]) {
    const px = cx + side, pz = cz;
    const py = T.top(px, pz);
    for (let dy = 1; dy <= pillarH; dy++)
      T.put(px, pz, py + dy, dy % 3 === 0 ? BLOCKS.STONE_PALE.id : BLOCKS.STONE.id);
  }

  // Partial lintel — missing 1-2 centre blocks to look broken
  const lintelY = baseY + pillarH + 1;
  const missing = new Set<number>();
  const missCt = 1 + rng.int(0, 1);
  for (let m = 0; m < missCt; m++) missing.add(rng.int(1, span * 2 - 1));
  for (let i = 0; i <= span * 2; i++) {
    if (missing.has(i)) continue;
    T.put(cx - span + i, cz, lintelY, BLOCKS.STONE_PALE.id);
  }

  // Rubble scatter around the base
  for (let i = 0; i < 6 + rng.int(0, 4); i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(1, span + 3);
    const rx = Math.round(cx + Math.cos(a) * d);
    const rz = Math.round(cz + Math.sin(a) * d);
    if (T.dry(rx, rz)) T.put(rx, rz, T.top(rx, rz) + 1, rng.chance(0.5) ? BLOCKS.STONE.id : BLOCKS.STONE_PALE.id);
  }

  T.reserve(cx, cz, span + 6);
  return { kind: 'arch', at: [cx, cz] };
}

/**
 * HOT_SPRING — a shallow warm pool of teal water ringed by pale boulders and steam-moss.
 *
 *   requires   dry inland ground (not ocean, not river)
 *   generates  oval RIVER_WATER pool 5-7 wide, stone/pale ring, leaf-moss scatter
 */
function hotSpring(_world: any, T: any, site: any, rng: any) {
  const cx = site.at[0] | 0, cz = site.at[1] | 0;
  if (!T.dry(cx, cz) || T.claimed(cx, cz)) return null;
  const baseY = T.top(cx, cz);

  const rx = 3 + rng.int(0, 1), rz = 2 + rng.int(0, 2);

  // Dig shallow basin and fill with warm river water (1 block deep)
  for (let dz = -rz; dz <= rz; dz++)
    for (let dx = -rx; dx <= rx; dx++) {
      if ((dx / rx) ** 2 + (dz / rz) ** 2 > 1.0) continue;
      T.ground(cx + dx, cz + dz, baseY, BLOCKS.STONE_WARM.id);   // floor
      T.put(cx + dx, cz + dz, baseY + 1, RIVER_WATER.id);         // warm pool
    }

  // Boulder rim
  const boulderAngleStep = (Math.PI * 2) / (8 + rng.int(0, 4));
  for (let a = 0; a < Math.PI * 2; a += boulderAngleStep) {
    const bx = Math.round(cx + Math.cos(a) * (rx + 1));
    const bz = Math.round(cz + Math.sin(a) * (rz + 1));
    if (!T.dry(bx, bz)) continue;
    const by = T.top(bx, bz);
    T.put(bx, bz, by + 1, rng.chance(0.55) ? BLOCKS.STONE_WARM.id : BLOCKS.STONE_PALE.id);
    if (rng.chance(0.35)) T.put(bx, bz, by + 2, BLOCKS.STONE_PALE.id);
  }

  // Leaf-moss scatter just outside the rim
  const MOSSY = [BLOCKS.LEAF_MINT, BLOCKS.LEAF_CREAM];
  for (let i = 0; i < 8 + rng.int(0, 5); i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(rx + 1, rx + 4);
    const sx = Math.round(cx + Math.cos(a) * d);
    const sz = Math.round(cz + Math.sin(a) * d);
    if (!T.dry(sx, sz)) continue;
    T.put(sx, sz, T.top(sx, sz) + 1, rng.pick(MOSSY).id);
  }

  T.reserve(cx, cz, rx + 6);
  return { kind: 'hotspring', at: [cx, cz] };
}

/* Ordered by preference within a kind: if the terrain does not support the
 * plan's first choice the site falls through to something it *does* support,
 * rather than being dropped or forced. */
waterfallGarden.kind = 'waterfall';
stoneCrossing.kind = 'crossing';
lilyPond.kind = 'pond';
blossomGrove.kind = 'grove';
cliffOverlook.kind = 'overlook';
hotSpring.kind = 'hotspring';
ancientWell.kind = 'well';
ruinedArch.kind = 'arch';

const GRAMMARS = {
  waterfall: [waterfallGarden, stoneCrossing, cliffOverlook, blossomGrove],
  crossing: [stoneCrossing, lilyPond, blossomGrove],
  pond: [lilyPond, stoneCrossing, blossomGrove],
  overlook: [cliffOverlook, blossomGrove],
  grove: [blossomGrove, lilyPond],
  hotspring: [hotSpring, cliffOverlook, blossomGrove],
};

/**
 * Compose scenes at the plan's best sites.
 *
 * Runs after props (so a stamp can see the bridges) and before vegetation (so
 * the scatter respects the clearings it reserves).
 */
export function buildStamps(world: any, _rng: any) {
  const plan = world.plan;
  world.stampTrees = world.stampTrees || [];
  world.stamps = [];
  if (!plan) return world.stamps;

  const T = toolkit(world);
  const S = world.size;
  const area = (S / 256) ** 2;
  const maxStamps = Math.round(STAMPS_PER_AREA * area);
  const budget: any = {};
  for (const k in QUOTA) budget[k] = Math.round((QUOTA as any)[k] * area);
  const bridges = world.props?.bridges || [];
  // Bridges are hero objects too, and a scene built beside one competes with
  // it. Seeding the claim list is simpler than a second exclusion test.
  for (const b of bridges) T.claims.push([b.x, b.z]);

  for (const site of plan.scenic) {
    if (world.stamps.length >= maxStamps) break;
    const [sx, sz] = site.at;
    if (sx < 12 || sz < 12 || sx > S - 13 || sz > S - 13) continue;

    // Its own stream, so a scene lands identically however many randoms the
    // scenes before it happened to draw.
    (T as any).rng = makeRng(site.seed ^ 0x5bf03635);
    for (const grammar of (GRAMMARS as any)[site.kind] || GRAMMARS.grove) {
      if ((budget as any)[grammar.kind] <= 0) continue;
      const made = grammar(world, T, site, T.rng);
      if (made) {
        (budget as any)[grammar.kind]--;
        T.claims.push(made.at);
        made.score = site.score;
        made.planned = site.kind;
        world.stamps.push(made);
        break;
      }
    }
  }

  // Landmark pass: one per continent, placed after scenic stamps so their
  // claims don't compete with waterfall/grove quotas.
  const LANDMARK_GRAMMARS: Record<string, (w: any, T: any, s: any, r: any) => any> = {
    spire: twistedSpire,
    obelisk,
    ring: monolithRing,
    tombs: tombstoneField,
    biosphere: floatingBiosphere,
    well: ancientWell,
    arch: ruinedArch,
  };
  for (const site of plan.landmarks || []) {
    const [sx, sz] = site.at;
    if (sx < 12 || sz < 12 || sx > S - 13 || sz > S - 13) continue;
    (T as any).rng = makeRng(site.seed ^ 0x1d3a2c4b);
    const grammar = LANDMARK_GRAMMARS[site.kind];
    if (!grammar) continue;
    const made = grammar(world, T, site, (T as any).rng);
    if (made) {
      T.claims.push(made.at);
      made.score = 0;
      made.planned = site.kind;
      world.stamps.push(made);
    }
  }

  return world.stamps;
}
