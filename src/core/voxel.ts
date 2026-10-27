/**
 * The voxel core: a dense grid, a face-culling mesher with baked per-vertex
 * ambient occlusion, and the shader that gives every block its surface.
 *
 * Why baked AO matters: it is the single biggest reason the reference images
 * read as a handcrafted diorama rather than a pile of cubes. Contact shadows
 * in every crevice give the geometry weight and let us keep the key light
 * soft and the whole palette high-key without the forms going flat.
 *
 * Most materials are deliberately untextured. Only authored wood receives
 * parallel board seams or lengthwise grain from world-space UVs; terrain and
 * blossom planes remain uninterrupted flat colour.
 */

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { BLOCK_BY_ID, WATER, LIGHT } from './palette';
import { PLANET_UNIFORMS_GLSL, PLANET_BEND_GLSL, planetUniformValues } from '../render/planet.glsl';

export const CHUNK = 16;
export const DEFAULT_STREAM_RADIUS = 12;

/**
 * Objects on this layer are drawn only by the edge-mask pass, never by the
 * scene camera. See prepareEdgeObject.
 */
export const EDGE_LAYER = 2;

/* ================================================================== *
 * VoxelGrid
 * ================================================================== */
export class VoxelGrid {
  sx: number;
  sy: number;
  sz: number;
  data: Uint8Array;
  /** highest solid voxel per column, for fast ground queries */
  height: Int16Array;

  constructor(sx: number, sy: number, sz: number) {
    this.sx = sx;
    this.sy = sy;
    this.sz = sz;
    this.data = new Uint8Array(sx * sy * sz);
    this.height = new Int16Array(sx * sz).fill(-1);
  }

  idx(x: number, y: number, z: number) {
    return (y * this.sz + z) * this.sx + x;
  }

  inside(x: number, y: number, z: number) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }

  get(x: number, y: number, z: number) {
    if (!this.inside(x, y, z)) return 0;
    return this.data[this.idx(x, y, z)];
  }

  set(x: number, y: number, z: number, id: number) {
    if (!this.inside(x, y, z)) return;
    this.data[this.idx(x, y, z)] = id;
    const h = z * this.sx + x;
    if (id !== 0) {
      if (y > this.height[h]) this.height[h] = y;
    } else if (this.height[h] === y) {
      let yy = y - 1;
      while (yy >= 0 && this.data[this.idx(x, yy, z)] === 0) yy--;
      this.height[h] = yy;
    }
  }

  /** y of the topmost solid block in a column, or -1. */
  columnTop(x: number, z: number) {
    if (x < 0 || z < 0 || x >= this.sx || z >= this.sz) return -1;
    return this.height[z * this.sx + x];
  }

  /** World-space Y of the surface (top + 1), or 0 if the column is empty. */
  surfaceY(x: number, z: number): number {
    const t = this.columnTop(Math.round(x), Math.round(z));
    return t < 0 ? 0 : t + 1;
  }

  isSolid(x: number, y: number, z: number) {
    const id = this.get(x, y, z);
    return id !== 0 && !BLOCK_BY_ID[id]?.isWater;
  }

  /** Fill an axis-aligned box (inclusive bounds). */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number) {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, id);
  }

  /** Fill a sphere/ellipsoid, optionally with a predicate for shaping. */
  ellipsoid(
    cx: number,
    cy: number,
    cz: number,
    rx: number,
    ry: number,
    rz: number,
    id: number,
    predicate: ((x: number, y: number, z: number, d: number) => boolean) | null = null,
  ) {
    const x0 = Math.floor(cx - rx),
      x1 = Math.ceil(cx + rx);
    const y0 = Math.floor(cy - ry),
      y1 = Math.ceil(cy + ry);
    const z0 = Math.floor(cz - rz),
      z1 = Math.ceil(cz + rz);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const dx = (x + 0.5 - cx) / rx,
            dy = (y + 0.5 - cy) / ry,
            dz = (z + 0.5 - cz) / rz;
          const d = dx * dx + dy * dy + dz * dz;
          if (d <= 1.0 && (!predicate || predicate(x, y, z, Math.sqrt(d)))) this.set(x, y, z, id);
        }
  }
}

/* ================================================================== *
 * Face table
 *
 * Each face lists its normal, its 4 corner offsets in CCW winding, and the
 * two in-plane axes so we can derive AO neighbours generically.
 * ================================================================== */
const FACES = [
  {
    // +X
    n: [1, 0, 0],
    axis: 0,
    corners: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
    uAxis: 2,
    vAxis: 1,
  },
  {
    // -X
    n: [-1, 0, 0],
    axis: 0,
    corners: [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
      [0, 0, 0],
    ],
    uAxis: 2,
    vAxis: 1,
  },
  {
    // +Y
    n: [0, 1, 0],
    axis: 1,
    corners: [
      [0, 1, 0],
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
    ],
    uAxis: 0,
    vAxis: 2,
  },
  {
    // -Y
    n: [0, -1, 0],
    axis: 1,
    corners: [
      [0, 0, 1],
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
    ],
    uAxis: 0,
    vAxis: 2,
  },
  {
    // +Z
    n: [0, 0, 1],
    axis: 2,
    corners: [
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
      [0, 0, 1],
    ],
    uAxis: 0,
    vAxis: 1,
  },
  {
    // -Z
    n: [0, 0, -1],
    axis: 2,
    corners: [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
    ],
    uAxis: 0,
    vAxis: 1,
  },
];

const AXIS_VEC = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/* ================================================================== *
 * Mesher
 * ================================================================== */

class MeshBuffer {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  tint: number[] = [];
  fringeCol: number[] = [];
  uv: number[] = [];
  dat: number[] = [];
  idx: number[] = [];
  count = 0;

  get empty() {
    return this.count === 0;
  }

  quad(
    verts: any,
    n: any,
    base: any,
    tint: any,
    fringeCol: any,
    uvs: any,
    ao: any,
    pattern: any,
    fringe: any,
    localV: any,
  ) {
    const b = this.count;
    for (let i = 0; i < 4; i++) {
      this.pos.push(verts[i][0], verts[i][1], verts[i][2]);
      this.nrm.push(n[0], n[1], n[2]);
      this.col.push(base.r, base.g, base.b);
      this.tint.push(tint.r, tint.g, tint.b);
      this.fringeCol.push(fringeCol.r, fringeCol.g, fringeCol.b);
      this.uv.push(uvs[i][0], uvs[i][1]);
      this.dat.push(ao[i], pattern, fringe, localV[i]);
    }
    // Flip the split so the AO gradient never creases along the wrong diagonal.
    if (ao[0] + ao[2] > ao[1] + ao[3]) {
      this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    } else {
      this.idx.push(b + 1, b + 2, b + 3, b + 1, b + 3, b);
    }
    this.count += 4;
  }

  /**
   * Pack the vertex streams down before handing them to the GPU.
   *
   * Every one of these attributes was a float3/float4 — 84 bytes per vertex,
   * which on a world this size is ~40 MB of buffers and a lot of wasted
   * bandwidth on a stream the vertex shader touches once. Almost none of it
   * needs float precision:
   *
   *   position  voxel corners are integers -> Int16
   *   normal    axis-aligned, always 0 or ±1 -> Int8 normalized
   *   colours   already in 0..1, and these are flat pastels where a 1/255
   *             step is invisible -> Uint8 normalized
   *   aUv       world-space and integral at every vertex -> Int16
   *   aData     carries fractional AO, pattern, fringe and local height, so
   *             this one genuinely stays float
   *
   * Normalized integer attributes are expanded back to 0..1 (or -1..1) by the
   * GPU for free, so no shader change is needed.
   */
  toGeometry() {
    const g = new THREE.BufferGeometry();
    const n = this.count;

    const pos = new Int16Array(n * 3);
    for (let i = 0; i < n * 3; i++) pos[i] = this.pos[i];

    const nrm = new Int8Array(n * 3);
    for (let i = 0; i < n * 3; i++) nrm[i] = Math.round(this.nrm[i] * 127);

    const packColor = (src: number[]) => {
      const a = new Uint8Array(n * 3);
      for (let i = 0; i < n * 3; i++) {
        const v = src[i];
        a[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
      }
      return a;
    };

    const uv = new Int16Array(n * 2);
    for (let i = 0; i < n * 2; i++) uv[i] = this.uv[i];

    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(packColor(this.col), 3, true));
    g.setAttribute('aTint', new THREE.BufferAttribute(packColor(this.tint), 3, true));
    g.setAttribute('aFringe', new THREE.BufferAttribute(packColor(this.fringeCol), 3, true));
    g.setAttribute('aUv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aData', new THREE.Float32BufferAttribute(this.dat, 4));
    // 16-bit indices wherever a chunk fits, which is the common case.
    g.setIndex(
      n <= 65535
        ? new THREE.BufferAttribute(new Uint16Array(this.idx), 1)
        : new THREE.BufferAttribute(new Uint32Array(this.idx), 1),
    );
    g.computeBoundingSphere();
    return g;
  }
}

function createMeshRoots() {
  const solidGroup = new THREE.Group();
  const glowGroup = new THREE.Group();
  const edgeGroup = new THREE.Group();
  solidGroup.name = 'terrain';
  glowGroup.name = 'glow';
  edgeGroup.name = 'voxel-edges';

  const solidMat = makeVoxelMaterial();
  const glowMat = makeGlowMaterial();
  const edgeMat = makeEdgeMaterial();
  // Preserve the former single-edge-object access path for developer tools.
  (edgeGroup as any).material = edgeMat;

  return {
    solid: solidGroup,
    glow: glowGroup,
    edges: edgeGroup,
    material: solidMat,
    glowMaterial: glowMat,
    edgeMaterial: edgeMat,
  };
}

function edgeBelongsToChunk(edge: any, ci: any, ck: any, grid: any) {
  // Unit edges lying exactly on a chunk plane need one stable owner. Using
  // the cell on the positive side means every edge is emitted once, while the
  // one-block meshing halo still supplies both of its owning faces.
  const midpointX = (edge.start[0] + edge.end[0]) * 0.5;
  const midpointZ = (edge.start[2] + edge.end[2]) * 0.5;
  const cellX = THREE.MathUtils.clamp(Math.floor(midpointX), 0, grid.sx - 1);
  const cellZ = THREE.MathUtils.clamp(Math.floor(midpointZ), 0, grid.sz - 1);
  return Math.floor(cellX / CHUNK) === ci && Math.floor(cellZ / CHUNK) === ck;
}

