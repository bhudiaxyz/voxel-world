/**
 * Day/night cycle — animates the sun through a 24-hour loop with key-framed
 * palette blending. All palette colours are linear (no sRGB conversion).
 */
import * as THREE from 'three';

// Minimal interface for what we need from Atmosphere (lighting.js).
interface AtmoLike {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fill: THREE.DirectionalLight;
  sky: THREE.Mesh;
  worldSize: number;
  scene: THREE.Scene & { fog: THREE.FogExp2 };
}

/**
 * Key-framed sky/light palettes — all linear colours.
 * timeOfDay: 0=midnight, 0.25=dawn, 0.5=noon, 0.75=dusk, 1=midnight
 */
const TIMES = [0.0, 0.2, 0.27, 0.5, 0.73, 0.8, 1.0];

const PALETTE = {
  // [midnight, predawn, sunrise, noon, sunset, dusk, midnight]
  zenith: [
    new THREE.Color(0x080c18),
    new THREE.Color(0x0e1630),
    new THREE.Color(0x2a3a6a),
    new THREE.Color(0x4878a8),
    new THREE.Color(0x1e2a5a),
    new THREE.Color(0x0e1228),
    new THREE.Color(0x080c18),
  ],
  horizon: [
    new THREE.Color(0x0c0a08),
    new THREE.Color(0x2a1808),
    new THREE.Color(0xe87840),
    new THREE.Color(0xa0b0b8),
    new THREE.Color(0xd85830),
    new THREE.Color(0x281808),
    new THREE.Color(0x0c0a08),
  ],
  haze: [
    new THREE.Color(0x080c10),
    new THREE.Color(0x1e1408),
    new THREE.Color(0xe09050),
    new THREE.Color(0xb0c0c8),
    new THREE.Color(0xe09050),
    new THREE.Color(0x1e1408),
    new THREE.Color(0x080c10),
  ],
  sunColor: [
    new THREE.Color(0xa0b8c0),
    new THREE.Color(0xff8830),
    new THREE.Color(0xff6820),
    new THREE.Color(0xffe8b8),
    new THREE.Color(0xff6820),
    new THREE.Color(0xff8830),
    new THREE.Color(0xa0b8c0),
  ],
  sunIntensity: [0.02, 0.25, 0.75, 1.85, 0.75, 0.25, 0.02],
  hemiIntensity: [0.1, 0.25, 0.55, 1.08, 0.55, 0.25, 0.1],
  fillIntensity: [0.01, 0.05, 0.12, 0.22, 0.12, 0.05, 0.01],
};

function keyframe(t: number): { i: number; a: number } {
  for (let i = 0; i < TIMES.length - 1; i++) {
    if (t <= TIMES[i + 1]) {
      return { i, a: (t - TIMES[i]) / (TIMES[i + 1] - TIMES[i]) };
    }
  }
  return { i: TIMES.length - 2, a: 1 };
}

function lerpColor(arr: THREE.Color[], ia: { i: number; a: number }, out: THREE.Color): THREE.Color {
  return out.lerpColors(arr[ia.i], arr[ia.i + 1], ia.a);
}

function lerpScalar(arr: number[], ia: { i: number; a: number }): number {
  return arr[ia.i] * (1 - ia.a) + arr[ia.i + 1] * ia.a;
}

export class DayNight {
  timeOfDay: number; // 0–1; 0=midnight, 0.25=sunrise, 0.5=noon, 0.75=sunset
  dayLengthSeconds: number; // default 1200
  /** Wire this to world.meshes.material.userData.uniforms to get time-of-day voxel tints. */
  voxelUniforms: Record<string, { value: any }> | null = null;

  private readonly atmo: AtmoLike;
  private readonly renderer: THREE.WebGLRenderer | null;
  private readonly _sunDir = new THREE.Vector3();
  private readonly _moonDir = new THREE.Vector3();
  private readonly _col = new THREE.Color();
  private readonly _fillBase = new THREE.Color(0x8090c0);
  private _shadowSunY = Infinity;

  constructor(atmosphere: AtmoLike, renderer?: THREE.WebGLRenderer) {
    this.atmo = atmosphere;
    this.renderer = renderer ?? null;
    this.timeOfDay = 0.5; // start at noon
    this.dayLengthSeconds = 1200;
  }

  /** 0 = full day (noon), 1 = full night (midnight). */
  getNightFactor(): number {
    const d = Math.abs(this.timeOfDay - 0.5) * 2;
    return Math.max(0, (d - 0.3) / 0.7);
  }

  /**
   * Update the noon (index 3) sky keyframes so the day cycle reflects the
   * active palette. Call from onPaletteChange after setVoxelPalette().
   */
  applyNoonSky(sky: { zenith: number; horizon: number; haze: number }, sunColorHex: number): void {
    PALETTE.zenith[3].set(sky.zenith);
    PALETTE.horizon[3].set(sky.horizon);
    PALETTE.haze[3].set(sky.haze);
    PALETTE.sunColor[3].set(sunColorHex);
  }

  /** Expose sun direction without allocating — callers must not mutate. */
  get sunDir(): THREE.Vector3 {
    return this._sunDir;
  }
  getSunDir(): THREE.Vector3 {
    return this._sunDir.clone();
  }
  getMoonDir(): THREE.Vector3 {
    return this._moonDir.clone();
  }

