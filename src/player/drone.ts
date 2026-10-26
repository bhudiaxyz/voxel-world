import * as THREE from 'three';
import type { VoxelGrid } from '../core/voxel';

const DRONE = {
  cruiseSpeed: 18,
  sprintSpeed: 45,
  hoverAltitude: 12,
  yawSensitivity: 0.7,
  altitudeChangeRate: 12.0, // m/s per unit axis input
  enterLiftHeight: 18,
  keyYawSpeed: 1.2,
  landingDescentRate: 45, // m/s hover-height reduction while landing
  landingCompleteHeight: 2.5,
  heightSmoothRate: 1.5,
  heightPGain: 2.2,
  vertVelMax: 8.0,
  pitchSmoothRate: 1.8,
};

type State = 'idle' | 'rising' | 'cruising';

export interface DroneMode {
  readonly active: boolean;
  readonly landing: boolean;
  enter(camera: THREE.PerspectiveCamera): void;
  beginLanding(): void;
  update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    keys: Set<string>,
    mouseDeltaX: number,
    altitudeDelta: number,
    joyX?: number,
    joyY?: number,
  ): boolean;
  getAltitude(camera: THREE.PerspectiveCamera): number;
  getSpeed(): number;
}

export function createDroneMode(grid: VoxelGrid): DroneMode {
  let state: State = 'idle';
  let isLanding = false;
  let hoverAltitude = DRONE.hoverAltitude;
  let currentSpeed = 0;
  let yaw = 0;
  let smoothedTargetY = 0;

  return {
    get active(): boolean {
      return state !== 'idle';
    },
    get landing(): boolean {
      return isLanding;
    },

    enter(camera: THREE.PerspectiveCamera): void {
      state = 'rising';
      isLanding = false;
      yaw = camera.rotation.y;
      smoothedTargetY = camera.position.y;
      const groundY = grid.surfaceY(camera.position.x, camera.position.z);
      hoverAltitude = Math.max(DRONE.enterLiftHeight, camera.position.y - groundY);
    },

    beginLanding(): void {
      if (state !== 'idle') isLanding = true;
    },

    getAltitude(camera: THREE.PerspectiveCamera): number {
      return camera.position.y - grid.surfaceY(camera.position.x, camera.position.z);
    },

    getSpeed(): number {
      return currentSpeed;
    },

    update(
      dt: number,
      camera: THREE.PerspectiveCamera,
      keys: Set<string>,
      mouseDeltaX: number,
      altitudeDelta: number,
      joyX = 0,
      joyY = 0,
    ): boolean {
      if (state === 'idle') return false;
      camera.rotation.order = 'YXZ';
      camera.rotation.z = 0;

      // Yaw: mouse
      yaw -= mouseDeltaX * DRONE.yawSensitivity * 0.001;

      if (state === 'rising') {
        currentSpeed = 0;
        const gY = grid.surfaceY(camera.position.x, camera.position.z);
        const targetY = gY + hoverAltitude;
        camera.position.y += (targetY - camera.position.y) * Math.min(1, dt * 8);
        smoothedTargetY = camera.position.y;
        camera.rotation.y = yaw;
        camera.rotation.x = 0;
        if (Math.abs(camera.position.y - targetY) < 0.8) state = 'cruising';
        return false;
      }

      // --- Cruising ---
      // Abort landing if player pulls up
      if (isLanding && altitudeDelta > 0) isLanding = false;

      if (isLanding) {
        hoverAltitude = Math.max(0, hoverAltitude - DRONE.landingDescentRate * dt);
      } else {
        hoverAltitude = Math.max(3, hoverAltitude + altitudeDelta * dt);
      }

      const sprinting = keys.has('ShiftLeft') || keys.has('ShiftRight');
      currentSpeed = sprinting ? DRONE.sprintSpeed : DRONE.cruiseSpeed;

      // A/D + joystick X steer (yaw); always advance forward
      if (keys.has('KeyA') || keys.has('ArrowLeft')) yaw += DRONE.keyYawSpeed * dt;
      if (keys.has('KeyD') || keys.has('ArrowRight')) yaw -= DRONE.keyYawSpeed * dt;
      yaw -= joyX * DRONE.keyYawSpeed * dt;
      camera.position.x -= Math.sin(yaw) * currentSpeed * dt;
      camera.position.z -= Math.cos(yaw) * currentSpeed * dt;

      const gY = grid.surfaceY(camera.position.x, camera.position.z);
      const rawTargetY = gY + hoverAltitude;
      smoothedTargetY += (rawTargetY - smoothedTargetY) * Math.min(1, dt * DRONE.heightSmoothRate);

      const error = smoothedTargetY - camera.position.y;
      const vertV = Math.max(-DRONE.vertVelMax, Math.min(DRONE.vertVelMax, error * DRONE.heightPGain));
      camera.position.y += vertV * dt;

      if (camera.position.y < gY + 2.0) camera.position.y = gY + 2.0;

      camera.rotation.y = yaw;
      const pitchTarget = -0.06;
      camera.rotation.x += (pitchTarget - camera.rotation.x) * Math.min(1, dt * DRONE.pitchSmoothRate);

      // Landing complete when close enough to ground
      if (isLanding && camera.position.y <= gY + DRONE.landingCompleteHeight) {
        camera.position.y = gY + DRONE.landingCompleteHeight;
        state = 'idle';
        isLanding = false;
        return true;
      }

      return false;
    },
  };
}
