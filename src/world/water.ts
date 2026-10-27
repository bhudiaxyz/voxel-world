/**
 * Water.
 *
 * A single translucent plane at sea level. Three things make it read as water
 * rather than as a blue sheet:
 *
 *   1. A real surface normal, from the analytic derivative of the wave field
 *      rather than from a fake ripple scalar. Everything angular hangs off it
 *      — the sun glint, the fresnel, and the refraction offset — so all three
 *      agree with each other and with the wave you can see.
 *   2. Depth blending by Beer-Lambert absorption along the ACTUAL view ray,
 *      not by a lookup keyed on position. Path length is what the eye reads as
 *      depth, and it grows as the camera lowers, so the far water darkens and
 *      the near shallows stay clear from the same surface.
 *   3. Per-channel extinction, so depth is a hue shift rather than a fade to
 *      grey. Red goes first, which is why deep water turns blue-green in life
 *      and why a single-colour lerp never quite convinces.
 *
 * No reflections — they would fight the flat pastel look — just sky at grazing
 * angles and one specular highlight.
 */

import * as THREE from 'three';
import { WATER, SKY, LIGHT } from '../core/palette';
import { PLANET_UNIFORMS_GLSL, PLANET_BEND_GLSL, planetUniformValues } from '../render/planet.glsl';

/**
 * Half-range of the signed depth field, in world units. The texture is
 * eight-bit and centred on the waterline, so a step is 2*20/255 ≈ 0.16 of a
 * block — finer than the terrain, which moves a whole block at a time.
 */
export const DEPTH_RANGE = 34.0;

/**
 * Bake how deep the water is at every column straight from the heightfield.
 *
 * The first version sampled the scene depth buffer, but the water is drawn
 * *into* that same buffer during the same pass — reading and writing it at
 * once is undefined, and it turned the river into a sheet of white. The
 * heightfield already knows the answer exactly, so we just look it up.
 *
 * Stored as SIGNED depth in world units, with the waterline at the midpoint.
 *
 * Two reasons it is signed rather than clamped at zero. The shader needs a
 * real distance to integrate absorption over, which a 0..1 ramp has already
 * thrown away. And clamping flattens the whole dry side to a single value,
 * which leaves no gradient there and therefore no contour to find — the dark
 * waterline is drawn at the zero crossing of this field, and a field that
 * bottoms out at the shore has no zero crossing to draw.
 */
