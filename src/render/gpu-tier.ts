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
  /** VSM blur sample count. */
  blurSamples: number;
  /** Whether the Unreal bloom pass is added to the composer. */
  bloom: boolean;
  /** Number of AO rosette taps (0 = skip AO entirely). */
  aoTaps: number;
  /** Whether the defocus blur runs in the atmosphere pass. */
  dof: boolean;
}

export const TIER_SETTINGS: Record<GpuTier, TierSettings> = {
  high:     { dprCap: 2,    shadowRes: 3072, blurSamples: 16, bloom: true,  aoTaps: 8, dof: true  },
  mid:      { dprCap: 1.25, shadowRes: 2048, blurSamples: 8,  bloom: true,  aoTaps: 4, dof: true  },
  low:      { dprCap: 1,    shadowRes: 1024, blurSamples: 4,  bloom: false, aoTaps: 4, dof: false },
  'very-low': { dprCap: 1,  shadowRes: 512,  blurSamples: 2,  bloom: false, aoTaps: 0, dof: false },
};

export function detectGpuTier(): GpuTier {
  const cores = navigator.hardwareConcurrency ?? 4;
  // deviceMemory is in GB; not available on Firefox/Safari — default to 4
  const mem = ((navigator as any).deviceMemory as number | undefined) ?? 4;
  // Include iPad/iPhone/iPod so Apple tablets don't bypass the mobile path.
  const mobile = /Mobi|Android|iPad|iPhone|iPod/i.test(navigator.userAgent);

  // 7-year-old / budget mobile: very restricted fill rate and bandwidth.
  if (mobile && (cores <= 4 || mem <= 2)) return 'very-low';
  // Non-mobile weak device (e.g. old low-power laptop).
  if (cores <= 4 || mem <= 2) return 'low';
  // Flagship phones (S22 Ultra, iPhone 15) have ≥8 cores and ≥8 GB.
  if (mobile && cores >= 8 && mem >= 8) return 'high';
  if (!mobile && cores >= 8 && mem >= 6) return 'high';
  return 'mid';
}
