/**
 * Lightweight GPU tier detection.
 *
 * Buckets:
 *   high         — desktop discrete GPU (≥8 cores, ≥6 GB, large texture units)
 *   mobile-high  — flagship phone/iPad (≥8 cores, ≥8 GB mobile)
 *   mid          — laptop / modern tablet / capable mid-range phone
 *   low          — older or constrained desktop device
 *   very-low     — 7-year-old or weaker mobile
 *
 * Samsung Galaxy S22 Ultra (8-core, 12 GB)     → mobile-high
 * Apple iPad Pro M2 (8-core, 8 GB)             → mobile-high (Safari: deviceMemory absent, probe=4, threshold ≥4 catches it)
 * Apple iPad Air M2 (8-core, 4 GB)             → mobile-high
 * Apple iPad Air A14 (6-core, 4 GB)            → mid
 * MacBook Air M2 (8-core, 8 GB, no mobile UA)  → high  (maxTex=16384)
 * Intel UHD laptop (8-core, 16 GB, maxTex≤8192)→ mid   (downclassed by texture probe)
 * 2019 mid-range phone (6-core, 3 GB)          → mid
 * Budget phone (4-core, 2 GB, WebGL2)          → low (desktop) / very-low (mobile)
 * 7-year-old mobile (no WebGL2)                → very-low
 */

export type GpuTier = 'high' | 'mobile-high' | 'mid' | 'low' | 'very-low';

export interface TierSettings {
  /** Maximum device pixel ratio used for render targets. */
  dprCap: number;
  /** VSM shadow map edge length in pixels. */
  shadowRes: number;
  /** VSM blur sample count — fewer = cheaper on fill-rate-limited mobile. */
  shadowBlurSamples: number;
  /** Shadow frustum half-extent in world units. Smaller = denser texels. */
  shadowExtent: number;
  /** Main camera far plane. Lower = better depth precision, no visible difference with fog. */
  cameraFar: number;
  /** Whether the Unreal bloom pass is added to the composer. */
  bloom: boolean;
  /** Number of AO rosette taps (0 = skip AO entirely). */
  aoTaps: number;
  /** Whether the defocus blur runs in the atmosphere pass. */
  dof: boolean;
  /** Crepuscular ray taps per pixel (0 = disabled, 4 = half, 8 = full). */
  crepuscularTaps: number;
  /** Whether EdgeMaskPass (full second scene render) is added. High-only — it doubles scene draw calls. */
  edgeMask: boolean;
  /** Whether cloud-shadow noise runs in the atmosphere pass. */
  cloudShadow: boolean;
  /** Whether the full night-sky FBM (Milky Way, nebulae) runs. */
  nightSkyFull: boolean;
  /** Anti-aliasing quality. 'smaa' = full SMAA, 'fxaa' = single-pass, 'none' = off. */
  aaQuality: 'smaa' | 'fxaa' | 'none';
  /** Chunk stream radius in chunk units. Lower = fewer draw calls on weak devices. */
  streamRadius: number;
  /** Water plane subdivision (NxN quads). Higher = smoother waves but more vertices. */
  waterSubdivision: number;
  /** Particle instance count for leaves/dust effects. */
  particleCount: number;
}

