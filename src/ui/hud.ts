/**
 * Minimal in-game HUD.
 *
 * Gameplay owns the screen. The title appears once, while the only persistent
 * chrome is a small pair of shortcuts for the two non-obvious overlays.
 */

import type * as THREE from 'three';
import type { DayNight } from '../render/day-night';
import type { DroneMode } from '../player/drone';

const CSS = `
#hud {
  position:fixed; inset:0; z-index:20; pointer-events:none;
  font-family:Inter, ui-sans-serif, system-ui, sans-serif;
  color:var(--ink);
  --hud-shadow:0 8px 24px rgba(0,0,0,.42);
}
#hud .place {
  position:absolute; left:50%; top:max(24px, env(safe-area-inset-top));
  transform:translate(-50%, -6px); opacity:0;
  font-size:12px; font-weight:700; letter-spacing:.22em;
  text-transform:uppercase; color:var(--gold);
  text-shadow:0 0 14px rgba(201,173,115,.4);
  transition:opacity .55s ease, transform .55s ease;
}
#hud .place.show { opacity:.9; transform:translate(-50%, 0); }
#hud .shortcuts {
  position:absolute; right:max(18px, env(safe-area-inset-right));
  bottom:max(18px, env(safe-area-inset-bottom));
  display:flex; gap:7px; opacity:0; transform:translateY(5px);
  transition:opacity .45s ease, transform .45s ease;
}
#hud .shortcuts.show { opacity:.82; transform:none; }
#hud .shortcut {
  display:flex; align-items:center; gap:7px; height:30px; padding:0 10px 0 7px;
  border:1px solid var(--line); border-radius:8px;
  background:rgba(20,19,24,.72); backdrop-filter:blur(14px) saturate(1.08);
  box-shadow:var(--hud-shadow); font-size:10px; font-weight:700;
  letter-spacing:.11em; text-transform:uppercase; color:var(--ink-soft);
}
#hud kbd {
  min-width:18px; height:18px; padding:0 4px; display:grid; place-items:center;
  border-radius:4px; background:rgba(201,173,115,.18); color:var(--gold);
  font:700 10px/1 Inter, ui-sans-serif, system-ui, sans-serif;
  box-shadow:0 1px 0 rgba(0,0,0,.3);
}
#hud .status-bar {
  position:absolute; left:max(18px, env(safe-area-inset-left));
  bottom:max(18px, env(safe-area-inset-bottom));
  display:flex; flex-direction:column; gap:6px; align-items:flex-start;
}
#hud .status-chip {
  display:flex; align-items:center; gap:6px; height:28px; padding:0 10px 0 8px;
  border:1px solid var(--line); border-radius:8px;
  background:rgba(20,19,24,.72); backdrop-filter:blur(14px) saturate(1.08);
  box-shadow:var(--hud-shadow); font-size:10px; font-weight:700;
  letter-spacing:.09em; font-variant-numeric:tabular-nums; opacity:.82;
  color:var(--ink-soft);
}
#hud .settings-btn {
  position:absolute; top:max(14px, env(safe-area-inset-top));
  right:max(14px, env(safe-area-inset-right));
  pointer-events:none; width:38px; height:38px;
  opacity:0; transition:opacity .4s ease, background .14s ease, border-color .14s ease, color .14s ease;
  border:1px solid var(--line); border-radius:10px;
  background:rgba(20,19,24,.72); backdrop-filter:blur(14px) saturate(1.08);
  box-shadow:var(--hud-shadow); color:var(--ink-soft);
  font-size:18px; cursor:pointer; display:grid; place-items:center;
  -webkit-tap-highlight-color:transparent;
}
#hud .settings-btn.visible { opacity:.82; pointer-events:auto; }
#hud .settings-btn:hover, #hud .settings-btn:focus-visible {
  outline:none; background:rgba(42,39,48,.88); border-color:var(--gold); color:var(--gold);
}
@media (max-width:640px), (pointer:coarse) {
  #hud .shortcuts { display:none; }
}
`;

interface HudDeps {
  dayNight: DayNight;
  drone: DroneMode;
  camera: THREE.PerspectiveCamera;
}

export function createHud({ dayNight, drone, camera }: HudDeps) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'hud';
  root.innerHTML = `
    <div class="place show" id="hud-place">VoxelWorld</div>
    <button class="settings-btn" id="hud-settings" type="button" aria-label="Settings">⚙</button>
    <div class="shortcuts" id="hud-shortcuts">
      <span class="shortcut"><kbd>Y</kbd>Sit</span>
      <span class="shortcut"><kbd>M</kbd>Map</span>
      <span class="shortcut"><kbd>Esc</kbd>Menu</span>
    </div>
    <div class="status-bar">
      <div class="status-chip" id="hud-time">🕐 --:--</div>
      <div class="status-chip" id="hud-drone" style="display:none">↑ -- m  -- u/s</div>
    </div>
  `;
  document.body.appendChild(root);

  const place = root.querySelector('#hud-place') as HTMLElement;
  const shortcuts = root.querySelector('#hud-shortcuts') as HTMLElement;
  const settingsBtn = root.querySelector('#hud-settings') as HTMLButtonElement;
  const timeEl = root.querySelector('#hud-time') as HTMLElement;
  const droneEl = root.querySelector('#hud-drone') as HTMLElement;

  setTimeout(() => place.classList.remove('show'), 3200);
  setTimeout(() => shortcuts.classList.add('show'), 900);

  return {
    onSettingsClick(cb: () => void) { settingsBtn.addEventListener('click', cb); },
    showSettingsBtn() { settingsBtn.classList.add('visible'); },
    update() {
      // Time of day — always visible
      const tod = dayNight.timeOfDay;
      const totalH = tod * 24;
      const hour = Math.floor(totalH);
      const min = Math.floor((totalH - hour) * 60);
      const icon = hour >= 6 && hour < 20 ? '☀' : '🌙';
      timeEl.textContent = `${icon} ${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;

      // Drone stats — only when active
      if (drone.active) {
        droneEl.style.display = 'flex';
        const alt = Math.round(drone.getAltitude(camera));
        const spd = Math.round(drone.getSpeed());
        droneEl.textContent = `↑ ${alt} m  ${spd} u/s`;
      } else {
        droneEl.style.display = 'none';
      }
    },
    announce(name: string) {
      place.textContent = name;
      place.classList.add('show');
      clearTimeout((place as HTMLElement & { _t?: ReturnType<typeof setTimeout> })._t);
      (place as HTMLElement & { _t?: ReturnType<typeof setTimeout> })._t = setTimeout(
        () => place.classList.remove('show'),
        2600,
      );
    },
  };
}
