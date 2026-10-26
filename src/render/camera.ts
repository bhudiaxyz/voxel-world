/**
 * The camera rig.
 *
 * A long-lens near-isometric view: a narrow FOV placed far back gives us the
 * flattened, model-railway parallax of the reference images while keeping
 * perspective's depth cues. It trails the player with critically-damped
 * springs so movement feels weighty but never sloppy, and leads slightly in
 * the direction of travel so you can see where you're going.
 */

import * as THREE from 'three';

const DEG = Math.PI / 180;

export class CameraRig {
  declare camera: any;
  declare yaw: any;
  declare targetYaw: any;
  declare pitch: any;
  declare distance: any;
  declare targetDistance: any;
  declare minDistance: any;
  declare maxDistance: any;
  declare focus: any;
  declare smoothFocus: any;
  declare lead: any;
  declare smoothLead: any;
  declare shake: any;
  declare _shakeOff: any;
  declare _tmp: any;
  constructor(aspect: any) {
    this.camera = new THREE.PerspectiveCamera(21, aspect, 1, 620);

    /** orbit yaw, snapped to 45° increments by the shoulder buttons */
    this.yaw = 45 * DEG;
    this.targetYaw = this.yaw;
    this.pitch = 33.5 * DEG;
    /**
     * How chunky the voxels read is decided here, not in the mesh.
     *
     * A block's size on screen is (block size / camera distance). At the old
     * 108 units with a 21° lens the frame held ~69 blocks across and the world
     * dissolved into fine mosaic. The references hold roughly 25 blocks across
     * — big, confident cubes you can count. That means ~40 units out.
     */
    this.distance = 50;
    this.targetDistance = 50;
    this.minDistance = 50;
    this.maxDistance = 120;

    this.focus = new THREE.Vector3(0, 12, 0);
    this.smoothFocus = this.focus.clone();
    this.lead = new THREE.Vector3();
    this.smoothLead = new THREE.Vector3();

    this.shake = 0;
    this._shakeOff = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
  }

  rotate(dir: any) {
    this.targetYaw += dir * 45 * DEG;
  }
  zoom(delta: any) {
    this.targetDistance = THREE.MathUtils.clamp(this.targetDistance + delta, this.minDistance, this.maxDistance);
  }
  setZoomRange(min: any, max: any) {
    this.minDistance = min;
    this.maxDistance = Math.max(max, min + 1);
    this.targetDistance = THREE.MathUtils.clamp(this.targetDistance, this.minDistance, this.maxDistance);
  }
  kick(amount: any) {
    this.shake = Math.min(this.shake + amount, 1);
  }

  /**
   * @param target  world position to frame (the player)
   * @param velocity player velocity, used for look-ahead
   */
  update(dt: any, target: any, velocity: any) {
    const k = 1 - Math.exp(-7.5 * dt); // frame-rate independent damping
    const kSlow = 1 - Math.exp(-4.0 * dt);

    this.yaw += (this.targetYaw - this.yaw) * (1 - Math.exp(-9 * dt));
    this.distance += (this.targetDistance - this.distance) * kSlow;

    // Look-ahead: push the focus point along the travel direction.
    if (velocity) {
      this.lead.set(velocity.x, velocity.y * 0.25, velocity.z).multiplyScalar(0.42);
      if (this.lead.length() > 7) this.lead.setLength(7);
    }
    this.smoothLead.lerp(this.lead, kSlow);

    this.focus.copy(target);
    this.focus.y += 2.2;
    this.smoothFocus.lerp(this._tmp.copy(this.focus).add(this.smoothLead), k);

    const cp = Math.cos(this.pitch),
      sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw),
      sy = Math.sin(this.yaw);
    const d = this.distance;

    this.camera.position.set(
      this.smoothFocus.x + cy * cp * d,
      this.smoothFocus.y + sp * d,
      this.smoothFocus.z + sy * cp * d,
    );

    if (this.shake > 0.0001) {
      const s = this.shake * this.shake * 0.55;
      const t = performance.now() * 0.001;
      this._shakeOff.set(Math.sin(t * 47.3) * s, Math.sin(t * 39.7) * s * 0.8, Math.cos(t * 53.1) * s);
      this.camera.position.add(this._shakeOff);
      this.shake = Math.max(0, this.shake - dt * 3.2);
    }

    this.camera.lookAt(this.smoothFocus);
  }

  /** Movement input is given in screen space; convert it to world space. */
  screenToWorld(ix: any, iz: any, out: any) {
    const cy = Math.cos(this.yaw),
      sy = Math.sin(this.yaw);
    // forward = -camera horizontal direction, right = forward x up
    const fx = -cy,
      fz = -sy;
    const rx = sy,
      rz = -cy;
    out.set(fx * -iz + rx * ix, 0, fz * -iz + rz * ix);
    if (out.lengthSq() > 1) out.normalize();
    return out;
  }

  resize(aspect: any) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