//                         dprCap  shadowRes  blurSamples  shadowExtent  cameraFar  bloom   aoTaps  dof    crep  edge   cloud  nightFull  aa       stream  waterSub  particles
export const TIER_SETTINGS: Record<GpuTier, TierSettings> = {
  high:         { dprCap: 2,    shadowRes: 3072, shadowBlurSamples: 12, shadowExtent: 120, cameraFar: 6000, bloom: true,  aoTaps: 8, dof: true,  crepuscularTaps: 8, edgeMask: true,  cloudShadow: true,  nightSkyFull: true,  aaQuality: 'smaa', streamRadius: 12, waterSubdivision: 64, particleCount: 1200 },
  'mobile-high':{ dprCap: 1.5,  shadowRes: 2048, shadowBlurSamples: 8,  shadowExtent: 110, cameraFar: 3000, bloom: true,  aoTaps: 4, dof: true,  crepuscularTaps: 4, edgeMask: false, cloudShadow: true,  nightSkyFull: true,  aaQuality: 'smaa', streamRadius: 11, waterSubdivision: 32, particleCount: 700  },
  mid:          { dprCap: 1.25, shadowRes: 2048, shadowBlurSamples: 8,  shadowExtent: 120, cameraFar: 3000, bloom: true,  aoTaps: 4, dof: true,  crepuscularTaps: 4, edgeMask: false, cloudShadow: true,  nightSkyFull: true,  aaQuality: 'smaa', streamRadius: 11, waterSubdivision: 32, particleCount: 600  },
  low:          { dprCap: 1,    shadowRes: 1024, shadowBlurSamples: 4,  shadowExtent: 100, cameraFar: 1500, bloom: false, aoTaps: 0, dof: false, crepuscularTaps: 0, edgeMask: false, cloudShadow: false, nightSkyFull: false, aaQuality: 'fxaa', streamRadius: 8,  waterSubdivision: 16, particleCount: 200  },
  'very-low':   { dprCap: 1,    shadowRes: 512,  shadowBlurSamples: 4,  shadowExtent: 80,  cameraFar: 1200, bloom: false, aoTaps: 0, dof: false, crepuscularTaps: 0, edgeMask: false, cloudShadow: false, nightSkyFull: false, aaQuality: 'none', streamRadius: 6,  waterSubdivision: 4,  particleCount: 0    },
};

/**
 * Detect GPU tier from hardware signals.
 *
 * Uses hardwareConcurrency, deviceMemory (with canvas-timing fallback for
 * Firefox/Safari), MAX_TEXTURE_SIZE (discriminates integrated vs discrete GPU),
 * WebGL2 availability, and UA mobile detection.
 */
export function detectGpuTier(): GpuTier {
  const cores = navigator.hardwareConcurrency ?? 4;
  const mobile = /Mobi|Android|iPad|iPhone|iPod/i.test(navigator.userAgent);

  // WebGL2 absence is a strong low-tier signal on 7-year-old devices.
  const gl2 = (() => {
    try { return document.createElement('canvas').getContext('webgl2'); }
    catch { return null; }
  })();
  const hasWebGL2 = !!gl2;

  // MAX_TEXTURE_SIZE: integrated Intel/AMD tops out at 8192; discrete and all
  // Apple Silicon report 16384+. This is the most reliable way to separate
  // a 16-core i9 laptop with integrated graphics from a desktop discrete GPU.
  const maxTexSize: number = gl2
    ? (gl2.getParameter(gl2.MAX_TEXTURE_SIZE) as number)
    : 4096;
  // Release the probe context — it has served its purpose and holding it
  // occupies GPU memory until the tab closes.
  gl2?.getExtension('WEBGL_lose_context')?.loseContext();

  // deviceMemory is absent on Firefox/Safari; fall back to a canvas timing
  // probe or WebGL2 presence as a proxy.
  const declaredMem = (navigator as any).deviceMemory as number | undefined;
  const estimatedMem = declaredMem ?? (() => {
    if (!hasWebGL2) return 1;
    try {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 512;
      const ctx = cv.getContext('2d');
      if (!ctx) return 4;
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) ctx.fillRect(0, 0, 512, 512);
      return (performance.now() - t0) > 15 ? 2 : 4;
    } catch { return 4; }
  })();

  // very-low: no WebGL2, or weak mobile hardware
  if (mobile && (!hasWebGL2 || cores <= 4 || estimatedMem <= 2)) return 'very-low';
  // low: weak desktop/non-mobile (≤4 cores OR ≤2 GB)
  if (cores <= 4 || estimatedMem <= 2) return 'low';

  // mobile-high: flagship phone/tablet (replaces old 'high' mobile path to avoid
  // enabling EdgeMask on mobile, which doubles draw calls for little visual gain)
  if (mobile && cores >= 8 && estimatedMem >= 4) return 'mobile-high';

  // high: desktop with discrete GPU — requires large texture units to exclude
  // integrated Intel/AMD which tops out at maxTexSize=8192.
  if (!mobile && cores >= 8 && estimatedMem >= 6 && maxTexSize >= 16384) return 'high';

  // mid: capable device — requires BOTH ≥6 cores AND ≥3 GB.
  // Also catches integrated-GPU desktops (maxTexSize≤8192) that would otherwise
  // hit high but can't sustain EdgeMask + 3072 shadow.
  if (cores >= 6 && estimatedMem >= 3) return 'mid';

  // anything else (e.g. 6-core/2 GB or 4-core/4 GB) falls to low
  return 'low';
}