function beginMeshChunk(grid: any, ci: any, ck: any, meshes: any) {
  const x0 = ci * CHUNK;
  const z0 = ck * CHUNK;
  const x1 = Math.min(x0 + CHUNK, grid.sx);
  const z1 = Math.min(z0 + CHUNK, grid.sz);
  return {
    grid,
    ci,
    ck,
    meshes,
    x0,
    z0,
    x1,
    z1,
    y: 0,
    solid: new MeshBuffer(),
    glow: new MeshBuffer(),
    edgeMap: new Map(),
  };
}

function finishMeshChunk(state: any) {
  const { grid, ci, ck, meshes, x0, z0, x1, z1, solid, glow, edgeMap } = state;

  for (const [key, edge] of edgeMap) {
    if (!edgeBelongsToChunk(edge, ci, ck, grid)) edgeMap.delete(key);
  }

  const record: { solid: any; glow: any; edges: any } = { solid: null, glow: null, edges: null };
  if (!solid.empty) {
    record.solid = new THREE.Mesh(solid.toGeometry(), meshes.material);
    record.solid.name = `terrain-${ci}-${ck}`;
    record.solid.castShadow = true;
    record.solid.receiveShadow = true;
    record.solid.matrixAutoUpdate = false;
    meshes.solid.add(record.solid);
  }
  if (!glow.empty) {
    record.glow = new THREE.Mesh(glow.toGeometry(), meshes.glowMaterial);
    record.glow.name = `glow-${ci}-${ck}`;
    record.glow.matrixAutoUpdate = false;
    meshes.glow.add(record.glow);
  }
  if (edgeMap.size > 0) {
    record.edges = buildEdgeLines(edgeMap, meshes.edgeMaterial, {
      x0,
      z0,
      x1,
      z1,
      sx: grid.sx,
      sz: grid.sz,
    } as any);
    record.edges.name = `voxel-edges-${ci}-${ck}`;
    meshes.edges.add(record.edges);
  }
  return record;
}

function stepMeshChunk(state: any, layers = 6) {
  const y1 = Math.min(state.y + layers, state.grid.sy);
  // Edges can be jointly owned by faces on opposite sides of a chunk plane.
  // The one-cell halo gathers that topology without duplicating surface
  // geometry; the ownership filter in finishMeshChunk assigns each edge once.
  meshRegion(
    state.grid,
    state.x0,
    state.z0,
    state.x1,
    state.z1,
    state.solid,
    state.glow,
    state.edgeMap,
    1,
    state.y,
    y1,
  );
  state.y = y1;
  return state.y === state.grid.sy ? finishMeshChunk(state) : null;
}

function buildMeshChunk(grid: any, ci: any, ck: any, meshes: any) {
  return stepMeshChunk(beginMeshChunk(grid, ci, ck, meshes), grid.sy);
}

const BLOCK_COLOR_FIELDS = new Set(['top', 'side', 'bottom', 'tint', 'topTint', 'fringeColor']);

/**
 * Content modules register some voxel materials after the base palette module
 * has loaded. Module workers have their own palette instance, so copy the
 * completed registry into the chunk mesher before it receives any work.
 */
function serializeBlockRegistry() {
  return BLOCK_BY_ID.filter(Boolean).map((block: any) => {
    const definition: Record<string, any> = {};
    for (const [key, value] of Object.entries(block)) {
      if (BLOCK_COLOR_FIELDS.has(key) && (value as any)?.isColor) {
        definition[key] = [(value as any).r, (value as any).g, (value as any).b];
      } else if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
        definition[key] = value;
      }
    }
    return definition;
  });
}

/** Worker entrypoint: install the main thread's completed content palette. */
export function installBlockRegistry(definitions: any[]) {
  for (const definition of definitions) {
    const block = { ...definition };
    for (const key of BLOCK_COLOR_FIELDS) {
      const value = definition[key];
      if (!value) continue;
      const color = new THREE.Color();
      // Values already use Three's linear working space. Assigning components
      // directly avoids applying an sRGB conversion a second time.
      [color.r, color.g, color.b] = value;
      block[key] = color;
    }
    BLOCK_BY_ID[block.id] = block;
  }
}

function serializeBufferGeometry(geometry: any) {
  const attributes: Record<string, any> = {};
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    attributes[name] = {
      array: (attribute as any).array,
      itemSize: (attribute as any).itemSize,
      normalized: (attribute as any).normalized,
    };
  }
  return {
    attributes,
    index: geometry.index
      ? {
          array: geometry.index.array,
          itemSize: geometry.index.itemSize,
          normalized: geometry.index.normalized,
        }
      : null,
  };
}

function restoreBufferGeometry(payload: any) {
  if (!payload) return null;
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(payload.attributes)) {
    geometry.setAttribute(
      name,
      new THREE.BufferAttribute((attribute as any).array, (attribute as any).itemSize, (attribute as any).normalized),
    );
  }
  if (payload.index) {
    geometry.setIndex(new THREE.BufferAttribute(payload.index.array, payload.index.itemSize, payload.index.normalized));
  }
  geometry.computeBoundingSphere();
  return geometry;
}

function serializeEdgeGeometry(edges: any) {
  if (!edges) return null;
  const geometry = edges.geometry;
  const start = geometry.getAttribute('instanceStart');
  const attribute = (name: string) => {
    const value = geometry.getAttribute(name);
    return {
      array: value.array,
      itemSize: value.itemSize,
      normalized: value.normalized,
    };
  };
  return {
    // LineSegmentsGeometry stores start/end interleaved in this one array.
    positions: start.data.array,
    normalA: attribute('instanceNormalA'),
    normalB: attribute('instanceNormalB'),
    light: attribute('instanceLightEligible'),
    roundCaps: attribute('instanceRoundCaps'),
  };
}

function restoreMeshChunk(payload: any, ci: any, ck: any, meshes: any) {
  const record: { solid: any; glow: any; edges: any } = { solid: null, glow: null, edges: null };
  const solidGeometry = restoreBufferGeometry(payload.solid);
  if (solidGeometry) {
    record.solid = new THREE.Mesh(solidGeometry, meshes.material);
    record.solid.name = `terrain-${ci}-${ck}`;
    record.solid.castShadow = true;
    record.solid.receiveShadow = true;
    record.solid.matrixAutoUpdate = false;
    meshes.solid.add(record.solid);
  }
  const glowGeometry = restoreBufferGeometry(payload.glow);
  if (glowGeometry) {
    record.glow = new THREE.Mesh(glowGeometry, meshes.glowMaterial);
    record.glow.name = `glow-${ci}-${ck}`;
    record.glow.matrixAutoUpdate = false;
    meshes.glow.add(record.glow);
  }
  if (payload.edges) {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(payload.edges.positions);
    const set = (name: string, data: any) =>
      geometry.setAttribute(name, new THREE.InstancedBufferAttribute(data.array, data.itemSize, data.normalized));
    set('instanceNormalA', payload.edges.normalA);
    set('instanceNormalB', payload.edges.normalB);
    set('instanceLightEligible', payload.edges.light);
    set('instanceRoundCaps', payload.edges.roundCaps);
    record.edges = new LineSegments2(geometry, meshes.edgeMaterial as any);
    record.edges.name = `voxel-edges-${ci}-${ck}`;
    record.edges.matrixAutoUpdate = false;
    prepareEdgeObject(record.edges);
    meshes.edges.add(record.edges);
  }
  return record;
}

function makeChunkWindow(grid: any, ci: any, ck: any, margin = 2) {
  const x0 = Math.max(0, ci * CHUNK - margin);
  const z0 = Math.max(0, ck * CHUNK - margin);
  const x1 = Math.min(grid.sx, (ci + 1) * CHUNK + margin);
  const z1 = Math.min(grid.sz, (ck + 1) * CHUNK + margin);
  const width = x1 - x0,
    depth = z1 - z0;
  const data = new Uint8Array(width * grid.sy * depth);
  let target = 0;
  for (let y = 0; y < grid.sy; y++) {
    for (let z = z0; z < z1; z++) {
      const source = grid.idx(x0, y, z);
      data.set(grid.data.subarray(source, source + width), target);
      target += width;
    }
  }
  return {
    ci,
    ck,
    sx: grid.sx,
    sy: grid.sy,
    sz: grid.sz,
    x0,
    z0,
    width,
    depth,
    data,
  };
}

/** Worker entrypoint: mesh one copied chunk window without DOM or WebGL. */
export function buildChunkTransferPayload(window: any) {
  const grid = {
    sx: window.sx,
    sy: window.sy,
    sz: window.sz,
    get(x: number, y: number, z: number) {
      if (
        x < window.x0 ||
        x >= window.x0 + window.width ||
        z < window.z0 ||
        z >= window.z0 + window.depth ||
        y < 0 ||
        y >= window.sy
      )
        return 0;
      return window.data[(y * window.depth + (z - window.z0)) * window.width + (x - window.x0)];
    },
    isSolid(x: number, y: number, z: number) {
      return this.get(x, y, z) !== 0;
    },
  };
  const meshes = createMeshRoots();
  const record = buildMeshChunk(grid, window.ci, window.ck, meshes);
  return {
    solid: record!.solid ? serializeBufferGeometry(record!.solid.geometry) : null,
    glow: record!.glow ? serializeBufferGeometry(record!.glow.geometry) : null,
    edges: serializeEdgeGeometry(record!.edges),
  };
}

function removeMeshChunk(meshes: any, record: any) {
  for (const [root, object] of [
    [meshes.solid, record.solid],
    [meshes.glow, record.glow],
    [meshes.edges, record.edges],
  ]) {
    if (!object) continue;
    root.remove(object);
    object.geometry.dispose();
  }
}

/**
 * Legacy eager builder. Kept for tools that explicitly request a complete
 * render mesh; gameplay uses createWorldChunkStreamer below.
 */