export function makeDepthMap(world: any) {
  const S = world.size;
  // RG: R = signed water depth (same as before), G = river proximity 0–255
  const data = new Uint8Array(S * S * 2);
  const rivFlow: Uint8Array | null = world.rivFlow ?? null;
  for (let z = 0; z < S; z++) {
    for (let x = 0; x < S; x++) {
      const i = z * S + x;
      const top = world.heights[i];
      const d = WATER.level - (top + 1);
      const t = (d + DEPTH_RANGE) / (2 * DEPTH_RANGE);
      data[i * 2 + 0] = Math.max(0, Math.min(1, t)) * 255;
      data[i * 2 + 1] = rivFlow ? rivFlow[i] : 0;
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

// Shared noise + analytic wave field — injected into both vertex and fragment
// shaders so displaced geometry and surface normals always agree.
const WAVE_GLSL = /* glsl */ `
  float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
  float n2(vec2 p){
    vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y);
  }
  // Returns height in .x, partial derivatives (slope) in .yz.
  // Amplitudes are 3× the original fragment-only values so vertex
  // displacement is visible from the default play camera.
  vec3 waveField(vec2 p, float t) {
    vec3 acc = vec3(0.0);
    vec2 d0 = normalize(vec2( 1.00,  0.34));
    vec2 d1 = normalize(vec2(-0.42,  1.00));
    vec2 d2 = normalize(vec2( 0.83, -0.72));
    vec2 d3 = normalize(vec2(-0.91, -0.55));
    float k0 = 0.34, k1 = 0.51, k2 = 1.07, k3 = 1.93;
    float a0 = 0.21,  a1 = 0.14,  a2 = 0.06,  a3 = 0.025;
    float s0 = 0.62, s1 = 0.83, s2 = 1.34, s3 = 2.05;
    float ph0 = dot(d0, p)*k0 + t*s0;
    float ph1 = dot(d1, p)*k1 + t*s1;
    float ph2 = dot(d2, p)*k2 + t*s2;
    float ph3 = dot(d3, p)*k3 + t*s3;
    acc.x  = a0*sin(ph0) + a1*sin(ph1) + a2*sin(ph2) + a3*sin(ph3);
    acc.yz = a0*k0*cos(ph0)*d0 + a1*k1*cos(ph1)*d1
           + a2*k2*cos(ph2)*d2 + a3*k3*cos(ph3)*d3;
    return acc;
  }
`;

export function createWater(size: any, depthMap: any, tier: string = 'high', waterSubdivision?: number) {
  const sub = waterSubdivision ?? (tier === 'high' ? 64 : 32);
  const geo = new THREE.PlaneGeometry(size * 1.9, size * 1.9, sub, sub);
  geo.rotateX(-Math.PI / 2);

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uShoal: { value: WATER.shoal.clone() },
        uShallow: { value: WATER.shallow.clone() },
        uDeep: { value: WATER.deep.clone() },
        uWarm: { value: WATER.warm.clone() },
        uSheen: { value: WATER.sheen.clone() },
        uHorizon: { value: SKY.horizon.clone() },
        uSky: { value: SKY.zenith.clone() },
        uSunDir: { value: LIGHT.sunDir.clone().normalize() },
        uSunColor: { value: LIGHT.sunColor.clone() },
        uExtinction: { value: new THREE.Vector3(...WATER.extinction) },
        uDepthMap: { value: depthMap },
        uWorldSize: { value: size },
        uRange: { value: DEPTH_RANGE },
        uOpacity: { value: WATER.opacity },
        uDensity: { value: WATER.density },
        uSaturation: { value: WATER.saturation },
        uCellTone: { value: WATER.cellTone },
        uCaustic: { value: WATER.caustic },
        uReflect: { value: WATER.reflect },
        uLevel: { value: WATER.level },
        ...planetUniformValues(new THREE.Vector3()),
      },
    ]),
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      ${PLANET_UNIFORMS_GLSL}
      ${PLANET_BEND_GLSL}
      ${WAVE_GLSL}
      uniform float uTime;
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        // Displace Y by the analytic wave height so geometry has real depth.
        vec3 wave = waveField(vWorld.xz, uTime);
        vWorld.y += wave.x;
        // Pass the analytic surface normal to planet-bend so the bend axis
        // stays consistent with the displaced surface.
        vec3 wNrm = normalize(vec3(-wave.y, 1.0, -wave.z));
        applyPlanetBend(vWorld, wNrm);
        vec4 mvPosition = viewMatrix * vec4(vWorld, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <packing>
      #include <fog_pars_fragment>
      uniform float uTime, uOpacity, uDensity, uSaturation, uCellTone, uCaustic, uReflect;
      uniform float uWorldSize, uRange, uLevel;
      uniform vec3 uShoal, uShallow, uDeep, uWarm, uSheen, uHorizon, uSky, uSunDir, uSunColor;
      uniform vec3 uExtinction;
      uniform sampler2D uDepthMap;
      varying vec3 vWorld;

      ${WAVE_GLSL}

      /**
       * A caustic web: thin interlocking filaments of focused light.
       *
       * Built from the near-agreement of two noise fields drifting against
       * each other. Where they briefly match, their difference collapses and a
       * bright filament appears; as they slide apart it travels along the
       * pattern. That motion is the whole point — light focused by a moving
       * surface moves ACROSS the bed, whereas a patch that brightens and dims
       * in place reads as a stain rather than as light.
       */
      float causticWeb(vec2 p, float t) {
        vec2 a1 = p * 0.42        + vec2( t * 0.055, -t * 0.041);
        vec2 a2 = p * 0.42 * 1.31 + vec2(-t * 0.037,  t * 0.061) + 41.3;
        float web = pow(max(1.0 - abs(n2(a1) - n2(a2)) * 3.4, 0.0), 3.0);

        // A second, finer set at a non-integer ratio, so the two never lock
        // into a repeating moire.
        vec2 b1 = p * 0.95        + vec2(-t * 0.083,  t * 0.062) +  7.1;
        vec2 b2 = p * 0.95 * 1.27 + vec2( t * 0.071,  t * 0.049) + 91.7;
        web += pow(max(1.0 - abs(n2(b1) - n2(b2)) * 3.6, 0.0), 3.0) * 0.55;
        return min(web, 1.5);
      }

      /**
       * Signed distance from the waterline at a world XZ, in world units.
       * Positive under water, negative over land, zero exactly at the shore.
       * Returns depth in .x and river proximity [0,1] in .y.
       */
      vec2 sampleDepthMap(vec2 worldXZ) {
        vec2 t = worldXZ / uWorldSize;
        if (t.x < 0.0 || t.x > 1.0 || t.y < 0.0 || t.y > 1.0) return vec2(uRange, 0.0);
        vec2 s = texture2D(uDepthMap, t).rg;
        return vec2((s.r * 2.0 - 1.0) * uRange, s.g);
      }
      float depthAt(vec2 worldXZ) { return sampleDepthMap(worldXZ).x; }

      void main() {
        vec2 uv = vWorld.xz;
        vec3 V = normalize(cameraPosition - vWorld);

        /* Which side of the surface the camera is on.
         *
         * Wading into the river puts the camera under the plane, and every
         * angular term below then runs backwards: dot(N, V) goes negative, so
         * the fresnel saturates and the sheet turns into an opaque ceiling of
         * sky blue with the scene behind it erased. Seen from beneath, the
         * surface should be nearly clear instead — the player is standing IN
         * the river, and needs to see out of it. */
        float above = step(uLevel, cameraPosition.y);

        // River proximity [0,1] — 1 at channel centre, 0 on open water / land.
        float rivProx = sampleDepthMap(uv).y;

        // --- surface -----------------------------------------------------
        // Rivers run faster: scale wave speed proportional to river proximity.
        float riverSpeed = 1.0 + rivProx * 1.8;
        vec3 wave = waveField(uv, uTime * riverSpeed);
        // A slow swell riding under the wave trains. Real caustics are not
        // uniformly bright — wave grouping gathers the focus into broad bands
        // and leaves the water between them dim — so this modulates the web's
        // intensity at a much larger scale than the web itself.
        float swell = n2(uv * 0.055 + vec2(uTime * 0.021, -uTime * 0.017));
        vec3 N = normalize(vec3(-wave.y, 1.0, -wave.z));

        /* --- depth, along the view ray ------------------------------------
         * The lookup gives the vertical drop to the bottom. What actually
         * governs how much water the eye is looking through is the SLANT
         * distance, which is that drop over the cosine of the view angle —
         * so the same shallows read clear from overhead and deep from a low
         * camera, exactly as they should.
         *
         * The bottom is also sampled through a small refraction offset, so it
         * shifts with the surface it is seen through rather than sitting
         * unnaturally still beneath the ripples. */
        float vertical = max(depthAt(uv + N.xz * 1.15), 0.0);
        // The true waterline, unrefracted, is what the shore ink and the alpha
        // fade key off — the offset would otherwise let the stroke wander up
        // over dry land.
        float shore = depthAt(uv);

        // Grazing views would otherwise integrate an unbounded path length.
        float slant = vertical / max(abs(V.y), 0.16);

        /* --- absorption ----------------------------------------------------
         * Per-channel transmittance drives the blend directly, rather than
         * being collapsed to one number first. That is what produces the hue
         * shift: the channels absorbed fastest are exactly the ones the deep
         * colour takes over first, so the water travels from pale lilac to a
         * saturated blue-violet along a curve nothing has to hand-author.
         *
         * Three stops rather than two. Shoal is the near-shore tint, shallow
         * the shelf, deep the channel — without the middle stop the ramp runs
         * straight from pale to saturated and loses the whole midrange the
         * reference spends most of its area in. */
        vec3 transmittance = exp(-slant * uExtinction);
        vec3 near = mix(uShallow, uShoal, exp(-slant * 0.85));
        vec3 col = mix(uDeep, near, transmittance);

        // Warmth bounced up off sunlit sand, confined to the first stretch.
        col = mix(col, uWarm, smoothstep(2.2, 0.0, slant) * 0.30);

        // Chroma lift, applied to the BODY only — before any surface light.
        // The point is to restore what the depth blend averaged away, not to
        // saturate the sheen, the specular and the sky along with it.
        col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, uSaturation);

        /* --- the voxel lattice ------------------------------------------
         * A static per-cell tone. The reference water is visibly built from
         * the same grid as everything else, and that lattice is structure, so
         * it does not animate — it is the surface, not something on it. */
        col *= 1.0 + (h21(floor(uv)) - 0.5) * 2.0 * uCellTone;

        /* --- caustics ------------------------------------------------------
         * Weighted by how THIN the water is, so the web burns brightest over
         * the shallows and is gone in the channel. That weighting is what
         * makes it describe depth rather than float over everything at one
         * strength. */
        float shallowness = exp(-slant * 0.20);
        col += uSheen * causticWeb(uv, uTime) * (0.70 + swell * 0.60)
             * uCaustic * shallowness * above;

        /* --- reflection ------------------------------------------------------
         * The sky sampled along the true mirror direction, not mixed in as a
         * flat tint. Because it reflects about the wave normal, the horizon
         * bends with each ripple and slides as the ripple travels — which is
         * what makes a surface read as reflective at all. A constant fresnel
         * tint cannot do that no matter how it is tuned.
         *
         * Schlick, off the same normal, so the mirror strengthens toward
         * grazing exactly as it should and the water stays clear overhead. */
        vec3 mirror = reflect(-V, N);
        vec3 skyRefl = mix(uHorizon, uSky, smoothstep(-0.06, 0.40, mirror.y));
        float fres = (0.02 + 0.98 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0)) * above;
        col = mix(col, skyRefl, clamp(fres * uReflect, 0.0, 1.0));

        // A tight sun glint riding on top of the reflection.
        vec3 Hv = normalize(uSunDir + V);
        col += uSunColor * pow(max(dot(N, Hv), 0.0), 90.0) * 0.22 * above;

        /* --- bank foam -------------------------------------------------------
         * A thin bright froth band right at the waterline. Confined to the
         * 0.4–1.2 block shore strip so it is never visible on deep water. */
        float foamBand = smoothstep(0.0, 0.4, shore) * (1.0 - smoothstep(0.4, 1.2, shore));
        col = mix(col, vec3(0.90, 0.92, 0.96), foamBand * 0.50 * above);

        /* --- river tint -----------------------------------------------------
         * Subtly shift river channels toward a cooler, more turbid hue so they
         * read distinct from the calm lake/ocean at a glance. */
        col = mix(col, col * vec3(0.88, 0.95, 1.06), rivProx * 0.28);

        /* --- alpha -----------------------------------------------------------
         * Fading to nothing at the waterline is what removes the hard rim a
         * constant opacity cuts against the sand. Depth then closes it back
         * up, so you can see the riverbed through the shallows and not through
         * the channel. */
        float shelf = smoothstep(0.0, 0.55, shore);
        /* Coverage rises on its OWN curve, far slower than absorption.
         *
         * Tying the two together is physically tidy and visually wrong here:
         * at the extinction that gives the colour its range, the water would
         * be opaque by mid-channel, and the riverbed is half the reason to
         * look at it. Letting colour saturate hard while coverage climbs
         * gently is what keeps the bed legible everywhere and still leaves
         * the channel unmistakably deeper than the shelf. */
        float alpha = uOpacity * (1.0 - exp(-slant * uDensity));
        alpha = clamp(alpha + fres * 0.18, 0.0, 1.0) * shelf;
        // A thin tint from beneath, not a lid.
        alpha = mix(min(alpha, 0.18), alpha, above);

        /* The dark waterline is NOT drawn here.
         *
         * It belongs on the terrain, and the reason is geometric: the zero
         * crossing of the depth field sits essentially on the bank wall, and
         * the water plane at that point is behind the wall. A contour drawn on
         * the water is occluded by the very thing it is meant to outline —
         * visible on gentle beaches, missing on every steep bank, which is
         * most of this shoreline. The voxel shader draws it on the wall
         * instead, where it is always visible and follows the blocks exactly.
         * See the waterline block in core/voxel.js. */

        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(size / 2, WATER.level, size / 2);
  mesh.renderOrder = 10;
  mesh.frustumCulled = false;
  mesh.name = 'water';

  return {
    mesh,
    material: mat,
    planetUnis: mat.uniforms,
    update(dt: number) {
      mat.uniforms.uTime.value += dt;
    },
  };
}
