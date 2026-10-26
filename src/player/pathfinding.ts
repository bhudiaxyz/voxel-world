/**
 * Click-to-move navigation.
 *
 * The route finder does not move the character itself. It produces the same
 * world-space movement wish as the keyboard, leaving acceleration, collision,
 * stepping, swimming and animation under the existing Controller.
 */

import * as THREE from 'three';
import { WATER } from '../core/palette';

const PLAYER_HEIGHT = 1.75;
const MAX_STEP = 3.3;
const MAX_DROP = 3.35;
const SWIM_DEPTH = 1.25;
const FLOAT_Y = WATER.level - 1.05;
const LAYERS = 2; // terrain/water, plus an optional bridge deck
const SEARCH_BUDGET_MS = 1.75;
const MAX_EXPANSIONS = 420000;
const PULSE_DURATION = 0.52;

const DIRECTIONS = [
  [-1, 0, 1],
  [1, 0, 1],
  [0, -1, 1],
  [0, 1, 1],
  [-1, -1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [1, 1, Math.SQRT2],
];

class MinHeap {
  declare nodes: any[];
  declare scores: any[];
  constructor() {
    this.nodes = [];
    this.scores = [];
  }

  get size() {
    return this.nodes.length;
  }
  clear() {
    this.nodes.length = 0;
    this.scores.length = 0;
  }

  push(node: any, score: any) {
    let i = this.nodes.length;
    this.nodes.push(node);
    this.scores.push(score);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.scores[parent] <= score) break;
      this.nodes[i] = this.nodes[parent];
      this.scores[i] = this.scores[parent];
      i = parent;
    }
    this.nodes[i] = node;
    this.scores[i] = score;
  }

  pop() {
    const node = this.nodes[0];
    const score = this.scores[0];
    const lastNode = this.nodes.pop();
    const lastScore = this.scores.pop();
    if (this.nodes.length) {
      let i = 0;
      this.nodes[0] = lastNode;
      this.scores[0] = lastScore;
      while (true) {
        const left = i * 2 + 1;
        if (left >= this.nodes.length) break;
        const right = left + 1;
        const child = right < this.nodes.length && this.scores[right] < this.scores[left] ? right : left;
        if (this.scores[i] <= this.scores[child]) break;
        [this.nodes[i], this.nodes[child]] = [this.nodes[child], this.nodes[i]];
        [this.scores[i], this.scores[child]] = [this.scores[child], this.scores[i]];
        i = child;
      }
    }
    return { node, score };
  }
}

/**
 * Two walkable surfaces per map cell: natural ground/water and bridge deck.
 *
 * Exported because anything else that walks the world must walk the *same*
 * world. The validity cache is also the expensive part of this file, so a
 * second navigator shares an instance rather than rebuilding one.
 */
export class NavigationSurface {
  declare world: any;
  declare grid: any;
  declare heights: any;
  declare size: any;
  declare cells: any;
  declare bridgeY: any;
  declare validity: any;
  constructor(world: any) {
    this.world = world;
    this.grid = world.grid;
    this.heights = world.heights;
    this.size = world.size;
    this.cells = this.size * this.size;
    this.bridgeY = new Int16Array(this.cells);
    this.bridgeY.fill(-1);
    // 0 unknown, 1 walkable, 2 blocked. The generated world is immutable.
    this.validity = new Uint8Array(this.cells * LAYERS);
    this._installBridges(world.props?.bridges || []);
  }

  _installBridges(bridges: any) {
    const S = this.size;
    for (const bridge of bridges) {
      const [x0, z0] = bridge.near;
      const [x1, z1] = bridge.far;
      const dx = Math.sign(x1 - x0),
        dz = Math.sign(z1 - z0);
      const length = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
      const px = dz === 0 ? 0 : 1;
      const pz = dx === 0 ? 0 : 1;
      for (let step = 0; step <= length; step++) {
        const cx = x0 + dx * step,
          cz = z0 + dz * step;
        for (let width = -1; width <= 1; width++) {
          const x = cx + px * width,
            z = cz + pz * width;
          if (x < 0 || z < 0 || x >= S || z >= S) continue;
          this.bridgeY[z * S + x] = bridge.deckY + 1;
        }
      }
    }
  }

  encode(x: any, z: any, layer = 0) {
    return (z * this.size + x) * LAYERS + layer;
  }

  decode(node: any) {
    const layer = node & 1;
    const cell = node >> 1;
    return { x: cell % this.size, z: Math.floor(cell / this.size), layer };
  }

  _clearAt(x: any, y: any, z: any) {
    const y0 = Math.floor(y + 0.02);
    const y1 = Math.floor(y + PLAYER_HEIGHT - 0.02);
    for (let yy = y0; yy <= y1; yy++) {
      if (this.grid.isSolid(x, yy, z)) return false;
    }
    return true;
  }

