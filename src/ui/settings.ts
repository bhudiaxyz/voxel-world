/**
 * Settings panel — gear button or tilde / backquote.
 *
 * Live controls for outline scale, zoom limits, atmosphere, and world
 * streaming. Values persist in localStorage and apply immediately.
 */

import { DEFAULT_STREAM_RADIUS } from '../core/voxel';
import { DEFAULT_SHADOW_RESOLUTION } from '../render/lighting';
import { PLANET_RADIUS_DEFAULT } from '../render/planet.glsl';
import type { DayNight } from '../render/day-night';
import { VOXEL_PALETTES, activePaletteName } from '../core/palette';

const STORE_KEY = 'VoxelWorld.settings';
const SETTINGS_VERSION = 2;

const INK_BASE = 0.05;
const PREVIOUS_INK_DEFAULT = INK_BASE * 1.12;
const PREVIOUS_LOAD_RADIUS_DEFAULT = 5;
const PREVIOUS_SHADOW_RESOLUTION_DEFAULT = 4096;

/**
 * Authored defaults. `inkWidth` keeps its legacy storage unit, but the value
 * shown to the player and sent to the renderer is now a direct CSS-pixel
 * width: inkWidth / INK_BASE.
 */
export const DEFAULTS = {
  inkWidth: INK_BASE * 1.85,
  zoomMin: 50,
  zoomMax: 120,
  fogEnabled: true,
  fogStart: 420,
  loadRadius: DEFAULT_STREAM_RADIUS,
  shadowResolution: DEFAULT_SHADOW_RESOLUTION,
  planetRadius: PLANET_RADIUS_DEFAULT,
  daySpeed: 1,
  windStrength: 0.4,
};

const RANGES = {
  // Half-thousandth precision keeps authored values such as 1.85x exact.
  inkWidth: { min: 0.012, max: 0.16, step: 0.0005 },
  zoomMin: { min: 12, max: 50, step: 1 },
  zoomMax: { min: 40, max: 140, step: 1 },
  fogStart: { min: 70, max: 420, step: 2 },
  loadRadius: { min: 3, max: 12, step: 1 },
  shadowResolution: { min: 0, max: 4096, step: 1024 },
  planetRadius: { min: 100, max: 1000, step: 10 },
  daySpeed: { min: 0.1, max: 5, step: 0.1 },
  windStrength: { min: 0, max: 1.5, step: 0.05 },
};