export function buildWorldMeshes(grid: any, { onProgress }: { onProgress?: (p: number) => void } = {}) {
  const meshes = createMeshRoots();

  const cx = Math.ceil(grid.sx / CHUNK);
  const cz = Math.ceil(grid.sz / CHUNK);
  const total = cx * cz;
  let done = 0;

  for (let ci = 0; ci < cx; ci++) {
    for (let ck = 0; ck < cz; ck++) {
      buildMeshChunk(grid, ci, ck, meshes);
      done++;
      if (onProgress) onProgress(done / total);
    }
  }

  return meshes;
}

/**
 * Keeps only the render geometry surrounding the camera/player corridor.
 * Collision, map queries and procedural data continue to use the full CPU
 * grid, so unloading a visual chunk can never change gameplay.
 */
export function createWorldChunkStreamer(grid: any, { loadRadius = DEFAULT_STREAM_RADIUS, unloadPadding = 1, wrapBuffer = 0, toroidalWrap = false } = {}) {
  const meshes = createMeshRoots();
  const chunksX = Math.ceil(grid.sx / CHUNK);
  const chunksZ = Math.ceil(grid.sz / CHUNK);
  const loaded = new Map<string, any>();
  const fadingMeshes = new Set<any>(); // only meshes actively fading in
  let loadQueue: any[] = [];
  let unloadQueue: string[] = [];
  let desiredLoadKeys = new Set<string>();
  let activeLoad: any = null;
  let meshWorker: Worker | null = null;
  let workerBusy: any = null;
  let viewKey = '';
  let idleHandle: any = null;
  let disposed = false;
  let currentLoadRadius = Math.max(1, loadRadius);
  const currentUnloadPadding = Math.max(1, unloadPadding);
  let lastPlayer: any = null;
  let lastCamera: any = null;

  if (typeof globalThis.Worker === 'function') {
    try {
      meshWorker = new Worker(new URL('./voxel-worker.ts', import.meta.url), {
        type: 'module',
        name: 'VoxelWorld-chunk-mesher',
      });
      // Worker messages are processed in order, so every subsequent chunk
      // sees the same runtime-registered materials as the main-thread preload.
      meshWorker.postMessage({
        type: 'block-registry',
        definitions: serializeBlockRegistry(),
      });
    } catch {
      meshWorker = null;
    }
  }

  const keyOf = (ci: any, ck: any) => `${ci},${ck}`;
  const frameYield = () => new Promise((resolve) => setTimeout(resolve, 0));

  /** Wire up per-chunk lodAlpha fade-in for a freshly built record. */
  const initChunkFade = (record: any) => {
    const uniforms = meshes.material.userData.uniforms;
    for (const mesh of [record.solid, record.glow]) {
      if (!mesh) continue;
      mesh.userData.lodAlpha = 0.0;
      mesh.userData.lodFading = true;
      fadingMeshes.add(mesh);
      mesh.onBeforeRender = () => {
        uniforms.uLodAlpha.value = mesh.userData.lodAlpha;
      };
      mesh.onAfterRender = () => {
        uniforms.uLodAlpha.value = 1.0;
      };
    }
    if (record.edges) {
      const edgeUniforms = (meshes.edgeMaterial as any).uniforms;
      const resolveCb = record.edges.onBeforeRender; // resolution callback from prepareEdgeObject
      record.edges.userData.lodAlpha = 0.0;
      record.edges.userData.lodFading = true;
      fadingMeshes.add(record.edges);
      record.edges.userData.resolveCb = resolveCb;
      record.edges.onBeforeRender = (renderer: any) => {
        resolveCb.call(record.edges, renderer);
        edgeUniforms.uLodAlpha.value = record.edges.userData.lodAlpha;
      };
      record.edges.onAfterRender = () => {
        edgeUniforms.uLodAlpha.value = 1.0;
      };
    }
  };

  const loadChunk = (ci: any, ck: any) => {
    const key = keyOf(ci, ck);
    if (loaded.has(key) || disposed) return;
    const record = buildMeshChunk(grid, ci, ck, meshes);
    initChunkFade(record);
    loaded.set(key, record);
  };

  const unloadChunk = (key: any) => {
    const record = loaded.get(key);
    if (!record) return;
    for (const mesh of [record.solid, record.glow, record.edges]) {
      if (mesh) fadingMeshes.delete(mesh);
    }
    removeMeshChunk(meshes, record);
    loaded.delete(key);
  };

  const drainUnloads = (limit: any) => {
    for (let i = 0; i < limit && unloadQueue.length; i++) {
      unloadChunk(unloadQueue.shift());
    }
  };

  const distanceToSegmentSq = (x: any, z: any, ax: any, az: any, bx: any, bz: any) => {
    const dx = bx - ax,
      dz = bz - az;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq > 0 ? THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / lengthSq, 0, 1) : 0;
    const px = ax + dx * t,
      pz = az + dz * t;
    const ox = x - px,
      oz = z - pz;
    return ox * ox + oz * oz;
  };

  const schedule = () => {
    const canLoad = meshWorker ? !workerBusy && loadQueue.length > 0 : Boolean(activeLoad || loadQueue.length);
    if (idleHandle !== null || disposed || (!canLoad && !unloadQueue.length)) return;
    if (typeof globalThis.requestIdleCallback === 'function') {
      idleHandle = globalThis.requestIdleCallback(pump, { timeout: 120 });
    } else {
      idleHandle = setTimeout(() => pump({ didTimeout: false, timeRemaining: () => 8 }), 0);
    }
  };

  const pump = (deadline: any) => {
    idleHandle = null;
    if (disposed) return;

    // Releasing stale buffers is cheap, but cap it so crossing a boundary
    // cannot turn one idle callback into a long garbage-collection spike.
    drainUnloads(3);

    if (meshWorker) {
      while (!workerBusy && loadQueue.length) {
        const next = loadQueue.shift();
        const key = keyOf(next.ci, next.ck);
        if (loaded.has(key) || !desiredLoadKeys.has(key)) continue;
        const window = makeChunkWindow(grid, next.ci, next.ck);
        workerBusy = { key, ci: next.ci, ck: next.ck };
        meshWorker.postMessage({ key, window }, [window.data.buffer]);
      }
      schedule();
      return;
    }

    // A timed-out idle callback still performs one small vertical slice, so a
    // busy 4k-shadow frame cannot starve a developer-requested radius change.
    // Genuine idle time can consume up to four slices without monopolising it.
    const maxSteps = deadline.didTimeout ? 1 : 4;
    for (let step = 0; step < maxSteps; step++) {
      if (!deadline.didTimeout && deadline.timeRemaining() <= 2) break;
      while (!activeLoad && loadQueue.length) {
        const next = loadQueue.shift();
        const key = keyOf(next.ci, next.ck);
        if (loaded.has(key) || !desiredLoadKeys.has(key)) continue;
        activeLoad = { key, state: beginMeshChunk(grid, next.ci, next.ck, meshes) };
      }
      if (!activeLoad) break;
      const record = stepMeshChunk(activeLoad.state);
      if (record) {
        initChunkFade(record);
        loaded.set(activeLoad.key, record);
        activeLoad = null;
      }
    }
    schedule();
  };

  const disableWorker = () => {
    const interrupted = workerBusy;
    meshWorker?.terminate();
    meshWorker = null;
    workerBusy = null;
    if (interrupted && desiredLoadKeys.has(interrupted.key)) {
      loadQueue.unshift({ ci: interrupted.ci, ck: interrupted.ck, distanceSq: 0 });
    }
    schedule();
  };

  if (meshWorker) {
    meshWorker.onmessage = ({ data }) => {
      const completed = workerBusy;
      workerBusy = null;
      if (data.error) {
        if (completed && desiredLoadKeys.has(completed.key)) {
          loadQueue.unshift({
            ci: completed.ci,
            ck: completed.ck,
            distanceSq: 0,
          });
        }
        meshWorker!.terminate();
        meshWorker = null;
      } else if (completed?.key === data.key && desiredLoadKeys.has(data.key) && !loaded.has(data.key)) {
        const record = restoreMeshChunk(data.payload, data.ci, data.ck, meshes);
        initChunkFade(record);
        loaded.set(data.key, record);
      }
      schedule();
    };
    meshWorker.onerror = disableWorker;
  }

  const update = (player: any, camera = player, trimToRadius = false, dt = 0) => {
    if (disposed || !player) return;
    // Advance LOD fade-in for newly loaded chunks.
    // Only meshes actively fading are in fadingMeshes, so this is O(fading) not O(all loaded).
    if (dt > 0 && fadingMeshes.size > 0) {
      for (const mesh of fadingMeshes) {
        mesh.userData.lodAlpha = Math.min(1.0, mesh.userData.lodAlpha + dt * 1.5);
        if (mesh.userData.lodAlpha >= 1.0) {
          mesh.userData.lodFading = false;
          mesh.onBeforeRender = mesh.userData.resolveCb ?? (() => {});
          mesh.onAfterRender = () => {};
          fadingMeshes.delete(mesh);
        }
      }
    }
    // Unloading is intentionally frame-driven rather than idle-driven. A busy
    // GPU can starve requestIdleCallback, but stale GPU buffers must still be
    // released promptly as the player crosses the world.
    drainUnloads(4);
    const ax = player.x,
      az = player.z;
    const bx = camera?.x ?? ax,
      bz = camera?.z ?? az;
    lastPlayer = { x: ax, z: az };
    lastCamera = { x: bx, z: bz };
    const nextViewKey = [
      Math.floor(ax / CHUNK),
      Math.floor(az / CHUNK),
      Math.floor(bx / CHUNK),
      Math.floor(bz / CHUNK),
    ].join(',');
    if (nextViewKey === viewKey) return;
    viewKey = nextViewKey;

    const desired = [];
    const keep = new Set();
    const loadMargin = currentLoadRadius * CHUNK;
    const unloadMargin = (currentLoadRadius + currentUnloadPadding) * CHUNK;
    const loadSq = loadMargin * loadMargin;
    const unloadSq = (trimToRadius ? loadMargin : unloadMargin) ** 2;

    // Toroidal pre-loading: when the player is within the stream radius of a
    // world edge, also evaluate chunk distances from the ±worldSize-shifted
    // "ghost" positions. This is equivalent to computing wrapped distance on a
    // torus and ensures the opposite-side chunks are loaded before the modulo
    // wrap fires.
    const mirrorOffsets: [number, number][] = [[0, 0]];
    if (toroidalWrap) {
      const Sx = grid.sx, Sz = grid.sz;
      mirrorOffsets.push([Sx, 0], [-Sx, 0], [0, Sz], [0, -Sz]);
    }

    for (let ci = 0; ci < chunksX; ci++) {
      const x = Math.min((ci + 0.5) * CHUNK, grid.sx);
      for (let ck = 0; ck < chunksZ; ck++) {
        const z = Math.min((ck + 0.5) * CHUNK, grid.sz);
        let distanceSq = Infinity;
        for (const [dx, dz] of mirrorOffsets) {
          const d = distanceToSegmentSq(x, z, ax + dx, az + dz, bx + dx, bz + dz);
          if (d < distanceSq) distanceSq = d;
        }
        const key = keyOf(ci, ck);
        if (distanceSq <= unloadSq) keep.add(key);
        if (distanceSq <= loadSq && !loaded.has(key)) {
          desired.push({ ci, ck, distanceSq });
        }
      }
    }

    desired.sort((a, b) => a.distanceSq - b.distanceSq);
    loadQueue = desired;
    desiredLoadKeys = new Set(desired.map(({ ci, ck }) => keyOf(ci, ck)));
    if (activeLoad && !desiredLoadKeys.has(activeLoad.key)) activeLoad = null;
    unloadQueue = [...loaded.keys()].filter((key) => !keep.has(key));
    schedule();
  };

  const setLoadRadius = (radius: any) => {
    const next = THREE.MathUtils.clamp(Math.round(radius), 1, 16);
    if (next === currentLoadRadius) return;
    currentLoadRadius = next;
    // The view position has not changed, but both desired sets have. Force a
    // fresh queue immediately so the developer control is genuinely live.
    viewKey = '';
    if (lastPlayer) update(lastPlayer, lastCamera, true);
  };

  const preload = async (
    position: any,
    { radius = 2, onProgress }: { radius?: number; onProgress?: (p: number) => void } = {},
  ) => {
    const centerI = THREE.MathUtils.clamp(Math.floor(position.x / CHUNK), 0, chunksX - 1);
    const centerK = THREE.MathUtils.clamp(Math.floor(position.z / CHUNK), 0, chunksZ - 1);
    const initial = [];
    for (let di = -radius; di <= radius; di++) {
      for (let dk = -radius; dk <= radius; dk++) {
        const ci = centerI + di,
          ck = centerK + dk;
        if (ci < 0 || ck < 0 || ci >= chunksX || ck >= chunksZ) continue;
        if (di * di + dk * dk > radius * radius) continue;
        initial.push({ ci, ck, distanceSq: di * di + dk * dk });
      }
    }
    initial.sort((a, b) => a.distanceSq - b.distanceSq);
    for (let i = 0; i < initial.length; i++) {
      loadChunk(initial[i].ci, initial[i].ck);
      // Preloaded spawn chunks appear fully opaque immediately — no screen-door on start.
      const record = loaded.get(keyOf(initial[i].ci, initial[i].ck));
      if (record) {
        for (const mesh of [record.solid, record.glow, record.edges]) {
          if (!mesh) continue;
          mesh.userData.lodAlpha = 1.0;
          mesh.userData.lodFading = false;
        }
      }
      onProgress?.((i + 1) / initial.length);
      await frameYield();
    }
  };

  const dispose = () => {
    disposed = true;
    activeLoad = null;
    workerBusy = null;
    meshWorker?.terminate();
    meshWorker = null;
    if (idleHandle !== null) {
      if (typeof globalThis.cancelIdleCallback === 'function') {
        globalThis.cancelIdleCallback(idleHandle);
      } else {
        clearTimeout(idleHandle);
      }
      idleHandle = null;
    }
    for (const key of [...loaded.keys()]) unloadChunk(key);
    meshes.material.dispose();
    meshes.glowMaterial.dispose();
    meshes.edgeMaterial.dispose();
  };

  const invalidateAll = () => {
    // Unload every loaded chunk so they get re-meshed with the current block registry.
    for (const key of [...loaded.keys()]) unloadChunk(key);
    viewKey = ''; // force update() to re-queue everything
    if (lastPlayer) update(lastPlayer, lastCamera);
    // Push the updated block registry to the worker if one is running.
    if (meshWorker) {
      meshWorker.postMessage({ type: 'block-registry', definitions: serializeBlockRegistry() });
    }
  };

  return {
    meshes,
    update,
    setLoadRadius,
    preload,
    dispose,
    invalidateAll,
    /** Planet-bend uniforms for the terrain material — update each frame. */
    get planetUnis() {
      return meshes.material.userData.uniforms;
    },
    get loadRadius() {
      return currentLoadRadius;
    },
    get loadedCount() {
      return loaded.size;
    },
    get pendingCount() {
      return loadQueue.length + unloadQueue.length + (activeLoad ? 1 : 0) + (workerBusy ? 1 : 0);
    },
  };
}