  info(node: any) {
    const { x, z, layer } = this.decode(node);
    if (x < 1 || z < 1 || x >= this.size - 1 || z >= this.size - 1) return null;
    const cell = z * this.size + x;
    let y,
      water = false;
    if (layer === 1) {
      y = this.bridgeY[cell];
      if (y < 0) return null;
    } else {
      const feet = this.heights[cell] + 1;
      water = WATER.level - feet > SWIM_DEPTH;
      y = water ? FLOAT_Y : feet;
    }

    let validity = this.validity[node];
    if (validity === 0) {
      validity = this._clearAt(x, y, z) ? 1 : 2;
      this.validity[node] = validity;
    }
    return validity === 1 ? { node, x, z, layer, y, water } : null;
  }

  _heightAllows(a: any, b: any) {
    if (a.water && b.water) return true;
    if (a.water && !b.water) {
      // Match Controller.stepTo: a swimmer reaches from the waterline.
      return b.y <= WATER.level + MAX_STEP + 0.001;
    }
    if (!a.water && b.water) {
      // Enter through an ordinary bank rather than selecting a cliff dive as
      // the shortest route.
      return a.y <= WATER.level + MAX_STEP + 0.001;
    }
    const dy = b.y - a.y;
    return dy <= MAX_STEP + 0.001 && dy >= -MAX_DROP - 0.001;
  }

  _cornerRouteExists(a: any, b: any, x: any, z: any) {
    for (let layer = 0; layer < LAYERS; layer++) {
      const middle = this.info(this.encode(x, z, layer));
      if (middle && this._heightAllows(a, middle) && this._heightAllows(middle, b)) return true;
    }
    return false;
  }

  canMove(a: any, b: any) {
    if (!this._heightAllows(a, b)) return false;
    const dx = b.x - a.x,
      dz = b.z - a.z;
    if (Math.abs(dx) !== 1 || Math.abs(dz) !== 1) return true;

    // A diagonal is legal when at least one of its two one-cell L-shaped
    // crossings is clear. This prevents the controller cutting through the
    // touching corners of tree trunks, posts and cliff blocks.
    return this._cornerRouteExists(a, b, b.x, a.z) || this._cornerRouteExists(a, b, a.x, b.z);
  }

  forEachNeighbour(node: any, visit: any) {
    const a = this.info(node);
    if (!a) return;
    for (const [dx, dz, distance] of DIRECTIONS) {
      const x = a.x + dx,
        z = a.z + dz;
      if (x < 1 || z < 1 || x >= this.size - 1 || z >= this.size - 1) continue;
      for (let layer = 0; layer < LAYERS; layer++) {
        const b = this.info(this.encode(x, z, layer));
        if (!b || !this.canMove(a, b)) continue;
        const waterCost = b.water ? 1.24 : 1;
        const climbCost = Math.max(0, b.y - a.y) * 0.12;
        visit(b.node, distance * waterCost + climbCost);
      }
    }
  }

  nearestNode(x: any, z: any, expectedY: any, radius: any) {
    const cx = THREE.MathUtils.clamp(Math.floor(x), 1, this.size - 2);
    const cz = THREE.MathUtils.clamp(Math.floor(z), 1, this.size - 2);
    let best = -1,
      bestScore = Infinity;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq > radius * radius) continue;
        const xx = cx + dx,
          zz = cz + dz;
        if (xx < 1 || zz < 1 || xx >= this.size - 1 || zz >= this.size - 1) continue;
        for (let layer = 0; layer < LAYERS; layer++) {
          const candidate = this.info(this.encode(xx, zz, layer));
          if (!candidate) continue;
          const score = Math.sqrt(distanceSq) * 2.2 + Math.abs(candidate.y - expectedY);
          if (score < bestScore) {
            bestScore = score;
            best = candidate.node;
          }
        }
      }
    }
    return best;
  }
}

export class IncrementalAStar {
  declare surface: any;
  declare g: any;
  declare cameFrom: any;
  declare seen: any;
  declare generation: any;
  declare heap: any;
  declare start: any;
  declare goal: any;
  declare expansions: any;
  declare searching: any;
  constructor(surface: any) {
    this.surface = surface;
    const nodeCount = surface.cells * LAYERS;
    this.g = new Float32Array(nodeCount);
    this.cameFrom = new Int32Array(nodeCount);
    this.seen = new Uint16Array(nodeCount);
    this.generation = 0;
    this.heap = new MinHeap();
    this.start = -1;
    this.goal = -1;
    this.expansions = 0;
    this.searching = false;
  }

  _heuristic(node: any) {
    const a = this.surface.decode(node);
    const b = this.surface.decode(this.goal);
    const dx = Math.abs(a.x - b.x),
      dz = Math.abs(a.z - b.z);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  }