  update(dt: number): void {
    this.timeOfDay = (this.timeOfDay + dt / this.dayLengthSeconds) % 1;
    const t = this.timeOfDay;
    // Compute keyframe segment once — all lerp calls below share the same t.
    const ia = keyframe(t);

    // Full circle: 0=midnight (sun below), 0.5=noon (sun overhead)
    const a = t * Math.PI * 2;

    this._sunDir
      .set(
        -Math.cos(a),
        Math.sin(a) * 1.1 - 0.1, // slight downward bias keeps sun below horizon at night
        0.3,
      )
      .normalize();

    this._moonDir.copy(this._sunDir).multiplyScalar(-1);

    const atmo = this.atmo;
    const S = atmo.worldSize;

    // Position sun relative to shadow target so followTarget() keeps working.
    atmo.sun.position
      .copy(this._sunDir)
      .multiplyScalar(S * 1.1)
      .add(atmo.sun.target.position);
    atmo.sun.updateMatrixWorld();

    // Intensities
    atmo.sun.intensity = lerpScalar(PALETTE.sunIntensity, ia);
    atmo.hemi.intensity = lerpScalar(PALETTE.hemiIntensity, ia);
    atmo.fill.intensity = lerpScalar(PALETTE.fillIntensity, ia);

    // Colours
    lerpColor(PALETTE.sunColor, ia, this._col);
    atmo.sun.color.copy(this._col);
    atmo.fill.color.copy(this._col).lerp(this._fillBase, 0.6);

    // Sky dome uniforms
    const skyMat = atmo.sky.material as THREE.ShaderMaterial;
    lerpColor(PALETTE.zenith, ia, skyMat.uniforms['uSkyZenith'].value as THREE.Color);
    lerpColor(PALETTE.horizon, ia, skyMat.uniforms['uSkyHorizon'].value as THREE.Color);
    lerpColor(PALETTE.haze, ia, skyMat.uniforms['uSkyNadir'].value as THREE.Color);
    // Keep the sun glow direction in sync with the animated sun
    (skyMat.uniforms['uSunDirW'].value as THREE.Vector3).copy(this._sunDir);
    // uSunGlow: scale by current intensity so the halo fades at night
    const glowScale = Math.max(0, this._sunDir.y) * atmo.sun.intensity * 0.087;
    lerpColor(PALETTE.sunColor, ia, this._col);
    (skyMat.uniforms['uSunGlow'].value as THREE.Color).copy(this._col).multiplyScalar(glowScale);
    // uSunColor: used for limb glow halo and disc, fades to black at night
    const sunColorScale = Math.max(0, this._sunDir.y + 0.15);
    (skyMat.uniforms['uSunColor'].value as THREE.Color).copy(this._col).multiplyScalar(sunColorScale);

    // Night sky uniforms
    const nightF = this.getNightFactor();
    skyMat.uniforms['uNight'].value = nightF;
    // Aurora fades in as deep night deepens (nightF > 0.5 → full at nightF = 1)
    skyMat.uniforms['uAurora'].value = Math.max(0, (nightF - 0.5) / 0.5);
    skyMat.uniforms['uAuroraTime'].value += dt * 0.3;
    (skyMat.uniforms['uMoonDir'].value as THREE.Vector3).copy(this._moonDir);
    skyMat.uniforms['uStarAngle'].value =
      ((skyMat.uniforms['uStarAngle'].value as number) + dt * 0.0001) % (Math.PI * 2);

    skyMat.needsUpdate = false; // values are mutable; no recompile needed

    // Fog colour tracks the haze palette
    lerpColor(PALETTE.haze, ia, atmo.scene.fog.color);

    // Renderer clear colour (used for the brief gap before the sky dome covers it)
    if (this.renderer) {
      this.renderer.setClearColor(atmo.scene.fog.color);
      // When shadowMap.autoUpdate is off (very-low tier) only re-render shadows
      // when the sun has moved enough to be visible (~0.5° in Y).
      if (!this.renderer.shadowMap.autoUpdate) {
        if (Math.abs(this._sunDir.y - this._shadowSunY) > 0.009) {
          this._shadowSunY = this._sunDir.y;
          this.renderer.shadowMap.needsUpdate = true;
        }
      }
    }

    // Push time-of-day tints to the voxel material.
    if (this.voxelUniforms) {
      const vu = this.voxelUniforms;
      // Live sun direction
      vu['uSunDir'].value.copy(this._sunDir);
      // Sun intensity: scales diffuse boost with elevation
      const elev = Math.max(0, this._sunDir.y);
      vu['uSunAmbient'].value = 0.08 + elev * 0.18;
      // Fill ambient: slightly higher at night to prevent total black (moon bounce)
      vu['uFillAmbient'].value = 0.04 + (1 - elev) * 0.04;
      // Sun tint: warm orange-gold at horizon, neutral white at noon
      const horizonWarm = Math.pow(Math.max(0, 1 - elev * 2.5), 2);
      lerpColor(PALETTE.sunColor, ia, this._col);
      vu['uSunTint'].value.set(
        1.0 + (this._col.r - 1.0) * horizonWarm * 0.6,
        1.0 + (this._col.g - 1.0) * horizonWarm * 0.6,
        1.0 + (this._col.b - 1.0) * horizonWarm * 0.6,
      );
      // Ambient tint: cool blue at night, neutral at day
      const night = this.getNightFactor();
      vu['uAmbientTint'].value.set(
        1.0 - night * 0.08,
        1.0 - night * 0.04,
        1.0 + night * 0.12,
      );
    }
  }
}
