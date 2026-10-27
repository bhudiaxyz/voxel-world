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
  landingDescentRate: 90,  // m/s hover-height reduction while landing
  landingCompleteHeight: 2.5,
  heightPGain: 10.0,  // proportional gain on altitude error
  vertVelMax: 36.0,   // max vertical speed (m/s)
  // Descent only: smooth so flying off a cliff doesn't instantly plunge the drone.
  // Ascent is never smoothed — lerping upward delays response and causes terrain clipping.
  targetDescentRate: 8.0, // max m/s the terrain target can fall
  lookAheadTime: 0.55,    // seconds ahead to probe for rising terrain
  pitchSmoothRate: 1.8,
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
      smoothedTargetY = camera.position.y;
      const groundY = grid.surfaceY(camera.position.x, camera.position.z);
      if (skipRise) {
        // Transition from fly — already airborne, hold current altitude.
        hoverAltitude = camera.position.y - groundY;
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
      // joyY < 0 brakes proportionally; 0 or positive = full cruise speed
      const speedMult = joyY < 0 ? Math.max(0, 1 + joyY) : 1;
      camera.position.x -= Math.sin(yaw) * currentSpeed * speedMult * dt;
      camera.position.z -= Math.cos(yaw) * currentSpeed * speedMult * dt;

      const gY = grid.surfaceY(camera.position.x, camera.position.z);

      // Look ahead: only when actually moving, probe terrain ahead and use it
      // only if it would require a climb (not if it's a distant mountain we're
      // not heading toward — that would snap the target up on entry).
      let rawTargetY = gY + hoverAltitude;
      // Look-ahead: only useful when the drone is actually moving forward.
      // Skip on the first frame after entry (speedMult==1 but dt*speed << lookDist)
      // by checking that the look-ahead point is close enough to be imminent.
      const actualSpeed = currentSpeed * speedMult;
      if (actualSpeed > 0.5) {
        const lookDist = Math.max(6, actualSpeed * DRONE.lookAheadTime);
        const aheadSurface = grid.surfaceY(
          camera.position.x - Math.sin(yaw) * lookDist,
          camera.position.z - Math.cos(yaw) * lookDist,
        );
        const aheadTarget = aheadSurface + hoverAltitude;
        // Only use look-ahead to raise the target, and only if the rise is
        // modest (within 2× hoverAltitude) — prevents a distant cliff from
        // snapping the drone up on mode-switch entry.
        if (aheadTarget > rawTargetY && aheadTarget - rawTargetY < hoverAltitude * 2) {
          rawTargetY = aheadTarget;
        }
      }

      // Ascent: snap the target immediately so rising terrain is never smoothed away.
      // Descent: cap rate so flying off a cliff doesn't plunge the drone.
      if (rawTargetY >= smoothedTargetY) {
        smoothedTargetY = rawTargetY;
      } else {
        smoothedTargetY = Math.max(rawTargetY, smoothedTargetY - DRONE.targetDescentRate * dt);
      }

      // P-controller drives vertical velocity; camera smooths naturally via the
      // gain — high error = fast climb, small error = gentle drift.
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
