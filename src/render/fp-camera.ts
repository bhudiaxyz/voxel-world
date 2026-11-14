import * as THREE from 'three';

const EYE_HEIGHT = 1.75;
const SENSITIVITY = 0.0021;
const PITCH_LIMIT = Math.PI / 2 - 0.05;
const HEAD_BOB_AMP = 0.022; // metres of vertical oscillation
const HEAD_BOB_HZ = 2.2; // cycles per second at full sprint
/** Max camera roll from Q/E in drone/fly mode (radians, ~34°). */
const ROLL_MAX = 0.6;

export class FPCamera {
    camera: THREE.PerspectiveCamera;
    yaw: number;
    pitch: number;
    isLocked: boolean;
    droneActive: boolean;
    _keys: Set<string>;

    /** Set true on touch devices; bypasses pointer-lock requirement for movement. */
    touchActive: boolean;
    /** Set true while in fly mode; blocks controller-driven camera update, keeps direct yaw/pitch. */
    flyActive: boolean;
    /** Touch ascend (+1) / descend (-1) held state for drone/fly mode. */
    touchAltAxis: number;
    /** Set true while sprint button held on touch; injects ShiftLeft into _keys. */
    set touchSprint(on: boolean) {
        if (on) this._keys.add('ShiftLeft');
        else this._keys.delete('ShiftLeft');
    }
    private _dom: HTMLElement;
    private _jumpEdge: boolean;
    private _bobPhase: number;
    private _wishV: THREE.Vector3;
    /** Raw joystick axes set by setTouchMove — used by drone for its own yaw. */
    _joyX = 0;
    _joyY = 0;
    private _prevSpace: boolean;
    // Drone altitude accumulator (scroll wheel) — drained each frame.
    private _droneAltDelta: number;
    /**
     * Camera roll (radians) for drone and fly mode — Q/E or the touch ⟲⟳
     * buttons, as planet-explorer. Eased toward the held input and sprung back
     * to level on release, so the horizon never stays crooked by accident.
     */
    roll = 0;
    /** Touch roll input: -1 (⟲ left), 0, +1 (⟳ right). */
    touchRoll = 0;

    constructor(aspect: number, domElement: HTMLElement, cameraFar = 6000) {
        this.camera = new THREE.PerspectiveCamera(72, aspect, 0.1, cameraFar);
        this.camera.rotation.order = 'YXZ';

        this.yaw = 0;
        this.pitch = 0;
        this.isLocked = false;
        this.droneActive = false;
        this.flyActive = false;
        this.touchActive = false;
        this.touchAltAxis = 0;

        this._dom = domElement;
        this._keys = new Set<string>();
        this._jumpEdge = false;
        this._bobPhase = 0;
        this._wishV = new THREE.Vector3();
        this._prevSpace = false;
        this._droneAltDelta = 0;

        this._bindEvents();
    }

    private _bindEvents(): void {
        const dom = this._dom;

        dom.addEventListener('pointerdown', (e: PointerEvent) => {
            if (e.pointerType === 'mouse' && e.button === 0 && !this.isLocked) dom.requestPointerLock();
        });

        document.addEventListener('pointerlockchange', () => {
            this.isLocked = document.pointerLockElement === dom;
            dom.style.cursor = this.isLocked ? 'none' : 'default';
        });

        document.addEventListener('mousemove', (e: MouseEvent) => {
            if (!this.isLocked) return;
            // Walk, fly AND drone all share direct yaw/pitch (as planet-explorer).
            // In the drone, yaw steers the heading and pitch only tilts the camera
            // — it never changes altitude (Space/C/scroll own that), so mouse
            // drift cannot cause a climb.
            this.yaw -= e.movementX * SENSITIVITY;
            this.pitch -= e.movementY * SENSITIVITY;
            this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
        });

        document.addEventListener('keydown', (e: KeyboardEvent) => {
            this._keys.add(e.code);
            if (e.code === 'Space') {
                e.preventDefault();
                if (!this._prevSpace) this._jumpEdge = true;
                this._prevSpace = true;
            }
        });
        document.addEventListener('keyup', (e: KeyboardEvent) => {
            this._keys.delete(e.code);
            if (e.code === 'Space') this._prevSpace = false;
        });
        window.addEventListener('blur', () => {
            this._keys.clear();
            this._prevSpace = false;
        });

        dom.addEventListener(
            'wheel',
            (e: WheelEvent) => {
                if (this.droneActive) this._droneAltDelta -= e.deltaY * 0.02;
            },
            { passive: true },
        );
    }

