/**
 * Built things — bridges, lanterns, fences, paths, ruins.
 *
 * These are the "someone lives here" layer. Without them the world is
 * scenery; with them it's a place. Everything is placed against the finished
 * heightfield so it sits on the ground properly.
 */

import { BLOCKS, WATER } from '../core/palette';
import { clamp } from '../core/rng';

/**
 * A plank bridge across the channel at a river node.
 *
 * The deck is axis-aligned because voxel planks are, but *which* axis is read
 * from the channel normal. The previous version always spanned +X, which was
 * fine while the river was a parametric curve running roughly down the map and
 * became a pier pointing along the bank the moment rivers were free to run in
 * any direction.
 *
 * Returns null if there's nowhere sensible to put it.
 */
export function buildBridge(world: any, node: any, rng: any) {
  const { grid, heights, size: S } = world;
  const alongX = Math.abs(node.nx) >= Math.abs(node.nz);
  const ax = alongX ? 1 : 0,
    az = alongX ? 0 : 1; // deck direction
  const px = az,
    pz = ax; // deck width direction
  const cx = Math.round(node.x),
    cz = Math.round(node.z);

  const col = (i: any, j = 0) => {
    const x = clamp(cx + ax * i + px * j, 0, S - 1);
    const z = clamp(cz + az * i + pz * j, 0, S - 1);
    return z * S + x;
  };
  const put = (i: any, j: any, y: any, id: any) => {
    const x = cx + ax * i + px * j,
      z = cz + az * i + pz * j;
    if (x < 0 || z < 0 || x >= S || z >= S) return;
    grid.set(x, y, z, id);
  };

  /* Walk outward to dry land on both banks.
   *
   * The stop condition used to be "any column more than a block above the
   * bed", which was fine while river beds sat four blocks under the surface
   * and became wrong the moment pools reached sixteen: the walk halted on a
   * submerged shelf and put a deck at y=15, nine blocks under the waterline.
   * A bank is land, so the test is against the waterline. */
  const SEA = Math.floor(WATER.level);
  const bankStop = (i: any) => heights[col(i)] > Math.max(heights[col(0)] + 1, SEA);
  let left = 0,
    right = 0;
  while (left > -40 && !bankStop(left)) left--;
  while (right < 40 && !bankStop(right)) right++;
  if (right - left < 6 || right - left > 46) return null;

  const deckY = Math.max(heights[col(left)], heights[col(right)]) + 1;
  const halfW = 1;

  for (let i = left; i <= right; i++) {
    for (let j = -halfW; j <= halfW; j++) put(i, j, deckY, BLOCKS.PLANK.id);
    // railings
    for (const side of [-halfW - 1, halfW + 1]) {
      put(i, side, deckY, BLOCKS.BEAM.id);
      if (i % 3 === 0) put(i, side, deckY + 1, BLOCKS.BEAM.id);
      // One continuous pale timber across the darker uprights. Alternating
      // beam/plank blocks made the rail read as a checkerboard rather than as
      // the clean horizontal handrail in the reference.
      put(i, side, deckY + 2, BLOCKS.PLANK_PALE.id);
    }
    // support piers into the water
    if ((i - left) % 7 === 3) {
      for (let y = deckY - 1; y > 0; y--) {
        const x = cx + ax * i,
          z = cz + az * i;
        if (grid.isSolid(x, y, z)) break;
        put(i, 0, y, BLOCKS.BEAM.id);
      }
    }
  }

  // a lantern at each end
  for (const i of [left + 1, right - 1]) {
    put(i, -halfW - 1, deckY + 3, BLOCKS.BEAM.id);
    put(i, -halfW - 1, deckY + 4, BLOCKS.LANTERN.id);
  }

  const end = (i: any) => [cx + ax * i, cz + az * i];
  return {
    deckY,
    alongX,
    near: end(left),
    far: end(right),
    // Kept for the spawn picker and anything that just wants "somewhere on it".
    x: cx,
    z: cz,
  };
}

