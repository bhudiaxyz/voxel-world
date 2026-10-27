/**
 * Post-processing — where the diorama gets its air.
 *
 * Chain:
 *   SceneDepthPass -> EdgeMaskPass -> Atmosphere -> Bloom -> Crepuscular -> Grade/Output -> AA
 *
 * Everything before Grade is linear HDR. Grade begins with the same ACES and
 * sRGB conversion that used to occupy a separate OutputPass, then performs its
 * display-space work. Combining those operations saves one full-resolution
 * copy of every pixel without changing their order.
 *
 * THE ATMOSPHERE PASS
 * -------------------
 * The reference images do almost all of their "this is a miniature" work with
 * aerial perspective, so this pass is where the budget goes. It is one
 * fullscreen pass doing six things off a single depth fetch:
 *
 *   1. Large-scale ambient occlusion. The mesher bakes per-vertex AO into
 *      block crevices; what it cannot see is a canopy hanging over grass or
 *      the base of a cliff. Depth-only, 8 taps, wide radius, lavender-tinted.
 *   2. Drifting cloud shadow, reconstructed in world space. Very low
 *      amplitude — it is there to keep big flat shelves alive, not to be seen.
 *   3. Desaturation with distance. scene.fog (see lighting.js) already mixes
 *      toward the haze colour; that alone loses chroma and value at the same
 *      rate. The references lose *chroma* much faster than value, so distance
 *      pulls the residual colour toward its own luminance as well.
 *   4. A per-pixel nudge toward the true directional sky colour, which is what
 *      actually erases the horizon line.
 *   5. Ground mist: a second, whiter medium with an exponential height
 *      falloff, integrated analytically along the view ray so it genuinely
 *      pools in the river valley and around the island rim.
 *   6. Sun in-scatter and a four-tap defocus, both driven by the fog amount
 *      that has already been computed, so they cost almost nothing.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GRADE, SKY, LIGHT } from '../core/palette';
import { FOG_NEAR } from './lighting';
import type { GpuTier } from './gpu-tier';
import { TIER_SETTINGS } from './gpu-tier';
import { EDGE_LAYER } from '../core/voxel';
import { SKY_UNIFORMS_GLSL, SKY_FN_GLSL, skyUniformValues } from './sky';

/* ------------------------------------------------------------------ *
 * Grade — display space. Taste only.
 * ------------------------------------------------------------------ */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uLift: { value: GRADE.lift.clone() },
    uGamma: { value: GRADE.gamma.clone() },
    uGain: { value: GRADE.gain.clone() },
    uSat: { value: GRADE.saturation },
    uContrast: { value: GRADE.contrast },
    uVignette: { value: GRADE.vignette },
    uTime: { value: 0 },
    uGrain: { value: 0.006 },
    uAberration: { value: 0.0008 },
    tEdges: { value: null },
    // Display-space ink. It is mixed, never added, after bloom and tone
    // mapping, so the pale stroke cannot become an emitter.
    uEdgeDark: { value: new THREE.Vector3(0.39, 0.32, 0.43) },
    uEdgeLight: { value: new THREE.Vector3(0.94, 0.91, 0.93) },
    uEdgeDarkOpacity: { value: 0.0 },
    uEdgeLightOpacity: { value: 0.0 },
    // "Milk": a flat mix toward a bright lilac across the whole frame. The
    // reference frames are clean and confidently coloured, so this stays low
    // — just enough to keep the darkest values from going heavy.
    uMilk: { value: 0.01 },
    uMilkColor: { value: new THREE.Vector3(0.855, 0.845, 0.925) },
    // Highlight rolloff. ACES already shoulders, but pastels sit high enough
    // that a second, gentler knee is what stops blossom tops clipping to white.
    uKnee: { value: 0.8 },
    toneMappingExposure: { value: GRADE.exposure },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tEdges;
    uniform vec3 uLift, uGamma, uGain, uMilkColor;
    uniform vec3 uEdgeDark, uEdgeLight;
    uniform float uSat, uContrast, uVignette, uTime, uGrain, uAberration, uMilk, uKnee;
    uniform float uEdgeDarkOpacity, uEdgeLightOpacity;
    varying vec2 vUv;

    #include <tonemapping_pars_fragment>

    vec3 displaySample(vec2 uv) {
      vec3 c = texture2D(tDiffuse, uv).rgb;
      c = ACESFilmicToneMapping(c);
      return sRGBTransferOETF(vec4(c, 1.0)).rgb;
    }

    void main() {
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);

      // --- chromatic aberration, strictly at the frame edges ----------
      float ca = uAberration * r2 * 2.4;
      vec3 col = displaySample(uv);
      if (uAberration > 0.00001) {
        col.r = displaySample(uv - d * ca).r;
        col.b = displaySample(uv + d * ca).b;
      }

      // --- lift / gamma / gain ----------------------------------------
      col = col * uGain + uLift;
      col = pow(max(col, 0.0), 1.0 / uGamma);

      // --- saturation --------------------------------------------------
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);

      // --- split tone ---------------------------------------------------
      // Highlights toward warm cream, shadows toward lavender. The shadow leg
      // matters more than it looks: it is what makes cast shadows read as
      // coloured air rather than as absence of light.
      col = mix(col, col * vec3(1.020, 1.000, 0.978), smoothstep(0.55, 1.0, l));
      col = mix(col, col * vec3(0.968, 0.976, 1.045), 1.0 - smoothstep(0.0, 0.50, l));

      // --- milk ----------------------------------------------------------
      // Weighted toward the dark end so the deepest values (trunks, shadowed
      // cliff faces) lift the most and nothing in frame approaches black,
      // while highlights keep their separation.
      float darkBias = 1.0 - smoothstep(0.05, 0.72, l);
      col = mix(col, uMilkColor, uMilk * (0.42 + 0.58 * darkBias));

      // The reference keeps its palette light, but does not flatten it: warm
      // lit planes and cool shadow planes remain clearly separated. Contrast
      // pivots around middle grey so whites stay soft while coloured shadows
      // regain enough depth to describe the stepped forms.
      col = max((col - 0.5) * uContrast + 0.5, 0.0);

      // --- highlight knee -------------------------------------------------
      // Monotonic exponential shoulder. The previous rational curve eventually
      // turned downward, so a very bright red channel became darker while blue
      // kept rising—the source of cyan highlights on pink blossom and timber.
      vec3 over = max(col - vec3(uKnee), 0.0);
      vec3 rolled = vec3(uKnee) + (1.0 - uKnee)
                  * (1.0 - exp(-over / max(1.0 - uKnee, 0.001)));
      col = mix(col, rolled, step(vec3(uKnee), col));

      // --- explicit edge graph -------------------------------------------
      // R is the union of dark segments, G the union of pale segments. Dark
      // coverage wins at mixed junctions, producing one continuous joint.
      vec2 edge = clamp(texture2D(tEdges, uv).rg, 0.0, 1.0);
      float darkCoverage = edge.r;
      float lightCoverage = edge.g * (1.0 - smoothstep(0.0, 0.35, darkCoverage));
      col = mix(col, uEdgeLight, lightCoverage * uEdgeLightOpacity);
      col = mix(col, uEdgeDark, darkCoverage * uEdgeDarkOpacity);

      // --- vignette --------------------------------------------------------
      // Tinted rather than neutral; a grey vignette on a lilac frame reads as
      // dirt on the lens.
      float vig = uVignette * smoothstep(0.10, 1.0, r2 * 1.75);
      col = mix(col, col * vec3(0.955, 0.955, 1.0), vig);
      col *= 1.0 - vig * 0.28;

      // --- film grain ------------------------------------------------------
      float g = fract(sin(dot(uv * vec2(1234.5, 6789.1) + uTime, vec2(12.9898, 78.233))) * 43758.5453);
      col += (g - 0.5) * uGrain;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/**
 * Render the connected edge graph into a two-channel coverage mask while
 * sampling the main scene depth. MAX blending makes overlapping round-capped
 * segments a mathematical union: corners and T-junctions cannot accumulate,
 * glow, or open a one-pixel crack.
 */