function meshRegion(
  grid: any,
  x0: any,
  z0: any,
  x1: any,
  z1: any,
  solid: any,
  glow: any,
  edgeMap: any,
  edgeHalo = 0,
  y0 = 0,
  y1 = grid.sy,
) {
  const aoOf = (occ: any) => {
    // occ = [side1, side2, corner] booleans
    if (occ[0] && occ[1]) return 0;
    return (3 - (occ[0] + occ[1] + occ[2])) / 3;
  };

  const ao = new Array(4);
  const localV = new Array(4);
  const uvs = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  const verts = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  const scanX0 = Math.max(0, x0 - edgeHalo);
  const scanZ0 = Math.max(0, z0 - edgeHalo);
  const scanX1 = Math.min(grid.sx, x1 + edgeHalo);
  const scanZ1 = Math.min(grid.sz, z1 + edgeHalo);

  for (let y = y0; y < y1; y++) {
    for (let z = scanZ0; z < scanZ1; z++) {
      for (let x = scanX0; x < scanX1; x++) {
        const id = grid.get(x, y, z);
        if (id === 0) continue;
        const block = BLOCK_BY_ID[id];
        if (!block) continue;
        const target = block.emissive ? glow : solid;
        const emitGeometry = x >= x0 && x < x1 && z >= z0 && z < z1;

        for (let f = 0; f < 6; f++) {
          const F = FACES[f];
          const nx = x + F.n[0],
            ny = y + F.n[1],
            nz = z + F.n[2];
          if (grid.isSolid(nx, ny, nz)) continue;

          const isTop = F.n[1] === 1;
          const isBottom = F.n[1] === -1;
          const baseCol = isTop ? block.top : isBottom ? block.bottom || block.side : block.side;
          const pattern = isTop ? (block.topPattern ?? block.pattern) : block.pattern;
          const tintCol = (isTop ? block.topTint || block.tint : block.tint) || baseCol;
          const fringeCol = block.fringeColor || block.top || baseCol;

          const uA = AXIS_VEC[F.uAxis],
            vA = AXIS_VEC[F.vAxis];

          /**
           * Which of this face's four borders are REAL cube edges.
           *
           * Two adjacent grass blocks on a flat shelf both emit a top face,
           * and the seam between them is not an edge at all — it is the middle
           * of a continuous surface. Inking every quad border would engrave
           * a waffle grid across every lawn. A border is only a genuine convex
           * edge when the in-plane neighbour block is absent. These masks now
           * feed the explicit shared edge graph; they are never painted into
           * an individual face.
           */
          let convexMask = 0,
            concaveMask = 0;
          {
            const dirs = [
              [-uA[0], -uA[1], -uA[2], 1],
              [uA[0], uA[1], uA[2], 2],
              [-vA[0], -vA[1], -vA[2], 4],
              [vA[0], vA[1], vA[2], 8],
            ];
            for (const [dx, dy, dz, bit] of dirs) {
              if (!grid.isSolid(x + dx, y + dy, z + dz)) {
                // nothing beside us: an outer corner of the solid
                convexMask |= bit;
              } else if (grid.isSolid(x + dx + F.n[0], y + dy + F.n[1], z + dz + F.n[2])) {
                // neighbour is there AND it rises in front of this face:
                // an inner corner, where the surface folds back on itself
                concaveMask |= bit;
              }
              // otherwise the neighbour's face continues ours — a flat seam,
              // which is not an edge and must never be drawn.
            }
          }

          const forceLightEdge = isTop && block.lightEdge === true;
          collectFaceEdges(edgeMap, x, y, z, F, convexMask, baseCol, false, forceLightEdge);
          collectFaceEdges(edgeMap, x, y, z, F, concaveMask, baseCol, true, forceLightEdge);

          if (!emitGeometry) continue;

          for (let i = 0; i < 4; i++) {
            const c = F.corners[i];
            verts[i][0] = x + c[0];
            verts[i][1] = y + c[1];
            verts[i][2] = z + c[2];

            // AO: sample the two in-plane neighbours and the diagonal, all in
            // the layer of air directly in front of this face.
            const su = c[F.uAxis] === 1 ? 1 : -1;
            const sv = c[F.vAxis] === 1 ? 1 : -1;
            const s1 = grid.isSolid(nx + uA[0] * su, ny + uA[1] * su, nz + uA[2] * su);
            const s2 = grid.isSolid(nx + vA[0] * sv, ny + vA[1] * sv, nz + vA[2] * sv);
            const cn = grid.isSolid(
              nx + uA[0] * su + vA[0] * sv,
              ny + uA[1] * su + vA[1] * sv,
              nz + uA[2] * su + vA[2] * sv,
            );
            ao[i] = aoOf([s1, s2, cn]);

            // World-space UVs so patterns tile across block seams.
            uvs[i][0] = verts[i][F.uAxis];
            uvs[i][1] = verts[i][F.vAxis];
            // Local height within THIS block, for the grass fringe.
            localV[i] = isTop ? 1 : isBottom ? 0 : c[1];
          }

          // Bit 3 of the pattern byte signals wind sway; mod(aData.y, 8) in the frag shader strips it.
          const patternPacked = (pattern || 0) | (block.sway ? 8 : 0);
          target.quad(verts, F.n, baseCol, tintCol, fringeCol, uvs, ao, patternPacked, block.fringe || 0, localV);
        }
      }
    }
  }
}

