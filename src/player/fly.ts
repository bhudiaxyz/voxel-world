import * as THREE from 'three';
import type { VoxelGrid } from '../core/voxel';
import { WORLD, wrapAxis } from '../world/terrain';

const FLY = {
  speed: 20,
  sprintSpeed: 60,
  floorClearance: 1.75, // eye height above terrain floor
  // ponytail: fixed descent cap; lower if floor still drops too fast over cliffs
  floorDescentRate: 8.0, // max m/s the floor constraint can fall
  lookAheadDist: 6,     // blocks ahead to probe for obstacles
  autoClimbRate: 14,    // max m/s upward push when obstacle is ahead
};

export interface FlyMode {
  readonly active: boolean;
  enter(camera: THREE.PerspectiveCamera): void;
  exit(): void;
  /**
   * @param yaw      current camera yaw from FPCamera (radians)
   * @param pitch    current camera pitch from FPCamera (radians)
   * @param altDelta already-scaled altitude delta (m) from drainDroneAltDelta(dt)
   */
  update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    keys: Set<string>,
    yaw: number,
    pitch: number,
    altDelta: number,
    joyX?: number,
    joyY?: number,
  ): void;
}

export function createFlyMode(grid: VoxelGrid): FlyMode {
  let active = false;
  let smoothedFloor = 0;

  return {
    get active() {
      return active;
    },

    enter(camera) {
      active = true;
      camera.rotation.order = 'YXZ';
      camera.rotation.z = 0;
      // Scan upward to clear any objects directly above the player before entering fly mode.
      const cx = Math.round(camera.position.x), cz = Math.round(camera.position.z);
      let clearY = Math.ceil(camera.position.y) + 1;
      const scanTop = clearY + 48;
      while (clearY < scanTop && grid.isSolid(cx, clearY, cz)) clearY++;
      if (clearY > camera.position.y + 1) camera.position.y = clearY + 2;
      smoothedFloor = grid.surfaceY(camera.position.x, camera.position.z) + FLY.floorClearance;
    },

    exit() {
      active = false;
    },

    update(dt, camera, keys, yaw, pitch, altDelta, joyX = 0, joyY = 0) {
      if (!active) return;

      // Apply mouse/touch look — caller owns yaw/pitch, we own the camera rotation.
      camera.rotation.set(pitch, yaw, 0);

      const fwd = -Math.sin(yaw);
      const rgt = Math.cos(yaw);
      const sprinting = keys.has('ShiftLeft') || keys.has('ShiftRight');
      const speed = sprinting ? FLY.sprintSpeed : FLY.speed;

      let dx = 0,
        dz = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) {
        dx += fwd;
        dz -= rgt;
      }
      if (keys.has('KeyS') || keys.has('ArrowDown')) {
        dx -= fwd;
        dz += rgt;
      }
      if (keys.has('KeyD') || keys.has('ArrowRight')) {
        dx += rgt;
        dz += fwd;
      }
      if (keys.has('KeyA') || keys.has('ArrowLeft')) {
        dx -= rgt;
        dz -= fwd;
      }
      // touch joystick: joyY = forward/back, joyX = strafe left/right
      dx += fwd * joyY + rgt * joyX;
      dz += -rgt * joyY + fwd * joyX;

      camera.position.x += dx * speed * dt;
      camera.position.z += dz * speed * dt;
      camera.position.x = wrapAxis(camera.position.x);
      camera.position.z = wrapAxis(camera.position.z);
      camera.position.y += altDelta * dt;

      // Terrain floor: smooth downward so cliffs don't snap the floor away beneath the player.
      // Ascent is uncapped — rising terrain must be respected immediately.
      const seaFloor = WORLD.seaLevel + FLY.floorClearance;
      const rawFloor = Math.max(grid.surfaceY(camera.position.x, camera.position.z), WORLD.seaLevel) + FLY.floorClearance;
      const maxDrop = FLY.floorDescentRate * dt;
      smoothedFloor = Math.max(rawFloor, smoothedFloor - maxDrop, seaFloor);
      if (camera.position.y < smoothedFloor) camera.position.y = smoothedFloor;

      // Auto-climb: if moving horizontally and the path ahead is blocked, push upward.
      const moveLen = Math.sqrt(dx * dx + dz * dz);
      if (moveLen > 0.01) {
        const probeX = camera.position.x + (dx / moveLen) * FLY.lookAheadDist;
        const probeZ = camera.position.z + (dz / moveLen) * FLY.lookAheadDist;
        const aheadSurface = grid.surfaceY(probeX, probeZ) + FLY.floorClearance;
        const clearanceNeeded = aheadSurface - camera.position.y;
        if (clearanceNeeded > 0) {
          camera.position.y += Math.min(clearanceNeeded, FLY.autoClimbRate * dt);
        }
      }
    },
  };
}
