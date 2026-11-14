import nipplejs from 'nipplejs';
import type { FPCamera } from '../render/fp-camera';

/** px → radians per pixel for swipe-look */
const LOOK_SENSITIVITY = 0.004;

// `navigator.maxTouchPoints > 0` is true on most Windows 10/11 laptops regardless of touchscreen.
// `(pointer: coarse)` is the reliable discriminator: phones/tablets use a finger (coarse),
// laptops use a mouse (fine) even when they also have touch hardware.
export const isTouchDevice =
    ('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.matchMedia('(pointer: coarse)').matches;

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
  /* wrap into extra columns (growing leftward) instead of overflowing off the top on phones */
  flex-wrap: wrap-reverse; align-content: flex-start;
  max-height: calc(100dvh - max(120px, calc(100px + env(safe-area-inset-bottom))));
  pointer-events: auto; z-index: 10;
}
@media (max-height: 500px) {
  #touch-btns { gap: 8px; bottom: max(16px, env(safe-area-inset-bottom)); max-height: calc(100dvh - 32px); }
  #touch-btns button { width: 46px; height: 46px; font-size: 18px; }
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
/* Roll pair: top-left — clear of the right-hand column however that wraps on
   a short screen, and of the HUD time chip bottom-left. */
#touch-roll {
  position: fixed;
  left: max(20px, env(safe-area-inset-left));
  top: max(20px, env(safe-area-inset-top));
  display: none; flex-direction: row; gap: 12px;
  pointer-events: auto; z-index: 10;
}
#touch-roll button {
  width: 52px; height: 52px; border-radius: 50%;
  border: 1.5px solid rgba(192,88,40,0.45);
  background: rgba(7,7,10,0.45); color: #e8dcc1;
  font-size: 22px; line-height: 1; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  user-select: none; touch-action: manipulation;
}
#touch-roll button:active { background: rgba(192,88,40,0.30); }
@media (max-height: 500px) {
  #touch-roll button { width: 44px; height: 44px; font-size: 18px; }
}
`;

export interface TouchControls {
    /** ✈ — cycle walk → drone → fly → walk (keyboard F). */
    onCycle: (fn: () => void) => void;
    onLand: (fn: () => void) => void;
    onSit: (fn: () => void) => void;
    onEdgeToggle: (fn: () => void) => void;
    onTimeBack: (fn: () => void) => void;
    onTimeForward: (fn: () => void) => void;
    onMap: (fn: () => void) => void;
    /** Call each frame with current mode state to show/hide contextual buttons. */
    update(droneActive: boolean, landing: boolean, flyActive: boolean): void;
    destroy(): void;
}

/**
 * Creates nippleJS left-joystick + right-half swipe-to-look + action buttons.
 *
 * Keyboard ↔ touch mapping:
 *   WASD/arrows  → left joystick
 *   Mouse look   → right-half swipe
 *   Space        → ↑ button  (jump on foot / ascend in drone or fly)
 *   C            → ↓ button  (descend)
 *   Shift        → ⚡ button  (sprint)
 *   F            → ✈ button  (cycle walk → drone → fly → walk)
 *   L            → 🛬 button  (land — visible only while airborne)
 *   M            → 🗺 button  (map)
 *   Y            → 🐕 button  (dog sit / stand)
 *   G            → ⚙ HUD button (settings)
 *   B            → ⬡ button  (edge toggle)
 *   [ / ]        → ◀ ▶ buttons (time of day)
 * Matches planet-explorer's layout and F-cycle; Sit/edges/time are voxel-world extras.
 */
export function createTouchControls(fpCam: FPCamera, dom: HTMLElement): TouchControls {
    const stub: TouchControls = {
        onCycle: () => {},
        onLand: () => {},
        onSit: () => {},
        onEdgeToggle: () => {},
        onTimeBack: () => {},
        onTimeForward: () => {},
        onMap: () => {},
        update: () => {},
        destroy: () => {},
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
    <button id="btn-map"          aria-label="Toggle map">🗺</button>
    <button id="btn-jump"    aria-label="Jump / Ascend">↑</button>
    <button id="btn-descend" aria-label="Descend">↓</button>
    <button id="btn-sprint"  aria-label="Sprint">⚡</button>
    <button id="btn-fly"     aria-label="Next mode: drone">✈</button>
    <button id="btn-land"    aria-label="Land">🛬</button>
    <button id="btn-sit"     aria-label="Dog sit / stand">🐕</button>
    <button id="btn-edges"   aria-label="Toggle edges">⬡</button>
    <button id="btn-time-back"    aria-label="Step time back">◀</button>
    <button id="btn-time-forward" aria-label="Step time forward">▶</button>
  `;
    document.body.appendChild(btns);

    // Roll (Q/E) — a small column left of the main buttons, airborne only.
    const rollBtns = document.createElement('div');
    rollBtns.id = 'touch-roll';
    rollBtns.style.display = 'none';
    rollBtns.innerHTML = `
    <button id="btn-roll-left"  aria-label="Roll left">⟲</button>
    <button id="btn-roll-right" aria-label="Roll right">⟳</button>
  `;
    document.body.appendChild(rollBtns);

    // ---- left joystick (WASD) -----------------------------------------------
    const manager = nipplejs.create({
        zone: joyZone,
        mode: 'dynamic',
        restOpacity: 0.55,
        color: 'rgba(192,88,40,0.8)',
        size: 110,
    });
    manager.on('move', (evt) => {
        const v = evt.data?.vector;
        if (v) fpCam.setTouchMove(v.x, v.y);
    });
    manager.on('end', () => fpCam.setTouchMove(0, 0));

    // ---- right-half swipe-to-look (mouse) -----------------------------------
    let lookId: number | null = null;
    let prevX = 0,
        prevY = 0;

    dom.addEventListener(
        'touchstart',
        (e) => {
            e.preventDefault();
            if (lookId !== null && !Array.from(e.touches).some((t) => t.identifier === lookId)) lookId = null;
            for (const t of Array.from(e.changedTouches)) {
                if (t.clientX >= innerWidth / 2 && lookId === null) {
                    lookId = t.identifier;
                    prevX = t.clientX;
                    prevY = t.clientY;
                }
            }
        },
        { passive: false },
    );

    dom.addEventListener(
        'touchmove',
        (e) => {
            e.preventDefault();
            for (const t of Array.from(e.changedTouches)) {
                if (t.identifier === lookId) {
                    fpCam.applyTouchLook(
                        (t.clientX - prevX) * LOOK_SENSITIVITY,
                        (t.clientY - prevY) * LOOK_SENSITIVITY,
                    );
                    prevX = t.clientX;
                    prevY = t.clientY;
                }
            }
        },
        { passive: false },
    );

    const clearLook = (e: TouchEvent) => {
        for (const t of Array.from(e.changedTouches)) if (t.identifier === lookId) lookId = null;
    };
    dom.addEventListener('touchend', clearLook, { passive: true });
    dom.addEventListener('touchcancel', clearLook, { passive: true });

    // ---- held-state helper --------------------------------------------------
    const held = (id: string, down: () => void, up: () => void) => {
        const el = document.getElementById(id)!;
        el.addEventListener(
            'touchstart',
            (e) => {
                e.stopPropagation();
                down();
            },
            { passive: true },
        );
        el.addEventListener(
            'touchend',
            (e) => {
                e.stopPropagation();
                up();
            },
            { passive: true },
        );
        el.addEventListener(
            'touchcancel',
            (e) => {
                e.stopPropagation();
                up();
            },
            { passive: true },
        );
    };

    // ↑ jump / ascend (Space) — ascend in drone or fly, jump on foot
    held(
        'btn-jump',
        () => {
            if (fpCam.droneActive || fpCam.flyActive) fpCam.touchAltAxis = 1;
            else fpCam.triggerTouchJump();
        },
        () => {
            fpCam.touchAltAxis = 0;
        },
    );
    // ↓ descend (C)
    held(
        'btn-descend',
        () => {
            fpCam.touchAltAxis = -1;
        },
        () => {
            fpCam.touchAltAxis = 0;
        },
    );
    // ⚡ sprint (Shift)
    held(
        'btn-sprint',
        () => {
            fpCam.touchSprint = true;
        },
        () => {
            fpCam.touchSprint = false;
        },
    );
    // ⟲ / ⟳ roll (Q / E) — held; the camera eases back to level on release.
    held(
        'btn-roll-left',
        () => (fpCam.touchRoll = -1),
        () => (fpCam.touchRoll = 0),
    );
    held(
        'btn-roll-right',
        () => (fpCam.touchRoll = 1),
        () => (fpCam.touchRoll = 0),
    );

    // ---- tap-only buttons wired externally via returned setters -------------
    const tap = (id: string, fn: () => void) =>
        document.getElementById(id)!.addEventListener(
            'touchend',
            (e) => {
                e.stopPropagation();
                fn();
            },
            { passive: true },
        );
    const edgesBtn = document.getElementById('btn-edges')!;
    const controls: TouchControls = {
        onCycle: (fn) => tap('btn-fly', fn),
        onLand: (fn) => tap('btn-land', fn),
        onSit: (fn) => tap('btn-sit', fn),
        onEdgeToggle: (fn) =>
            tap('btn-edges', () => {
                fn();
                edgesBtn.classList.toggle('active');
            }),
        onTimeBack: (fn) => tap('btn-time-back', fn),
        onTimeForward: (fn) => tap('btn-time-forward', fn),
        onMap: (fn) => tap('btn-map', fn),
        update(droneActive: boolean, landing: boolean, flyActive: boolean) {
            // Roll buttons only make sense in the air (planet-explorer shows them in fly).
            const airborne = droneActive || flyActive;
            if (rollBtns.style.display !== (airborne ? 'flex' : 'none')) {
                rollBtns.style.display = airborne ? 'flex' : 'none';
                if (!airborne) fpCam.touchRoll = 0;
            }
            const land = document.getElementById('btn-land')! as HTMLElement;
            const fly = document.getElementById('btn-fly')! as HTMLElement;
            // Land: shown in either air mode (planet-explorer), hidden mid-landing.
            land.style.display = (droneActive || flyActive) && !landing ? 'block' : 'none';
            // ✈ shows the mode a tap will switch to.
            const next = flyActive
                ? ['🚶', 'Next mode: walk']
                : droneActive
                  ? ['🕊', 'Next mode: fly']
                  : ['✈', 'Next mode: drone'];
            if (fly.textContent !== next[0]) {
                fly.textContent = next[0];
                fly.setAttribute('aria-label', next[1]);
            }
        },
        destroy() {
            manager.destroy();
            joyZone.remove();
            btns.remove();
            rollBtns.remove();
            style.remove();
        },
    };
    return controls;
}