/* ================================================================== *
 * Explicit voxel edges
 * ================================================================== */

/** Intrinsic sRGB luminance at which a face belongs to the pale palette. */
const LIGHT_FACE_LUMA = 0.61;
const faceLightCache = new WeakMap();

function isLightFace(color: any) {
  const cached = faceLightCache.get(color);
  if (cached !== undefined) return cached;
  const hex = color.getHex(THREE.SRGBColorSpace);
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const light = r * 0.2126 + g * 0.7152 + b * 0.0722 >= LIGHT_FACE_LUMA;
  faceLightCache.set(color, light);
  return light;
}

function pointOrder(a: any, b: any) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/** Add one face's ownership of a unit edge, deduplicated across both faces. */
function addEdgeFace(edgeMap: any, p0: any, p1: any, normal: any, light: any, concave: any, forceLight: any) {
  let start = p0,
    end = p1;
  if (pointOrder(start, end) > 0) [start, end] = [end, start];
  const key = `${start.join(',')}|${end.join(',')}`;
  let edge = edgeMap.get(key);
  if (!edge) {
    edge = { start, end, faces: [], concave: false };
    edgeMap.set(key, edge);
  }
  // If either owning face identifies this as an inward fold, the shared edge
  // is concave. Concave edges always use the dark ink.
  edge.concave ||= concave;

  const normalKey = normal.join(',');
  const existing = edge.faces.find((face: any) => face.key === normalKey);
  if (existing) {
    // A material boundary can contribute the same plane twice. Be
    // conservative: both contributors must be pale for the face to be pale.
    existing.light = existing.light && light;
    existing.forceLight ||= forceLight;
  } else {
    edge.faces.push({ key: normalKey, normal: [...normal], light, forceLight });
  }
}

function collectFaceEdges(
  edgeMap: any,
  x: any,
  y: any,
  z: any,
  face: any,
  mask: any,
  color: any,
  concave: any,
  forceLight = false,
) {
  if (mask === 0) return;
  const borders = [
    [1, face.uAxis, 0],
    [2, face.uAxis, 1],
    [4, face.vAxis, 0],
    [8, face.vAxis, 1],
  ];
  const light = isLightFace(color);

  for (const [bit, axis, value] of borders) {
    if ((mask & bit) === 0) continue;
    const corners = face.corners.filter((corner: any) => corner[axis] === value);
    const p0 = [x + corners[0][0], y + corners[0][1], z + corners[0][2]];
    const p1 = [x + corners[1][0], y + corners[1][1], z + corners[1][2]];
    addEdgeFace(edgeMap, p0, p1, face.n, light, concave, forceLight);
  }
}

/** Merge adjacent unit edges with identical topology into clean long runs. */
function mergeEdgeRuns(edgeMap: any) {
  const groups = new Map();

  for (const edge of edgeMap.values()) {
    const faces = [...edge.faces].sort((a, b) => a.key.localeCompare(b.key));
    const normalA = faces[0]?.normal || [0, 0, 0];
    const normalB = faces[1]?.normal || [0, 0, 0];
    // A grass top explicitly promotes its convex perimeter to the light ink;
    // otherwise both owning faces must belong to the pale palette. Concave
    // and non-manifold connections remain dark without exception.
    const light =
      faces.length === 2 &&
      !edge.concave &&
      ((faces[0].light && faces[1].light) || faces.some((face) => face.forceLight));
    const axis = edge.start.findIndex((value: any, i: any) => value !== edge.end[i]);
    const fixed = edge.start.filter((_: any, i: any) => i !== axis);
    const style = `${axis}|${fixed.join(',')}|${normalA.join(',')}|${normalB.join(',')}|${light ? 1 : 0}`;
    let group = groups.get(style);
    if (!group) {
      group = { axis, fixed, normalA, normalB, light, units: [] };
      groups.set(style, group);
    }
    group.units.push([edge.start[axis], edge.end[axis]]);
  }

  const runs: any[] = [];
  for (const group of groups.values()) {
    group.units.sort((a: any, b: any) => a[0] - b[0]);
    let start = group.units[0][0];
    let end = group.units[0][1];
    const push = () => {
      const p0 = [0, 0, 0],
        p1 = [0, 0, 0];
      let f = 0;
      for (let axis = 0; axis < 3; axis++) {
        if (axis === group.axis) {
          p0[axis] = start;
          p1[axis] = end;
        } else {
          p0[axis] = p1[axis] = group.fixed[f++];
        }
      }
      runs.push({ ...group, start: p0, end: p1 });
    };

    for (let i = 1; i < group.units.length; i++) {
      const unit = group.units[i];
      if (unit[0] === end) {
        end = unit[1];
      } else {
        push();
        start = unit[0];
        end = unit[1];
      }
    }
    push();
  }

  // A round cap is normally what closes small cracks where several runs meet.
  // At a mixed-colour joint, however, a dark cap protrudes half a stroke past
  // the vertex and visibly bites into the pale run. Give the pale run ownership
  // of that joint and terminate every incident dark run at the vertex plane.
  const joints = new Map();
  const addJoint = (run: any, cap: any) => {
    const point = cap === 'roundStart' ? run.start : run.end;
    const key = point.join(',');
    let joint = joints.get(key);
    if (!joint) {
      joint = [];
      joints.set(key, joint);
    }
    joint.push({ run, cap });
  };
  for (const run of runs) {
    run.roundStart = true;
    run.roundEnd = true;
    addJoint(run, 'roundStart');
    addJoint(run, 'roundEnd');
  }
  for (const joint of joints.values()) {
    if (!joint.some(({ run }: any) => run.light)) continue;
    for (const { run, cap } of joint) {
      if (!run.light) run[cap] = false;
    }
  }
  return runs;
}

