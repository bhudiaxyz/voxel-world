/**
 * Lighting & atmosphere.
 *
 * The atmosphere model, top to bottom:
 *
 *   1. A shared sky function (render/sky.js) drives both the dome and the
 *      colour that distance fades into, so the horizon line does not exist.
 *   2. Scene-level FogExp2 carries the *aerial perspective* — the bulk of the
 *      distance falloff. It lives in the material pass so it is respected by
 *      everything, including transparent water and particles, which a
 *      depth-buffer post pass cannot touch.
 *   3. postfx.js adds the parts that need the depth buffer: valley mist,
 *      large-scale AO, desaturation-with-distance, sun in-scatter, and a
 *      whisper of defocus.
 *
 * The light rig uses a warm key over restrained lilac fill. The reference is
 * high-key, but its light and shadow planes are still plainly different; the
 * pastel character comes from the surface colours, not from flooding every
 * face with the same ambient value.
 *
 * NOTE ON COLOUR: palette colours are already LINEAR. three's lights, fog and
 * clear colour are all consumed in the working (linear) space, so they are
 * handed over as-is. The previous revision ran every one of them through
 * convertLinearToSRGB() first, which silently brightened and de-saturated the
 * entire rig by ~30% and was a large part of why nothing could be graded down
 * without going grey.
 */

import * as THREE from 'three';
import { LIGHT, SKY, FOG } from '../core/palette';
import { SKY_UNIFORMS_GLSL, SKY_FN_GLSL, skyUniformValues } from './sky';
import type { GpuTier } from './gpu-tier';
import { TIER_SETTINGS } from './gpu-tier';

/**
 * Full-resolution dynamic shadowing. `?shadow=` remains only as a diagnostic
 * override; gameplay defaults to 3k.
 */
const SHADOW_RES = (() => {
  const q = new URLSearchParams(location.search).get('shadow');
  return q ? parseInt(q, 10) : 3072;
})();
export const DEFAULT_SHADOW_RESOLUTION = 3072;

// Shadow coverage follows the player, so it must describe the playable view,
// not the full procedural map. Scaling this with a 768-block world spread the
// map across hundreds of invisible blocks and reduced each texel to a large,
// visibly stair-stepped patch. This comfortably covers the furthest camera
// setting and nearby off-screen casters while keeping the texels dense.
const SHADOW_EXTENT = 120;

/**
 * Aerial-perspective density. FogExp2 is 1 - exp(-(density*d)^2), which is the
 * curve we want: nearly transparent up close, then it falls off a cliff.
 * D is the distance at which the medium reaches ~63% opacity.
 *
 * Calibrated against the play camera (~105 units out, world is 192 across):
 *   70u  foreground .12   105u subject .25   160u midground .49
 *   240u far        .78   330u horizon  .95
 * Those numbers are read straight off the reference images.
 */
const AERIAL_D = 90;

/**
 * How far the air stays completely clear, in world units.
 *
 * FogExp2 has no near plane: its curve starts biting at zero distance, so at
 * the play camera's ~50 units roughly a fifth of every surface in frame was
 * already being mixed toward the haze. That is not aerial perspective, it is a
 * flat wash over the whole picture — it drains the palette everywhere and is
 * why turning fog off made the colours look right.
 *
 * Subtracting a near distance before the curve is applied keeps the subject
 * and its surroundings at full chroma while leaving the far falloff untouched:
 * past this radius the original curve resumes exactly as before.
 */
const FOG_NEAR = 96;

/* Patch the fog into every material at once.
 *
 * three's fog chunk is shared by every shader that declares `fog: true`, so
 * editing it here is what keeps terrain, water, foliage and particles agreeing
 * on where the air begins. Doing it per material would guarantee they drift. */
{
  const chunk = THREE.ShaderChunk.fog_fragment;
  const target = 'float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );';
  if (chunk.includes(target)) {
    THREE.ShaderChunk.fog_fragment = chunk.replace(
      target,
      `float fogDepthFar = max( vFogDepth - ${FOG_NEAR.toFixed(1)}, 0.0 );\n` +
        '\tfloat fogFactor = 1.0 - exp( - fogDensity * fogDensity * fogDepthFar * fogDepthFar );',
    );
  } else if (typeof console !== 'undefined') {
    // Fail loudly rather than silently reverting to the washed look.
    console.warn('fog_fragment chunk changed shape; near-plane patch not applied');
  }
}

