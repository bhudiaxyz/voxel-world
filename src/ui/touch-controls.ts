import nipplejs from 'nipplejs';
import type { FPCamera } from '../render/fp-camera';

/** px → radians per pixel for swipe-look */
const LOOK_SENSITIVITY = 0.004;

export const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

const STYLE = `
#joy-zone {
  position: fixed; left: 0; top: 0;
  width: 50%; height: 100%;
  pointer-events: auto; touch-action: none; z-index: 5;
}
#touch-btns {
  position: fixed;
  right: max(20px, env(safe-area-inset-right));
  bottom: max(100px, calc(80px + env(safe-area-inset-bottom)));
  display: flex; flex-direction: column; gap: 12px;
  pointer-events: auto; z-index: 10;
}
#touch-btns button {
  width: 60px; height: 60px; border-radius: 50%;
  border: 1.5px solid rgba(192,88,40,0.55);
  background: rgba(7,7,10,0.55); color: #e8dcc1;
  font-size: 22px; line-height: 1; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  user-select: none; touch-action: manipulation;
  transition: opacity 0.2s;
}
#touch-btns button:active { background: rgba(192,88,40,0.30); }
#btn-edges.active { border-color: rgba(192,88,40,1); background: rgba(192,88,40,0.25); }
#btn-land { display: none; }
`;

export interface TouchControls {
  onDroneEnter:  (fn: () => void) => void;
  onLand:        (fn: () => void) => void;
  onEdgeToggle:  (fn: () => void) => void;
  /** Call each frame with current drone state to show/hide contextual buttons. */
  update(droneActive: boolean, landing: boolean): void;
  destroy(): void;
}

/**
 * Creates nippleJS left-joystick + right-half swipe-to-look + action buttons.
 *
 * Keyboard ↔ touch mapping:
 *   WASD/arrows  → left joystick
 *   Mouse look   → right-half swipe
 *   Space        → ↑ button  (jump on foot / ascend in drone)
 *   C            → ↓ button  (descend in drone)
 *   Shift        → ⚡ button  (sprint)
 *   F/G          → ✈ button  (enter drone)
 *   L            → 🛬 button  (land — visible only while airborne)
 *   E            → ⬡ button  (edge toggle)
 */
export function createTouchControls(fpCam: FPCamera, dom: HTMLElement): TouchControls {
  const stub: TouchControls = {
    onDroneEnter:  () => {},
    onLand:        () => {},
    onEdgeToggle:  () => {},
    update:        () => {},
    destroy:       () => {},
  };
  if (!isTouchDevice) return stub;

  fpCam.touchActive = true;

  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const joyZone = document.createElement('div');
  joyZone.id = 'joy-zone';
  document.body.appendChild(joyZone);

  const btns = document.createElement('div');
  btns.id = 'touch-btns';
  btns.innerHTML = `
    <button id="btn-jump"    aria-label="Jump / Ascend">↑</button>
    <button id="btn-descend" aria-label="Descend">↓</button>
    <button id="btn-sprint"  aria-label="Sprint">⚡</button>
    <button id="btn-drone"   aria-label="Enter drone">✈</button>
    <button id="btn-land"    aria-label="Land">🛬</button>
    <button id="btn-edges"   aria-label="Toggle edges">⬡</button>
  `;
  document.body.appendChild(btns);

  // ---- left joystick (WASD) -----------------------------------------------
  const manager = nipplejs.create({
    zone: joyZone, mode: 'dynamic', restOpacity: 0.55,
    color: 'rgba(192,88,40,0.8)', size: 110,
  });
  manager.on('move', (evt) => {
    const v = evt.data?.vector;
    if (v) fpCam.setTouchMove(v.x, v.y);
  });
  manager.on('end', () => fpCam.setTouchMove(0, 0));

  // ---- right-half swipe-to-look (mouse) -----------------------------------
  let lookId: number | null = null;
  let prevX = 0, prevY = 0;

  dom.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (lookId !== null && !Array.from(e.touches).some(t => t.identifier === lookId)) lookId = null;
    for (const t of Array.from(e.changedTouches)) {
      if (t.clientX >= innerWidth / 2 && lookId === null) {
        lookId = t.identifier; prevX = t.clientX; prevY = t.clientY;
      }
    }
  }, { passive: false });

  dom.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === lookId) {
        fpCam.applyTouchLook(
          (t.clientX - prevX) * LOOK_SENSITIVITY,
          (t.clientY - prevY) * LOOK_SENSITIVITY,
        );
        prevX = t.clientX; prevY = t.clientY;
      }
    }
  }, { passive: false });

  const clearLook = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) if (t.identifier === lookId) lookId = null;
  };
  dom.addEventListener('touchend',    clearLook, { passive: true });
  dom.addEventListener('touchcancel', clearLook, { passive: true });

  // ---- held-state helper --------------------------------------------------
  const held = (id: string, down: () => void, up: () => void) => {
    const el = document.getElementById(id)!;
    el.addEventListener('touchstart',  (e) => { e.stopPropagation(); down(); }, { passive: true });
    el.addEventListener('touchend',    (e) => { e.stopPropagation(); up();   }, { passive: true });
    el.addEventListener('touchcancel', (e) => { e.stopPropagation(); up();   }, { passive: true });
  };

  // ↑ jump / ascend (Space)
  held('btn-jump',
    () => { if (fpCam.droneActive) fpCam.touchAltAxis = 1; else fpCam.triggerTouchJump(); },
    () => { fpCam.touchAltAxis = 0; },
  );
  // ↓ descend (C)
  held('btn-descend',
    () => { fpCam.touchAltAxis = -1; },
    () => { fpCam.touchAltAxis = 0;  },
  );
  // ⚡ sprint (Shift)
  held('btn-sprint',
    () => { fpCam.touchSprint = true;  },
    () => { fpCam.touchSprint = false; },
  );

  // ---- tap-only buttons wired externally via returned setters -------------
  const controls: TouchControls = {
    onDroneEnter(fn) {
      document.getElementById('btn-drone')!.addEventListener('touchend', (e) => {
        e.stopPropagation(); fn();
      }, { passive: true });
    },
    onLand(fn) {
      document.getElementById('btn-land')!.addEventListener('touchend', (e) => {
        e.stopPropagation(); fn();
      }, { passive: true });
    },
    onEdgeToggle(fn) {
      const el = document.getElementById('btn-edges')!;
      el.addEventListener('touchend', (e) => {
        e.stopPropagation(); fn(); el.classList.toggle('active');
      }, { passive: true });
    },
    update(droneActive: boolean, landing: boolean) {
      const land   = document.getElementById('btn-land')!  as HTMLElement;
      const drone  = document.getElementById('btn-drone')! as HTMLElement;
      land.style.display  = droneActive && !landing ? '' : 'none';
      drone.style.display = droneActive ? 'none' : '';
    },
    destroy() {
      manager.destroy();
      joyZone.remove();
      btns.remove();
      style.remove();
    },
  };
  return controls;
}
