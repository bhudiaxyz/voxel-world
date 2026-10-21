/**
 * World planning — the layer that decides WHAT goes where, before any voxel
 * is written.
 *
 * The generator used to go straight from noise to blocks, which is why the
 * world read as terrain rather than as places: noise has no notion of a
 * region, so it cannot give you somewhere to be. Everything here works on a
 * coarse grid (one cell per CELL voxels) and produces a plan the voxel stage
 * then executes.
 *
 *   seed -> region centres -> macro fields -> biomes -> scenic sites
 *
 * The ordering matters. Regions come first so that biome boundaries follow
 * region edges rather than noise contours — that is what turns "noise
 * coordinate 28372" into "the sakura shore west of the highland".
 */

import { makeRng, makeNoise2D, fbm2, clamp } from '../core/rng';

export const BIOME = {
  MEADOW:   0,
  SAKURA:   1,
  HIGHLAND: 2,
  SHORE:    3,
  WETLAND:  4,
};
export const BIOME_NAME = ['meadow', 'sakura', 'highland', 'shore', 'wetland'];

/** Planning resolution: one cell per this many voxels. */
export const CELL = 8;

/**
 * Distance between region centres, **in blocks**.
 *
 * This used to be `size * 0.115`, and that single relative number was why a
 * larger world was not a larger *place*: every size produced the same 56
 * regions, so growing the map grew the biomes instead of adding any. A walk
 * across a 1024-block world met exactly as much variety as a walk across a
 * 256-block one, stretched four times thinner.
 *
 * In blocks, region count scales with area — 56 regions at 256, ~900 at 1024 —
 * and a region stays the same size on screen however big the world gets.
 * Roughly three screens across: big enough to have an identity, small enough
 * that a walk crosses several.
 */
export const REGION_SPACING = 30;

/**
 * Feature sizes for the macro fields, also in blocks.
 *
 * Deliberately much larger than REGION_SPACING so biomes form *provinces* —
 * a run of sakura regions, then a run of wetland — rather than alternating
 * region by region. Below about 4x the spacing the map turns to salt and
 * pepper, which reads as noise rather than as geography.
 */
const FEATURE = { elevation: 210, temperature: 320, moisture: 300, magic: 250 };

/**
 * Where the coast is, as a fraction of the world size.
 *
 * Terrain perturbs this with noise to get a lobed rim, but every planning
 * decision that needs to know where the island ends reads it from here. A
 * second literal is a second coastline, and the two drift apart the moment
 * either is tuned — which is how rivers end up stopping in mid-air or running
 * off the plinth.
 */
export const ISLAND_R = 0.427;

/**
 * Poisson-disc by dart throwing.
 *
 * Uniform random placement clumps — it produces pairs almost touching and
 * bald patches beside them, which is the single most recognisable tell of a
 * generated world. Enforcing a minimum separation gives an even scatter that
 * still looks unplanned, and it is what lets region centres double as the
 * skeleton for a Voronoi partition without producing slivers.
 */
export function poissonDisc(width: any, height: any, radius: any, rng: any, tries = 30) {
  const pts = [];
  const r2 = radius * radius;
  /* Bucketed rejection.
   *
   * The naive version compares each dart against every point already placed,
   * which is fine at the 56 points a 256-block world used to want and is
   * quadratic once spacing is measured in blocks: a 1024-block world wants
   * ~900 points and 27,000 darts, so ~24 million distance tests. With a cell
   * size of `radius` a conflict can only be in the 5x5 neighbourhood, so each
   * dart costs a constant handful of tests instead.
   */
  const cw = Math.max(1, Math.ceil(width / radius));
  const ch = Math.max(1, Math.ceil(height / radius));
  const grid = new Int32Array(cw * ch).fill(-1);
  const budget = Math.ceil((width * height) / (radius * radius)) * tries;

  for (let i = 0; i < budget; i++) {
    const x = rng.range(0, width), z = rng.range(0, height);
    const gx = Math.min(cw - 1, Math.floor(x / radius));
    const gz = Math.min(ch - 1, Math.floor(z / radius));
    let ok = true;
    for (let dz = -2; dz <= 2 && ok; dz++) {
      for (let dx = -2; dx <= 2 && ok; dx++) {
        const ix = gx + dx, iz = gz + dz;
        if (ix < 0 || iz < 0 || ix >= cw || iz >= ch) continue;
        const k = grid[iz * cw + ix];
        if (k < 0) continue;
        const px = pts[k][0] - x, pz = pts[k][1] - z;
        if (px * px + pz * pz < r2) ok = false;
      }
    }
    // One point per cell is all a cell of side `radius` can hold anyway.
    if (ok && grid[gz * cw + gx] < 0) { grid[gz * cw + gx] = pts.length; pts.push([x, z]); }
  }
  return pts;
}