class EdgeMaskPass extends Pass {
  /**
   * Edge objects live in the main scene on EDGE_LAYER rather than in a private
   * scene of their own, and this pass simply re-renders that scene with the
   * camera looking at nothing else. The scene camera never sees the layer, so
   * the strokes stay out of the beauty pass.
   *
   * The reason for the layer rather than a separate scene: an object has one
   * parent. Keeping edges in the main graph is what allows a character part's
   * outline to hang off the animated node it belongs to and inherit its
   * world matrix for free, instead of needing a mirrored hierarchy kept in
   * sync by hand every frame.
   */
  camera: THREE.Camera;
  target: THREE.WebGLRenderTarget;
  sourceScene: THREE.Scene;
  material: THREE.Material | null;
  clearColor: THREE.Color;

  constructor(
    material: THREE.Material | null,
    camera: THREE.Camera,
    target: THREE.WebGLRenderTarget,
    scene: THREE.Scene,
  ) {
    super();
    this.needsSwap = false;
    this.camera = camera;
    this.target = target;
    this.sourceScene = scene;
    this.material = material;
    this.clearColor = new THREE.Color();
  }

  render(renderer: THREE.WebGLRenderer) {
    const previousTarget = renderer.getRenderTarget();
    const previousAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);
    const previousAutoClear = renderer.autoClear;