const CSS = `
#settings {
  position:fixed; inset:0; z-index:46; display:none; pointer-events:none;
  font-family:Inter, ui-sans-serif, system-ui, sans-serif; color:var(--ink);
}
#settings.open { display:block; }
#settings .panel {
  position:absolute; top:16px; right:16px; pointer-events:auto;
  width:min(330px, calc(100vw - 32px)); padding:18px;
  max-height:calc(100vh - 32px); overflow:auto;
  border-radius:12px; background:rgba(20,19,24,.92);
  backdrop-filter:blur(18px) saturate(1.12);
  border:1px solid var(--line);
  box-shadow:0 24px 64px rgba(0,0,0,.55);
}
#settings header { display:flex; align-items:center; justify-content:space-between;
                   margin-bottom:20px; }
#settings h2 { margin:0; font-size:15px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--gold); }
#settings .perf { margin-left:auto; margin-right:8px; font-size:10px;
                  font-variant-numeric:tabular-nums; color:var(--ink-faint); }
#settings .row { display:grid; grid-template-columns:1fr auto; gap:7px 14px;
                 align-items:center; margin-bottom:16px; }
#settings .row label { font-size:12px; font-weight:500; color:var(--ink-soft); }
#settings .row .val { font-size:11px; font-variant-numeric:tabular-nums;
                      color:var(--ink-faint); text-align:right; }
#settings .row input[type=range] {
  grid-column:1 / -1; width:100%; height:2px; appearance:none; outline:none;
  border-radius:99px; background:rgba(201,173,115,.18); cursor:pointer;
}
#settings .row input[type=range]::-webkit-slider-thumb {
  appearance:none; width:14px; height:14px; border-radius:50%;
  background:var(--gold); border:2px solid var(--gold-bright);
  box-shadow:0 2px 8px rgba(0,0,0,.45);
}
#settings .row input[type=range]::-moz-range-thumb {
  width:11px; height:11px; border-radius:50%;
  background:var(--gold); border:2px solid var(--gold-bright);
  box-shadow:0 2px 8px rgba(0,0,0,.45);
}
#settings .row input[type=range]:disabled { opacity:.28; cursor:not-allowed; }
#settings .toggle {
  appearance:none; width:34px; height:19px; margin:0; cursor:pointer;
  border-radius:99px; position:relative; background:rgba(201,173,115,.12);
  border:1px solid rgba(201,173,115,.2); transition:background .16s ease;
}
#settings .toggle::after {
  content:""; position:absolute; width:13px; height:13px; left:2px; top:2px;
  border-radius:50%; background:var(--ink-faint);
  transition:transform .16s ease;
}
#settings .toggle:checked { background:rgba(201,173,115,.32); }
#settings .toggle:checked::after { transform:translateX(15px); background:var(--gold); }
#settings .divider { height:1px; margin:2px 0 16px; background:var(--line); }
#settings .palette-row {
  display:flex; align-items:center; justify-content:space-between; gap:10px;
  margin-bottom:16px;
}
#settings .palette-row label {
  font-size:12px; font-weight:500; color:var(--ink-soft); white-space:nowrap;
}
#settings .palette-row select {
  flex:1; height:34px; padding:0 10px;
  border:1px solid rgba(201,173,115,.18); border-radius:8px;
  background:rgba(30,28,35,.72); color:var(--ink-soft);
  font:600 11px/1 Inter, ui-sans-serif, system-ui, sans-serif;
  letter-spacing:.06em; cursor:pointer; appearance:none;
}
#settings .palette-row select:focus { outline:none; border-color:var(--gold); }
#settings .foot { display:flex; justify-content:flex-start; align-items:center;
                  margin-top:2px; padding-top:16px; border-top:1px solid var(--line); }
#settings button {
  height:34px; padding:0 14px; border:1px solid rgba(201,173,115,.25);
  border-radius:8px; background:rgba(30,28,35,.72); color:var(--ink-soft);
  font:600 11px/1 Inter, ui-sans-serif, system-ui, sans-serif;
  letter-spacing:.08em; text-transform:uppercase; cursor:pointer;
  transition:background .14s ease, border-color .14s ease;
}
#settings button:hover { background:rgba(42,39,48,.88); border-color:var(--gold); }
#settings .icon { width:30px; height:30px; padding:0; border:0; background:transparent;
                  color:var(--ink-faint); font-size:19px; text-transform:none; }
#settings .icon:hover { background:rgba(201,173,115,.1); color:var(--gold); }
#settings #set-reset { width:34px; padding:0; font-size:16px; text-transform:none; }
`;

interface SettingsValues {
  inkWidth: number;
  zoomMin: number;
  zoomMax: number;
  fogEnabled: boolean;
  fogStart: number;
  loadRadius: number;
  shadowResolution: number;
  planetRadius: number;
  daySpeed: number;
  windStrength: number;
}