function makeEdgeMaterial() {
  const CORE_WIDTH = 0.7;
  const AA_PAD = 0.8;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      resolution: { value: new THREE.Vector2(1, 1) },
      // The geometry extends past the visible stroke so the fragment shader
      // has a full pixel in which to resolve analytic coverage.
      linewidth: { value: CORE_WIDTH + AA_PAD * 2.0 },
      uCoreWidth: { value: CORE_WIDTH },
      uFogDensity: { value: 0.0 },
      uWaterLevel: { value: WATER.level },
      /** How much of a stroke survives below the waterline. */
      uSubmergedInk: { value: 0.0 },
      uMistBase: { value: 6.0 },
      uMistH: { value: 8.0 },
      uMistDens: { value: 0.022 },
      uMistMax: { value: 0.55 },
      tSceneDepth: { value: null },
      uLodAlpha: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      uniform vec2 resolution;
      uniform float linewidth;
      uniform float uFogDensity;
      uniform float uMistBase, uMistH, uMistDens, uMistMax;

      attribute vec3 instanceStart;
      attribute vec3 instanceEnd;
      attribute vec3 instanceNormalA;
      attribute vec3 instanceNormalB;
      attribute float instanceLightEligible;
      attribute vec2 instanceRoundCaps;

      // These are constant for every vertex of an edge instance. Measuring
      // against them in framebuffer pixels avoids all perspective-varying
      // interpolation, so camera distance cannot affect stroke width.
      varying vec2 vScreenStart;
      varying vec2 vScreenEnd;
      varying float vWindowDepthStart;
      varying float vWindowDepthEnd;
      varying float vLightEdge;
      varying float vFogVisibility;
      varying vec2 vRoundCaps;
      varying float vEdgeY;

      float trimSegmentAlpha(vec4 start, vec4 end) {
        float a = projectionMatrix[2][2];
        float b = projectionMatrix[3][2];
        float nearEstimate = a > 0.0 ? -b / (a + 1.0) : -0.5 * b / a;
        return (nearEstimate - start.z) / (end.z - start.z);
      }

      float heightAverage(float y0, float y1) {
        float a = clamp((y0 - uMistBase) / uMistH, -4.0, 20.0);
        float b = clamp((y1 - uMistBase) / uMistH, -4.0, 20.0);
        if (abs(b - a) < 0.02) return exp(-a);
        return (exp(-a) - exp(-b)) / (b - a);
      }

      void main() {
        vec4 start = modelViewMatrix * vec4(instanceStart, 1.0);
        vec4 end = modelViewMatrix * vec4(instanceEnd, 1.0);

        bool perspective = projectionMatrix[2][3] == -1.0;
        if (perspective) {
          if (start.z < 0.0 && end.z >= 0.0) {
            end.xyz = mix(start.xyz, end.xyz, trimSegmentAlpha(start, end));
          } else if (end.z < 0.0 && start.z >= 0.0) {
            start.xyz = mix(end.xyz, start.xyz, trimSegmentAlpha(end, start));
          }
        }

        vec4 clipStart = projectionMatrix * start;
        vec4 clipEnd = projectionMatrix * end;
        vec2 ndcStart = clipStart.xy / clipStart.w;
        vec2 ndcEnd = clipEnd.xy / clipEnd.w;
        vScreenStart = (ndcStart * 0.5 + 0.5) * resolution;
        vScreenEnd = (ndcEnd * 0.5 + 0.5) * resolution;
        vWindowDepthStart = clipStart.z / clipStart.w * 0.5 + 0.5;
        vWindowDepthEnd = clipEnd.z / clipEnd.w * 0.5 + 0.5;
        vRoundCaps = instanceRoundCaps;

        float aspect = resolution.x / resolution.y;
        vec2 dir = ndcEnd - ndcStart;
        dir.x *= aspect;
        dir = length(dir) > 1e-7 ? normalize(dir) : vec2(1.0, 0.0);

        vec2 offset = vec2(dir.y, -dir.x);
        dir.x /= aspect;
        offset.x /= aspect;
        if (position.x < 0.0) offset *= -1.0;
        if (position.y < 0.0) offset -= dir;
        else if (position.y > 1.0) offset += dir;

        offset *= linewidth / resolution.y;
        vec4 clip = position.y < 0.5 ? clipStart : clipEnd;
        clip.xy += offset * clip.w;
        gl_Position = clip;

        // A short transition at grazing angles prevents a one-frame colour
        // pop as the camera rotates across a face plane.
        float frontA = smoothstep(0.0, 0.08,
                                  (normalMatrix * instanceNormalA).z);
        float frontB = smoothstep(0.0, 0.08,
                                  (normalMatrix * instanceNormalB).z);
        vLightEdge = instanceLightEligible * frontA * frontB;

        float fogDepth = -(position.y < 0.5 ? start.z : end.z);
        float fogTerm = uFogDensity * max(fogDepth, 0.0);
        float aerialVisibility = exp(-fogTerm * fogTerm);
        // Through the model matrix, not raw: the world edge mesh sits at the
        // origin so the two agree there, but a character part's endpoints are
        // local to an animated node, and reading them as world coordinates put
        // the figure hundreds of units away and let the mist eat its outline.
        vec3 edgeWorld = (modelMatrix * vec4(
          position.y < 0.5 ? instanceStart : instanceEnd, 1.0)).xyz;
        vEdgeY = edgeWorld.y;
        float worldDistance = distance(cameraPosition, edgeWorld);
        float mist = 1.0 - exp(-uMistDens * worldDistance
                              * heightAverage(cameraPosition.y, edgeWorld.y));
        mist = clamp(mist, 0.0, 1.0) * uMistMax;
        vFogVisibility = aerialVisibility * (1.0 - mist);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSceneDepth;
      uniform vec2 resolution;
      uniform float uCoreWidth;
      uniform float uLodAlpha;

      varying vec2 vScreenStart;
      varying vec2 vScreenEnd;
      varying float vWindowDepthStart;
      varying float vWindowDepthEnd;
      varying float vLightEdge;
      varying float vFogVisibility;
      varying vec2 vRoundCaps;
      varying float vEdgeY;
      uniform float uWaterLevel, uSubmergedInk;

      void main() {
        // Exact framebuffer-pixel distance to the projected segment. Most
        // ends are round; dark runs use a butt cap where a pale run owns the
        // shared joint. The SDF contains no world-space or camera-distance
        // term, so both cap shape and stroke width remain stable at any zoom.
        vec2 segment = vScreenEnd - vScreenStart;
        float segmentLengthSq = max(dot(segment, segment), 1e-4);
        float segmentLength = sqrt(segmentLengthSq);
        float alongPx = dot(gl_FragCoord.xy - vScreenStart, segment)
                        / segmentLength;
        float along = clamp(alongPx / segmentLength, 0.0, 1.0);
        vec2 nearest = vScreenStart + segment * along;

        // Visibility belongs to the mathematical edge centerline, not to the
        // expanded coverage quad. A fixed-function depth test compares every
        // fragment of that quad against a sloping owner face; close to the
        // camera the face then clips away most of its own outline. Sample the
        // populated scene depth on both sides of the centerline instead. A
        // genuinely nearer object wins at all three samples, while either
        // owning face is enough to keep the full-width stroke visible.
        vec2 lineDirection = segment / segmentLength;
        vec2 lineNormal = vec2(-lineDirection.y, lineDirection.x);
        vec2 depthUv = nearest / resolution;
        vec2 depthStep = lineNormal * 0.75 / resolution;
        float sceneDepth = texture2D(tSceneDepth, depthUv).x;
        sceneDepth = max(sceneDepth,
                         texture2D(tSceneDepth, depthUv + depthStep).x);
        sceneDepth = max(sceneDepth,
                         texture2D(tSceneDepth, depthUv - depthStep).x);
        float edgeDepth = mix(vWindowDepthStart, vWindowDepthEnd, along);
        float alongDepthSlope = abs(vWindowDepthEnd - vWindowDepthStart)
                                / max(length(segment), 1.0);
        // Fixed bias covers near-edge precision; distance term scales with
        // edgeDepth² to compensate for the depth buffer's non-linear precision
        // loss at large view distances (near=0.1, far=6000 compresses most
        // precision into the first few units).
        float depthBias = 2e-5 + alongDepthSlope + edgeDepth * edgeDepth * 1e-5;
        if (edgeDepth > sceneDepth + depthBias) discard;

        float halfWidth = uCoreWidth * 0.5;
        float acrossPx = dot(gl_FragCoord.xy - vScreenStart, lineNormal);
        float signedDistance = abs(acrossPx) - halfWidth;
        if (alongPx < 0.0) {
          signedDistance = vRoundCaps.x > 0.5
            ? length(vec2(alongPx, acrossPx)) - halfWidth
            : max(signedDistance, -alongPx);
        } else if (alongPx > segmentLength) {
          float beyondEnd = alongPx - segmentLength;
          signedDistance = vRoundCaps.y > 0.5
            ? length(vec2(beyondEnd, acrossPx)) - halfWidth
            : max(signedDistance, beyondEnd);
        }
        float aa = max(fwidth(signedDistance) * 0.65, 0.50);
        float coverage = 1.0 - smoothstep(-aa, aa, signedDistance);
        coverage *= clamp(vFogVisibility, 0.0, 1.0);
        coverage *= uLodAlpha;
        /* A hard stop at the surface, not a ramp.
         *
         * Fading over a depth left every vertical edge trailing off into the
         * water, and a stroke that dims along its length reads as a smudge
         * rather than as a line that ends. Cutting it clean lets the water's
         * own dark waterline become the terminator instead.
         *
         * The only softness is one pixel of antialiasing, taken from the
         * screen-space rate of change of height so the cut stays a single
         * pixel at any distance rather than a fixed slab of world space. */
        float waterAa = max(fwidth(vEdgeY) * 0.5, 1e-5);
        float aboveWater = smoothstep(uWaterLevel - waterAa,
                                      uWaterLevel + waterAa, vEdgeY);
        coverage *= mix(uSubmergedInk, 1.0, aboveWater);
        if (coverage <= 0.001) discard;

        float light = clamp(vLightEdge, 0.0, 1.0);
        gl_FragColor = vec4(coverage * (1.0 - light),
                            coverage * light,
                            0.0,
                            coverage);
      }
    `,
    // Hidden-line removal is performed against the already-rendered scene
    // depth at the edge centerline. Fixed-function testing would let sloping
    // owner faces cut a zoom-dependent amount from the coverage quad.
    depthTest: false,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.MaxEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
    extensions: { derivatives: true } as any,
  });

  // Preserve the small public surface used by settings and LineSegments2,
  // while keeping the authored width separate from the invisible AA skirt.
  let coreWidth = CORE_WIDTH;
  let pixelRatio = 1.0;
  const syncPhysicalWidth = () => {
    const physicalWidth = coreWidth * pixelRatio;
    material.uniforms.uCoreWidth.value = physicalWidth;
    material.uniforms.linewidth.value = physicalWidth + AA_PAD * 2.0;
  };
  Object.defineProperties(material, {
    linewidth: {
      get: () => coreWidth,
      set: (value) => {
        coreWidth = Math.max(0.35, value);
        syncPhysicalWidth();
      },
    },
    resolution: {
      get: () => material.uniforms.resolution.value,
    },
  });
  (material as any).worldUnits = false;
  material.userData.setPixelRatio = (value: any) => {
    const next = Math.max(0.25, value || 1.0);
    if (next === pixelRatio) return;
    pixelRatio = next;
    syncPhysicalWidth();
  };
  return material;
}

function buildEdgeLines(edgeMap: any, material = makeEdgeMaterial(), chunkBounds: any = null) {
  const runs = mergeEdgeRuns(edgeMap);

  if (chunkBounds) {
    // Runs parallel to a chunk axis continue in the neighbouring chunk. A
    // flat endpoint lets the two analytic strokes meet at the exact vertex;
    // round caps would overlap there and create a dark bead at every seam.
    for (const run of runs) {
      if (run.axis === 0) {
        if (chunkBounds.x0 > 0 && run.start[0] === chunkBounds.x0) run.roundStart = false;
        if (chunkBounds.x1 < chunkBounds.sx && run.end[0] === chunkBounds.x1) run.roundEnd = false;
      } else if (run.axis === 2) {
        if (chunkBounds.z0 > 0 && run.start[2] === chunkBounds.z0) run.roundStart = false;
        if (chunkBounds.z1 < chunkBounds.sz && run.end[2] === chunkBounds.z1) run.roundEnd = false;
      }
    }
  }

  const positions = new Float32Array(runs.length * 6);
  const normalsA = new Int8Array(runs.length * 3);
  const normalsB = new Int8Array(runs.length * 3);
  const light = new Uint8Array(runs.length);
  const roundCaps = new Uint8Array(runs.length * 2);

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    positions.set([...run.start, ...run.end], i * 6);
    for (let axis = 0; axis < 3; axis++) {
      normalsA[i * 3 + axis] = run.normalA[axis] * 127;
      normalsB[i * 3 + axis] = run.normalB[axis] * 127;
    }
    light[i] = run.light ? 255 : 0;
    roundCaps[i * 2] = run.roundStart ? 255 : 0;
    roundCaps[i * 2 + 1] = run.roundEnd ? 255 : 0;
  }

  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  geometry.setAttribute('instanceNormalA', new THREE.InstancedBufferAttribute(normalsA, 3, true));
  geometry.setAttribute('instanceNormalB', new THREE.InstancedBufferAttribute(normalsB, 3, true));
  geometry.setAttribute('instanceLightEligible', new THREE.InstancedBufferAttribute(light, 1, true));
  geometry.setAttribute('instanceRoundCaps', new THREE.InstancedBufferAttribute(roundCaps, 2, true));

  const edges = new LineSegments2(geometry, material as any);
  edges.name = 'voxel-edges';
  edges.matrixAutoUpdate = false;
  prepareEdgeObject(edges);
  return edges;
}

/**
 * Shared setup for anything that draws into the edge mask.
 *
 * The layer is what keeps these strokes out of the beauty pass: the scene
 * camera only ever looks at layer 0, and the edge pass flips to EDGE_LAYER for
 * the one render that consumes them. Living in the main scene rather than in a
 * private one is what lets an edge object be parented to an animated node and
 * still arrive with a correct world matrix.
 */
function prepareEdgeObject(edges: any) {
  edges.castShadow = false;
  edges.receiveShadow = false;
  edges.renderOrder = 2;
  edges.layers.set(EDGE_LAYER);
  // LineSegments2's default callback reports the renderer's logical viewport,
  // not the active offscreen target. Use the physical target viewport so the
  // SDF and gl_FragCoord stay in the same pixel coordinate system at any DPR.
  const edgeViewport = new THREE.Vector4();
  edges.onBeforeRender = (renderer: any) => {
    renderer.getCurrentViewport(edgeViewport);
    edges.material.resolution.set(edgeViewport.z, edgeViewport.w);
  };
  return edges;
}

/**
 * The twelve edges of an axis-aligned box, ready to parent to the mesh it
 * outlines. Used for the character, whose parts are animated boxes rather than
 * voxels — the same material, so its strokes obey exactly the same width,
 * hidden-line and pale/dark rules as the world's.
 *
 * Every edge of a box is convex and both its faces carry the same colour, so
 * eligibility is decided once for the whole box; the shader still withholds
 * the pale ink per frame unless both faces face the camera.
 */
export function createBoxEdges(width: any, height: any, depth: any, color: any, material: any) {
  const h = [width * 0.5, height * 0.5, depth * 0.5];
  const positions = [];
  const normalsA = [];
  const normalsB = [];

  // For each axis, the four edges running along it sit at the corners of the
  // other two, and are shared by one face from each of those two axes.
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3,
      v = (axis + 2) % 3;
    for (const su of [-1, 1]) {
      for (const sv of [-1, 1]) {
        const p0 = [0, 0, 0],
          p1 = [0, 0, 0];
        const nA = [0, 0, 0],
          nB = [0, 0, 0];
        p0[axis] = -h[axis];
        p1[axis] = h[axis];
        p0[u] = p1[u] = su * h[u];
        p0[v] = p1[v] = sv * h[v];
        nA[u] = su;
        nB[v] = sv;
        positions.push(...p0, ...p1);
        normalsA.push(...nA);
        normalsB.push(...nB);
      }
    }
  }

  const count = positions.length / 6;
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(new Float32Array(positions));
  geometry.setAttribute(
    'instanceNormalA',
    new THREE.InstancedBufferAttribute(
      Int8Array.from(normalsA, (n) => n * 127),
      3,
      true,
    ),
  );
  geometry.setAttribute(
    'instanceNormalB',
    new THREE.InstancedBufferAttribute(
      Int8Array.from(normalsB, (n) => n * 127),
      3,
      true,
    ),
  );
  geometry.setAttribute(
    'instanceLightEligible',
    new THREE.InstancedBufferAttribute(new Uint8Array(count).fill(isLightFace(color) ? 255 : 0), 1, true),
  );
  // No mixed-colour joints on a single box, so every end keeps its round cap.
  geometry.setAttribute(
    'instanceRoundCaps',
    new THREE.InstancedBufferAttribute(new Uint8Array(count * 2).fill(255), 2, true),
  );

  const edges = new LineSegments2(geometry, material);
  edges.name = 'box-edges';
  // The parts are small and always near the camera, and their bounds move
  // every frame with the animation; culling them per-part is not worth the
  // matrix work.
  edges.frustumCulled = false;
  return prepareEdgeObject(edges);
}

/* ================================================================== *
 * Shader
 * ================================================================== */

const COMMON_GLSL = /* glsl */ `
  float vxHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vxHash3(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vxNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(vxHash(i), vxHash(i + vec2(1.0, 0.0)), f.x),
               mix(vxHash(i + vec2(0.0, 1.0)), vxHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;

const VERT_DECL = /* glsl */ `
  attribute vec3 aTint;
  attribute vec3 aFringe;
  attribute vec2 aUv;
  attribute vec4 aData;
  varying vec3 vTintV;
  varying vec3 vFringeV;
  varying vec2 vUvW;
  varying vec4 vDataV;
  varying vec3 vNrmW;
  varying vec3 vPosW;

  uniform float uWindTime;
  uniform vec2  uWindDir;
  uniform float uWindStrength;
`;

const VERT_BODY = /* glsl */ `
  vTintV = aTint;
  vFringeV = aFringe;
  vUvW = aUv;
  vDataV = aData;
  vNrmW  = normal;
  // Chunk positions are absolute and the meshes are never transformed, so the
  // local attribute is already the world position.
  vPosW  = position;

  // Wind sway: bit 3 of aData.y flags swayable blocks (leaf blocks).
  // Phase offset from world XZ keeps adjacent trees out of sync.
  // Height factor (aData.w) keeps the base stationary.
  if (aData.y >= 8.0 && uWindStrength > 0.0) {
    float phase = transformed.x * 0.31 + transformed.z * 0.27;
    float sway  = (sin(uWindTime * 1.1 + phase) * 0.6
                 + sin(uWindTime * 0.47 + phase * 1.9) * 0.4)
                 * uWindStrength;
    float heightT = clamp(transformed.y / 28.0, 0.0, 1.0);
    transformed.x += uWindDir.x * sway * heightT;
    transformed.z += uWindDir.y * sway * heightT;
  }
`;

const FRAG_DECL = /* glsl */ `
  varying vec3 vTintV;
  varying vec3 vFringeV;
  varying vec2 vUvW;
  varying vec4 vDataV;
  varying vec3 vNrmW;
  varying vec3 vPosW;
  uniform float uLodAlpha;
  uniform float uAoStrength;
  uniform vec3  uAoTint;
  uniform float uShadowTintStrength;
  uniform vec3  uShadowHue;
  uniform sampler2D uWaterMap;
  uniform float uWaterLevel, uWaterRange, uWorldSize;
  uniform float uWaterInkWidth, uWaterInkStrength;
  uniform vec3  uWaterInk;
  uniform vec3  uSunDir;
  uniform float uSunAmbient;   // diffuse boost from sun on lit faces
  uniform float uFillAmbient;  // flat ambient lift for all faces
  uniform vec3  uSunTint;      // warm tint on sun-facing surfaces
  uniform vec3  uAmbientTint;  // cool tint on all surfaces (night blue shift)


  /**
   * Brick courses for the soil cliffs. Three courses per block in a running
   * bond. The mortar is only a step darker than the face — in the reference
   * these read as a texture you notice on second look, not as a graphic
   * pattern, so the contrast here is deliberately low.
   */
  vec3 patBrick(vec2 uv, vec3 base, vec3 mortar) {
    const float ch = 0.3333;
    float row  = floor(uv.y / ch);
    float offs = mod(row, 2.0) * 0.5;
    vec2 p = vec2((uv.x + offs) / 0.8, uv.y / ch);
    vec2 f = fract(p);
    float m = min(
      smoothstep(0.0, 0.07, f.x) * smoothstep(0.0, 0.07, 1.0 - f.x),
      smoothstep(0.0, 0.13, f.y) * smoothstep(0.0, 0.13, 1.0 - f.y));
    float h = vxHash(floor(p) + 3.7);
    vec3 face = base * (0.965 + h * 0.07);
    face = mix(face, face * 1.06, step(0.88, h));   // occasional weathered brick
    return mix(mortar, face, m);
  }

  vec3 patStone(vec2 uv, vec3 base, vec3 tint) {
    float n = vxNoise(uv * 1.6) * 0.6 + vxNoise(uv * 4.3) * 0.3 + vxNoise(uv * 11.0) * 0.1;
    vec3 col = mix(base, tint, smoothstep(0.42, 0.78, n));
    col *= 0.98 + vxNoise(uv * 23.0) * 0.04;
    return col;
  }

  vec3 patGrassTop(vec2 uv, vec3 base, vec3 tint) {
    float n = vxNoise(uv * 5.5) * 0.55 + vxNoise(uv * 14.0) * 0.45;
    vec3 col = mix(base, tint, smoothstep(0.40, 0.80, n));
    col *= 0.985 + vxHash(floor(uv * 6.0)) * 0.03;
    return col;
  }

  vec3 patTile(vec2 uv, vec3 base, vec3 seam) {
    vec2 f = fract(uv);
    float m = min(smoothstep(0.0, 0.06, f.x) * smoothstep(0.0, 0.06, 1.0 - f.x),
                  smoothstep(0.0, 0.06, f.y) * smoothstep(0.0, 0.06, 1.0 - f.y));
    float h = vxHash(floor(uv) + 8.1);
    vec3 col = base * (0.96 + h * 0.08);
    col = mix(col, seam * 0.97, step(0.9, h) * 0.5);
    return mix(seam, col, m);
  }

  vec3 patPlank(vec2 uv, vec3 base, vec3 tint) {
    // Parallel board joints along world X, plus very low-amplitude grain.
    // This is material-specific illustration, never a generic voxel grid.
    float f = fract(uv.x);
    float seam = 1.0 - smoothstep(0.018, 0.145, min(f, 1.0 - f));
    // Each deck board spans across the bridge, so its fine grain follows the
    // other UV axis while the stronger joint repeats down the bridge length.
    float grain = sin(uv.y * 15.0 + sin(uv.x * 1.8) * 1.4) * 0.5 + 0.5;
    vec3 col = base * (0.972 + grain * 0.040);
    return mix(col, tint * 0.78, seam * 0.66);
  }

  vec3 patBark(vec2 uv, vec3 base, vec3 tint) {
    float grain = sin(uv.x * 13.0 + sin(uv.y * 2.2) * 1.8) * 0.5 + 0.5;
    float fine = sin(uv.x * 31.0 + uv.y * 0.7) * 0.5 + 0.5;
    return mix(base, tint, (grain * 0.16 + fine * 0.06));
  }
`;

const BAYER_DITHER_GLSL = /* glsl */ `
  {
    // Bayer 4×4 ordered dither — screen-door fade, no blending cost.
    const float bayer[16] = float[16](
       0.0,  8.0,  2.0, 10.0,
      12.0,  4.0, 14.0,  6.0,
       3.0, 11.0,  1.0,  9.0,
      15.0,  7.0, 13.0,  5.0
    );
    int bx = int(gl_FragCoord.x) & 3;
    int by = int(gl_FragCoord.y) & 3;
    float threshold = (bayer[by * 4 + bx] + 0.5) / 16.0;
    if (uLodAlpha < threshold) discard;
  }
`;

const FRAG_BODY = /* glsl */ `
  {
    vec3 col = diffuseColor.rgb;
    float pat = mod(vDataV.y, 8.0);
    float fringe = vDataV.z;
    float localV = vDataV.w;
    bool isSide = abs(vNrmW.y) < 0.5;

    if (pat > 0.5 && pat < 1.5)      col = patBrick(vUvW, col, vTintV);
    else if (pat > 1.5 && pat < 2.5) col = patStone(vUvW, col, vTintV);
    else if (pat > 2.5 && pat < 3.5) col = patPlank(vUvW, col, vTintV);
    else if (pat > 3.5 && pat < 4.5) col = patBark(vUvW, col, vTintV);
    else if (pat > 4.5 && pat < 5.5) col = patGrassTop(vUvW, col, vTintV);
    else if (pat > 5.5 && pat < 6.5) col = patTile(vUvW, col, vTintV);

    // --- grass spilling over the lip of the block --------------------
    // Keep the green cap at the authored fraction (25% for turf). A restrained
    // world-space wobble avoids a ruler-straight stripe without allowing the
    // cap to consume a third or more of the dirt/stone face.
    if (fringe > 0.001 && isSide) {
      float jag = vxNoise(vec2(vUvW.x * 5.0, 0.5)) * 0.55
                + vxNoise(vec2(vUvW.x * 13.0, 2.5)) * 0.45;
      float e = 1.0 - fringe + (jag - 0.5) * 0.12;
      float t = smoothstep(e - 0.032, e + 0.032, localV);
      col = mix(col, mix(vFringeV * 0.88, vFringeV, smoothstep(e, 1.0, localV)), t);
    }

    // --- world-space macro colour variation -------------------------
    // Two-octave noise over the XZ plane breaks up uniform regions into
    // natural-looking patches — lighter dry spots, darker damp patches.
    // Scale 1: ~80 m patch (0.0125 × 80 ≈ 1 period); Scale 2: ~26 m detail.
    float macro = vxNoise(vPosW.xz * 0.0125) * 0.65
                + vxNoise(vPosW.xz * 0.038)  * 0.35;
    col *= 0.95 + macro * 0.10;   // ±5 % luminance variation

    // --- face-direction shading -------------------------------------
    // A constant per-axis ramp keeps voxel forms readable from any angle
    // independent of the sun direction. Side values raised from 0.88/0.94 so
    // the unlit face reads as shaded surface rather than silhouette.
    float faceShade = 1.0;
    if (vNrmW.y > 0.5)            faceShade = 1.0;
    else if (vNrmW.y < -0.5)      faceShade = 0.78;
    else if (abs(vNrmW.x) > 0.5)  faceShade = 0.96;
    else                          faceShade = 0.92;
    // Hemisphere sky-ground blend: adds a small sky-tinted lift to faces that
    // point upward and a ground-bounce lift to those that point down, matching
    // the scene HemisphereLight behaviour and lifting the darkest side faces.
    float skyFacing = clamp(dot(vNrmW, vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5, 0.0, 1.0);
    faceShade += skyFacing * 0.08;
    // Directional sun contribution: faces angled toward the sun receive a
    // diffuse boost, faces away get a smaller fill (no face is fully unlit).
    float sunDot = dot(vNrmW, uSunDir);
    faceShade += max(sunDot, 0.0) * uSunAmbient;
    faceShade += (1.0 - max(sunDot, 0.0)) * uFillAmbient;
    col *= faceShade;
    // Sun tint on lit faces, ambient tint on all (night blue shift)
    float sunWt = max(sunDot, 0.0) * uSunAmbient;
    col *= mix(vec3(1.0), uSunTint, sunWt * 0.55);
    col *= mix(vec3(1.0), uAmbientTint, 0.18);

    // --- height-based tint on side faces ----------------------------
    // Walls darken slightly near ground level — simulates moisture
    // absorption, soil staining, and reduced sky exposure.
    if (isSide) {
      float hRamp = clamp(vPosW.y / 36.0, 0.0, 1.0);
      col *= 0.90 + hRamp * 0.10;
    }

    // --- baked ambient occlusion ------------------------------------
    float ao = mix(1.0 - uAoStrength, 1.0, vDataV.x);
    ao = ao * ao * (3.0 - 2.0 * ao);          // soften the ramp
    col *= mix(uAoTint, vec3(1.0), ao);

    /* --- waterline -----------------------------------------------------
     * The dark stroke where the water surface cuts across the terrain.
     *
     * Drawn by the BANK rather than by the water plane, and that is the
     * whole trick. The two meet exactly where the plane vanishes behind the
     * bank, so a contour drawn on the water is occluded by the very wall it
     * is meant to outline — it survives on a gentle beach and disappears on
     * every steep edge, which is most of this shoreline. On the wall it is
     * always visible, and it follows the voxel grid exactly.
     *
     * Side faces only: the surface cuts across those. A top face is either
     * wholly under or wholly over, and banding one would paint a stripe
     * across a whole shelf.
     *
     * Applied last, after shading and occlusion, so it stays a flat graphic
     * line of constant value rather than something the lighting can dim.
     */
    if (abs(vNrmW.y) < 0.5) {
      // Half a block along the face normal lands exactly on the centre of
      // the neighbouring column, which is the one holding the water.
      vec2 probe = (vPosW.xz + vNrmW.xz * 0.5) / uWorldSize;
      float neighbour = (texture2D(uWaterMap, probe).r * 2.0 - 1.0) * uWaterRange;
      // Width in pixels, not world units, so the stroke matches the block
      // outlines at every distance instead of thinning across the basin.
      float w = max(fwidth(vPosW.y) * uWaterInkWidth, 0.012);
      float line = (1.0 - smoothstep(0.0, w, abs(vPosW.y - uWaterLevel)))
                 * smoothstep(0.02, 0.30, neighbour);
      col = mix(col, uWaterInk, line * uWaterInkStrength);
    }

    diffuseColor.rgb = col;
  }
`;

/**
 * Hand the terrain the water's depth field, so the banks can draw the
 * waterline. Called once the world and the water both exist.
 */
export function setVoxelWaterline(material: any, depthMap: any, worldSize: any, range: any) {
  const u = material.userData.uniforms;
  if (!u) return;
  u.uWaterMap.value = depthMap;
  u.uWorldSize.value = worldSize;
  u.uWaterRange.value = range;
}

export function makeVoxelMaterial() {
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    dithering: false,
  });
  mat.userData.uniforms = {
    uLodAlpha: { value: 1.0 },
    uAoStrength: { value: 0.25 },
    uAoTint: { value: new THREE.Color(0.64, 0.59, 0.74) },
    uShadowHue: { value: new THREE.Vector3(1.05, 0.9, 1.18) },
    uShadowTintStrength: { value: 0.82 },
    uSunDir: { value: LIGHT.sunDir.clone() },
    uSunAmbient: { value: 0.14 },  // diffuse lift on sun-facing sides
    uFillAmbient: { value: 0.06 }, // flat lift on shadow sides
    uSunTint: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
    uAmbientTint: { value: new THREE.Vector3(1.0, 1.0, 1.0) },

    /* --- waterline ---------------------------------------------------- */
    /** Signed depth field, handed over by setVoxelWaterline once the world exists. */
    uWaterMap: { value: null },
    uWaterLevel: { value: WATER.level },
    uWaterRange: { value: 20.0 },
    uWorldSize: { value: 192.0 },
    uWaterInk: { value: WATER.edge.clone() },
    /** Stroke width in pixels. */
    uWaterInkWidth: { value: 1.5 },
    uWaterInkStrength: { value: 0.85 },

    /* --- wind sway ---------------------------------------------------- */
    uWindTime:     { value: 0.0 },
    uWindDir:      { value: new THREE.Vector2(1.0, 0.3).normalize() },
    uWindStrength: { value: 0.0 },

    /* --- planet bend -------------------------------------------------- */
    ...planetUniformValues(new THREE.Vector3()),
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECL}\n${PLANET_UNIFORMS_GLSL}\n${PLANET_BEND_GLSL}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n${VERT_BODY}\n  applyPlanetBend(transformed, vNrmW);\n  vPosW = transformed;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON_GLSL}\n${FRAG_DECL}`)
      .replace('void main() {', `void main() {\n${BAYER_DITHER_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_BODY}`)
      .replace(
        'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
        `vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
        #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
          DirectionalLightShadow petalShadow = directionalLightShadows[0];
          float petalVisibility = getShadow(
            directionalShadowMap[0], petalShadow.shadowMapSize,
            petalShadow.shadowIntensity, petalShadow.shadowBias,
            petalShadow.shadowRadius, vDirectionalShadowCoord[0]);
          float petalShade = (1.0 - petalVisibility) * uShadowTintStrength;
          float petalLum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
          vec3 petalCool = vec3(petalLum) * uShadowHue;
          outgoingLight = mix(outgoingLight, petalCool, petalShade);
        #endif`,
      );
    mat.userData.shader = shader;
  };
  mat.customProgramCacheKey = () => 'VoxelWorld-voxel-v8';
  return mat;
}