    const material = this.material as THREE.ShaderMaterial | null;
    (material?.userData as { setPixelRatio?: (r: number) => void })?.setPixelRatio?.(renderer.getPixelRatio());
    const fog = this.sourceScene.fog as (THREE.FogExp2 & { enabled?: boolean }) | null;
    if (material?.uniforms?.['uFogDensity'] && fog?.isFogExp2) {
      const fogEnabled = fog.enabled !== false;
      material.uniforms['uFogDensity'].value = fogEnabled ? fog.density : 0;
      material.uniforms['uMistDens'].value = fogEnabled ? 0.012 : 0;
    }

    // Rendering the scene a second time would otherwise re-run the whole
    // shadow map, which the beauty pass has already produced this frame.
    const previousShadowAuto = renderer.shadowMap.autoUpdate;
    const previousShadowNeeds = renderer.shadowMap.needsUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;

    // Dynamic matrices are current before the composer runs, and RenderPass
    // immediately precedes this pass. Repeating a full hierarchy walk for an
    // edge-only layer is pure CPU work once terrain and detail are chunked.
    const previousMatrixAuto = this.sourceScene.matrixWorldAutoUpdate;
    this.sourceScene.matrixWorldAutoUpdate = false;

    const previousLayers = this.camera.layers.mask;
    this.camera.layers.set(EDGE_LAYER);

    renderer.autoClear = false;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.render(this.sourceScene, this.camera);

    this.camera.layers.mask = previousLayers;
    this.sourceScene.matrixWorldAutoUpdate = previousMatrixAuto;
    renderer.shadowMap.autoUpdate = previousShadowAuto;
    renderer.shadowMap.needsUpdate = previousShadowNeeds;
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(this.clearColor, previousAlpha);
    renderer.autoClear = previousAutoClear;
  }
}

/**
 * Renders the scene into a dedicated FBO that owns the depth texture, then
 * blits the colour to the readBuffer so the rest of the composer chain picks
 * it up exactly as if a plain RenderPass had run.
 *
 * The depth texture must never be simultaneously an FBO depth attachment and
 * a sampler in the same draw call (WebGL feedback loop). Keeping it on a
 * separate FBO that is never the composer's writeBuffer makes that impossible:
 * the composer ping-pongs between renderTarget1/2, neither of which has the
 * depth texture attached, so every pass that samples it is writing elsewhere.
 */
class SceneDepthPass extends Pass {
  private _scene: THREE.Scene;
  private _camera: THREE.Camera;
  private _fbo: THREE.WebGLRenderTarget;
  private _quad: FullScreenQuad;

  constructor(scene: THREE.Scene, camera: THREE.Camera, fbo: THREE.WebGLRenderTarget) {
    super();
    this.needsSwap = false;
    this._scene = scene;
    this._camera = camera;
    this._fbo = fbo;
    this._quad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: fbo.texture } },
        vertexShader: `varying vec2 vUv;
                       void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
        fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
                       void main(){ gl_FragColor=texture2D(tDiffuse,vUv); }`,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
  }

  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    renderer.setRenderTarget(this._fbo);
    renderer.render(this._scene, this._camera);

    renderer.setRenderTarget(read);
    renderer.clear();
    this._quad.render(renderer);
  }

  setSize(w: number, h: number) {
    this._fbo.setSize(w, h);
  }

  dispose() {
    (this._quad.material as THREE.Material).dispose();
    this._quad.dispose();
  }
}

/* ------------------------------------------------------------------ *
 * Atmosphere — linear HDR. Physics (or a convincing impression of it).
 * ------------------------------------------------------------------ */