/** Carve a paved path between two points, following the terrain. */
export function carvePath(world: any, ax: any, az: any, bx: any, bz: any, rng: any, width = 1) {
  const { grid, heights, size: S } = world;
  const steps = Math.ceil(Math.hypot(bx - ax, bz - az) * 1.4);
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // gentle sinuous wander so paths never look like a ruler line
    const wobble = Math.sin(t * Math.PI * 3.1) * 3.5 * Math.sin(t * Math.PI);
    const nx = bx - ax,
      nz = bz - az;
    const len = Math.hypot(nx, nz) || 1;
    const px = -nz / len,
      pz = nx / len;
    const x = Math.round(ax + (bx - ax) * t + px * wobble);
    const z = Math.round(az + (bz - az) * t + pz * wobble);

    for (let dz = -width; dz <= width; dz++)
      for (let dx = -width; dx <= width; dx++) {
        const xx = clamp(x + dx, 0, S - 1),
          zz = clamp(z + dz, 0, S - 1);
        if (dx * dx + dz * dz > width * width + 0.5) continue;
        const top = heights[zz * S + xx];
        if (!grid.isSolid(xx, top, zz)) continue;
        // clear anything sitting on the path (shrubs, grass detail)
        grid.set(xx, top + 1, zz, 0);
        grid.set(xx, top, zz, BLOCKS.PATH.id);
      }
    out.push([x, z]);
  }
  return out;
}

/** A standing lantern post. */
export function placeLantern(grid: any, x: any, y: any, z: any) {
  grid.set(x, y, z, BLOCKS.BEAM.id);
  grid.set(x, y + 1, z, BLOCKS.BEAM.id);
  grid.set(x, y + 2, z, BLOCKS.BEAM.id);
  grid.set(x, y + 3, z, BLOCKS.LANTERN.id);
  grid.set(x, y + 4, z, BLOCKS.BEAM.id);
}

/**
 * A sea bridge between two continent/island centres, landing at low-elevation shore.
 *
 * Three architecture styles are supported:
 *  - 'trestle'    Plank deck, timber piers every 5 blocks, wood railing.
 *                 Best for short spans.
 *  - 'arch'       Stone-warm arch with peak ~20% of water span above deck,
 *                 stone parapets. Best for medium spans.
 *  - 'suspension' Two tall beam pylons near each shore, catenary of
 *                 PLANK_PALE cables drooping to mid-span. Best for long spans.
 *
 * All styles share the same shore-finding logic and ramp-to-ground landing.
 */