  begin(start: any, goal: any) {
    this.generation++;
    if (this.generation > 65535) {
      this.seen.fill(0);
      this.generation = 1;
    }
    this.heap.clear();
    this.start = start;
    this.goal = goal;
    this.expansions = 0;
    this.searching = start >= 0 && goal >= 0;
    if (!this.searching) return;
    this.seen[start] = this.generation;
    this.g[start] = 0;
    this.cameFrom[start] = -1;
    this.heap.push(start, this._heuristic(start));
  }

  cancel() {
    this.searching = false;
    this.heap.clear();
  }

  _reconstruct() {
    const path = [];
    let node = this.goal;
    while (node >= 0) {
      path.push(node);
      if (node === this.start) break;
      node = this.cameFrom[node];
    }
    if (path[path.length - 1] !== this.start) return null;
    return path.reverse();
  }

  step(budgetMs = SEARCH_BUDGET_MS) {
    if (!this.searching) return null;
    const deadline = performance.now() + budgetMs;
    let checks = 0;
    while (this.heap.size && this.expansions < MAX_EXPANSIONS) {
      const { node, score } = this.heap.pop();
      if (this.seen[node] !== this.generation) continue;
      const expected = this.g[node] + this._heuristic(node);
      if (score > expected + 0.02) continue; // stale heap entry
      if (node === this.goal) {
        this.searching = false;
        return this._reconstruct();
      }

      const baseCost = this.g[node];
      this.surface.forEachNeighbour(node, (next: any, edgeCost: any) => {
        const nextCost = baseCost + edgeCost;
        if (this.seen[next] === this.generation && nextCost >= this.g[next] - 0.0001) return;
        this.seen[next] = this.generation;
        this.g[next] = nextCost;
        this.cameFrom[next] = node;
        // A tiny tie-break toward the goal produces straighter equal-cost paths.
        const h = this._heuristic(next);
        this.heap.push(next, nextCost + h + h * 1e-5);
      });
      this.expansions++;
      if ((++checks & 63) === 0 && performance.now() >= deadline) return undefined;
    }
    this.searching = false;
    return false;
  }
}

export function routePoints(nodes: any, surface: any) {
  if (!nodes?.length) return [];
  const points: any[] = [];
  const append = (node: any) => {
    const s = surface.info(node);
    // `layer` travels with the point so a follower knows when a route steps
    // onto a bridge deck and stops sampling the ground underneath it.
    points.push({ node, x: s.x + 0.5, y: s.y, z: s.z + 0.5, water: s.water, layer: s.layer });
  };
  append(nodes[0]);

  let previousDx = 0,
    previousDz = 0;
  for (let i = 1; i < nodes.length; i++) {
    const a = surface.decode(nodes[i - 1]);
    const b = surface.decode(nodes[i]);
    const dx = Math.sign(b.x - a.x),
      dz = Math.sign(b.z - a.z);
    const layerChanged = a.layer !== b.layer;
    const waterChanged = surface.info(nodes[i - 1]).water !== surface.info(nodes[i]).water;
    if (i > 1 && (dx !== previousDx || dz !== previousDz || layerChanged || waterChanged)) {
      append(nodes[i - 1]);
    }
    previousDx = dx;
    previousDz = dz;
  }
  if (points[points.length - 1].node !== nodes[nodes.length - 1]) append(nodes[nodes.length - 1]);
  return points;
}