function makeAtmosphereShader(sunDir: THREE.Vector3) {
  return {
    uniforms: {
      tDiffuse: { value: null },
      tDepth: { value: null },
      uNear: { value: 1 },
      uFar: { value: 620 },
      uInvProj: { value: new THREE.Matrix4() },
      uInvView: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uResolution: { value: new THREE.Vector2(1600, 900) },
      uFocal: { value: 900.0 },
      uTime: { value: 0 },

      ...skyUniformValues(SKY, sunDir, THREE),

      /** must match scene.fog's 1/density so the two agree */
      uAerialD: { value: 196 },
      /** Must match the near plane patched into three's fog chunk. */
      uFogNear: { value: FOG_NEAR },
      /** how much residual chroma distance eats, on top of the fog mix */
      uDesat: { value: 0.58 },
      /** how far a fogged pixel is pulled toward its true directional sky colour */
      uSkyBlend: { value: 0.62 },

      /* ---- valley mist ---- */
      uMistColor: { value: new THREE.Color(0.8, 0.79, 0.9) },
      uMistBase: { value: 8.0 }, // waterline-ish
      uMistH: { value: 9.0 }, // e-folding height
      uMistDens: { value: 0.012 },
      uMistMax: { value: 0.34 },

      /* ---- large-scale AO ---- */
      uAOStrength: { value: 0.24 },
      uAORadius: { value: 2.4 }, // world units (tuned for the ~40u play camera)
      uAORange: { value: 4.5 }, // depth delta that counts as fully occluding
      uAOTint: { value: new THREE.Color(0.61, 0.57, 0.72) },

      /* ---- extras ---- */
      uInscatter: { value: 0.28 },
      uDof: { value: 1.2 },         // pixels of defocus at full haze (0 = disabled)
      uAOTaps: { value: 8 },        // rosette taps (0 = skip AO)
      uCloud: { value: 0.055 },
      uCloudShadow: { value: 1.0 }, // 1 = cloud shadow noise on, 0 = disabled
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: /* glsl */ `
      #include <packing>
      uniform sampler2D tDiffuse, tDepth;
      uniform float uNear, uFar, uAerialD, uFogNear, uDesat, uSkyBlend;
      uniform float uMistBase, uMistH, uMistDens, uMistMax;
      uniform float uAOStrength, uAORadius, uAORange;
      uniform float uInscatter, uDof, uAOTaps, uCloud, uCloudShadow, uTime, uFocal;
      uniform vec3 uCamPos, uMistColor, uAOTint;
      uniform vec2 uResolution;
      uniform mat4 uInvProj, uInvView;
      ${SKY_UNIFORMS_GLSL}
      varying vec2 vUv;
      ${SKY_FN_GLSL}

      float viewZ(vec2 uv) {
        float d = texture2D(tDepth, uv).x;
        return perspectiveDepthToViewZ(d, uNear, uFar);
      }

      float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
      float n2(vec2 p){
        vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y);
      }

      /**
       * Analytic integral of an exponential-height medium along the view ray.
       * Returns the *average* density over the segment, so the optical depth is
       * just avg * pathLength. Doing it in closed form (rather than raymarching)
       * is what makes real valley pooling affordable in a single pass.
       */
      float heightAvg(float y0, float y1) {
        float a = clamp((y0 - uMistBase) / uMistH, -4.0, 20.0);
        float b = clamp((y1 - uMistBase) / uMistH, -4.0, 20.0);
        if (abs(b - a) < 0.02) return exp(-a);
        return (exp(-a) - exp(-b)) / (b - a);
      }

      // Full eight-point rosette for smooth large-scale contact shading.
      const vec2 AO_DIR[8] = vec2[8](
        vec2( 1.000,  0.000), vec2( 0.707,  0.707), vec2( 0.000,  1.000), vec2(-0.707,  0.707),
        vec2(-1.000,  0.000), vec2(-0.707, -0.707), vec2( 0.000, -1.000), vec2( 0.707, -0.707));

      void main() {
        vec4 src = texture2D(tDiffuse, vUv);
        float rawDepth = texture2D(tDepth, vUv).x;

        // Sky: already the right colour by construction (same skyRadiance),
        // nothing to add.
        if (rawDepth >= 0.9999) { gl_FragColor = src; return; }

        vec4 ndc = vec4(vUv * 2.0 - 1.0, rawDepth * 2.0 - 1.0, 1.0);
        vec4 view = uInvProj * ndc;
        view /= view.w;
        float dist = length(view.xyz);
        vec3 world = (uInvView * vec4(view.xyz, 1.0)).xyz;
        vec3 wdir = normalize(world - uCamPos);

        // ---- aerial term (must match scene.fog exactly) ----------------
        // Same near plane as the material fog. If these two ever disagree the
        // depth-buffer effects fade on a different schedule from the surfaces
        // they sit on, and the seam is visible as a ring.
        float t = max(dist - uFogNear, 0.0) / uAerialD;
        float fog = 1.0 - exp(-t * t);

        // ---- ground mist ------------------------------------------------
        // Mist gets the same treatment for the same reason: pooled in the
        // valleys it should be, sitting on the block in front of you it should
        // not be.
        float mistPath = max(dist - uFogNear * 0.5, 0.0);
        float mist = 1.0 - exp(-uMistDens * mistPath * heightAvg(uCamPos.y, world.y));
        mist = clamp(mist, 0.0, 1.0) * uMistMax;

        // ---- defocus ----------------------------------------------------
        // Two taps on a rotating pair, radius driven by total haze. Enough to
        // take the edge off the far field; deliberately not enough to read as
        // a photographic effect.
        float blurPx = uDof * pow(max(fog, mist), 1.4);
        vec3 col = src.rgb;
        if (uDof > 0.0 && blurPx > 0.12) {
          vec2 px = blurPx / uResolution;
          vec3 acc = col;
          for (int i = 0; i < 4; i++) {
            acc += texture2D(tDiffuse, vUv + AO_DIR[i * 2] * px).rgb;
          }
          col = acc / 5.0;
        }

        // ---- large-scale AO ---------------------------------------------
        // uAOTaps = 0 skips entirely (very-low / low tier).
        // uAOTaps = 4 runs the near ring only (mid tier, half the fetches).
        float ao = 1.0;
        if (uAOTaps > 0.0) {
          float zc = viewZ(vUv);
          float px = clamp(uAORadius * uFocal / max(-zc, 1.0), 2.0, 64.0);
          vec2 aoStep = px / uResolution;
          float occ = 0.0;
          for (int i = 0; i < 8; i++) {
            float w = step(float(i), uAOTaps - 1.0);
            float zs1 = viewZ(vUv + AO_DIR[i] * aoStep * 0.45);
            float zs2 = viewZ(vUv + AO_DIR[i] * aoStep);
            float d1 = zs1 - zc;
            float d2 = zs2 - zc;
            occ += w * clamp(d1 / uAORange, 0.0, 1.0) * (1.0 - smoothstep(uAORange, uAORange * 4.0, d1)) * 0.6;
            occ += w * clamp(d2 / uAORange, 0.0, 1.0) * (1.0 - smoothstep(uAORange, uAORange * 4.0, d2)) * 0.4;
          }
          occ = clamp(occ / max(uAOTaps, 1.0), 0.0, 1.0);
          // Fade AO out with distance: it has nothing to say once the air has
          // eaten the contrast anyway, and it keeps the far field clean.
          ao = 1.0 - uAOStrength * occ * (1.0 - fog);
        }
        col *= mix(uAOTint, vec3(1.0), ao);

        // ---- drifting cloud shadow (tiered) --------------------------------
        if (uCloudShadow > 0.5) {
          float cs = n2(world.xz * 0.010 + vec2(uTime * 0.011, uTime * 0.006)) * 0.65
                   + n2(world.xz * 0.026 - vec2(uTime * 0.017, 0.0)) * 0.35;
          cs = smoothstep(0.40, 0.78, cs);
          col *= 1.0 - uCloud * cs * (1.0 - fog);
        }

        // ---- chroma falls faster than value ------------------------------
        float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(col, vec3(lum), min(fog * uDesat, 0.95));

        // ---- melt into the sky --------------------------------------------
        vec3 sky = skyRadiance(wdir);
        col = mix(col, sky, fog * uSkyBlend);

        // ---- mist on top ----------------------------------------------------
        col = mix(col, uMistColor, mist * (1.0 - fog * 0.5));

        // ---- forward scatter -------------------------------------------------
        float s = max(dot(wdir, uSunDirW), 0.0);
        col += uSunGlow * uInscatter * (fog + mist * 0.5) * (pow(s, 4.0) * 0.8 + pow(s, 1.2) * 0.35);

        gl_FragColor = vec4(col, src.a);
      }
    `,
  };
}

export function createPostFX(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  edgeMaterial: THREE.ShaderMaterial,
  tier: GpuTier = 'high',
) {
  const size = renderer.getSize(new THREE.Vector2());
  const dpr = renderer.getPixelRatio();

  const target = new THREE.WebGLRenderTarget(size.x * dpr, size.y * dpr, {
    type: THREE.HalfFloatType,
    // SMAA is the final pass. Multisampling this HDR target as well consumed
    // four times the colour/depth bandwidth for nearly identical edges.
    samples: 0,
  });
  const depthTexture = new THREE.DepthTexture(size.x * dpr, size.y * dpr);
  depthTexture.type = THREE.UnsignedIntType;
  const edgeMask = new THREE.WebGLRenderTarget(size.x * dpr, size.y * dpr, {
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
  });
  edgeMask.texture.name = 'edge-coverage-mask';
  edgeMask.texture.colorSpace = THREE.NoColorSpace;

  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(dpr);
  composer.setSize(size.x, size.y);

  // sceneFBO owns the depthTexture and is never part of the composer's
  // ping-pong chain, so no pass ever writes to it while sampling depthTexture.
  const sceneFBO = new THREE.WebGLRenderTarget(size.x * dpr, size.y * dpr, {
    type: THREE.HalfFloatType,
    samples: 0,
    depthTexture,
  });

  const ts = TIER_SETTINGS[tier];

  composer.addPass(new SceneDepthPass(scene, camera, sceneFBO));
  edgeMaterial.uniforms.tSceneDepth.value = depthTexture;
  const edgePass = new EdgeMaskPass(edgeMaterial, camera, edgeMask, scene);
  if (ts.edgeMask) composer.addPass(edgePass);

  const haze = new ShaderPass(makeAtmosphereShader(LIGHT.sunDir));
  haze.uniforms.tDepth.value = depthTexture;
  haze.uniforms.uAOTaps.value = ts.aoTaps;
  haze.uniforms.uDof.value = ts.dof ? 1.2 : 0.0;
  haze.uniforms.uCloudShadow.value = ts.cloudShadow ? 1.0 : 0.0;
  haze.uniforms.uNightSkyFull = { value: ts.nightSkyFull ? 1.0 : 0.0 };
  const authoredMistMax = haze.uniforms.uMistMax.value;
  composer.addPass(haze);

  // Bloom runs *after* the atmosphere on purpose: the haze is a light source
  // in its own right, and letting it feed the bloom is what gives the far
  // field that soft luminous edge instead of a flat wash.
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    GRADE.bloom.strength,
    GRADE.bloom.radius,
    GRADE.bloom.threshold,
  );
  // The palette's numbers are display-space intuitions, but this pass sees
  // linear HDR, where a threshold of 0.72 catches most of a pastel palette
  // outright. Only genuine emitters and specular hits should bloom.
  bloom.threshold = 1.25;
  bloom.strength = 0.22;
  bloom.radius = 0.9;
  if (ts.bloom) composer.addPass(bloom);

  const CrepuscularShader = {
    uniforms: {
      tDiffuse: { value: null as THREE.Texture | null },
      uSunScreen: { value: new THREE.Vector2(0.5, 0.5) },
      uSunVisible: { value: 0.0 },
      uDecay: { value: 0.96 },
      uDensity: { value: 0.96 },
      uWeight: { value: 0.35 },
      uTaps: { value: 8.0 }, // 0 = disabled, 4 = half-quality, 8 = full
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec2  uSunScreen;
      uniform float uSunVisible;
      uniform float uDecay;
      uniform float uDensity;
      uniform float uWeight;
      uniform float uTaps;
      varying vec2 vUv;
      void main() {
        if (uSunVisible < 0.01 || uTaps < 0.5) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
        vec2 delta = (vUv - uSunScreen) * uDensity / 8.0;
        vec2 uv = vUv;
        float illum = 1.0;
        vec3 accum = vec3(0.0);
        for (int i = 0; i < 8; i++) {
          float w = step(float(i), uTaps - 1.0);
          uv -= delta;
          accum += texture2D(tDiffuse, uv).rgb * illum * w;
          illum *= mix(1.0, uDecay, w);
        }
        accum *= uWeight * uSunVisible / max(uTaps, 1.0);
        gl_FragColor = texture2D(tDiffuse, vUv) + vec4(accum, 0.0);
      }
    `,
  };
  const crepPass = new ShaderPass(CrepuscularShader);
  crepPass.uniforms['uTaps'].value = ts.crepuscularTaps;
  composer.addPass(crepPass);

  const grade = new ShaderPass(GradeShader);
  // This shader performs ACES and the sRGB transfer itself. Prevent Three from
  // injecting a second tone-mapping prelude if this pass is ever temporarily
  // made the final screen pass by profiling or debugging tools.
  grade.material.toneMapped = false;
  grade.uniforms.tEdges.value = edgeMask.texture;
  grade.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
  grade.uniforms.uAberration.value = 0.0008;
  // When EdgeMaskPass is skipped, zero the opacities so the black fallback
  // texture fed to tEdges is invisible in the grade pass.
  if (!ts.edgeMask) {
    grade.uniforms.uEdgeDarkOpacity.value = 0.0;
    grade.uniforms.uEdgeLightOpacity.value = 0.0;
  }
  composer.addPass(grade);

  // AA pass — SMAA (high/mid), FXAA (low), or none (very-low).
  // All paths: needsSwap=false keeps RenderPass from alternating rt1/rt2,
  // which caused the atmosphere depth texture mismatch and full-screen flash.
  let aaResolutionUniforms: { value: THREE.Vector2 } | null = null;
  if (ts.aaQuality === 'smaa') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const smaa = new (SMAAPass as any)(size.x * dpr, size.y * dpr) as SMAAPass;
    smaa.needsSwap = false;
    composer.addPass(smaa);
    const smaaAny = smaa as unknown as { uniforms?: { resolution: { value: THREE.Vector2 } } };
    if (smaaAny.uniforms?.resolution) aaResolutionUniforms = smaaAny.uniforms.resolution;
  } else if (ts.aaQuality === 'fxaa') {
    const fxaa = new ShaderPass(FXAAShader);
    fxaa.needsSwap = false;
    fxaa.uniforms['resolution'].value.set(1 / (size.x * dpr), 1 / (size.y * dpr));
    composer.addPass(fxaa);
    aaResolutionUniforms = fxaa.uniforms['resolution'];
  }
  // 'none': no AA pass added — fastest path for very-low tier

  const setRes = (w: number, h: number) => {
    const p = renderer.getPixelRatio();
    haze.uniforms.uResolution.value.set(w * p, h * p);
    // focal length in pixels — converts a world-space radius at a given view
    // depth into a screen-space one
    haze.uniforms.uFocal.value = camera.projectionMatrix.elements[5] * h * p * 0.5;
    if (aaResolutionUniforms) aaResolutionUniforms.value.set(1 / (w * p), 1 / (h * p));
  };
  setRes(size.x, size.y);

  return {
    composer,
    bloom,
    grade,
    haze,
    target,
    edgeMask,
    edgePass,
    setSunScreenPos(x: number, y: number, visible: number): void {
      crepPass.uniforms['uSunScreen'].value.set(x, y);
      crepPass.uniforms['uSunVisible'].value = visible;
    },
    render(dt: number) {
      grade.uniforms.uTime.value += dt;
      const u = haze.uniforms;
      u.uTime.value += dt;
      u.uNear.value = camera.near;
      u.uFar.value = camera.far;
      u.uInvProj.value.copy(camera.projectionMatrixInverse);
      u.uInvView.value.copy(camera.matrixWorld);
      u.uCamPos.value.copy(camera.position);
      type ExtFog = THREE.FogExp2 & { enabled?: boolean; aerialD?: number };
      const extFog = scene.fog as ExtFog | null;
      const fogEnabled = extFog?.enabled !== false;
      if (extFog?.aerialD) {
        u.uAerialD.value = fogEnabled ? extFog.aerialD : 1e9;
      }
      u.uMistMax.value = fogEnabled ? authoredMistMax : 0;
      composer.render(dt);
    },
    setSize(w: number, h: number) {
      const dpr = renderer.getPixelRatio();
      composer.setPixelRatio(dpr);
      composer.setSize(w, h);
      sceneFBO.setSize(w * dpr, h * dpr);
      edgeMask.setSize(w * dpr, h * dpr);
      setRes(w, h);
    },
    depthTexture,
  };
}
