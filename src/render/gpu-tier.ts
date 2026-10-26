/**
 * Lightweight GPU tier detection.
 *
 * Buckets:
 *   high  — desktop or flagship phone (≥8 cores, ≥6 GB, not mobile)
 *   mid   — laptop / modern tablet / recent mid-range phone
 *   low   — old phone / budget device (≤4 cores or ≤2 GB RAM)
 *
 * Samsung Galaxy S22 Ultra (8-core, 12 GB) → high
 * Apple iPad M2 (8-core, 8 GB)            → high
 * Apple iPad Air A14 (6-core, 4 GB)       → mid
 * 2019-era phone (6-core, 3 GB)           → mid
 * Budget / 7-year-old phone (4-core, 2 GB)→ low
 */

export type GpuTier = 'high' | 'mid' | 'low';

export interface TierSettings {
  /** Maximum device pixel ratio used for render targets. */
  dprCap: number;
  /** VSM shadow map edge length in pixels. */
  shadowRes: number;
  /** VSM blur sample count. */
  blurSamples: number;
  /** Whether the Unreal bloom pass is added to the composer. */
  bloom: boolean;
}

export const TIER_SETTINGS: Record<GpuTier, TierSettings> = {
  high: { dprCap: 2,   shadowRes: 3072, blurSamples: 16, bloom: true  },
  mid:  { dprCap: 1.5, shadowRes: 2048, blurSamples: 8,  bloom: true  },
  low:  { dprCap: 1,   shadowRes: 1024, blurSamples: 4,  bloom: false },
};

export function detectGpuTier(): GpuTier {
  const cores = navigator.hardwareConcurrency ?? 4;
  // deviceMemory is in GB; not available on Firefox/Safari — default to 4
  const mem = (navigator as any).deviceMemory as number | undefined ?? 4;
  const mobile = /Mobi|Android/i.test(navigator.userAgent);

  if (cores <= 4 || mem <= 2) return 'low';
  if (!mobile && cores >= 8 && mem >= 6) return 'high';
  // Flagship phones (S22 Ultra, iPhone 15) have ≥8 cores and ≥8 GB.
  if (mobile && cores >= 8 && mem >= 8) return 'high';
  return 'mid';
}