function load(): SettingsValues {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: SettingsValues = { ...DEFAULTS };
    for (const [k, fallback] of Object.entries(DEFAULTS)) {
      const key = k as keyof SettingsValues;
      if (typeof fallback === 'boolean') {
        if (typeof parsed[k] === 'boolean') (out[key] as boolean) = parsed[k] as boolean;
        else if (parsed[k] === 0 || parsed[k] === 1) (out[key] as boolean) = Boolean(parsed[k]);
      } else {
        const n = Number(parsed[k]);
        if (Number.isFinite(n)) (out[key] as number) = n;
      }
    }
    // Carry users who were still on the former authored default forward while
    // preserving every genuinely custom outline value.
    if (Math.abs(out.inkWidth - PREVIOUS_INK_DEFAULT) < 1e-7) {
      out.inkWidth = DEFAULTS.inkWidth;
    }
    if (((parsed['_version'] as number) || 1) < SETTINGS_VERSION) {
      if (out.loadRadius === PREVIOUS_LOAD_RADIUS_DEFAULT) {
        out.loadRadius = DEFAULTS.loadRadius;
      }
      if (out.shadowResolution === PREVIOUS_SHADOW_RESOLUTION_DEFAULT) {
        out.shadowResolution = DEFAULTS.shadowResolution;
      }
    }
    return clampAll(out);
  } catch {
    return { ...DEFAULTS };
  }
}

function save(values: SettingsValues): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...values, _version: SETTINGS_VERSION }));
  } catch {
    /* private mode */
  }
}

function clampAll(v: SettingsValues): SettingsValues {
  const ink = RANGES.inkWidth,
    zmin = RANGES.zoomMin,
    zmax = RANGES.zoomMax;
  const fog = RANGES.fogStart,
    loadRadius = RANGES.loadRadius;
  const shadowResolution = RANGES.shadowResolution;
  v.inkWidth = clamp(v.inkWidth, ink.min, ink.max);
  v.zoomMin = clamp(v.zoomMin, zmin.min, zmin.max);
  v.zoomMax = clamp(v.zoomMax, zmax.min, zmax.max);
  if (v.zoomMax < v.zoomMin + 4) v.zoomMax = v.zoomMin + 4;
  v.fogEnabled = v.fogEnabled !== false;
  v.fogStart = clamp(v.fogStart, fog.min, fog.max);
  v.loadRadius = Math.round(clamp(v.loadRadius, loadRadius.min, loadRadius.max));
  v.shadowResolution =
    Math.round(clamp(v.shadowResolution, shadowResolution.min, shadowResolution.max) / shadowResolution.step) *
    shadowResolution.step;
  v.planetRadius =
    Math.round(clamp(v.planetRadius, RANGES.planetRadius.min, RANGES.planetRadius.max) / RANGES.planetRadius.step) *
    RANGES.planetRadius.step;
  v.daySpeed = Math.round(clamp(v.daySpeed, RANGES.daySpeed.min, RANGES.daySpeed.max) * 10) / 10;
  v.windStrength = Math.round(clamp(v.windStrength, RANGES.windStrength.min, RANGES.windStrength.max) / RANGES.windStrength.step) * RANGES.windStrength.step;
  return v;
}

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

const fmt = {
  inkWidth: (n: number) => `${(n / INK_BASE).toFixed(2)} px`,
  zoomMin: (n: number) => String(Math.round(n)),
  zoomMax: (n: number) => String(Math.round(n)),
  fogStart: (n: number) => String(Math.round(n)),
  shadowResolution: (n: number) => (n > 0 ? `${Math.round(n / 1024)}K` : 'Off'),
  planetRadius: (n: number) => String(Math.round(n)),
  daySpeed: (n: number) => `${n.toFixed(1)}×`,
  windStrength: (n: number) => n === 0 ? 'Off' : n.toFixed(2),
};