/**
 * Build the plan for a world of `size` voxels square.
 *
 * Pure: it touches no voxel grid and allocates nothing per-block, so it is
 * cheap enough to run before terrain and can be consulted from anywhere
 * downstream — vegetation, props, scenic stamps — without re-deriving
 * anything.
 */
export function planWorld(seed: any, size: any) {
  const rng = makeRng(seed ^ 0x9e3779b9);
  const nTemp  = makeNoise2D(seed + 41);
  const nMoist = makeNoise2D(seed + 42);
  const nMagic = makeNoise2D(seed + 43);
  const nEdge  = makeNoise2D(seed + 44);

  const half = size / 2;

  /* ---- 1. region centres ------------------------------------------
   * Spaced at roughly an eighth of the world, so a region is a few screens
   * across: big enough to have an identity, small enough that a walk crosses
   * several. */
  const centres = poissonDisc(size, size, REGION_SPACING, rng);

  /* ---- 2. macro fields, sampled once per region --------------------
   * Sampled at the centre rather than per cell: a region is meant to be ONE
   * place, and averaging a field across it would blur every boundary back
   * into the mush the regions exist to replace. */
  const regions = centres.map(([cx, cz], id) => {
    /* Field coordinates are absolute, not normalised by world size.
     *
     * `nx = cx / size` meant every field held the same number of blobs at any
     * scale, so the macro structure stretched with the map instead of
     * repeating across it — the other half of why a big world was not a big
     * place. Dividing by a length in blocks keeps province size fixed and lets
     * the count grow. */
    const ex = cx / FEATURE.elevation, ez = cz / FEATURE.elevation;
    // Distance from the middle drives elevation, so the island reads as a
    // massif ringed by shore rather than as scattered highlands.
    const rim = Math.hypot(cx - half, cz - half) / half;
    // The rim term sets the island silhouette; it must not also decide the
    // interior. At a 1.25 slope everything past two-thirds of the radius fell
    // under the shore threshold — and since area grows with radius, that was
    // most of the world. Shore became two thirds of the map and the moisture
    // rules below were never reached at all.
    const elevation = clamp(
      0.94 - rim * 0.70 + fbm2(nEdge, ex, ez, 3) * 0.42, 0, 1);
    const temperature = clamp(
      0.5 + fbm2(nTemp, cx / FEATURE.temperature, cz / FEATURE.temperature, 3), 0, 1);
    const moisture = clamp(
      0.5 + fbm2(nMoist, cx / FEATURE.moisture, cz / FEATURE.moisture, 3), 0, 1);
    const magic = clamp(
      0.5 + fbm2(nMagic, cx / FEATURE.magic, cz / FEATURE.magic, 2), 0, 1);

    let biome;
    // Order matters: the elevation extremes are genuinely exclusive, but they
    // are kept narrow so the character biomes get the whole middle band.
    if (elevation < 0.15)                        biome = BIOME.SHORE;
    else if (elevation > 0.82)                   biome = BIOME.HIGHLAND;
    else if (moisture > 0.55 && magic > 0.44)    biome = BIOME.SAKURA;
    else if (moisture > 0.62)                    biome = BIOME.WETLAND;
    else                                         biome = BIOME.MEADOW;

    return {
      id, center: [cx, cz], biome, elevation, temperature, moisture, magic,
      // Its own stream, so a region can be regenerated in isolation and land
      // on exactly the same result.
      seed: (seed ^ (id * 0x85ebca6b)) >>> 0,
      importance: 0,
      neighbors: [] as any[],
    };
  });

  /* ---- 2b. a bucket grid over the centres --------------------------
   * Every lookup below — nearest region, elevation blend — was a linear scan
   * over all regions. That is free at 56 regions and quadratic in world area
   * once regions are spaced in blocks: a 1024-block world has ~900 of them,
   * so the Voronoi pass alone would be 15 million distance tests and the
   * elevation blend another 15 million.
   */
  const BUCKET = REGION_SPACING;
  const bw = Math.max(1, Math.ceil(size / BUCKET));
  const buckets: any[] = [];
  for (let i = 0; i < bw * bw; i++) buckets.push([]);
  for (const r of regions) {
    const bx = clamp(Math.floor(r.center[0] / BUCKET), 0, bw - 1);
    const bz = clamp(Math.floor(r.center[1] / BUCKET), 0, bw - 1);
    buckets[bz * bw + bx].push(r);
  }
  /** Regions within `rings` buckets of a point, widening until it finds some. */
  const nearby = (x: any, z: any, rings: any, out: any) => {
    out.length = 0;
    const bx = clamp(Math.floor(x / BUCKET), 0, bw - 1);
    const bz = clamp(Math.floor(z / BUCKET), 0, bw - 1);
    for (let r = rings; r <= rings + 6 && out.length === 0; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const ix = bx + dx, iz = bz + dz;
          if (ix < 0 || iz < 0 || ix >= bw || iz >= bw) continue;
          const b = buckets[iz * bw + ix];
          for (let k = 0; k < b.length; k++) out.push(b[k]);
        }
      }
    }
    return out;
  };

  /* ---- 3. the cell map --------------------------------------------
   * Nearest region wins, but the query point is warped by low-frequency
   * noise first. Straight Voronoi gives perfectly straight boundaries and
   * the world looks tiled; warping the lookup keeps the partition intact
   * while making every border organic.
   */
  const cw = Math.ceil(size / CELL);
  const cellRegion = new Int16Array(cw * cw);
  const cellBiome = new Uint8Array(cw * cw);
  // Warp is bounded by the region spacing so the search radius below stays
  // valid; as a fraction of world size it grew to 56 blocks at 1024 and threw
  // the lookup clean out of its own neighbourhood.
  const WARP = REGION_SPACING * 0.5;
  const scratch: any[] = [];

  for (let cz = 0; cz < cw; cz++) {
    for (let cx = 0; cx < cw; cx++) {
      const wx = (cx + 0.5) * CELL, wz = (cz + 0.5) * CELL;
      const qx = wx + fbm2(nEdge, wx * 0.006, wz * 0.006, 3) * WARP;
      const qz = wz + fbm2(nEdge, wx * 0.006 + 19, wz * 0.006 + 7, 3) * WARP;
      const cand = nearby(qx, qz, 1, scratch);
      let best = cand[0], bestD = Infinity;
      for (let i = 0; i < cand.length; i++) {
        const c = cand[i].center;
        const dx = c[0] - qx, dz = c[1] - qz;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = cand[i]; }
      }
      const i = cz * cw + cx;
      cellRegion[i] = best.id;
      cellBiome[i] = best.biome;
    }
  }

  // Adjacency, read straight off the cell map — cheaper and more truthful
  // than a Delaunay triangulation of the centres, because it reflects the
  // warped boundaries rather than the ideal ones.
  for (let cz = 0; cz < cw; cz++) {
    for (let cx = 0; cx < cw - 1; cx++) {
      const a = cellRegion[cz * cw + cx], b = cellRegion[cz * cw + cx + 1];
      if (a !== b) {
        if (!(regions[a].neighbors as any[]).includes(b)) (regions[a].neighbors as any[]).push(b);
        if (!(regions[b].neighbors as any[]).includes(a)) (regions[b].neighbors as any[]).push(a);
      }
    }
  }

  /* ---- 3b. the elevation field -------------------------------------
   * A smooth height per cell, blended from the nearest region centres by
   * inverse-square weight.
   *
   * The biome map is deliberately hard-edged — a cell belongs to exactly one
   * region — but elevation must not be, or every region boundary becomes a
   * cliff. Blending the three nearest gives continuous relief that still
   * peaks where the plan put its highlands.
   */
  const cellElev = new Float32Array(cw * cw);
  for (let cz = 0; cz < cw; cz++) {
    for (let cx = 0; cx < cw; cx++) {
      const wx = (cx + 0.5) * CELL, wz = (cz + 0.5) * CELL;
      let num = 0, den = 0;
      // Two rings only. The weight is inverse *fourth* power, so a region four
      // spacings away contributes about a thousandth of its nearest
      // neighbour — restricting the sum is exact to well past float precision,
      // and it makes the relief properly local into the bargain.
      const cand = nearby(wx, wz, 2, scratch);
      for (let i = 0; i < cand.length; i++) {
        const r = cand[i];
        const dx = r.center[0] - wx, dz = r.center[1] - wz;
        const d2 = Math.max(dx * dx + dz * dz, 1);
        const w = 1 / (d2 * d2);          // inverse square, sharply local
        num += r.elevation * w;
        den += w;
      }
      cellElev[cz * cw + cx] = den > 0 ? num / den : 0.34;
    }
  }

  /** Bilinear elevation, 0..1, so terrain reads it without stepping. */
  const elevationAt = (x: any, z: any) => {
    const fx = clamp(x / CELL - 0.5, 0, cw - 1.001);
    const fz = clamp(z / CELL - 0.5, 0, cw - 1.001);
    const x0 = Math.floor(fx), z0 = Math.floor(fz);
    const tx = fx - x0, tz = fz - z0;
    const a = cellElev[z0 * cw + x0],     b = cellElev[z0 * cw + x0 + 1];
    const c = cellElev[(z0 + 1) * cw + x0], d = cellElev[(z0 + 1) * cw + x0 + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };

  /* ---- 4. hydrology ------------------------------------------------
   * Water is *routed*, not drawn.
   *
   * The river used to be a parametric sine: `x = 0.50*S + t*0.115*S + …`. It
   * looked like a river, but it had no relationship to the land it was
   * supposedly draining, so it cut straight through whatever the plan had
   * decided was high ground — at the default seed it beheaded the
   * highest-scoring region entirely. Water finding its own way down is not a
   * simulation luxury here, it is the only thing that makes the relief and the
   * drainage agree.
   */
  const nWander = makeNoise2D(seed + 45);
  const RIM = size * ISLAND_R;

  /** Regions far enough from the rim to be genuine inland features. */
  const inland = regions.filter(
    (r) => Math.hypot(r.center[0] - half, r.center[1] - half) < RIM * 0.74);
  const pool = inland.length ? inland : regions;

  /**
   * Steepest descent with inertia.
   *
   * Each step looks along a forward cone and takes the lowest sample, then
   * *blends* that direction with the current heading. Pure steepest descent
   * zig-zags from cell to cell and reads as a staircase; pure inertia ignores
   * the terrain. The blend is what produces a meander — the channel commits to
   * a direction, overshoots the low ground, and swings back.
   *
   * No depression filling. The elevation field is an inverse-square blend of
   * region elevations, so it is smooth and nearly free of interior basins, and
   * where a river does run out of downhill its inertia carries it on until the
   * rim term takes over. A lake pass would cost more than it is worth here.
   */
  const traceRiver = (sx: any, sz: any, opts: any = {}) => {
    const step = opts.step ?? 3;
    const join = opts.join ?? null;      // polyline to merge into, if any
    const joinR2 = (opts.joinRadius ?? 7) ** 2;
    const pts = [[sx, sz]];
    let x = sx, z = sz;
    // Start out heading away from the middle: the rim term dominates the
    // elevation field, so that is downhill in the large.
    let hx = x - half, hz = z - half;
    const h0 = Math.hypot(hx, hz) || 1;
    hx /= h0; hz /= h0;

    for (let i = 0; i < 600; i++) {
      if (Math.hypot(x - half, z - half) > RIM * 0.99) break;   // the sea
      if (x < 3 || z < 3 || x > size - 4 || z > size - 4) break;

      if (join) {
        for (let k = 0; k < join.length; k++) {
          const dx = join[k][0] - x, dz = join[k][1] - z;
          if (dx * dx + dz * dz < joinR2) { pts.push(join[k]); return pts; }
        }
      }

      const base = Math.atan2(hz, hx);
      let bx = hx, bz = hz, best = Infinity;
      for (let k = -4; k <= 4; k++) {
        const a = base + k * 0.22;
        const dx = Math.cos(a), dz = Math.sin(a);
        const nx = x + dx * step, nz = z + dz * step;
        const e = elevationAt(nx, nz)
                // Wander at a scale of ~50 blocks, so the channel wobbles
                // within a valley rather than shivering along it.
                + fbm2(nWander, nx * 0.020, nz * 0.020, 2) * 0.030
                // A slight cost to turning, so straight is the default and a
                // bend has to be earned by the terrain.
                + Math.abs(k) * 0.004;
        if (e < best) { best = e; bx = dx; bz = dz; }
      }
      hx = hx * 0.55 + bx * 0.45;
      hz = hz * 0.55 + bz * 0.45;
      const l = Math.hypot(hx, hz) || 1;
      hx /= l; hz /= l;
      x += hx * step; z += hz * step;
      pts.push([x, z]);
    }
    /* Drop the headwater.
     *
     * A trace that starts on the summit carves a channel through the summit,
     * which is how the highest planned region kept arriving at terrain height
     * 19 — the river was eating its own source. Real channels begin at a
     * spring some way down the slope; discarding the first stretch gives the
     * same result for free and leaves the peak intact to be a peak. */
    const skip = opts.spring === false ? 0 : Math.round(pts.length * 0.14);
    return pts.length - skip >= 8 ? pts.slice(skip) : pts;
  };

  /* The lake is a planning decision too.
   *
   * Terrain used to site it at a literal 0.335, 0.605 — which could and did
   * land on top of a planned summit, carving a basin through a peak. Water
   * collects in the lowest place available; naming that place here is what
   * stops the two systems contradicting one another, and it lets the river
   * network below know the lake exists. */
  const peaks = [...pool].sort((a, b) => b.elevation - a.elevation);
  const rivers: any[] = [];

  /* How much water the world gets, scaled by area.
   *
   * Everything here used to be a fixed count: one trunk, one tributary, one
   * lake. Fixed counts are the same mistake as fractional spacing — quadruple
   * the map and the drainage does not get denser, it gets sparser, and a
   * quarter of the world ends up with no water in sight. */
  const areaScale = (size / 256) ** 2;
  const trunkCount = clamp(Math.round(1.5 * Math.sqrt(areaScale)), 1, 20);
  const lakeCount = clamp(Math.round(1 * areaScale), 1, 48);

  /* Lake basins: the lowest-lying inland regions, kept apart.
   *
   * Sited at a literal coordinate a lake could — and did — land on top of
   * whatever the plan had decided was high ground, carving a basin straight
   * through a summit. Water collects in the lowest place available. */
  const lakes: any[] = [];
  const basins = [...pool].sort((a, b) => a.elevation - b.elevation);
  for (const b of basins) {
    if (lakes.length >= lakeCount) break;
    const rad = REGION_SPACING * rng.range(0.85, 1.5);
    if (lakes.some((l) => Math.hypot(l.center[0] - b.center[0],
                                     l.center[1] - b.center[1]) < (l.radius + rad) * 1.9)) continue;
    lakes.push({ region: b.id, center: b.center.slice(), radius: rad });
  }
  // The largest is *the* lake — the one terrain treats as its set-piece basin
  // and the one older code that expects a single `plan.lake` still reads.
  const lake = lakes.reduce((a, b) => (b.radius > a.radius ? b : a), lakes[0]);

  // Trunks: one from each of the highest regions, all the way to the sea.
  for (const p of peaks) {
    if (rivers.length >= trunkCount) break;
    if (rivers.some((r) => Math.hypot(r.points[0][0] - p.center[0],
                                      r.points[0][1] - p.center[1]) < REGION_SPACING * 5)) continue;
    rivers.push({ order: 0, source: p.id, points: traceRiver(...(p.center as [any, any])) });
  }

  /* Every lake that no trunk reaches gets its own outflow.
   *
   * An unconnected lake reads as a puddle someone dropped on the map. One
   * outflow is enough to make it a system — the eye accepts a body of water
   * that visibly goes somewhere. */
  for (const l of lakes) {
    const reached = rivers.some((r) => r.points.some(([x, z]: any) =>
      Math.hypot(x - l.center[0], z - l.center[1]) < l.radius * 1.3));
    if (reached) continue;
    rivers.push({
      order: 1, source: l.region, outflow: true,
      // No spring trim: an outflow starts at the lake, by definition.
      points: traceRiver(l.center[0], l.center[1], { spring: false }),
    });
  }

  // Tributaries from lesser summits, merged into whichever channel they meet.
  // Confluences are what make a drainage look drained rather than decorated.
  const trunks = rivers.filter((r) => r.order === 0);
  for (const p of peaks) {
    if (rivers.length >= trunkCount * 3) break;
    if (rivers.some((r) => r.source === p.id)) continue;
    const host = trunks[rivers.length % Math.max(trunks.length, 1)];
    if (!host) break;
    const pts = traceRiver(p.center[0], p.center[1], { join: host.points });
    if (pts.length < 10) continue;
    rivers.push({ order: 1, source: p.id, tributary: true, points: pts });
  }

  /** Distance from a point to the nearest channel centreline, in blocks. */
  const riverProbe: any[] = [];
  for (const r of rivers)
    for (let i = 0; i < r.points.length; i += 3) riverProbe.push(r.points[i]);
  const riverDistance = (x: any, z: any) => {
    let best = Infinity;
    for (const p of riverProbe) {
      const dx = p[0] - x, dz = p[1] - z;
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
  /** Signed distance to the nearest lake: negative inside one. */
  const lakeDistance = (x: any, z: any) => {
    let best = Infinity;
    for (const l of lakes) {
      const d = Math.hypot(x - l.center[0], z - l.center[1]) - l.radius;
      if (d < best) best = d;
    }
    return best;
  };

  const inside = (x: any, z: any) => x >= 0 && z >= 0 && x < size && z < size;
  const cellAt = (x: any, z: any) => {
    const cx = clamp(Math.floor(x / CELL), 0, cw - 1);
    const cz = clamp(Math.floor(z / CELL), 0, cw - 1);
    return cz * cw + cx;
  };
  const regionAt = (x: any, z: any) => regions[cellRegion[cellAt(x, z)]];
  const biomeAt = (x: any, z: any) => cellBiome[cellAt(x, z)];

  /* ---- 5. scenic sites ---------------------------------------------
   * Candidate places worth composing a scene around, scored and ranked
   * rather than taken as they come.
   *
   * The score is the whole point. Procedural generation that accepts its
   * first roll produces the average of its distribution everywhere, and the
   * average is exactly what looks generated. Generating many and keeping the
   * best few costs almost nothing at this resolution and is what lets a
   * screenshot look chosen.
   *
   * Sites are scored against the *hydrology* now, not against biome adjacency
   * alone. Biome neighbours are a weak proxy for "there is water here": the
   * first version produced 22 crossings and no waterfalls at all, because
   * shore-next-to-highland is rare and being next to the actual river was not
   * something the score could see.
   */
  const scenic = [];
  for (const r of regions) {
    const [rx, rz] = r.center;
    const dRiver = riverDistance(rx, rz);
    const dLake = lakeDistance(rx, rz);
    // How far the ground falls away nearby — the plan's own idea of relief.
    let relief = 0;
    for (const n of r.neighbors) relief = Math.max(relief, Math.abs(r.elevation - regions[n].elevation));
    const variety = new Set(r.neighbors.map((n) => regions[n].biome)).size;

    // Near enough that a scene built here can include the water, rather than
    // merely be in the same postcode as it.
    const onRiver = dRiver < CELL * 3.5;
    const onLake  = dLake > -REGION_SPACING * 0.6 && dLake < CELL * 3.0;
    const waterProx = Math.max(
      1 - clamp(dRiver / (CELL * 6), 0, 1),
      1 - clamp(Math.abs(dLake) / (CELL * 6), 0, 1));

    // A scene needs contrast to frame itself: water to look across, height to
    // look up at, and a boundary so it is somewhere rather than more of the
    // same. Flat interior regions score low and are skipped.
    const score =
        waterProx * 0.34
      + Math.min(relief / 0.35, 1) * 0.26
      + Math.min(variety, 3) / 3 * 0.18
      + r.magic * 0.12
      + r.moisture * 0.10;

    /* Kind is a *claim about the terrain*, and each grammar re-checks it
     * before building — a waterfall site with no cliff at it silently
     * downgrades rather than producing a cascade running down flat ground. */
    let kind;
    if ((onRiver || onLake) && relief > 0.16)     kind = 'waterfall';
    else if (onRiver)                             kind = 'crossing';
    else if (onLake || r.moisture > 0.62)         kind = 'pond';
    else if (r.elevation > 0.66 && relief > 0.12) kind = 'overlook';
    else                                          kind = 'grove';

    r.importance = score;
    if (score > 0.40) {
      scenic.push({
        region: r.id, kind, score, at: r.center.slice(),
        biome: r.biome, elevation: r.elevation, relief,
        dRiver, dLake, seed: r.seed,
      });
    }
  }
  scenic.sort((a, b) => b.score - a.score);

  return {
    size, cellSize: CELL, cellsAcross: cw,
    regions, cellRegion, cellBiome,
    regionAt, biomeAt, elevationAt, cellElev, inside,
    /** Planned water: where the basins sit and how every channel runs.
     *  `lake` is the largest — the set-piece one terrain dishes out in full. */
    lake, lakes, rivers, riverDistance, lakeDistance,
    regionSpacing: REGION_SPACING,
    /** Best-scoring scenes first. */
    scenic,
  };
}