    /**
     * Horizontal wish direction in world space (normalised, Y=0),
     * or zero vector when no movement keys held or not locked.
     */
    getWish(): THREE.Vector3 {
        const w = this._wishV.set(0, 0, 0);
        if (this.droneActive || this.flyActive) return w;
        const fwd = -Math.sin(this.yaw);
        const rgt = Math.cos(this.yaw);
        // Touch joystick — rebuilt from current yaw each frame so swipe-look steers while held.
        if (this.touchActive && (this._joyX || this._joyY)) {
            const nx = this._joyX,
                ny = this._joyY;
            return w.set(fwd * ny + rgt * nx, 0, -rgt * ny + fwd * nx).normalize();
        }
        if (!this.isLocked) return w;
        if (this._keys.has('KeyW') || this._keys.has('ArrowUp')) {
            w.x += fwd;
            w.z -= rgt;
        }
        if (this._keys.has('KeyS') || this._keys.has('ArrowDown')) {
            w.x -= fwd;
            w.z += rgt;
        }
        if (this._keys.has('KeyD') || this._keys.has('ArrowRight')) {
            w.x += rgt;
            w.z += fwd;
        }
        if (this._keys.has('KeyA') || this._keys.has('ArrowLeft')) {
            w.x -= rgt;
            w.z -= fwd;
        }
        if (w.lengthSq() > 0) w.normalize();
        return w;
    }

    /** Called by touch-controls each frame with joystick vector (-1..1 each axis). */
    setTouchMove(nx: number, ny: number): void {
        if (!this.touchActive) return;
        this._joyX = nx;
        this._joyY = ny;
    }

    /** Accumulate touch look delta (radians). */
    applyTouchLook(dyaw: number, dpitch: number): void {
        this.yaw -= dyaw;
        this.pitch -= dpitch;
        this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
    }

    triggerTouchJump(): void {
        if (!this._prevSpace) this._jumpEdge = true;
    }

    /** Returns true on the frame Space is first pressed, then resets. */
    getJumpEdge(): boolean {
        const v = this._jumpEdge;
        this._jumpEdge = false;
        return v;
    }

    getJumpHeld(): boolean {
        return this._keys.has('Space');
    }

    isKeyDown(code: string): boolean {
        return this._keys.has(code);
    }

    /**
     * Advance camera roll toward the held Q/E (or touch ⟲⟳) input. Only meant
     * for drone and fly mode; walking resets it to level. Returns the roll.
     */
    updateRoll(dt: number, airborne: boolean): number {
        const input = airborne
            ? (this._keys.has('KeyE') ? 1 : 0) - (this._keys.has('KeyQ') ? 1 : 0) + this.touchRoll
            : 0;
        const target = Math.max(-1, Math.min(1, input)) * ROLL_MAX;
        // Lean in briskly, settle back a little slower so it feels like banking.
        const rate = input !== 0 ? 4.0 : 2.5;
        this.roll += (target - this.roll) * Math.min(1, dt * rate);
        if (!airborne) this.roll = 0;
        return this.roll;
    }

    /**
     * Drain accumulated drone altitude delta since last call.
     * Returns a value in m/s so that the caller can do `hoverAltitude += result * dt`.
     *   Keys / touch: ±12 m/s rate.
     *   Scroll wheel:  direct-delta converted to rate by dividing by dt,
     *                  so `rate * dt` restores the original per-tick offset.
     */
    drainDroneAltDelta(dt = 0): number {
        const keyAxis = (this._keys.has('Space') ? 1 : 0) - (this._keys.has('KeyC') ? 1 : 0);
        // Scroll gives a direct position delta; convert to rate so dt cancels cleanly.
        const scrollRate = dt > 0 ? this._droneAltDelta / dt : 0;
        this._droneAltDelta = 0;
        return scrollRate + (keyAxis + this.touchAltAxis) * 12;
    }

    /**
     * Position camera at eye height above controllerPos, apply yaw/pitch.
     * Adds head-bob when grounded and moving.
     */
    update(dt: number, controllerPos: THREE.Vector3, speedFraction = 0, grounded = true): void {
        if (this.droneActive || this.flyActive) return;

        if (grounded && speedFraction > 0.05) {
            this._bobPhase += dt * HEAD_BOB_HZ * Math.PI * 2;
        } else {
            this._bobPhase *= Math.max(0, 1 - dt * 8);
        }
        const bob = Math.sin(this._bobPhase) * HEAD_BOB_AMP * speedFraction;

        this.camera.position.set(controllerPos.x, controllerPos.y + EYE_HEIGHT + bob, controllerPos.z);
        this.camera.rotation.set(this.pitch, this.yaw, 0);
    }

    resize(aspect: number): void {
        this.camera.aspect = aspect;
        this.camera.updateProjectionMatrix();
    }
}
