import * as THREE from 'three';
import type { VoxelGrid } from '../core/voxel';

const FLY = {
  speed: 20,
  sprintSpeed: 60,
  floorClearance: 1.75, // eye height above terrain floor
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

  return {
    get active() {
      return active;
    },

    enter(camera) {
      active = true;
      camera.rotation.order = 'YXZ';
      camera.rotation.z = 0;
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
      camera.position.y += altDelta;

      // Terrain floor constraint — cannot fly below ground
      const floor = grid.surfaceY(camera.position.x, camera.position.z) + FLY.floorClearance;
      if (camera.position.y < floor) camera.position.y = floor;
    },
  };
}
