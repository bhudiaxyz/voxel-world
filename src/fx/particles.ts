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
import { PLANET_UNIFORMS_GLSL, PLANET_BEND_GLSL, planetUniformValues } from '../render/planet';
import { makeRng } from '../core/rng';

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
  uniform float uKind;      // 0 tumbling quad (petal/mote), 1 rain streak, 2 snowflake
  uniform float uFollowY;   // 1 = field is centred on the camera vertically too (weather)
  uniform vec2  uWind;      // horizontal drift for weather, world units / s
  uniform vec3  uSunDir;
  uniform float uSunLit;    // 0..1, how strongly motes catch the sun when looked toward
  varying vec3 vCol;
  varying vec2 vUv;
  varying float vFade;
  varying float vSun;
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
    vec3 p;
    if (uKind < 0.5) {
      // tumble
      p = position * aSize;
      vec3 axis = normalize(vec3(sin(aSeed.x*7.1), 0.6, cos(aSeed.x*3.3)));
      p = rotAxis(axis, t * aSeed.y + aSeed.x * 6.28) * p;
    } else {
      // Camera-facing billboard. Rain is a thin vertical streak (stays upright,
      // only yaws to face the camera); snow is a small round flake.
      vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
      vec3 up = uKind < 1.5 ? vec3(0.0, 1.0, 0.0)
                            : normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
      vec2 sz = uKind < 1.5 ? vec2(0.035, 0.95) * aSize : vec2(aSize);
      p = right * position.x * sz.x + up * position.y * sz.y;
    }

    // fall + sway
    vec3 base = offset;
    float fall = mod(base.y - t * aSeed.z, uBounds.y);
    vec3 wp;
    wp.y = fall + uFollowY * (uOrigin.y - uBounds.y * 0.5);
    if (uKind < 0.5) {
      wp.x = base.x + sin(t * 0.55 + aSeed.x * 6.28) * 2.6 + sin(t * 0.21) * 1.4;
      wp.z = base.z + cos(t * 0.47 + aSeed.x * 5.11) * 2.6 + cos(t * 0.17) * 1.4;
    } else {
      // Weather drifts with the wind; snow also flutters.
      float flutter = uKind > 1.5 ? 1.0 : 0.0;
      wp.x = base.x + uWind.x * t + flutter * sin(t * 1.3 + aSeed.x * 6.28) * 0.6;
      wp.z = base.z + uWind.y * t + flutter * cos(t * 1.1 + aSeed.x * 5.11) * 0.6;
    }

    // keep the field centred on the camera so it never runs out
    wp.xz = mod(wp.xz - uOrigin.xz + uBounds.xz * 0.5, uBounds.xz) - uBounds.xz * 0.5 + uOrigin.xz;

    // apply planet bend to anchor before adding billboard offset
    vec3 wpNrm = vec3(0.0, 1.0, 0.0);
    applyPlanetBend(wp, wpNrm);

    vec3 world = wp + p;
    vec4 mv = viewMatrix * vec4(world, 1.0);

    // Sunlit dust: forward scattering — a mote between the eye and the sun
    // lights up, the same physics as the haze in-scatter.
    vSun = uSunLit * pow(max(dot(normalize(world - cameraPosition), uSunDir), 0.0), 6.0);

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
  varying float vSun;
  uniform float uSoft;
  uniform float uKind;
  void main() {
    vec2 q = vUv * 2.0 - 1.0;
    float a;
    float shade = 1.0;
    if (uKind < 0.5) {
      // rounded-diamond petal silhouette
      float d = pow(abs(q.x), 1.55) + pow(abs(q.y), 1.15);
      a = 1.0 - smoothstep(0.78, 1.0, d);
      // a soft lit edge along one side gives the flat quad some form
      shade = 0.88 + 0.22 * smoothstep(-0.6, 0.9, q.y - q.x * 0.4);
    } else if (uKind < 1.5) {
      // rain: soft across, tapered at both ends, brightest toward the tail
      a = (1.0 - abs(q.x)) * smoothstep(1.0, 0.2, abs(q.y)) * (0.55 + 0.45 * (0.5 - q.y * 0.5));
    } else {
      // snow: soft round flake
      a = 1.0 - smoothstep(0.35, 1.0, length(q));
    }
    if (a < 0.02) discard;
    vec3 c = vCol * shade * (1.0 + vSun * 3.5);
    gl_FragColor = vec4(c, a * vFade * uSoft * (1.0 + vSun));
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

    const mk = (
        count: any,
        bounds: any,
        colors: any,
        sizeRange: any,
        fallRange: any,
        soft: any,
        blend: any,
        isPetal = false,
        kind = 0,
        layerRng = rng,
    ) => {
        count = Math.max(0, Math.round(count * scale));
        if (count === 0) return;
        const geo = makeQuadGeometry(count, bounds, layerRng, colors, sizeRange, fallRange);
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
                    uKind: { value: kind },
                    uFollowY: { value: kind > 0 ? 1 : 0 },
                    uWind: { value: new THREE.Vector2() },
                    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
                    uSunLit: { value: 0 },
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
    mk(
        260,
        B(worldSize * 0.8, 44, worldSize * 0.8),
        PETAL_COLORS,
        [0.5, 1.05],
        [1.0, 2.1],
        0.92,
        THREE.NormalBlending,
        true,
    );
    // mid-field petals, smaller and denser
    mk(
        420,
        B(worldSize * 1.0, 50, worldSize * 1.0),
        PETAL_COLORS,
        [0.24, 0.5],
        [1.3, 2.6],
        0.7,
        THREE.NormalBlending,
        true,
    );
    // glowing motes
    mk(
        300,
        B(worldSize * 0.8, 30, worldSize * 0.8),
        MOTE_COLORS,
        [0.18, 0.46],
        [0.1, 0.42],
        0.3,
        THREE.AdditiveBlending,
    );
    // near-camera pollen, fast parallax
    mk(130, B(52, 24, 52), MOTE_COLORS, [0.1, 0.24], [0.25, 0.7], 0.22, THREE.AdditiveBlending);
    // Motes and pollen catch the sun (forward scatter); petals are opaque-ish
    // and would just flare, so they stay out of it.
    const sunLit = layers.slice(-2);

    /* ---- weather -----------------------------------------------------
     * A field centred on the camera in all three axes. The buffers hold the
     * tier's full count; `instanceCount` scales with intensity, so clear skies
     * draw nothing at all. Own RNG stream: adding weather must not move a
     * single petal (see DESIGN.md, Determinism). */
    const wRng = makeRng(0x7a1e);
    const rainCol = [new THREE.Color(0.78, 0.84, 0.95)];
    const snowCol = [new THREE.Color(0.96, 0.97, 1.0)];
    const rain = mk(1400, B(60, 34, 60), rainCol, [0.8, 1.3], [26, 34], 0.38, THREE.NormalBlending, false, 1, wRng);
    const snow = mk(1100, B(64, 30, 64), snowCol, [0.06, 0.14], [1.1, 2.0], 0.9, THREE.NormalBlending, false, 2, wRng);
    const weatherGeo = (m?: THREE.ShaderMaterial) =>
        m ? (group.children.find((c) => (c as THREE.Mesh).material === m) as THREE.Mesh).geometry : null;
    const rainGeo = weatherGeo(rain) as THREE.InstancedBufferGeometry | null;
    const snowGeo = weatherGeo(snow) as THREE.InstancedBufferGeometry | null;
    const rainMax = rainGeo?.instanceCount ?? 0;
    const snowMax = snowGeo?.instanceCount ?? 0;
    if (rainGeo) rainGeo.instanceCount = 0;
    if (snowGeo) snowGeo.instanceCount = 0;

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
        /**
         * Per-frame weather + light state (main.ts).
         * @param sunLit 0..1 — dust-mote sun glow (daylight, low sun strongest)
         */
        setAtmosphere(rainAmt: number, snowAmt: number, wind: THREE.Vector2, sunDir: THREE.Vector3, sunLitAmt: number) {
            if (rainGeo) rainGeo.instanceCount = Math.round(rainMax * rainAmt);
            if (snowGeo) snowGeo.instanceCount = Math.round(snowMax * snowAmt);
            for (const m of [rain, snow]) if (m) m.uniforms.uWind.value.copy(wind);
            for (const m of sunLit) {
                m.uniforms.uSunDir.value.copy(sunDir);
                m.uniforms.uSunLit.value = sunLitAmt;
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
