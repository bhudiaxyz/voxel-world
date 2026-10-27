/** Player pause menu — Escape. Shows adaptive key/touch bindings. */

import { isTouchDevice } from './touch-controls';

const CSS = `
#pause {
  position:fixed; inset:0; z-index:45; display:none;
  align-items:center; justify-content:center;
  background:rgba(7,7,10,.55); backdrop-filter:blur(10px) saturate(1.04);
  font-family:var(--font-body,Inter,ui-sans-serif,system-ui,sans-serif); color:var(--ink);
}
#pause.open { display:flex; }
#pause .panel {
  width:min(360px, calc(100vw - 32px)); padding:18px 20px 20px;
  border-radius:14px; background:rgba(20,19,24,.92);
  border:1px solid var(--line);
  backdrop-filter:blur(18px) saturate(1.12);
  box-shadow:0 24px 64px rgba(0,0,0,.55);
}
#pause h2 { margin:0 0 18px; font-size:15px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--gold); }
#pause nav { display:grid; gap:8px; }
#pause button {
  width:100%; height:42px; padding:0 14px; display:flex; align-items:center;
  justify-content:space-between; border:1px solid rgba(201,173,115,.18);
  border-radius:8px; background:rgba(30,28,35,.72); color:var(--ink-soft);
  font:600 12px/1 var(--font-body,Inter,ui-sans-serif,system-ui,sans-serif);
  letter-spacing:.08em; text-transform:uppercase; cursor:pointer;
  transition:background .14s ease, border-color .14s ease;
}
#pause button:hover, #pause button:focus-visible {
  outline:none; background:rgba(42,39,48,.88); border-color:var(--gold);
}
#pause #pause-resume { background:rgba(201,173,115,.12); border-color:var(--line); color:var(--gold); }
#pause #pause-resume:hover, #pause #pause-resume:focus-visible {
  background:rgba(201,173,115,.22); border-color:var(--gold);
}
#pause kbd {
  min-width:22px; height:20px; padding:0 5px; display:inline-grid; place-items:center;
  border-radius:5px; background:rgba(201,173,115,.12); color:var(--gold);
  font:700 9px/1 var(--font-body,Inter,ui-sans-serif,system-ui,sans-serif);
  text-transform:uppercase; white-space:nowrap;
}
#pause .controls {
  margin-top:18px; padding-top:16px;
  border-top:1px solid rgba(201,173,115,.12);
}
#pause .controls h3 {
  margin:0 0 10px; font-size:10px; font-weight:700;
  letter-spacing:.14em; text-transform:uppercase; color:var(--ink-faint,rgba(232,220,193,.4));
}
#pause .bindings {
  display:grid; grid-template-columns:1fr 1fr; gap:5px 10px;
}
#pause .binding {
  display:flex; align-items:center; gap:6px;
  font-size:11px; color:var(--ink-soft,rgba(232,220,193,.62));
  letter-spacing:.04em;
}
#pause .binding kbd { flex-shrink:0; }
`;

const KEYBOARD_BINDINGS = [
  ['WASD', 'Move'],
  ['Mouse', 'Look'],
  ['Space', 'Jump / Ascend'],
  ['C', 'Descend'],
  ['Shift', 'Sprint'],
  ['F', 'Toggle fly mode'],
  ['G', 'Enter drone'],
  ['L', 'Land (drone)'],
  ['E', 'Edge toggle'],
  ['M', 'Map'],
  ['Esc', 'Pause'],
];

const TOUCH_BINDINGS = [
  ['Left stick', 'Move'],
  ['Swipe right', 'Look'],
  ['↑', 'Jump / Ascend'],
  ['↓', 'Descend'],
  ['⚡', 'Sprint'],
  ['✈', 'Toggle fly mode'],
  ['🚁', 'Enter drone'],
  ['🛬', 'Land (drone)'],
  ['⬡', 'Edges'],
  ['Esc', 'Pause'],
];

function buildBindings(rows: string[][]): string {
  return rows.map(([key, label]) => `<div class="binding"><kbd>${key}</kbd><span>${label}</span></div>`).join('');
}

export function createPause({ input, map, onNewWorld }: any) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const bindings = isTouchDevice ? TOUCH_BINDINGS : KEYBOARD_BINDINGS;

  const root = document.createElement('div');
  root.id = 'pause';
  root.innerHTML = `
    <div class="panel" role="dialog" aria-label="Pause menu" aria-modal="true">
      <h2>Paused</h2>
      <nav>
        <button type="button" id="pause-resume"><span>Resume</span><kbd>Esc</kbd></button>
        <button type="button" id="pause-map"><span>Map</span><kbd>M</kbd></button>
      </nav>
      <div class="controls">
        <h3>Controls</h3>
        <div class="bindings">${buildBindings(bindings)}</div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const resume = root.querySelector('#pause-resume');
  let open = false;
  let wasPaused = false;

  const setOpen = (next: any) => {
    if (next === open) return;
    open = next;
    root.classList.toggle('open', open);
    if (open) {
      wasPaused = input.paused;
      input.paused = true;
      input.keys.clear();
      (resume as any).focus({ preventScroll: true });
    } else {
      input.paused = wasPaused;
    }
  };

  resume!.addEventListener('click', () => setOpen(false));
  root.querySelector('#pause-map')!.addEventListener('click', () => {
    setOpen(false);
    map.toggle();
  });
  root.addEventListener('click', (e) => {
    if (e.target === root) setOpen(false);
  });

  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      setOpen(!open);
    } else if (e.code === 'KeyM' && open) {
      e.preventDefault();
      setOpen(false);
      map.toggle();
    }
  });

  return {
    el: root,
    get open() {
      return open;
    },
    toggle: () => setOpen(!open),
  };
}
