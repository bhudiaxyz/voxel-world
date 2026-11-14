import * as THREE from 'three';
import type { VoxelGrid } from '../core/voxel';
import { WORLD, wrapAxis } from '../world/terrain';

const DRONE = {
    cruiseSpeed: 18,
    sprintSpeed: 45,
    hoverAltitude: 15,
    /** Minimum hover height on entering the drone (was 18 — a big launch). */
    enterLiftHeight: 6,
    keyYawSpeed: 1.4,
    landingDescentRate: 90,
    landingCompleteHeight: 2.5,
    /** Max blocks/s the camera's target sinks while landing (cruise cap is 7). */
    landingSinkRate: 40,
    /** Camera ease toward the target while landing, per second (cruise is 3). */
    landingEase: 9,
};

type State = 'idle' | 'rising' | 'cruising';

export interface DroneMode {
    readonly active: boolean;
    readonly landing: boolean;
    enter(camera: THREE.PerspectiveCamera, skipRise?: boolean): void;
    beginLanding(): void;
    /** Leave drone mode immediately, camera stays where it is (F-cycle to fly). */
    exit(): void;
    update(
        dt: number,
        camera: THREE.PerspectiveCamera,
        keys: Set<string>,
        /** Shared look state (FPCamera): yaw = heading, pitch/roll = camera only. A/D steer it. */
        look: { yaw: number; pitch: number; roll: number },
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
                const cx = Math.round(camera.position.x),
                    cz = Math.round(camera.position.z);
                let clearY = Math.ceil(camera.position.y) + 1;
                const scanTop = clearY + 48;
                while (clearY < scanTop && grid.isSolid(cx, clearY, cz)) clearY++;
                // Only clear an obstruction if there IS one overhead (clearY moved).
                const blocked = clearY > Math.ceil(camera.position.y) + 1;
                const safeAltitude = blocked ? clearY + 3 - groundY : 0; // 3 blocks of headroom above it
                hoverAltitude = Math.max(DRONE.enterLiftHeight, safeAltitude, camera.position.y - groundY);
            }
        },

        beginLanding(): void {
            if (state !== 'idle') isLanding = true;
        },

        exit(): void {
            state = 'idle';
            isLanding = false;
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
            look: { yaw: number; pitch: number; roll: number },
            altitudeDelta: number,
            joyX = 0,
            joyY = 0,
        ): boolean {
            if (state === 'idle') return false;
            camera.rotation.order = 'YXZ';

            /* Look is shared with walk and fly mode (as planet-explorer): the
             * caller's yaw is the HEADING, pitch tilts only the camera so you can
             * look down at the terrain or up at the sky while the drone keeps
             * flying level, and roll is the Q/E bank. A/D and joystick X steer by
             * turning the shared yaw, so mouse, keys and touch all agree. */
            if (keys.has('KeyA') || keys.has('ArrowLeft')) look.yaw += DRONE.keyYawSpeed * dt;
            if (keys.has('KeyD') || keys.has('ArrowRight')) look.yaw -= DRONE.keyYawSpeed * dt;
            look.yaw -= joyX * DRONE.keyYawSpeed * dt;
            yaw = look.yaw;
            const applyLook = () => camera.rotation.set(look.pitch, yaw, look.roll);

            if (state === 'rising') {
                currentSpeed = 0;
                const gY = grid.surfaceY(camera.position.x, camera.position.z);
                const targetY = gY + hoverAltitude;
                camera.position.y += (targetY - camera.position.y) * Math.min(1, dt * 8);
                applyLook();
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

            // Always advance forward along the heading.
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
            const sx = Math.sin(yaw),
                sz = Math.cos(yaw);
            const aheadY = grid.surfaceY(camera.position.x - sx * lookDist, camera.position.z - sz * lookDist);
            const leftY = grid.surfaceY(
                camera.position.x - sz * lookDist * 0.4,
                camera.position.z + sx * lookDist * 0.4,
            );
            const rightY = grid.surfaceY(
                camera.position.x + sz * lookDist * 0.4,
                camera.position.z - sx * lookDist * 0.4,
            );
            const probeHigh = Math.max(gY, aheadY, leftY, rightY, WORLD.seaLevel);
            const rawTarget = probeHigh + hoverAltitude;

            // Ascent: snap immediately so rising terrain is never smoothed away.
            // Descent: cap rate so a sudden drop doesn't plunge the drone — but
            // while LANDING that cap was the whole landing speed (7 blocks/s, then
            // a slow ease), so landing gets its own, much faster limits.
            const descentCap = isLanding ? DRONE.landingSinkRate : 7;
            if (rawTarget >= smoothedTargetY) {
                smoothedTargetY = rawTarget;
            } else {
                smoothedTargetY = Math.max(rawTarget, smoothedTargetY - descentCap * dt);
            }

            // Fast ascent, gentle descent on actual camera position (brisk when landing).
            const lerpRate =
                smoothedTargetY > camera.position.y
                    ? Math.min(1, dt * 7)
                    : Math.min(1, dt * (isLanding ? DRONE.landingEase : 3));
            camera.position.y += (smoothedTargetY - camera.position.y) * lerpRate;

            // Hard floor: never clip into terrain or sea surface.
            const hardFloor = Math.max(gY, WORLD.seaLevel) + 2.0;
            if (camera.position.y < hardFloor) camera.position.y = hardFloor;

            applyLook();

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