/**
 * Intensities live here rather than in palette.js because they are a property
 * of the rig, not of the art bible, and because the linear-colour fix above
 * changed what every number means. Hues still come from the palette.
 */
const RIG = {
  sun: 1.85, // warm key gives top faces the reference's peach highlight
  hemi: 1.08, // broad lilac sky lifts the reference's coloured side faces
  fill: 0.22, // camera-side lavender keeps shadow hue without bleaching it
  amb: 0.12, // a soft floor; trunks and occlusion can still carry depth
};

export class Atmosphere {
  declare scene: any;
  declare worldSize: any;
  declare time: any;
  declare aerialD: any;
  declare fogEnabled: any;
  declare hazeColor: any;
  declare sky: any;
  declare shadowExtent: any;
  declare sun: any;
  declare shadowResolution: any;
  declare hemi: any;
  declare fill: any;
  constructor(scene: any, worldSize: any, tier: GpuTier = 'high') {
    this.scene = scene;
    this.worldSize = worldSize;
    this.time = 0;
    this.aerialD = AERIAL_D;
    this.fogEnabled = true;
    const ts = TIER_SETTINGS[tier];

    /* ---- the air ------------------------------------------------- */
    // Fog colour is the skyline colour, because that is where most of the
    // dissolving happens; postfx nudges it per-pixel toward the true
    // directional sky value to finish the job.
    this.hazeColor = SKY.haze.clone().lerp(SKY.horizon, 0.35);
    scene.fog = new THREE.FogExp2(this.hazeColor, 1 / AERIAL_D);
    scene.fog.aerialD = AERIAL_D; // postfx reads this back

    /* ---- sky dome ------------------------------------------------ */
    this.sky = makeSkyDome(worldSize * 2.6, LIGHT.sunDir);
    this.sky.material.uniforms.uNightSkyFull.value = ts.nightSkyFull ? 1.0 : 0.0;
    scene.add(this.sky);

    /* ---- key light ----------------------------------------------- */
    const sun = new THREE.DirectionalLight(LIGHT.sunColor.clone(), RIG.sun);
    sun.position.copy(LIGHT.sunDir).multiplyScalar(worldSize * 1.1);
    sun.castShadow = true;

    // The frustum follows the player, so a fixed view-sized extent keeps the
    // same crisp texel density even as the generated world grows.
    const S = Math.min(worldSize * 0.42, ts.shadowExtent ?? SHADOW_EXTENT);
    this.shadowExtent = S;
    sun.shadow.camera.left = -S;
    sun.shadow.camera.right = S;
    sun.shadow.camera.top = S;
    sun.shadow.camera.bottom = -S;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = worldSize * 3.2;
    const requestedRes = ts.shadowRes > 0 ? ts.shadowRes : SHADOW_RES;
    // Cap to MAX_TEXTURE_SIZE so old mobile GPUs don't silently fail or clamp.
    const gl = (document.createElement('canvas').getContext('webgl2') ||
                document.createElement('canvas').getContext('webgl')) as WebGLRenderingContext | null;
    const maxTex = gl ? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) : 2048;
    const shadowRes = Math.min(requestedRes, maxTex);
    sun.shadow.mapSize.set(shadowRes, shadowRes);
    // Voxels are 1 unit. The old normalBias of 0.5 was half a block, which
    // slid every shadow half a block off its caster (peter-panning at every
    // terrace lip). A tenth of a block kills acne without visible detachment.
    sun.shadow.bias = -0.00018;
    sun.shadow.normalBias = 0.1;
    // VSM's separable blur: enough softness to match the painted reference,
    // with enough samples that the penumbra is smooth rather than speckled.
    sun.shadow.radius = 2.25;
    sun.shadow.blurSamples = ts.shadowBlurSamples ?? 12;
    sun.shadow.intensity = 0.48;
    // Keep this fully dynamic. A day/night system can animate the sun every
    // frame and both terrain and player shadows will respond immediately.
    sun.shadow.autoUpdate = true;
    sun.shadow.needsUpdate = true;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;
    this.shadowResolution = shadowRes;