export function buildSeaBridge(world: any, ax: number, az: number, bx: number, bz: number,
                               style: 'trestle' | 'arch' | 'suspension' = 'trestle') {
  const { grid, heights, size: S } = world;
  const SEA = Math.floor(WATER.level);
  const BEACH = SEA + 5; // maximum landing height — stay at beach/grassland level

  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 4) return null;
  const ux = dx / len, uz = dz / len;
  const rpx = -uz, rpz = ux; // railing perpendicular
  const halfW = 1;

  const colH = (t: number) => {
    const x = clamp(Math.round(ax + ux * t), 0, S - 1);
    const z = clamp(Math.round(az + uz * t), 0, S - 1);
    return heights[z * S + x];
  };

  // Walk outward from A centre to find the best (lowest) land entry point.
  // "Best" = first land column whose height is ≤ BEACH. If none is that low,
  // fall back to the lowest land column in the outer half of A's side.
  const findShore = (fromCenter: boolean) => {
    const step = fromCenter ? 1 : -1;
    const start = fromCenter ? 0 : Math.round(len);
    const end   = fromCenter ? Math.round(len / 2) : Math.round(len / 2);
    let bestI = start, bestH = Infinity;
    let firstLand = -1;
    for (let i = start; fromCenter ? i <= end : i >= end; i += step) {
      const h = colH(i);
      if (h > SEA) {
        if (firstLand < 0) firstLand = i;
        if (h <= BEACH) return i; // ideal: beach/grass level
        if (h < bestH) { bestH = h; bestI = i; }
      }
    }
    return firstLand >= 0 ? bestI : -1; // lowest land, or -1 if no land found
  };

  const startI = findShore(true);
  const endI   = findShore(false);
  if (startI < 0 || endI < 0 || endI <= startI + 2) return null;

  // Deck travels at a fixed low height — just clears the water.
  const deckY = SEA + 3;

  // Ramp length: how many blocks to slope up/down onto the island
  const RAMP = 6;

  for (let i = startI; i <= endI; i++) {
    const wx = ax + ux * i, wz = az + uz * i;
    const xi = clamp(Math.round(wx), 0, S - 1);
    const zi = clamp(Math.round(wz), 0, S - 1);
    const groundH = heights[zi * S + xi];
    const isLand  = groundH > SEA;

    // At the landings ramp the deck up/down to meet the ground smoothly.
    const rampNear = i - startI;
    const rampFar  = endI - i;
    const rampFrac = Math.min(rampNear, rampFar, RAMP) / RAMP;
    // On land: deck follows terrain + 1, blending toward deckY over the ramp.
    // Over water: always deckY.
    const thisY = isLand
      ? Math.round(deckY + (groundH + 1 - deckY) * (1 - rampFrac))
      : deckY;

    const put = (offP: number, y: number, id: number) => {
      const x = clamp(Math.round(wx + rpx * offP), 0, S - 1);
      const z = clamp(Math.round(wz + rpz * offP), 0, S - 1);
      grid.set(x, y, z, id);
    };

    // Deck planks
    for (let j = -halfW; j <= halfW; j++) put(j, thisY, BLOCKS.PLANK.id);

    // Fill any gap between deck and ground so there is no floating section
    if (isLand && thisY > groundH + 1) {
      for (let y = groundH + 1; y < thisY; y++)
        for (let j = -halfW; j <= halfW; j++) put(j, y, BLOCKS.BEAM.id);
    }

    const showRail = !isLand || rampFrac > 0.5;

    if (style === 'trestle') {
      // Timber railing: dark beam uprights every 4 blocks, pale capping rail
      if (showRail) {
        for (const side of [-halfW - 1, halfW + 1]) {
          put(side, thisY, BLOCKS.BEAM.id);
          if (i % 4 === 0) put(side, thisY + 1, BLOCKS.BEAM.id);
          put(side, thisY + 2, BLOCKS.PLANK_PALE.id);
        }
      }
      // Timber piers down to seabed every 5 blocks over water
      if (!isLand && i % 5 === 0) {
        for (let y = thisY - 1; y > 0; y--) {
          if (grid.isSolid(xi, y, zi)) break;
          put(0, y, y > SEA - 2 ? BLOCKS.BEAM.id : BLOCKS.STONE.id);
        }
      }

    } else if (style === 'arch') {
      // Stone parapet: solid stone_warm wall 2 blocks tall on each side
      if (showRail) {
        for (const side of [-halfW - 1, halfW + 1]) {
          put(side, thisY,     BLOCKS.STONE_WARM.id);
          put(side, thisY + 1, BLOCKS.STONE_WARM.id);
        }
      }
      // Stone arch: parabolic column of STONE_WARM below the deck over water.
      // Column height = archH * (1 - (2t-1)²) where t = 0..1 along water span.
      if (!isLand) {
        const waterSpan = endI - startI;
        const archH = Math.max(4, Math.round(waterSpan * 0.18));
        const t = (i - startI) / Math.max(1, waterSpan);
        const colHeight = Math.round(archH * (1 - Math.pow(2 * t - 1, 2)));
        for (let y = thisY - 1; y >= thisY - colHeight; y--) {
          if (grid.isSolid(xi, y, zi)) break;
          put(0, y, y > SEA - 2 ? BLOCKS.STONE_WARM.id : BLOCKS.STONE.id);
        }
      }

    } else {
      // suspension: minimal railing — just pale capping rail, no uprights
      if (showRail) {
        for (const side of [-halfW - 1, halfW + 1]) {
          put(side, thisY + 1, BLOCKS.PLANK_PALE.id);
        }
      }
    }
  }

  // ---- Style-specific post-pass (pylons, cables, lanterns) ----

  const waterSpan = endI - startI;

  if (style === 'trestle') {
    // Lanterns at quarter-points and mid-span (water section only)
    for (const frac of [0.25, 0.5, 0.75]) {
      const i = Math.round(startI + waterSpan * frac);
      if (colH(i) > SEA) continue;
      const wx = ax + ux * i, wz = az + uz * i;
      const x = clamp(Math.round(wx + rpx * (halfW + 1)), 0, S - 1);
      const z = clamp(Math.round(wz + rpz * (halfW + 1)), 0, S - 1);
      grid.set(x, deckY + 3, z, BLOCKS.BEAM.id);
      grid.set(x, deckY + 4, z, BLOCKS.LANTERN.id);
    }

  } else if (style === 'arch') {
    // Lanterns on top of parapets at quarter-points
    for (const frac of [0.25, 0.75]) {
      const i = Math.round(startI + waterSpan * frac);
      if (colH(i) > SEA) continue;
      const wx = ax + ux * i, wz = az + uz * i;
      for (const side of [-halfW - 1, halfW + 1]) {
        const x = clamp(Math.round(wx + rpx * side), 0, S - 1);
        const z = clamp(Math.round(wz + rpz * side), 0, S - 1);
        grid.set(x, deckY + 2, z, BLOCKS.BEAM.id);
        grid.set(x, deckY + 3, z, BLOCKS.LANTERN.id);
      }
    }

  } else {
    // Suspension: two pylons ~15% of waterSpan from each shore
    const pylonH = Math.max(6, Math.round(waterSpan * 0.15));
    const pylonOffsets = [
      Math.round(startI + waterSpan * 0.15),
      Math.round(startI + waterSpan * 0.85),
    ];
    for (const pi of pylonOffsets) {
      const wx = ax + ux * pi, wz = az + uz * pi;
      for (const side of [-halfW - 1, halfW + 1]) {
        const px = clamp(Math.round(wx + rpx * side), 0, S - 1);
        const pz = clamp(Math.round(wz + rpz * side), 0, S - 1);
        const baseY = deckY;
        for (let y = baseY; y <= baseY + pylonH; y++) grid.set(px, y, pz, BLOCKS.BEAM.id);
        // lantern cap
        grid.set(px, baseY + pylonH + 1, pz, BLOCKS.LANTERN.id);
      }
    }

    // Catenary cables: PLANK_PALE from each pylon top drooping to mid-span.
    // y(t) = pylonTopY - pylonH * 4*t*(1-t)  where t goes pylon→midspan (0→1).
    const pylonTopY = deckY + pylonH;
    const midI = Math.round((startI + endI) / 2);
    for (const [pylonI, dir] of [[pylonOffsets[0], 1], [pylonOffsets[1], -1]] as [number,number][]) {
      const steps = Math.abs(midI - pylonI);
      for (let s = 0; s <= steps; s++) {
        const t = s / Math.max(1, steps);
        const cableI = pylonI + dir * s;
        const cableY = Math.round(pylonTopY - pylonH * 4 * t * (1 - t));
        const wx = ax + ux * cableI, wz = az + uz * cableI;
        for (const side of [-halfW - 1, halfW + 1]) {
          const cx2 = clamp(Math.round(wx + rpx * side), 0, S - 1);
          const cz2 = clamp(Math.round(wz + rpz * side), 0, S - 1);
          grid.set(cx2, cableY, cz2, BLOCKS.PLANK_PALE.id);
        }
      }
    }
  }

  return {
    deckY,
    alongX: Math.abs(ux) >= Math.abs(uz),
    near: [Math.round(ax + ux * startI), Math.round(az + uz * startI)],
    far:  [Math.round(ax + ux * endI),   Math.round(az + uz * endI)],
    x: Math.round(ax + ux * ((startI + endI) / 2)),
    z: Math.round(az + uz * ((startI + endI) / 2)),
    seaBridge: true,
  };
}

