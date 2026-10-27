/**
 * Atmospheric particles.
 *
 * Three layers, each doing a different job:
 *   petals  — big readable tumbling quads, the hero motif
 *   motes   — tiny soft bokeh dots that give the air volume
 *   pollen  — near-camera drift, sells depth by moving fast in parallax
 *
 * All GPU-animated from a single instanced draw per layer; the CPU only
 * seeds them once.
 */

import * as THREE from 'three';
import { PETAL_COLORS, MOTE_COLORS } from '../core/palette';
import { PLANET_UNIFORMS_GLSL, PLANET_BEND_GLSL, planetUniformValues } from '../render/planet.glsl';

const PETAL_VERT = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  attribute vec3 offset;    // seeded spawn position
  attribute vec3 aSeed;     // (phase, spinSpeed, fallSpeed)
  attribute vec3 aColor;
  attribute float aSize;
  uniform float uTime;
  uniform vec3 uBounds;     // world extent
  uniform vec3 uOrigin;
  varying vec3 vCol;
  varying vec2 vUv;
  varying float vFade;
  ${PLANET_UNIFORMS_GLSL}
  ${PLANET_BEND_GLSL}

  mat3 rotAxis(vec3 a, float t) {
    float c = cos(t), s = sin(t), o = 1.0 - c;
    return mat3(
      o*a.x*a.x + c,      o*a.x*a.y - a.z*s,  o*a.x*a.z + a.y*s,
      o*a.x*a.y + a.z*s,  o*a.y*a.y + c,      o*a.y*a.z - a.x*s,
      o*a.x*a.z - a.y*s,  o*a.y*a.z + a.x*s,  o*a.z*a.z + c);
  }

  void main() {
    vUv = uv;
    vCol = aColor;

    float t = uTime;
    vec3 p = position * aSize;

    // tumble
    vec3 axis = normalize(vec3(sin(aSeed.x*7.1), 0.6, cos(aSeed.x*3.3)));
    p = rotAxis(axis, t * aSeed.y + aSeed.x * 6.28) * p;

    // fall + sway
    vec3 base = offset;
    float fall = mod(base.y - t * aSeed.z, uBounds.y);
    vec3 wp;
    wp.y = fall;
    wp.x = base.x + sin(t * 0.55 + aSeed.x * 6.28) * 2.6 + sin(t * 0.21) * 1.4;
    wp.z = base.z + cos(t * 0.47 + aSeed.x * 5.11) * 2.6 + cos(t * 0.17) * 1.4;

    // keep the field centred on the camera so it never runs out
    wp.xz = mod(wp.xz - uOrigin.xz + uBounds.xz * 0.5, uBounds.xz) - uBounds.xz * 0.5 + uOrigin.xz;

    // apply planet bend to anchor before adding billboard offset
    vec3 wpNrm = vec3(0.0, 1.0, 0.0);
    applyPlanetBend(wp, wpNrm);

    vec3 world = wp + p;
    vec4 mv = viewMatrix * vec4(world, 1.0);

    // fade in/out at the top and bottom of the loop so there's no popping
    vFade = smoothstep(0.0, 0.12, fall / uBounds.y) * (1.0 - smoothstep(0.86, 1.0, fall / uBounds.y));

    gl_Position = projectionMatrix * mv;
    #ifdef USE_FOG
      vFogDepth = -mv.z;
    #endif
  }
