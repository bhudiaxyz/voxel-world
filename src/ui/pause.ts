/** Player pause menu — Escape. Developer rendering controls live elsewhere. */

const CSS = `
#pause {
  position:fixed; inset:0; z-index:45; display:none;
  align-items:center; justify-content:center;
  background:rgba(7,7,10,.55); backdrop-filter:blur(10px) saturate(1.04);
  font-family:Inter, ui-sans-serif, system-ui, sans-serif; color:var(--ink);
}
#pause.open { display:flex; }
#pause .panel {
  width:min(300px, calc(100vw - 32px)); padding:18px;
  border-radius:14px; background:rgba(20,19,24,.88);
  border:1px solid var(--line);
  backdrop-filter:blur(18px) saturate(1.12);
  box-shadow:0 24px 64px rgba(0,0,0,.55);
}
#pause h2 { margin:0 0 20px; font-size:15px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--gold); }
#pause nav { display:grid; gap:8px; }
#pause button {
  width:100%; height:42px; padding:0 14px; display:flex; align-items:center;
  justify-content:space-between; border:1px solid rgba(201,173,115,.18);
  border-radius:8px; background:rgba(30,28,35,.72); color:var(--ink-soft);
  font:600 12px/1 Inter, ui-sans-serif, system-ui, sans-serif;
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
  min-width:22px; height:20px; padding:0 5px; display:grid; place-items:center;
  border-radius:5px; background:rgba(201,173,115,.12); color:var(--gold);
  font:700 9px/1 Inter, ui-sans-serif, system-ui, sans-serif;
  text-transform:uppercase;
}
`;

export function createPause({ input, map }: any) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'pause';
  root.innerHTML = `
    <div class="panel" role="dialog" aria-label="Pause menu" aria-modal="true">
      <h2>Paused</h2>
      <nav>
        <button type="button" id="pause-resume"><span>Resume</span><kbd>Esc</kbd></button>
        <button type="button" id="pause-map"><span>Map</span><kbd>M</kbd></button>
      </nav>
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
      (resume as any).focus({ preventScroll:true });
    } else {
      input.paused = wasPaused;
    }
  };

  resume!.addEventListener('click', () => setOpen(false));
  root.querySelector('#pause-map')!.addEventListener('click', () => {
    setOpen(false);
    map.toggle();
  });
  root.addEventListener('click', (e) => { if (e.target === root) setOpen(false); });

  addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || e.repeat) return;
    e.preventDefault();
    setOpen(!open);
  });

  return {
    el: root,
    get open() { return open; },
    toggle: () => setOpen(!open),
  };
}