/** Emissive blocks (lanterns, crystals) — unlit, bright, bloom bait. */
export function makeGlowMaterial() {
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true });
  const planetUnis = planetUniformValues(new THREE.Vector3());
  // Minimal vertex/fragment declarations — glow geometry only has position/normal/color.
  // Using the full VERT_DECL/FRAG_DECL (terrain-specific attributes aTint/aFringe/aUv/aData)
  // caused driver-level issues on some WebGL implementations when those attributes were
  // missing from glow geometry, leading to visual flickering.
  const GLOW_VERT_DECL = /* glsl */ `varying vec3 vNrmW;\n${PLANET_UNIFORMS_GLSL}\n${PLANET_BEND_GLSL}`;
  const GLOW_FRAG_DECL = /* glsl */ `varying vec3 vNrmW;`;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, planetUnis);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLOW_VERT_DECL}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  vNrmW = normal;
  applyPlanetBend(transformed, vNrmW);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLOW_FRAG_DECL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float faceShade = vNrmW.y > 0.5 ? 1.06 : (vNrmW.y < -0.5 ? 0.8 : 0.94);
          diffuseColor.rgb *= faceShade * 1.5;
        }`,
      );
  };
  mat.userData.uniforms = {
    uAoStrength: { value: 0 },
    uAoTint: { value: new THREE.Color(1, 1, 1) },
  };
  mat.userData.planetUnis = planetUnis;
  mat.customProgramCacheKey = () => 'VoxelWorld-glow-v3';
  return mat;
}
