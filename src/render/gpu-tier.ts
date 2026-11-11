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
 * Samsung Galaxy S22 Ultra (8-core, deviceMemory 8)   → mobile-high
 * Apple iPad / iPhone, A12 or newer (maxTex 16384)    → mobile-high (iPadOS desktop UA detected via touch points)
 * Older Apple mobile (maxTex < 16384)                 → mid
 * Desktop with discrete GPU (renderer string)         → high
 * Laptop with integrated Intel/AMD GPU                → mid
 * 2019 mid-range Android (6-core, 3-4 GB)             → mid
 * Old Mali-T / Adreno ≤5xx phones                     → low
 * Budget phone (≤4 cores or ≤2 GB)                    → very-low
 * Software renderer (SwiftShader, llvmpipe)           → very-low
 * No WebGL2 → app cannot run; main.ts shows a message.
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
    /** Ground-sprite (grass blades / wildflowers) density multiplier. 0 = legacy sparse tufts only. */
    detailDensity: number;
    /** Ground-sprite draw distance in world units (per-batch distance cull). */
    detailDistance: number;
    /** Re-render the shadow map every N frames (1 = every frame). */
    shadowInterval: number;
}

//                         dprCap  shadowRes  blurSamples  shadowExtent  cameraFar  bloom   aoTaps  dof    crep  edge   cloud  nightFull  aa       stream  waterSub  particles
export const TIER_SETTINGS: Record<GpuTier, TierSettings> = {
    high: {
        dprCap: 2,
        shadowRes: 4096,
        shadowBlurSamples: 12,
        shadowExtent: 120,
        cameraFar: 6000,
        bloom: true,
        aoTaps: 8,
        dof: true,
        crepuscularTaps: 8,
        edgeMask: true,
        cloudShadow: true,
        nightSkyFull: true,
        aaQuality: 'smaa',
        streamRadius: 12,
        waterSubdivision: 64,
        particleCount: 1200,
        detailDensity: 1.0,
        detailDistance: 140,
        shadowInterval: 1,
    },
    'mobile-high': {
        dprCap: 1.5,
        shadowRes: 2048,
        shadowBlurSamples: 8,
        shadowExtent: 110,
        cameraFar: 3000,
        bloom: true,
        aoTaps: 4,
        dof: true,
        crepuscularTaps: 4,
        edgeMask: false,
        cloudShadow: true,
        nightSkyFull: true,
        aaQuality: 'smaa',
        streamRadius: 11,
        waterSubdivision: 32,
        particleCount: 700,
        detailDensity: 0.55,
        detailDistance: 90,
        shadowInterval: 2,
    },
    mid: {
        dprCap: 1.25,
        shadowRes: 2048,
        shadowBlurSamples: 8,
        shadowExtent: 120,
        cameraFar: 3000,
        bloom: true,
        aoTaps: 4,
        dof: true,
        crepuscularTaps: 4,
        edgeMask: false,
        cloudShadow: true,
        nightSkyFull: true,
        aaQuality: 'smaa',
        streamRadius: 11,
        waterSubdivision: 32,
        particleCount: 600,
        detailDensity: 0.6,
        detailDistance: 100,
        shadowInterval: 2,
    },
    low: {
        dprCap: 1,
        shadowRes: 1024,
        shadowBlurSamples: 4,
        shadowExtent: 100,
        cameraFar: 1500,
        bloom: false,
        aoTaps: 0,
        dof: false,
        crepuscularTaps: 0,
        edgeMask: false,
        cloudShadow: false,
        nightSkyFull: false,
        aaQuality: 'fxaa',
        streamRadius: 8,
        waterSubdivision: 16,
        particleCount: 200,
        detailDensity: 0.25,
        detailDistance: 70,
        shadowInterval: 3,
    },
    'very-low': {
        dprCap: 1,
        shadowRes: 512,
        shadowBlurSamples: 4,
        shadowExtent: 80,
        cameraFar: 1200,
        bloom: false,
        aoTaps: 0,
        dof: false,
        crepuscularTaps: 0,
        edgeMask: false,
        cloudShadow: false,
        nightSkyFull: false,
        aaQuality: 'none',
        streamRadius: 6,
        waterSubdivision: 4,
        particleCount: 0,
        detailDensity: 0,
        detailDistance: 50,
        shadowInterval: 6,
    },
};

/** The renderer (three r185) requires WebGL2; without it the app cannot start. */
export function hasWebGL2(): boolean {
    try {
        return !!document.createElement('canvas').getContext('webgl2');
    } catch {
        return false;
    }
}

/**
 * Detect GPU tier from hardware signals.
 *
 * `?tier=<name>` overrides detection (testing on real devices).
 *
 * Signals: unmasked GPU renderer string (integrated vs discrete vs software),
 * hardwareConcurrency, deviceMemory (Chrome/Android only — capped at 8), and
 * mobile detection that includes iPadOS, which reports a desktop Mac UA.
 * Misclassification is cheap: main.ts runs an adaptive-resolution governor on
 * top of whatever tier is picked here.
 */
export function detectGpuTier(): GpuTier {
    const forced = new URLSearchParams(location.search).get('tier') as GpuTier | null;
    if (forced && forced in TIER_SETTINGS) return forced;

    const cores = navigator.hardwareConcurrency || 4;
    const iPadOS = /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
    const mobile = iPadOS || /Mobi|Android|iPad|iPhone|iPod/i.test(navigator.userAgent);
    // Absent on Safari/Firefox. Unknown is treated as "enough" — the GPU string
    // and the resolution governor do the real work.
    const mem: number = (navigator as any).deviceMemory ?? 8;

    let gpu = '';
    let maxTex = 4096;
    try {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl) return 'very-low';
        maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        gpu = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)).toLowerCase();
        // Release the probe context — mobile Safari caps live contexts.
        gl.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
        return 'very-low';
    }

    if (/swiftshader|llvmpipe|software|basic render/.test(gpu)) return 'very-low';

    if (mobile) {
        // iOS/iPadOS: no deviceMemory and coarse core counts. A12+ (2018) report
        // 16384 textures and comfortably run the mid/mobile-high feature set.
        if (/apple/.test(gpu) || iPadOS || /iPad|iPhone/.test(navigator.userAgent)) {
            return maxTex >= 16384 ? 'mobile-high' : 'mid';
        }
        if (cores <= 4 || mem <= 2) return 'very-low';
        // Old Mali-T / Adreno 3xx-5xx (pre-2019 mid-range) stay off the heavy path.
        if (/mali-t|adreno \(tm\) [345]\d\d|powervr/.test(gpu)) return 'low';
        if (cores >= 8 && mem >= 6) return 'mobile-high'; // e.g. Galaxy S22 Ultra (Adreno 730 / Xclipse 920)
        return cores >= 6 && mem >= 3 ? 'mid' : 'low';
    }

    if (cores <= 4 || mem <= 2) return 'low';
    // ANGLE/D3D11 reports MAX_TEXTURE_SIZE 16384 even on Intel UHD, so it cannot
    // separate integrated from discrete. The renderer string can.
    const integrated =
        /intel|iris|uhd|(radeon\(tm\)|radeon) (vega )?graphics|mali|adreno/.test(gpu) && !/arc/.test(gpu);
    if (!integrated && cores >= 8 && mem >= 6 && maxTex >= 16384) return 'high';
    return cores >= 6 ? 'mid' : 'low';
}