export function createPathNavigator({ world, controller, camera, dom, input }: any) {
  const surface = new NavigationSurface(world);
  const search = new IncrementalAStar(surface);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pulseNormal = new THREE.Vector3();
  const pulseUp = new THREE.Vector3(0, 1, 0);
  const pulseMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  // Open at the equator: only the outward half of the sphere rises from the
  // clicked face, so the feedback reads as a soft pulse rather than an orb.
  const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), pulseMaterial);
  pulse.name = 'click-pulse';
  pulse.visible = false;
  pulse.frustumCulled = false;
  pulse.matrixAutoUpdate = false;
  pulse.renderOrder = 5;
  world.group.add(pulse);
  let pulseAge = PULSE_DURATION;
  let pressed: any = null;
  let route: any = null;
  let waypoint = 0;
  let goal = -1;
  let stuckFor = 0;
  let lastX = controller.pos.x,
    lastZ = controller.pos.z;
  let replans = 0;

  const clearRoute = (clearGoal = true) => {
    route = null;
    waypoint = 0;
    stuckFor = 0;
    search.cancel();
    if (clearGoal) goal = -1;
  };

  const beginSearch = (targetNode: any, isReplan = false) => {
    const start = surface.nearestNode(controller.pos.x, controller.pos.z, controller.pos.y, 4);
    if (start < 0 || targetNode < 0) {
      clearRoute();
      return;
    }
    route = null;
    waypoint = 0;
    goal = targetNode;
    if (!isReplan) replans = 0;
    search.begin(start, goal);
  };

  const showPulse = (hit: any) => {
    pulseNormal.copy(hit.face?.normal || pulseUp).transformDirection(hit.object.matrixWorld);
    pulse.position.copy(hit.point).addScaledVector(pulseNormal, 0.018);
    pulse.quaternion.setFromUnitVectors(pulseUp, pulseNormal);
    pulse.scale.setScalar(0.16);
    pulseMaterial.opacity = 0.24;
    pulseAge = 0;
    pulse.visible = true;
    pulse.updateMatrix();
    pulse.updateMatrixWorld(true);
  };

  const updatePulse = (dt: any) => {
    if (!pulse.visible) return;
    pulseAge += dt;
    const t = THREE.MathUtils.clamp(pulseAge / PULSE_DURATION, 0, 1);
    const expand = 1 - Math.pow(1 - t, 3);
    pulse.scale.setScalar(0.16 + expand * 1.08);
    pulseMaterial.opacity = 0.24 * (1 - THREE.MathUtils.smoothstep(t, 0.16, 1));
    pulse.updateMatrix();
    pulse.updateMatrixWorld(true);
    if (t >= 1) pulse.visible = false;
  };

  const chooseDestination = (clientX: any, clientY: any) => {
    const rect = dom.getBoundingClientRect();
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(world.meshes.solid, true)[0];
    if (!hit) return;
    showPulse(hit);

    const normal = hit.face?.normal || THREE.Object3D.DEFAULT_UP;
    const x = Math.floor(hit.point.x - normal.x * 0.01);
    const z = Math.floor(hit.point.z - normal.z * 0.01);
    const target = surface.nearestNode(x + 0.5, z + 0.5, hit.point.y, 12);
    if (target >= 0) beginSearch(target);
    else clearRoute();
  };

  dom.addEventListener('pointerdown', (event: any) => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || input.paused) return;
    pressed = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  dom.addEventListener('pointerup', (event: any) => {
    if (!pressed || event.pointerId !== pressed.id) return;
    const distance = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y);
    pressed = null;
    if (distance <= 6 && !input.paused) chooseDestination(event.clientX, event.clientY);
  });
  dom.addEventListener('pointercancel', () => {
    pressed = null;
  });

  return {
    cancel: clearRoute,
    /** Shared so other agents navigate the same surface. See NavigationSurface. */
    surface,
    get active() {
      return search.searching || Boolean(route);
    },

    /** Replace `wish` only when no manual movement is active. */
    update(dt: any, wish: any, manualMovement: any, suspended = false) {
      updatePulse(dt);
      if (manualMovement) {
        clearRoute();
        lastX = controller.pos.x;
        lastZ = controller.pos.z;
        return;
      }
      if (suspended) return;

      if (search.searching) {
        const result = search.step();
        if (Array.isArray(result)) {
          route = routePoints(result, surface);
          waypoint = Math.min(1, route.length - 1);
          stuckFor = 0;
        } else if (result === false) {
          clearRoute();
        }
      }
      if (!route?.length) return;

      let target = route[waypoint];
      let dx = target.x - controller.pos.x;
      let dz = target.z - controller.pos.z;
      let distance = Math.hypot(dx, dz);
      const arrival = waypoint === route.length - 1 ? 0.42 : 0.72;
      while (distance <= arrival && waypoint < route.length - 1) {
        target = route[++waypoint];
        dx = target.x - controller.pos.x;
        dz = target.z - controller.pos.z;
        distance = Math.hypot(dx, dz);
      }
      if (waypoint === route.length - 1 && distance <= arrival) {
        clearRoute();
        wish.set(0, 0, 0);
        return;
      }

      if (distance > 1e-5) {
        const speed = THREE.MathUtils.clamp(distance / 1.35, 0.18, 1);
        wish.set((dx / distance) * speed, 0, (dz / distance) * speed);
      }

      const moved = Math.hypot(controller.pos.x - lastX, controller.pos.z - lastZ);
      if (moved < 0.012 && distance > 0.8 && controller.grounded) stuckFor += dt;
      else stuckFor = Math.max(0, stuckFor - dt * 2);
      lastX = controller.pos.x;
      lastZ = controller.pos.z;

      // Collision geometry is authoritative. If a route cannot make progress,
      // replan from the actual position rather than forcing the body through.
      if (stuckFor > 1.1) {
        if (replans < 2 && goal >= 0) {
          replans++;
          stuckFor = 0;
          beginSearch(goal, true);
          wish.set(0, 0, 0);
        } else {
          clearRoute();
          wish.set(0, 0, 0);
        }
      }
    },
  };
}
