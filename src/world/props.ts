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

  // paths running off both bridge heads, along the deck's own direction
  for (const b of props.bridges) {
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
