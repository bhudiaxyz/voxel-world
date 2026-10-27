import * as THREE from 'three';
import { GRADE } from '../core/palette';
import type { GpuTier } from './gpu-tier';
import { TIER_SETTINGS } from './gpu-tier';

export function createRenderer(container: any, tier: GpuTier = 'high') {
  const captureMode = new URLSearchParams(location.search).get('capture') === '1';
  const dprCap = TIER_SETTINGS[tier].dprCap;

  const choosePixelRatio = (_w?: any, _h?: any) => Math.min(window.devicePixelRatio || 1, dprCap);

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
  // low + very-low: shadow map re-render every frame is expensive on constrained
  // hardware; DayNight.update() sets needsUpdate once per frame so cadence is identical.
  renderer.shadowMap.autoUpdate = tier !== 'very-low' && tier !== 'low';

  // Palette colours are stored linear. getHex() encodes back to sRGB, which is
  // what setClearColor expects; the previous convertLinearToSRGB() *before*
  // getHex() applied the transfer twice and cleared to a near-white.
  // Start dark so the canvas doesn't flash sky-haze colour before the first frame renders.
  renderer.setClearColor(0x07070a, 1);
  renderer.domElement.style.background = '#07070a';
  container.appendChild(renderer.domElement);

  (renderer as any).renderProfile = tier;
  (renderer as any).resizeTo = (width: any, height: any) => {
    renderer.setPixelRatio(choosePixelRatio(width, height));
    renderer.setSize(width, height);
  };
  return renderer;
}
