/**
 * The sky model — one function, shared by the sky dome (lighting.js) and the
 * aerial-perspective pass (postfx.ts).
 *
 * Why share it: the single most important trick in the reference images is that
 * the horizon *does not exist*. Distant land doesn't sit against the sky, it
 * turns into the sky. That only works if the colour geometry fades toward is
 * bit-for-bit the colour the sky would have been in that same direction. Two
 * separately-tuned gradients always leave a faint seam; one function cannot.
 *
 * Everything here is LINEAR. Both consumers render into the HDR composer target
 * and let OutputPass do tone mapping + the sRGB transfer exactly once.
 */
import * as THREE from 'three';

/** Uniform block both shaders must declare. */
export const SKY_UNIFORMS_GLSL = /* glsl */ `
  uniform vec3 uSkyZenith;
  uniform vec3 uSkyHorizon;
  uniform vec3 uSkyNadir;
  uniform vec3 uSunGlow;
  uniform vec3 uSunDirW;
  uniform float uNight;
  uniform vec3  uMoonDir;
  uniform float uStarAngle;
  uniform float uGalaxyStrength;
  uniform float uNebulaStrength;
  uniform float uCloudCover;
  uniform float uCloudDark;
  uniform vec2  uWind;
  uniform vec3  uSunColor;
  uniform float uAurora;
  uniform float uAuroraTime;
  uniform float uNightSkyFull;
`;

