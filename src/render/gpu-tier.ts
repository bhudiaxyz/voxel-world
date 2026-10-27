/**
 * Lightweight GPU tier detection.
 *
 * Buckets:
 *   high      — desktop or flagship mobile (≥8 cores, ≥6 GB, or flagship mobile)
 *   mid       — laptop / modern tablet / capable mid-range phone (≥6 cores AND ≥3 GB)
 *   low       — older or constrained device (≤4 cores or ≤2 GB, desktop/non-mobile)
 *   very-low  — 7-year-old or weaker mobile
 *
 * Samsung Galaxy S22 Ultra (8-core, 12 GB)     → high
 * Apple iPad M2 (8-core, 8 GB)                 → high
 * Apple iPad Air A14 (6-core, 4 GB)            → mid
 * 2019-era phone (6-core, 3 GB)                → mid
 * Budget phone (4-core, 2 GB)                  → low (desktop) / very-low (mobile)
 * 7-year-old mobile (4-core, 2 GB, mobile UA)  → very-low
 *
 * Key fix over previous version: mid now requires ≥6 cores AND ≥3 GB (previously OR),
 * so weak devices that passed on cores alone no longer get EdgeMask + bloom.
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
  /** Whether EdgeMaskPass (full second scene render) is added. High-only — it doubles scene draw calls. */
  edgeMask: boolean;
  /** Whether cloud-shadow noise runs in the atmosphere pass. */
  cloudShadow: boolean;
  /** Whether the full night-sky FBM (Milky Way, nebulae) runs. */
  nightSkyFull: boolean;
  /** Chunk stream radius in chunk units. Lower = fewer draw calls on weak devices. */
  streamRadius: number;
  /** Water plane subdivision (NxN quads). Higher = smoother waves but more vertices. */
  waterSubdivision: number;
  /** Particle instance count for leaves/dust effects. */
  particleCount: number;
}

export const TIER_SETTINGS: Record<GpuTier, TierSettings> = {
  //                dprCap  shadowRes  bloom   aoTaps  dof    crep  edge   cloud  nightFull  stream  waterSub  particles
  high:       { dprCap: 2,    shadowRes: 3072, bloom: true,  aoTaps: 8, dof: true,  crepuscularTaps: 8, edgeMask: true,  cloudShadow: true,  nightSkyFull: true,  streamRadius: 8, waterSubdivision: 64, particleCount: 1200 },
  mid:        { dprCap: 1.25, shadowRes: 2048, bloom: true,  aoTaps: 4, dof: true,  crepuscularTaps: 4, edgeMask: false, cloudShadow: true,  nightSkyFull: true,  streamRadius: 7, waterSubdivision: 32, particleCount: 600  },
  low:        { dprCap: 1,    shadowRes: 1024, bloom: false, aoTaps: 2, dof: false, crepuscularTaps: 0, edgeMask: false, cloudShadow: false, nightSkyFull: false, streamRadius: 5, waterSubdivision: 16, particleCount: 200  },
  'very-low': { dprCap: 1,    shadowRes: 512,  bloom: false, aoTaps: 0, dof: false, crepuscularTaps: 0, edgeMask: false, cloudShadow: false, nightSkyFull: false, streamRadius: 4, waterSubdivision: 8,  particleCount: 0    },
};

/**
 * Detect GPU tier from hardware signals.
 *
 * Uses hardwareConcurrency, deviceMemory (with canvas-timing fallback for
 * Firefox/Safari), WebGL2 availability, and UA mobile detection.
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

  // very-low: no WebGL2, or weak mobile hardware
  if (mobile && (!hasWebGL2 || cores <= 4 || estimatedMem <= 2)) return 'very-low';
  // low: weak desktop/non-mobile (≤4 cores OR ≤2 GB)
  if (cores <= 4 || estimatedMem <= 2) return 'low';
  // high: flagship — desktop ≥8 core/≥6 GB, or flagship mobile ≥8 core/≥8 GB
  if (!mobile && cores >= 8 && estimatedMem >= 6) return 'high';
  if (mobile  && cores >= 8 && estimatedMem >= 8) return 'high';
  // mid: capable device — requires BOTH ≥6 cores AND ≥3 GB (previously OR, which
  // let weak single-signal devices through to mid with EdgeMask + bloom).
  if (cores >= 6 && estimatedMem >= 3) return 'mid';
  // anything else (e.g. 6-core/2 GB or 4-core/4 GB) falls to low
  return 'low';
}
