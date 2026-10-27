import * as THREE from 'three';

const EYE_HEIGHT = 1.75;
const SENSITIVITY = 0.0021;
const PITCH_LIMIT = Math.PI / 2 - 0.05;
const HEAD_BOB_AMP = 0.022; // metres of vertical oscillation
const HEAD_BOB_HZ = 2.2; // cycles per second at full sprint

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
  private _touchWish: THREE.Vector3;
  /** Raw joystick axes set by setTouchMove — used by drone for its own yaw. */
  _joyX = 0;
  _joyY = 0;
  private _prevSpace: boolean;
  // Drone mouse/altitude accumulators — drained each frame by DroneMode (Task 9)
  private _droneMX: number;
  private _droneAltDelta: number;

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
    this._touchWish = new THREE.Vector3();
    this._prevSpace = false;
    this._droneMX = 0;
    this._droneAltDelta = 0;

    this._bindEvents();
  }

  private _bindEvents(): void {
    const dom = this._dom;

    dom.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button === 0 && !this.isLocked) dom.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement === dom;
      dom.style.cursor = this.isLocked ? 'none' : 'default';
    });

    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.isLocked) return;
      if (this.droneActive) {
        this._droneMX += e.movementX;
        // Mouse Y is intentionally NOT wired to altitude — any tiny upward
        // mouse drift would cause continuous climb. Space/C/scroll handle it.
        return;
      }
      // fly mode shares direct yaw/pitch update (falls through here intentionally)
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
    // Touch wish is already in world space (set by touch-controls.ts)
    if (this.touchActive && this._touchWish.lengthSq() > 0) {
      return w.copy(this._touchWish);
    }
    if (!this.isLocked || this.droneActive || this.flyActive) return w;
    const fwd = -Math.sin(this.yaw);
    const rgt = Math.cos(this.yaw);
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
    const fwd = -Math.sin(this.yaw);
    const rgt = Math.cos(this.yaw);
    this._touchWish.set(fwd * ny + rgt * nx, 0, -rgt * ny + fwd * nx);
    if (this._touchWish.lengthSq() > 0) this._touchWish.normalize();
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

  /** Drain accumulated drone yaw input since last call. */
  drainDroneMX(): number {
    const v = this._droneMX;
    this._droneMX = 0;
    return v;
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
