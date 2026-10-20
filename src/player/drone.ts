import * as THREE from 'three';
import type { VoxelGrid } from '../core/voxel.ts';

const DRONE = {
  cruiseSpeed:           18,
  sprintSpeed:           45,
  hoverAltitude:         12,
  yawSensitivity:        0.7,
  altitudeChangeRate:    2.0,
  enterLiftHeight:       18,
  keyYawSpeed:           1.2,
  landingDescentSpeed:   8,
  landingCompleteHeight: 2.5,
  heightSmoothRate:      1.5,
  heightPGain:           2.2,
  vertVelMax:            8.0,
  pitchSmoothRate:       1.8,
};

type State = 'idle' | 'rising' | 'cruising' | 'landing';

export interface DroneMode {
  readonly active: boolean;
  enter(camera: THREE.PerspectiveCamera): void;
  beginLanding(): void;
  update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    keys: Set<string>,
    mouseDeltaX: number,
    altitudeDelta: number,
  ): boolean;
  getAltitude(camera: THREE.PerspectiveCamera): number;
  getSpeed(): number;
}

export function createDroneMode(grid: VoxelGrid): DroneMode {
  let state: State = 'idle';
  let hoverAltitude = DRONE.hoverAltitude;
  let currentSpeed  = 0;
  let yaw           = 0;
  let smoothedTargetY = 0;

  function getGroundY(x: number, z: number): number {
    const top = grid.columnTop(Math.round(x), Math.round(z));
    return top < 0 ? 0 : top + 1;
  }

  return {
    get active(): boolean { return state !== 'idle'; },

    enter(camera: THREE.PerspectiveCamera): void {
      state = 'rising';
      yaw   = camera.rotation.y;
      smoothedTargetY = camera.position.y;
      const groundY  = getGroundY(camera.position.x, camera.position.z);
      hoverAltitude  = Math.max(DRONE.enterLiftHeight, camera.position.y - groundY);
    },

    beginLanding(): void {
      if (state !== 'idle') state = 'landing';
    },

    getAltitude(camera: THREE.PerspectiveCamera): number {
      return camera.position.y - getGroundY(camera.position.x, camera.position.z);
    },

    getSpeed(): number { return currentSpeed; },

    update(
      dt: number,
      camera: THREE.PerspectiveCamera,
      keys: Set<string>,
      mouseDeltaX: number,
      altitudeDelta: number,
    ): boolean {
      if (state === 'idle') return false;
      camera.rotation.order = 'YXZ';
      camera.rotation.z     = 0;

      if (state === 'landing') {
        currentSpeed = 0;
        camera.position.y -= DRONE.landingDescentSpeed * dt;
        const gY = getGroundY(camera.position.x, camera.position.z);
        camera.rotation.y = yaw;
        camera.rotation.x = 0;
        if (camera.position.y <= gY + DRONE.landingCompleteHeight) {
          camera.position.y = gY + DRONE.landingCompleteHeight;
          state = 'idle';
          return true;
        }
        return false;
      }

      // Yaw: mouse + arrow keys
      yaw -= mouseDeltaX * DRONE.yawSensitivity * 0.001;
      if (keys.has('ArrowLeft'))  yaw += DRONE.keyYawSpeed * dt;
      if (keys.has('ArrowRight')) yaw -= DRONE.keyYawSpeed * dt;

      if (state === 'rising') {
        currentSpeed = 0;
        const gY      = getGroundY(camera.position.x, camera.position.z);
        const targetY = gY + hoverAltitude;
        camera.position.y += (targetY - camera.position.y) * Math.min(1, dt * 2.5);
        smoothedTargetY    = camera.position.y;
        camera.rotation.y  = yaw;
        camera.rotation.x  = 0;
        if (Math.abs(camera.position.y - targetY) < 0.8) state = 'cruising';
        return false;
      }

      // Cruising
      hoverAltitude = Math.max(3, hoverAltitude + altitudeDelta * dt);

      const sprinting = keys.has('ShiftLeft') || keys.has('ShiftRight');
      currentSpeed    = sprinting ? DRONE.sprintSpeed : DRONE.cruiseSpeed;

      const gY         = getGroundY(camera.position.x, camera.position.z);
      const rawTargetY = gY + hoverAltitude;
      smoothedTargetY += (rawTargetY - smoothedTargetY) * Math.min(1, dt * DRONE.heightSmoothRate);

      const error = smoothedTargetY - camera.position.y;
      const vertV = Math.max(-DRONE.vertVelMax, Math.min(DRONE.vertVelMax, error * DRONE.heightPGain));

      camera.position.x -= Math.sin(yaw) * currentSpeed * dt;
      camera.position.z -= Math.cos(yaw) * currentSpeed * dt;
      camera.position.y += vertV * dt;

      if (camera.position.y < gY + 2.0) camera.position.y = gY + 2.0;

      camera.rotation.y  = yaw;
      const pitchTarget  = -0.06;
      camera.rotation.x += (pitchTarget - camera.rotation.x) * Math.min(1, dt * DRONE.pitchSmoothRate);

      return false;
    },
  };
}
