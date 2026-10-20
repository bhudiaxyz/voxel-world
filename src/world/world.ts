
/**
 * World assembly — runs the generators in order and turns the finished voxel
 * grid into renderable meshes.
 */

import * as THREE from 'three';
import { generateTerrain, WORLD } from './terrain.ts';
import { planWorld } from './planner.ts';
import { scatterVegetation } from './vegetation.ts';
import { buildStructures } from './props.ts';
import { buildStamps } from './stamps.ts';
import { createWorldChunkStreamer } from '../core/voxel.ts';
import { makeRng } from '../core/rng.ts';
import { BLOCKS, BLOCK_BY_ID } from '../core/palette.ts';

export async function buildWorld(seed: number, onProgress: (p: number, s?: string) => void = () => {}) {
  const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

  /* The plan comes before the voxels.
   *
   * Everything downstream — terrain, vegetation, props, scenic stamps — reads
   * from it rather than re-deriving its own idea of where things are, which is
   * what keeps a forest, the shore it stops at and the bridge across it
   * agreeing with one another. See world/planner.js. */
  onProgress(0.02, 'drawing the map');
  const plan = planWorld(seed, WORLD.size);

  onProgress(0.05, 'raising the land');
  const world: any = generateTerrain(seed, plan);
  world.plan = plan;
  world.rng = makeRng(seed ^ 0x5f3a);

  /**
   * Extension point for generators that need to contribute real Object3Ds
   * rather than voxels — instanced grass blades, wind-animated foliage,
   * banners, anything that can't be expressed as a block. Push into this and
   * it gets added to the world group and ticked each frame if it exposes an
   * `update(dt, camera)` method.
   */
  world.decorations = [];
  await yieldFrame();

  onProgress(0.24, 'building the crossings');
  buildStructures(world, world.rng);
  await yieldFrame();

  /* Scenes are composed after the bridges and before the scatter.
   *
   * After props, because a bridge is a hero object in its own right and a
   * scene should stand clear of one. Before vegetation, because the clearings
   * a scene reserves are the whole point of it, and the scatter pass would
   * cheerfully fill them in. */
  onProgress(0.34, 'composing the scenes');
  buildStamps(world, world.rng);
  await yieldFrame();

  onProgress(0.42, 'planting the blossom');
  scatterVegetation(world, world.rng);
  await yieldFrame();

  world.spawn = findSpawn(world);

  // Keep the complete voxel grid on the CPU for collision, swimming and the
  // map, but only create nearby GPU geometry. A small playable island around
  // the spawn is ready before the loading veil lifts; the rest streams during
  // idle time as the camera moves.
  onProgress(0.58, 'carving the stone');
  const streaming = createWorldChunkStreamer(world.grid);
  await streaming.preload(world.spawn, {
    radius: 3,
    onProgress: (p: number) => onProgress(0.58 + p * 0.38, 'carving the stone'),
  } as any);
  const meshes = streaming.meshes;
  await yieldFrame();

  const group = new THREE.Group();
  group.add(meshes.solid);
  group.add(meshes.glow);
  // On EDGE_LAYER, so only the edge-mask pass ever draws it.
  group.add(meshes.edges);

  world.animated = [];
  for (const d of world.decorations) {
    const obj = d.object3d || d;
    if (obj && obj.isObject3D) group.add(obj);
    if (typeof d.update === 'function') world.animated.push(d);
  }

  world.group = group;
  world.meshes = meshes;
  world.streaming = streaming;

  // Collect all terrain + decoration planet uniform objects for the frame loop.
  world.allPlanetUnis = [streaming.planetUnis, meshes.glowMaterial.userData.planetUnis];
  for (const d of world.decorations) {
    if (d.planetUnis) world.allPlanetUnis.push(d.planetUnis);
  }

  onProgress(1.0, 'ready');
  return world;
}

/** Pick a pleasant, walkable, well-framed spawn point near the river. */
function findSpawn(world: any) {
  const { grid, heights, size: S } = world;
  const b = world.props?.bridges?.[0];
  if (b) {
    // On the deck itself. The old spawn stepped three blocks off the near
    // head along +X, which was solid ground while every bridge ran east-west
    // and is open air now that they follow the channel.
    return new THREE.Vector3(b.x + 0.5, b.deckY + 1.2, b.z + 0.5);
  }
  const cx = Math.floor(S / 2), cz = Math.floor(S / 2);
  for (let r = 0; r < S / 2; r++) {
    for (let a = 0; a < 24; a++) {
      const th = (a / 24) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(th) * r);
      const z = Math.round(cz + Math.sin(th) * r);
      if (x < 4 || z < 4 || x > S - 5 || z > S - 5) continue;
      const top = heights[z * S + x];
      const id = grid.get(x, top, z);
      if (BLOCK_BY_ID[id]?.grassCap ||
          id === BLOCKS.PATH.id || id === BLOCKS.SAND.id) {
        return new THREE.Vector3(x + 0.5, top + 1.2, z + 0.5);
      }
    }
  }
  return new THREE.Vector3(cx, WORLD.height * 0.6, cz);
}