export const SKY_FN_GLSL = /* glsl */ `
  // --- 3D procedural helpers for night sky ---

  float _hash3(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float _noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(_hash3(i),              _hash3(i + vec3(1,0,0)), f.x),
          mix(_hash3(i + vec3(0,1,0)), _hash3(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(_hash3(i + vec3(0,0,1)), _hash3(i + vec3(1,0,1)), f.x),
          mix(_hash3(i + vec3(0,1,1)), _hash3(i + vec3(1,1,1)), f.x), f.y),
      f.z
    );
  }

  float _fbm3(vec3 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      value += _noise3(p) * amplitude;
      p = p * 2.03 + vec3(7.1, 13.7, 5.9);
      amplitude *= 0.5;
    }
    return value;
  }

  vec3 _rotateAroundAxis(vec3 p, vec3 axis, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return p * c + cross(axis, p) * s + axis * dot(axis, p) * (1.0 - c);
  }

  // Curtain aurora — animated with sweep pulses, flickering rays, and slow breathing.
  // Returned as additive linear radiance; zero when uAurora or uNight is 0.
  vec3 _aurora(vec3 dir) {
    float night = uNight * uAurora * smoothstep(0.04, 0.10, dir.y);
    if (night < 0.001) return vec3(0.0);

    float t  = uAuroraTime;        // ~0.3 units/s — structural motion
    float tf = uAuroraTime * 4.0;  // fast shimmer for flickering rays
    float az = atan(dir.x, dir.z);

    // Curtain lower edge: slow drift + fast flutter gives eerie instability
    float ripple = sin(az * 2.3 + t * 0.4) * 0.08
                 + sin(az * 5.1 - t * 0.7) * 0.04
                 + sin(az * 11.3 + tf * 0.2) * 0.015;
    float bandLo = smoothstep(0.10 + ripple, 0.28 + ripple, dir.y);
    float bandHi = 1.0 - smoothstep(0.38, 0.82, dir.y);
    float band   = bandLo * bandHi;

    // Vertical rays: slow structural noise + fast shimmer layer
    float rays = _noise3(dir * vec3(6.0, 18.0, 6.0) + vec3(t * 0.5, 0.0, t * 0.3)) * 0.6
               + _noise3(dir * vec3(12.1, 36.3, 12.1) + vec3(tf, 0.0, tf * 0.5)) * 0.4;
    rays = pow(smoothstep(0.28, 0.72, rays), 1.5);

    // Sweeping pulse wave that travels across the sky — the core eerie effect
    float pulse = 0.60 + 0.40 * sin(az * 1.7 + t * 0.5) * sin(az * 0.8 - t * 0.28);

    // Horizontal patchiness
    float n1 = _noise3(dir * 1.8 + vec3(11.0, t * 0.12, 7.0));
    float n2 = _noise3(dir * 3.7 + vec3(2.3,  t * 0.22, 14.1));
    float coverage = smoothstep(0.35, 0.75, n1 * 0.6 + n2 * 0.4);

    // Slow breathing: two incommensurate frequencies produce an irregular beat
    float breathe = 0.72 + 0.28 * sin(t * 0.45) * sin(t * 0.29 + 1.9);

    float shape = band * rays * coverage * pulse * breathe;

    // Colour: green → cyan at tips; magenta fringe; ghostly white flare at peaks
    float tipGrad    = smoothstep(0.15, 0.65, dir.y);
    float colorNoise = _noise3(dir * 3.5 + vec3(t * 0.04, 5.0, t * 0.07));
    float flare      = pow(rays * coverage, 2.5);
    vec3 col = mix(vec3(0.08, 0.90, 0.25), vec3(0.02, 0.55, 0.75), tipGrad);
    col = mix(col, vec3(0.65, 0.05, 0.50), smoothstep(0.55, 0.85, colorNoise) * 0.35);
    col = mix(col, vec3(0.80, 1.00, 0.88), flare * 0.38);  // ghostly white at intensity peaks

    return col * shape * night * 1.1;
  }

  /**
   * Stars, Milky Way, nebulae, and moon disc.
   * Returns additive linear radiance; caller adds it to the day-sky colour.
   * Returns black during daytime (uNight == 0) at no cost.
   */
  vec3 nightSkyAddons(vec3 dir) {
    float h = clamp(dir.y, -1.0, 1.0);
    vec3 add = vec3(0.0);

    // Moon disc + glow
    float moonDot  = clamp(dot(dir, uMoonDir), 0.0, 1.0);
    float moonDisc = smoothstep(0.99995, 0.999985, moonDot);
    float moonGlow = pow(moonDot, 280.0) * 0.1;
    add += vec3(0.82, 0.88, 1.0) * (moonDisc * 1.15 + moonGlow) * uNight;

    float clearNight = uNight * (1.0 - uCloudCover * 0.88);
    if (clearNight > 0.01 && h > -0.08 && uNightSkyFull > 0.5) {
      vec3 axis = normalize(vec3(0.2, 0.78, 0.35));
      vec3 celestial = _rotateAroundAxis(dir, axis, -uStarAngle);

      // Milky Way band
      vec3 galaxyNormal    = normalize(vec3(0.42, 0.32, 0.85));
      vec3 galaxyTangent   = normalize(cross(galaxyNormal, vec3(0.0, 1.0, 0.0)));
      vec3 galaxyBitangent = cross(galaxyNormal, galaxyTangent);
      float latitude  = dot(celestial, galaxyNormal);
      float longitude = atan(dot(celestial, galaxyBitangent), dot(celestial, galaxyTangent));

      float toCore  = cos(longitude - 0.85) * 0.5 + 0.5;
      float bulge   = toCore * toCore * toCore;
      float widthK  = mix(1.45, 0.6, bulge);
      float broadBand = exp(-latitude * latitude * 4.0  * widthK);
      float mainBand  = exp(-latitude * latitude * 12.5 * widthK);
      float coreBand  = exp(-latitude * latitude * 36.0 * widthK);
      float bandGain  = mix(0.55, 1.6, bulge);

      float macroCloud = _fbm3(celestial * 2.2 + vec3(4.2, 8.7, 1.4));
      float smoke      = _fbm3(celestial * 5.0 + vec3(18.1, 2.4, 11.7));
      float fineSmoke  = _fbm3(celestial * 10.0 + vec3(2.7, 31.4, 8.3));

      float cloudy = smoothstep(0.16, 0.80, macroCloud) * 0.50
                   + smoothstep(0.30, 0.78, smoke)      * 0.34
                   + smoothstep(0.42, 0.76, fineSmoke)  * 0.16;

      float grain = _noise3(celestial * 26.0) * 0.6 + _noise3(celestial * 54.0) * 0.4;

      float galaxy = (broadBand * (0.025 + cloudy * 0.32)
                    + mainBand  * (0.050 + cloudy * 0.52)
                    + coreBand  * (0.110 + smoothstep(0.2, 0.8, macroCloud) * 0.26)) * bandGain;
      galaxy *= 0.8 + grain * 0.4;

      // Great Rift dust lane
      float laneShift = (_fbm3(celestial * 1.7 + vec3(7.7, 19.2, 3.1)) - 0.5) * 0.24;
      float laneDelta = (latitude - laneShift) * 13.0;
      float rift      = exp(-laneDelta * laneDelta);
      float riftBreaks = smoothstep(0.3, 0.62, _fbm3(celestial * 3.4 + vec3(29.0, 5.5, 13.8)));
      galaxy *= 1.0 - rift * riftBreaks * mainBand * 0.92;

      vec3 coldSmoke   = vec3(0.16, 0.32, 0.78);
      vec3 violetSmoke = vec3(0.50, 0.26, 0.68);
      vec3 warmCore    = vec3(0.95, 0.66, 0.38);
      vec3 galaxyColor = mix(coldSmoke, violetSmoke, smoothstep(0.2, 0.85, smoke));
      galaxyColor = mix(galaxyColor, warmCore, coreBand * bulge * 0.85);

      float horizonFade = smoothstep(-0.06, 0.18, h);
      add += galaxyColor * galaxy * uGalaxyStrength * clearNight * horizonFade;

      // Emission nebulae
      float nebRegion = smoothstep(0.6, 0.82, _fbm3(celestial * 1.6 + vec3(23.1, 7.7, 15.3)));
      float nebDetail = _fbm3(celestial * 6.0 + vec3(9.2, 27.3, 4.4));
      float filament  = pow(smoothstep(0.5, 0.95, 1.0 - abs(2.0 * nebDetail - 1.0)), 1.7);
      float nebula    = nebRegion * (smoothstep(0.35, 0.8, nebDetail) * 0.5 + filament * 0.9);
      nebula *= mix(0.3, 1.0, broadBand) * (1.0 - rift * riftBreaks * 0.6);
      vec3 nebColor = mix(vec3(0.85, 0.26, 0.40), vec3(0.2, 0.55, 0.62),
                          smoothstep(0.3, 0.7, _fbm3(celestial * 2.4 + vec3(31.0, 3.0, 19.0))));
      add += nebColor * nebula * uNebulaStrength * clearNight * horizonFade;
    }

    add += _aurora(dir);
    return add;
  }

  /**
   * @param dir  normalised world-space view direction
   * Returns linear radiance. The band structure is deliberately shallow: the
   * whole sky lives inside about 12% of value range so it stays milky.
   */
  vec3 skyRadiance(vec3 dir) {
    float y = dir.y;

    // Periwinkle overhead relaxing into a warmer lilac at eye level. The
    // exponent pulls most of the transition down near the skyline, which is
    // where the diorama actually meets it.
    float t = smoothstep(-0.04, 0.70, y);
    t = t * t * (3.0 - 2.0 * t);
    vec3 col = mix(uSkyHorizon, uSkyZenith, t);

    // Below the skyline we keep going, very slightly cooler and darker, so the
    // underside of the floating island reads as "more of the same air" rather
    // than as a wall.
    col = mix(uSkyNadir, col, smoothstep(-0.42, -0.01, y));

    // Broad forward-scatter halo. Two lobes: a tight core and a very wide
    // wash. This is what stops the gradient reading as a dead linear ramp and
    // gives the frame a light source even when the sun is off-screen.
    // Wide lobe boost near sunset/sunrise and at night (limb glow).
    float wideLobe = 0.20 + (1.0 - clamp(uSunDirW.y * 6.0, 0.0, 1.0)) * 0.12;
    float sunDot = dot(dir, uSunDirW);
    float s = max(sunDot, 0.0);
    col += uSunGlow * (pow(s, 6.0) * 0.42 + pow(s, 1.5) * wideLobe);

    // Limb glow: tight halo + sharp disc, boosted near horizon, plus a wide
    // orange pre-sunrise/post-sunset wash.
    float horizonBoost = 1.0 + (1.0 - clamp(uSunDirW.y * 3.0, 0.0, 1.0)) * 2.2;
    float halo = pow(s, 24.0) * 0.3 * horizonBoost + pow(s, 300.0) * 0.7;
    float disc = smoothstep(0.9995, 0.9999, sunDot);
    float sunVis = smoothstep(-0.12, 0.02, uSunDirW.y);
    float limbWash = pow(s, 1.5) * 0.28 * smoothstep(0.18, -0.15, uSunDirW.y);
    vec3 limbColor = mix(vec3(1.0, 0.55, 0.15), uSunColor, 0.4);
    col += limbColor * limbWash;
    col += uSunColor * (halo + disc * 5.0) * sunVis;

    // Night sky: darken the day sky and add stars/moon
    col = mix(col, col * 0.04, uNight * 0.96);
    col += nightSkyAddons(dir);

    return col;
  }
`;