    /* ---- hemisphere fill ----------------------------------------- */
    const hemi = new THREE.HemisphereLight(LIGHT.skyColor.clone(), LIGHT.groundColor.clone(), RIG.hemi);
    scene.add(hemi);
    this.hemi = hemi;

    /* ---- camera-side bounce -------------------------------------- */
    const fill = new THREE.DirectionalLight(LIGHT.fillColor.clone(), RIG.fill);
    fill.position.set(worldSize * 0.7, worldSize * 0.35, worldSize * 0.9);
    scene.add(fill);
    this.fill = fill;

    scene.add(new THREE.AmbientLight(this.hazeColor.clone(), RIG.amb));
  }

  /**
   * Move the distance at which the aerial fog reaches ~63%. Larger = the
   * world stays clear further out. postfx reads `fog.aerialD` back every
   * frame, so this keeps the material fog and the post pass in agreement.
   */
  setAerialD(d: any) {
    this.aerialD = d;
    this.scene.fog.density = this.fogEnabled ? 1 / d : 0;
    this.scene.fog.aerialD = d;
  }

  /** Enable or disable every fog contribution without losing its settings. */
  setFogEnabled(enabled: any) {
    this.fogEnabled = Boolean(enabled);
    this.scene.fog.enabled = this.fogEnabled;
    this.scene.fog.density = this.fogEnabled ? 1 / this.aerialD : 0;
  }

  /** Reallocate the VSM targets at a developer-selected resolution. */
  setShadowResolution(resolution: any) {
    const requested = Number(resolution);
    const next = requested <= 0 ? 0 : THREE.MathUtils.clamp(Math.round(requested / 1024) * 1024, 1024, 4096);
    if (next === this.shadowResolution) return;

    const shadow = this.sun.shadow;
    shadow.map?.dispose();
    shadow.mapPass?.dispose();
    shadow.map = null;
    shadow.mapPass = null;

    this.shadowResolution = next;
    this.sun.castShadow = next > 0;
    if (next > 0) {
      shadow.mapSize.set(next, next);
      shadow.needsUpdate = true;
    }
  }

  /**
   * Keep the shadow frustum exactly centred on the player. Translate the sun
   * and target by the same delta instead of reconstructing the direction from
   * a constant; this preserves any live day/night rotation applied elsewhere.
   */
  followTarget(x: any, z: any) {
    const s = this.sun;
    const dx = x - s.target.position.x;
    const dz = z - s.target.position.z;
    s.target.position.x = x;
    s.target.position.z = z;
    s.position.x += dx;
    s.position.z += dz;
    s.target.updateMatrixWorld();
    s.updateMatrixWorld();
  }

  update(dt: any, camera: any) {
    this.time += dt;
    if (this.sky) {
      this.sky.position.set(camera.position.x, 0, camera.position.z);
      this.sky.material.uniforms.uTime.value = this.time;
      this.sky.updateMatrixWorld();
    }
  }
}

function makeSkyDome(radius: any, sunDir: any) {
  const geo = new THREE.SphereGeometry(radius, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      ...skyUniformValues(SKY, sunDir, THREE),
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${SKY_UNIFORMS_GLSL}
      uniform float uTime;
      varying vec3 vDir;
      ${SKY_FN_GLSL}

      float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
      float n2(vec2 p){
        vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y);
      }

      void main() {
        vec3 dir = normalize(vDir);
        vec3 col = skyRadiance(dir);

        // Barely-there banded cloud. It exists only so the upper sky has some
        // grain for the eye to land on; at this amplitude it should be
        // impossible to point at any individual cloud.
        vec2 sp = vec2(atan(dir.z, dir.x) * 1.6, dir.y * 3.4);
        float cl = n2(sp * 1.7 + vec2(uTime * 0.006, 0.0)) * 0.6
                 + n2(sp * 4.1 - vec2(uTime * 0.011, 0.0)) * 0.4;
        cl = smoothstep(0.50, 0.92, cl) * smoothstep(0.02, 0.5, dir.y);
        col = mix(col, col * 1.035, cl * 0.7);

        // Linear out. OutputPass owns tone mapping and the sRGB transfer for
        // the whole frame; doing it here as well (as this shader used to)
        // encodes twice and is why the sky washed out to white.
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -1000;
  m.frustumCulled = false;
  return m;
}

export { AERIAL_D, FOG_NEAR, FOG };
