import * as THREE from 'three';
import type { VoxelGrid } from '../core/voxel';
import { WORLD, wrapAxis } from '../world/terrain';

const DRONE = {
  cruiseSpeed: 18,
  sprintSpeed: 45,
  hoverAltitude: 15,
  yawSensitivity: 0.7,
  enterLiftHeight: 18,
  keyYawSpeed: 1.4,
  landingDescentRate: 90,
  landingCompleteHeight: 2.5,
};

type State = 'idle' | 'rising' | 'cruising';

export interface DroneMode {
  readonly active: boolean;
  readonly landing: boolean;
  enter(camera: THREE.PerspectiveCamera, skipRise?: boolean): void;
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

    enter(camera: THREE.PerspectiveCamera, skipRise = false): void {
      isLanding = false;
      yaw = camera.rotation.y;
      const groundY = grid.surfaceY(camera.position.x, camera.position.z);
      if (skipRise) {
        // Transition from fly — already airborne, hold current altitude.
        hoverAltitude = camera.position.y - groundY;
        smoothedTargetY = camera.position.y;
        state = 'cruising';
      } else {
        state = 'rising';
        // Scan upward to find the first clear block above the player's head,
        // so the drone launches above trees, bridges, or overhangs.
        const cx = Math.round(camera.position.x), cz = Math.round(camera.position.z);
        let clearY = Math.ceil(camera.position.y) + 1;
        const scanTop = clearY + 48;
        while (clearY < scanTop && grid.isSolid(cx, clearY, cz)) clearY++;
        const safeAltitude = (clearY + 4) - groundY; // 4 blocks of headroom above obstruction
        hoverAltitude = Math.max(DRONE.enterLiftHeight, safeAltitude, camera.position.y - groundY);
      }
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
        camera.rotation.y = yaw;
        camera.rotation.x = 0;
        if (Math.abs(camera.position.y - targetY) < 0.8) {
        smoothedTargetY = camera.position.y;
        state = 'cruising';
      }
        return false;
      }

      // --- Cruising ---
      // Abort landing if player pulls up
      if (isLanding && altitudeDelta > 0) isLanding = false;

      if (isLanding) {
        hoverAltitude = Math.max(0, hoverAltitude - DRONE.landingDescentRate * dt);
      } else {
        // Scale by speed so altitude change feels proportional to movement pace.
        hoverAltitude = Math.max(3, hoverAltitude + altitudeDelta * (currentSpeed / DRONE.cruiseSpeed) * dt);
      }

      const sprinting = keys.has('ShiftLeft') || keys.has('ShiftRight');
      currentSpeed = sprinting ? DRONE.sprintSpeed : DRONE.cruiseSpeed;

      // A/D + joystick X steer (yaw); always advance forward
      if (keys.has('KeyA') || keys.has('ArrowLeft')) yaw += DRONE.keyYawSpeed * dt;
      if (keys.has('KeyD') || keys.has('ArrowRight')) yaw -= DRONE.keyYawSpeed * dt;
      yaw -= joyX * DRONE.keyYawSpeed * dt;
      // joyY < 0 brakes proportionally; 0 or positive = full cruise speed
      const speedMult = joyY < 0 ? Math.max(0, 1 + joyY) : 1;
      camera.position.x -= Math.sin(yaw) * currentSpeed * speedMult * dt;
      camera.position.z -= Math.cos(yaw) * currentSpeed * speedMult * dt;
      camera.position.x = wrapAxis(camera.position.x);
      camera.position.z = wrapAxis(camera.position.z);

      const gY = grid.surfaceY(camera.position.x, camera.position.z);

      // Sample terrain ahead and to the sides so cliff faces are anticipated
      // before the drone reaches them rather than reacted to on impact.
      const lookDist = Math.max(5, currentSpeed * speedMult * 0.45);
      const sx = Math.sin(yaw), sz = Math.cos(yaw);
      const aheadY  = grid.surfaceY(camera.position.x - sx * lookDist,        camera.position.z - sz * lookDist);
      const leftY   = grid.surfaceY(camera.position.x - sz * lookDist * 0.4,  camera.position.z + sx * lookDist * 0.4);
      const rightY  = grid.surfaceY(camera.position.x + sz * lookDist * 0.4,  camera.position.z - sx * lookDist * 0.4);
      const probeHigh = Math.max(gY, aheadY, leftY, rightY, WORLD.seaLevel);
      const rawTarget = probeHigh + hoverAltitude;

      // Ascent: snap immediately so rising terrain is never smoothed away.
      // Descent: cap rate so a sudden drop doesn't plunge the drone.
      if (rawTarget >= smoothedTargetY) {
        smoothedTargetY = rawTarget;
      } else {
        smoothedTargetY = Math.max(rawTarget, smoothedTargetY - 7 * dt);
      }

      // Fast ascent, gentle descent on actual camera position.
      const lerpRate = smoothedTargetY > camera.position.y ? Math.min(1, dt * 7) : Math.min(1, dt * 3);
      camera.position.y += (smoothedTargetY - camera.position.y) * lerpRate;

      // Hard floor: never clip into terrain or sea surface.
      const hardFloor = Math.max(gY, WORLD.seaLevel) + 2.0;
      if (camera.position.y < hardFloor) camera.position.y = hardFloor;

      camera.rotation.y = yaw;
      camera.rotation.x = 0;

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
