/**
 * WebGL renderer setup.
 *
 * Purpose:
 *   Creates and configures the THREE.WebGLRenderer for the detected GPU tier
 *   and attaches its canvas to the container.
 *
 * Operations:
 *   - Pixel ratio = min(devicePixelRatio, tier dprCap) × dprScale.
 *   - sRGB output, ACES tone mapping, exposure from the palette GRADE.
 *   - VSM shadows (PCF fallback without float render-target support);
 *     shadow auto-update only on tiers with shadowInterval ≤ 1.
 *   - Adds helpers on the instance: setDprScale(s), resizeTo(w, h),
 *     floatRT (bool), renderProfile (tier).
 *
 * Usage:
 *   const renderer = createRenderer(container, tier);
 *   main.ts's adaptive-resolution governor calls setDprScale + resizeTo.
 *
 * Important:
 *   - antialias is off on purpose — AA is the last post-FX pass.
 *   - preserveDrawingBuffer only with `?capture=1` (screenshot tooling).
 *   - Palette colours are linear; pass hex (sRGB) to setClearColor, don't
 *     convert twice.
 */
import * as THREE from 'three';
import { GRADE } from '../core/palette';
import type { GpuTier } from './gpu-tier';
import { TIER_SETTINGS } from './gpu-tier';

export function createRenderer(container: any, tier: GpuTier = 'high') {
    const captureMode = new URLSearchParams(location.search).get('capture') === '1';
    const dprCap = TIER_SETTINGS[tier].dprCap;

    // `dprScale` is driven by the adaptive-resolution governor in main.ts.
    let dprScale = 1;
    const choosePixelRatio = (_w?: any, _h?: any) => Math.min(window.devicePixelRatio || 1, dprCap) * dprScale;

    const renderer = new THREE.WebGLRenderer({
        // The scene is rendered through EffectComposer and receives post-process AA at the
        // end of that chain. Asking the browser for another multisampled default
        // framebuffer only duplicates work without touching the composed image.
        antialias: false,
        powerPreference: 'high-performance',
        stencil: false,
        alpha: false,
        // Retaining every presented frame costs bandwidth on some drivers and is
        // unnecessary in gameplay. The deterministic capture tool opts in via
        // `?capture=1` when it needs canvas.toDataURL().
        preserveDrawingBuffer: captureMode,
    });
    renderer.setPixelRatio(choosePixelRatio(container.clientWidth, container.clientHeight));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = GRADE.exposure;

    renderer.shadowMap.enabled = true;
    // VSM gives the large pastel cast shadows a stable, separably-filtered
    // penumbra. The former five-sample rotated PCF kernel was responsible for
    // the visible grain/crawling in broad tree shadows.
    renderer.shadowMap.type = THREE.VSMShadowMap;
    // Half-float render targets (HDR chain + VSM moments) need a colour-buffer-float
    // extension. Nearly universal on WebGL2, but fall back rather than render black.
    const floatRT =
        renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    if (!floatRT) renderer.shadowMap.type = THREE.PCFShadowMap;
    (renderer as any).floatRT = floatRT;
    // Shadow-map cadence: main.ts sets needsUpdate every `shadowInterval` frames.
    renderer.shadowMap.autoUpdate = TIER_SETTINGS[tier].shadowInterval <= 1;

    // Palette colours are stored linear. getHex() encodes back to sRGB, which is
    // what setClearColor expects; the previous convertLinearToSRGB() *before*
    // getHex() applied the transfer twice and cleared to a near-white.
    // Start dark so the canvas doesn't flash sky-haze colour before the first frame renders.
    renderer.setClearColor(0x07070a, 1);
    renderer.domElement.style.background = '#07070a';
    container.appendChild(renderer.domElement);

    (renderer as any).renderProfile = tier;
    (renderer as any).setDprScale = (s: number) => {
        dprScale = s;
    };
    (renderer as any).resizeTo = (width: any, height: any) => {
        renderer.setPixelRatio(choosePixelRatio(width, height));
        renderer.setSize(width, height);
    };
    return renderer;
}