`;

const PETAL_FRAG = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  varying vec3 vCol;
  varying vec2 vUv;
  varying float vFade;
  uniform float uSoft;
  void main() {
    // rounded-diamond petal silhouette
    vec2 q = vUv * 2.0 - 1.0;
    float d = pow(abs(q.x), 1.55) + pow(abs(q.y), 1.15);
    float a = 1.0 - smoothstep(0.78, 1.0, d);
    if (a < 0.02) discard;
    // a soft lit edge along one side gives the flat quad some form
    float shade = 0.88 + 0.22 * smoothstep(-0.6, 0.9, q.y - q.x * 0.4);
    gl_FragColor = vec4(vCol * shade, a * vFade * uSoft);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function makeQuadGeometry(count: any, bounds: any, rng: any, colors: any, sizeRange: any, fallRange: any) {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.attributes.position = base.attributes.position;
  geo.attributes.uv = base.attributes.uv;

  const off = new Float32Array(count * 3);
  const seed = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    off[i * 3 + 0] = rng.range(-bounds.x / 2, bounds.x / 2);
    off[i * 3 + 1] = rng.range(0, bounds.y);
    off[i * 3 + 2] = rng.range(-bounds.z / 2, bounds.z / 2);
    seed[i * 3 + 0] = rng();
    seed[i * 3 + 1] = rng.range(0.6, 2.4);
    seed[i * 3 + 2] = rng.range(fallRange[0], fallRange[1]);
    const c = rng.pick(colors);
    col[i * 3 + 0] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    size[i] = rng.range(sizeRange[0], sizeRange[1]);
  }

  geo.setAttribute('offset', new THREE.InstancedBufferAttribute(off, 3));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 3));
  geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 1));
  geo.instanceCount = count;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return geo;
}

export function createParticles(worldSize: any, rng: any, maxCount = 1110) {
  const group = new THREE.Group();
  group.name = 'particles';
  const layers: THREE.ShaderMaterial[] = [];
  const petalMeshes: THREE.Mesh[] = [];
  const scale = maxCount / 1110;

  const mk = (count: any, bounds: any, colors: any, sizeRange: any, fallRange: any, soft: any, blend: any, isPetal = false) => {
    count = Math.max(0, Math.round(count * scale));
    if (count === 0) return;
    const geo = makeQuadGeometry(count, bounds, rng, colors, sizeRange, fallRange);
    const mat = new THREE.ShaderMaterial({
      vertexShader: PETAL_VERT,
      fragmentShader: PETAL_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: blend,
      side: THREE.DoubleSide,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uBounds: { value: bounds.clone() },
          uOrigin: { value: new THREE.Vector3() },
          uSoft: { value: soft },
          ...planetUniformValues(new THREE.Vector3()),
        },
      ]),
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = 20;
    group.add(m);
    layers.push(mat);
    if (isPetal) petalMeshes.push(m);
    return mat;
  };


  const B = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // Counts are deliberately low. Petals are punctuation, not weather — the
  // first pass used ~3700 particles and read as confetti in a snowstorm.
  // hero petals — sparse, large, slow
  mk(260, B(worldSize * 0.8, 44, worldSize * 0.8), PETAL_COLORS, [0.5, 1.05], [1.0, 2.1], 0.92, THREE.NormalBlending, true);
  // mid-field petals, smaller and denser
  mk(420, B(worldSize * 1.0, 50, worldSize * 1.0), PETAL_COLORS, [0.24, 0.5], [1.3, 2.6], 0.7, THREE.NormalBlending, true);
  // glowing motes
  mk(300, B(worldSize * 0.8, 30, worldSize * 0.8), MOTE_COLORS, [0.18, 0.46], [0.1, 0.42], 0.3, THREE.AdditiveBlending);
  // near-camera pollen, fast parallax
  mk(130, B(52, 24, 52), MOTE_COLORS, [0.1, 0.24], [0.25, 0.7], 0.22, THREE.AdditiveBlending);

  return {
    group,
    /** All layer uniform objects — update planet uniforms on each each frame. */
    planetUnisList: layers.map((m) => m.uniforms),
    update(dt: number, camera: any) {
      for (const m of layers) {
        m.uniforms.uTime.value += dt;
        m.uniforms.uOrigin.value.copy(camera.position);
      }
    },
    /** Re-randomise petal aColor buffers from the current PETAL_COLORS (call after setVoxelPalette). */
    recolorPetals() {
      for (const mesh of petalMeshes) {
        const attr = mesh.geometry.attributes['aColor'] as THREE.BufferAttribute;
        const buf = attr.array as Float32Array;
        const n = buf.length / 3;
        for (let i = 0; i < n; i++) {
          const c = PETAL_COLORS[Math.floor(Math.random() * PETAL_COLORS.length)];
          buf[i * 3 + 0] = c.r;
          buf[i * 3 + 1] = c.g;
          buf[i * 3 + 2] = c.b;
        }
        attr.needsUpdate = true;
      }
    },
  };
}
