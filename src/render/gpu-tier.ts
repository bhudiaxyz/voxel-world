/**
 * Lightweight GPU tier detection.
 *
 * Buckets:
 *   high      — desktop or flagship phone (≥8 cores, ≥6 GB, not mobile)
 *   mid       — laptop / modern tablet / recent mid-range phone
 *   low       — old phone / budget device (≤4 cores or ≤2 GB RAM)
 *   very-low  — 7-year-old or weaker mobile (≤4 cores or ≤2 GB and mobile)
 *
 * Samsung Galaxy S22 Ultra (8-core, 12 GB)     → high
 * Apple iPad M2 (8-core, 8 GB)                 → high
 * Apple iPad Air A14 (6-core, 4 GB)            → mid
 * 2019-era phone (6-core, 3 GB)                → mid
 * Budget / 7-year-old phone (4-core, 2 GB)     → low
 * 7-year-old mobile (4-core, 2 GB, mobile UA)  → very-low
 */

export type GpuTier = 'high' | 'mid' | 'low' | 'very-low';

export interface TierSettings {
  /** Maximum device pixel ratio used for render targets. */
  dprCap: number;
  /** VSM shadow map edge length in pixels. */
  shadowRes: number;
  /** Whether the Unreal bloom pass is added to the composer. */
  bloom: boolean;
  /** Number of AO rosette taps (0 = skip AO entirely). */
  aoTaps: number;
  /** Whether the defocus blur runs in the atmosphere pass. */
  dof: boolean;
  /** Crepuscular ray taps per pixel (0 = disabled, 4 = half, 8 = full). */
  crepuscularTaps: number;
  /** Whether EdgeMaskPass (full second scene render) is added. */
  edgeMask: boolean;
  /** Whether cloud-shadow noise runs in the atmosphere pass. */
  cloudShadow: boolean;
  /** Whether the full night-sky FBM (Milky Way, nebulae) runs. */
  nightSkyFull: boolean;
}

export const TIER_SETTINGS: Record<GpuTier, TierSettings> = {
  high:       { dprCap: 2,    shadowRes: 3072, bloom: true,  aoTaps: 8, dof: true,  crepuscularTaps: 8, edgeMask: true,  cloudShadow: true,  nightSkyFull: true  },
  mid:        { dprCap: 1.25, shadowRes: 2048, bloom: true,  aoTaps: 4, dof: true,  crepuscularTaps: 4, edgeMask: true,  cloudShadow: true,  nightSkyFull: true  },
  low:        { dprCap: 1,    shadowRes: 1024, bloom: false, aoTaps: 2, dof: false, crepuscularTaps: 0, edgeMask: false, cloudShadow: false, nightSkyFull: false },
  'very-low': { dprCap: 1,    shadowRes: 512,  bloom: false, aoTaps: 0, dof: false, crepuscularTaps: 0, edgeMask: false, cloudShadow: false, nightSkyFull: false },
};

/**
 * Detect GPU tier from hardware signals.
 *
 * Tier mapping:
 *   high      — desktop or flagship phone (≥8 cores, ≥6 GB, not mobile)
 *   mid       — laptop / modern tablet / recent mid-range phone
 *   low       — old phone / budget device
 *   very-low  — 7-year-old or weaker mobile
 *
 * Samsung Galaxy S22 Ultra (8-core, 12 GB)     → high
 * Apple iPad M2 (8-core, 8 GB)                 → high
 * Apple iPad Air A14 (6-core, 4 GB)            → mid
 * 2019-era phone (6-core, 3 GB)                → mid
 * Budget / 7-year-old phone (4-core, 2 GB)     → low
 * 7-year-old mobile (4-core, 2 GB, mobile UA)  → very-low
 */
export function detectGpuTier(): GpuTier {
  const cores = navigator.hardwareConcurrency ?? 4;
  const mobile = /Mobi|Android|iPad|iPhone|iPod/i.test(navigator.userAgent);

  // WebGL2 absence is a strong low-tier signal on 7-year-old devices.
  const hasWebGL2 = (() => {
    try { return !!document.createElement('canvas').getContext('webgl2'); }
    catch { return false; }
  })();

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

  if (mobile && (!hasWebGL2 || cores <= 4 || estimatedMem <= 2)) return 'very-low';
  if (cores <= 4 || estimatedMem <= 2) return 'low';
  if (mobile && cores >= 8 && estimatedMem >= 8) return 'high';
  if (!mobile && cores >= 8 && estimatedMem >= 6) return 'high';
  return 'mid';
}