/** Wire the shared uniforms onto a material/pass. Values come from palette. */
export function skyUniformValues(
  SKY: {
    zenith: THREE.Color;
    horizon: THREE.Color;
    haze: THREE.Color;
    sunTint: THREE.Color;
    ground: THREE.Color;
  },
  sunDir: THREE.Vector3,
  THREE_: typeof THREE,
) {
  return {
    // Slightly lifted and pushed toward lilac vs the raw palette entries: the
    // references sit their sky in a very narrow, very bright band and any
    // saturation here immediately reads as "outdoors at noon" instead of
    // "miniature under studio light".
    uSkyZenith: { value: SKY.zenith.clone().lerp(SKY.haze, 0.3) },
    uSkyHorizon: { value: SKY.horizon.clone().lerp(SKY.haze, 0.22) },
    uSkyNadir: { value: SKY.ground.clone().lerp(SKY.haze, 0.45).multiplyScalar(0.94) },
    uSunGlow: { value: SKY.sunTint.clone().multiplyScalar(0.16) },
    uSunDirW: { value: sunDir.clone() },
    uNight: { value: 0.0 },
    uMoonDir: { value: new THREE_.Vector3(0, -1, 0) },
    uStarAngle: { value: 0.0 },
    uGalaxyStrength: { value: 0.85 },
    uNebulaStrength: { value: 0.6 },
    uCloudCover: { value: 0.08 },
    uCloudDark: { value: 0.0 },
    uWind: { value: new THREE_.Vector2(1, 0) },
    uSunColor: { value: new THREE_.Color(1.0, 0.9, 0.7) },
    uAurora:       { value: 0.0 },
    uAuroraTime:   { value: 0.0 },
    uNightSkyFull: { value: 1.0 }, // 0 = static moon+stars only, 1 = full Milky Way + nebulae
  };
}