/** Populate the world with built structures. */
export function buildStructures(world: any, rng: any) {
  const { size: S, heights, grid, riverPath } = world;
  const props: { bridges: any[]; paths: any[]; lanterns: any[] } = {
    bridges: [],
    paths: [],
    lanterns: [],
  };

  /* Bridges go on the river the plan actually routed.
   *
   * Candidates are ranked by how *narrow* the channel is, because a crossing
   * belongs where the river is crossable — picking three fixed fractions of
   * the map put decks over the widest pools as often as not. The ford is
   * excluded: the whole point of a ford is that it is the place you do not
   * need a bridge. */
  /* Only the lower course is water — see the ravine branch in terrain.js. A
   * bridge over the dry upper channel is a gantry over a ditch, and the first
   * run of this put one at height 63 on a mountainside. */
  const sea = Math.floor(WATER.level);
  const wet = (p: any) => heights[clamp(Math.round(p.z), 0, S - 1) * S + clamp(Math.round(p.x), 0, S - 1)] <= sea;
  const crossable = riverPath.filter((p: any) => !p.ford && wet(p));
  const ranked = (crossable.length ? crossable : riverPath.filter(wet)).slice().sort((a: any, b: any) => a.w - b.w);

  /* Count scales with area, spacing does not.
   *
   * Three was a constant, so a nine-times-larger map got three bridges and
   * eight of its rivers had no crossing anywhere along them. The 41-block
   * spacing below is in blocks for the same reason scene separation is: it
   * describes how far apart two bridges have to be to read as two bridges. */
  const maxBridges = Math.max(3, Math.round(3 * (S / 256) ** 2));
  for (const node of ranked) {
    if (props.bridges.length >= maxBridges) break;
    if (props.bridges.some((b) => Math.hypot(b.x - node.x, b.z - node.z) < 41)) continue;
    const b = buildBridge(world, node, rng);
    if (b) props.bridges.push(b);
  }

  /* Sea bridges — short hops along stepping-stone chains.
   *
   * Each chain is [mainA, stone1?, stone2?, mainB]. Build one bridge per
   * consecutive hop: center-to-center, then buildSeaBridge walks inward to
   * find the actual shore on each side, so each span is short. */
  const plan = world.plan;
  if (plan?.bridgeChains?.length) {
    for (const chain of plan.bridgeChains as [number, number][][]) {
      for (let k = 0; k < chain.length - 1; k++) {
        const [ax, az] = chain[k], [bx, bz] = chain[k + 1];
        const spanLen = Math.hypot(bx - ax, bz - az);
        // ponytail: fixed thresholds; tune if world scale changes
        const bridgeStyle: 'trestle' | 'arch' | 'suspension' =
          spanLen < 120 ? 'trestle' : spanLen < 220 ? 'arch' : 'suspension';
        const sb = buildSeaBridge(world, ax, az, bx, bz, bridgeStyle);
        if (sb) {
          props.bridges.push(sb);
          const dx = Math.sign(sb.far[0] - sb.near[0]), dz = Math.sign(sb.far[1] - sb.near[1]);
          props.paths.push(carvePath(world, sb.near[0], sb.near[1], sb.near[0] - dx * 10, sb.near[1] - dz * 10, rng, 1));
          props.paths.push(carvePath(world, sb.far[0],  sb.far[1],  sb.far[0]  + dx * 10, sb.far[1]  + dz * 10, rng, 1));
        }
      }
    }
  }

  // paths running off both bridge heads, along the deck's own direction
  for (const b of props.bridges.filter((b: any) => !b.seaBridge)) {
    const dx = Math.sign(b.near[0] - b.far[0]),
      dz = Math.sign(b.near[1] - b.far[1]);
    props.paths.push(carvePath(world, b.near[0] + dx * 7, b.near[1] + dz * 7, b.near[0], b.near[1], rng, 1));
    props.paths.push(carvePath(world, b.far[0], b.far[1], b.far[0] - dx * 8, b.far[1] - dz * 8, rng, 1));
  }

  // lanterns along the paths
  for (const path of props.paths) {
    for (let i = 2; i < path.length; i += 9) {
      const [x, z] = path[i];
      const top = heights[clamp(z, 0, S - 1) * S + clamp(x, 0, S - 1)];
      if (grid.isSolid(x + 2, top, z)) {
        placeLantern(grid, x + 2, top + 1, z);
        props.lanterns.push([x + 2, top + 1, z]);
      }
    }
  }

  world.props = props;
  return props;
}