interface SettingsDeps {
  rig: { setZoomRange(a: number, b: number): void };
  atmo: {
    setAerialD(v: number): void;
    setFogEnabled(v: boolean): void;
    setShadowResolution(v: number): void;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: any;
  world: {
    streaming?: {
      loadRadius?: number;
      loadedCount?: number;
      pendingCount?: number;
      setLoadRadius(r: number): void;
    };
    meshes?: { edgeMaterial?: { linewidth: number }; material?: { userData: Record<string, any> } };
    allPlanetUnis: Array<{ uPlanetRadius: { value: number } }>;
  };
  dayNight: DayNight;
  seed: { currentWord: () => string; push(word: string): void; gen(): string };
}

export function createSettings({ rig, atmo, input, world, dayNight, seed }: SettingsDeps) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'settings';
  root.innerHTML = `
    <div class="panel" role="dialog" aria-label="Settings">
      <header>
        <h2>Settings</h2>
        <span class="perf" id="set-fps">-- fps</span>
        <button class="icon" type="button" id="set-x" aria-label="Close settings">×</button>
      </header>
      <div class="row">
        <label for="set-seed">World seed</label>
        <input id="set-seed" type="text" style="grid-column:1/-1;width:100%;box-sizing:border-box;padding:5px 8px;background:rgba(201,173,115,.08);border:1px solid rgba(201,173,115,.2);border-radius:6px;color:var(--ink);font-size:12px;" />
      </div>
      <div class="divider"></div>
      <div class="row">
        <label for="set-ink">Outline</label>
        <span class="val" id="set-ink-val"></span>
        <input id="set-ink" type="range"
               min="${RANGES.inkWidth.min}" max="${RANGES.inkWidth.max}"
               step="${RANGES.inkWidth.step}" />
      </div>
      <div class="row">
        <label for="set-fog-enabled">Fog</label>
        <input class="toggle" id="set-fog-enabled" type="checkbox" />
      </div>
      <div class="row">
        <label for="set-fog">Fog distance</label>
        <span class="val" id="set-fog-val"></span>
        <input id="set-fog" type="range"
               min="${RANGES.fogStart.min}" max="${RANGES.fogStart.max}"
               step="${RANGES.fogStart.step}" />
      </div>
      <div class="divider"></div>
      <div class="row">
        <label for="set-zmin">Camera near</label>
        <span class="val" id="set-zmin-val"></span>
        <input id="set-zmin" type="range"
               min="${RANGES.zoomMin.min}" max="${RANGES.zoomMin.max}"
               step="${RANGES.zoomMin.step}" />
      </div>
      <div class="row">
        <label for="set-zmax">Camera far</label>
        <span class="val" id="set-zmax-val"></span>
        <input id="set-zmax" type="range"
               min="${RANGES.zoomMax.min}" max="${RANGES.zoomMax.max}"
               step="${RANGES.zoomMax.step}" />
      </div>
      <div class="divider"></div>
      <div class="row">
        <label for="set-load-radius">World LOD radius</label>
        <span class="val" id="set-load-radius-val"></span>
        <input id="set-load-radius" type="range"
               min="${RANGES.loadRadius.min}" max="${RANGES.loadRadius.max}"
               step="${RANGES.loadRadius.step}" />
      </div>
      <div class="row">
        <label for="set-shadow-resolution">Shadow quality</label>
        <span class="val" id="set-shadow-resolution-val"></span>
        <input id="set-shadow-resolution" type="range"
               min="${RANGES.shadowResolution.min}" max="${RANGES.shadowResolution.max}"
               step="${RANGES.shadowResolution.step}" />
      </div>
      <div class="divider"></div>
      <div class="row">
        <label for="set-planet-radius">Planet radius</label>
        <span class="val" id="set-planet-radius-val"></span>
        <input id="set-planet-radius" type="range"
               min="${RANGES.planetRadius.min}" max="${RANGES.planetRadius.max}"
               step="${RANGES.planetRadius.step}" />
      </div>
      <div class="row">
        <label for="set-day-speed">Day speed</label>
        <span class="val" id="set-day-speed-val"></span>
        <input id="set-day-speed" type="range"
               min="${RANGES.daySpeed.min}" max="${RANGES.daySpeed.max}"
               step="${RANGES.daySpeed.step}" />
      </div>
      <div class="row">
        <label for="set-wind">Wind sway</label>
        <span class="val" id="set-wind-val"></span>
        <input id="set-wind" type="range"
               min="${RANGES.windStrength.min}" max="${RANGES.windStrength.max}"
               step="${RANGES.windStrength.step}" />
      </div>
      <div class="palette-row">
        <label for="set-palette">Palette</label>
        <select id="set-palette"></select>
      </div>
      <div class="foot">
        <button type="button" id="set-new-world">🎲 New world</button>
        <button type="button" id="set-reset" aria-label="Reset settings" style="margin-left:auto;">↺</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const seedEl = root.querySelector('#set-seed') as HTMLInputElement;
  seedEl.value = seed.currentWord();

  const applyNewSeed = (word: string) => {
    const w = word.trim() || seed.gen();
    seedEl.value = w;
    seed.push(w);
    location.reload();
  };
  seedEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyNewSeed(seedEl.value);
    e.stopPropagation();
  });
  root.querySelector('#set-new-world')!.addEventListener('click', () => applyNewSeed(seed.gen()));

  const paletteSelect = root.querySelector('#set-palette') as HTMLSelectElement;
  for (const [k, p] of Object.entries(VOXEL_PALETTES)) {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = (p as { label: string }).label;
    if (k === activePaletteName) opt.selected = true;
    paletteSelect.appendChild(opt);
  }
  let _onPaletteChange: ((name: string) => void) | null = null;
  paletteSelect.addEventListener('change', () => _onPaletteChange?.(paletteSelect.value));

  const els = {
    ink: root.querySelector('#set-ink') as HTMLInputElement,
    zmin: root.querySelector('#set-zmin') as HTMLInputElement,
    zmax: root.querySelector('#set-zmax') as HTMLInputElement,
    fogEnabled: root.querySelector('#set-fog-enabled') as HTMLInputElement,
    fog: root.querySelector('#set-fog') as HTMLInputElement,
    loadRadius: root.querySelector('#set-load-radius') as HTMLInputElement,
    shadowResolution: root.querySelector('#set-shadow-resolution') as HTMLInputElement,
    planetRadius: root.querySelector('#set-planet-radius') as HTMLInputElement,
    daySpeed: root.querySelector('#set-day-speed') as HTMLInputElement,
    wind: root.querySelector('#set-wind') as HTMLInputElement,
  };
  const vals = {
    ink: root.querySelector('#set-ink-val') as HTMLElement,
    zmin: root.querySelector('#set-zmin-val') as HTMLElement,
    zmax: root.querySelector('#set-zmax-val') as HTMLElement,
    fog: root.querySelector('#set-fog-val') as HTMLElement,
    loadRadius: root.querySelector('#set-load-radius-val') as HTMLElement,
    shadowResolution: root.querySelector('#set-shadow-resolution-val') as HTMLElement,
    planetRadius: root.querySelector('#set-planet-radius-val') as HTMLElement,
    daySpeed: root.querySelector('#set-day-speed-val') as HTMLElement,
    wind: root.querySelector('#set-wind-val') as HTMLElement,
  };

  const values = load();
  const fpsEl = root.querySelector('#set-fps') as HTMLElement;
  let open = false;
  let wasPaused = false;
  let streamStatus = '';
  let shownFps = -1;

  const syncStreamStatus = () => {
    const streaming = world?.streaming;
    const radius = streaming?.loadRadius ?? values.loadRadius;
    const loaded = streaming?.loadedCount ?? 0;
    const pending = streaming?.pendingCount ?? 0;
    const next = `${Math.round(radius)} chunks · ${loaded} loaded` + (pending > 0 ? ` · ${pending} queued` : '');
    if (next === streamStatus) return;
    streamStatus = next;
    vals.loadRadius.textContent = next;
  };

  const apply = () => {
    clampAll(values);
    const edgeMaterial = world?.meshes?.edgeMaterial;
    if (edgeMaterial) {
      edgeMaterial.linewidth = values.inkWidth / INK_BASE;
    }
    rig.setZoomRange(values.zoomMin, values.zoomMax);
    atmo.setAerialD(values.fogStart);
    atmo.setFogEnabled(values.fogEnabled);
    world?.streaming?.setLoadRadius(values.loadRadius);
    atmo.setShadowResolution(values.shadowResolution);
    // Apply planet radius to all materials
    for (const u of world.allPlanetUnis) u.uPlanetRadius.value = values.planetRadius;
    // Apply day speed: daySpeed is a multiplier; base cycle = 1200s
    dayNight.dayLengthSeconds = 1200 / values.daySpeed;
    // Apply wind strength: _windBase is read by the frame loop's gust envelope
    const wu = world?.meshes?.material?.userData?.uniforms;
    if (wu) wu._windBase = values.windStrength;
  };

  const syncUi = () => {
    els.ink.value = String(values.inkWidth);
    els.zmin.value = String(values.zoomMin);
    els.zmax.value = String(values.zoomMax);
    els.fogEnabled.checked = values.fogEnabled;
    els.fog.value = String(values.fogStart);
    els.loadRadius.value = String(values.loadRadius);
    els.shadowResolution.value = String(values.shadowResolution);
    els.planetRadius.value = String(values.planetRadius);
    els.daySpeed.value = String(values.daySpeed);
    els.wind.value = String(values.windStrength);
    els.fog.disabled = !values.fogEnabled;
    vals.ink.textContent = fmt.inkWidth(values.inkWidth);
    vals.zmin.textContent = fmt.zoomMin(values.zoomMin);
    vals.zmax.textContent = fmt.zoomMax(values.zoomMax);
    vals.fog.textContent = fmt.fogStart(values.fogStart);
    syncStreamStatus();
    vals.shadowResolution.textContent = fmt.shadowResolution(values.shadowResolution);
    vals.planetRadius.textContent = fmt.planetRadius(values.planetRadius);
    vals.daySpeed.textContent = fmt.daySpeed(values.daySpeed);
    vals.wind.textContent = fmt.windStrength(values.windStrength);
  };

  const commit = () => {
    apply();
    save(values);
    syncUi();
  };

  els.ink.addEventListener('input', () => {
    values.inkWidth = +els.ink.value;
    commit();
  });
  els.zmin.addEventListener('input', () => {
    values.zoomMin = +els.zmin.value;
    commit();
  });
  els.zmax.addEventListener('input', () => {
    values.zoomMax = +els.zmax.value;
    commit();
  });
  els.fogEnabled.addEventListener('change', () => {
    values.fogEnabled = els.fogEnabled.checked;
    commit();
  });
  els.fog.addEventListener('input', () => {
    values.fogStart = +els.fog.value;
    commit();
  });
  els.loadRadius.addEventListener('input', () => {
    values.loadRadius = +els.loadRadius.value;
    commit();
  });
  els.shadowResolution.addEventListener('input', () => {
    values.shadowResolution = +els.shadowResolution.value;
    commit();
  });
  els.planetRadius.addEventListener('input', () => {
    values.planetRadius = +els.planetRadius.value;
    commit();
  });
  els.daySpeed.addEventListener('input', () => {
    values.daySpeed = +els.daySpeed.value;
    commit();
  });
  els.wind.addEventListener('input', () => {
    values.windStrength = +els.wind.value;
    commit();
  });

  root.querySelector('#set-reset')!.addEventListener('click', () => {
    Object.assign(values, DEFAULTS);
    commit();
  });

  const setOpen = (next: boolean) => {
    if (next === open) return;
    open = next;
    root.classList.toggle('open', open);
    if (open) {
      wasPaused = input.paused;
      input.paused = true;
      input.keys.clear();
      syncUi();
    } else {
      input.paused = wasPaused;
    }
  };

  root.querySelector('#set-x')!.addEventListener('click', () => setOpen(false));
  root.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

  addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.code === 'Escape' && open) {
      setOpen(false);
    }
  });

  apply();
  syncUi();

  return {
    get open() {
      return open;
    },
    toggle: () => setOpen(!open),
    onPaletteChange(cb: (name: string) => void) { _onPaletteChange = cb; },
    values,
    update() {
      if (!open) return;
      syncStreamStatus();
      const fps = (window as unknown as { __fps: number }).__fps || 0;
      if (fps !== shownFps) {
        shownFps = fps;
        fpsEl.textContent = `${fps} fps`;
      }
    },
  };
}
