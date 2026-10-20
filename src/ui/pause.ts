/** Player pause menu — Escape. Developer rendering controls live elsewhere. */

const CSS = `
#pause {
  position:fixed; inset:0; z-index:45; display:none;
  align-items:center; justify-content:center;
  background:rgba(207,207,224,.28); backdrop-filter:blur(10px) saturate(1.04);
  font-family:Inter, ui-sans-serif, system-ui, sans-serif; color:#50475f;
}
#pause.open { display:flex; }
#pause .panel {
  width:min(300px, calc(100vw - 32px)); padding:18px;
  border-radius:14px; background:rgba(255,255,255,.68);
  border:1px solid rgba(255,255,255,.84);
  backdrop-filter:blur(18px) saturate(1.12);
  box-shadow:0 24px 64px rgba(69,56,88,.20);
}
#pause h2 { margin:0 0 20px; font-size:15px; font-weight:650; letter-spacing:.02em; }
#pause nav { display:grid; gap:8px; }
#pause button {
  width:100%; height:42px; padding:0 14px; display:flex; align-items:center;
  justify-content:space-between; border:1px solid rgba(255,255,255,.78);
  border-radius:8px; background:rgba(255,255,255,.42); color:#574d66;
  font:600 12px/1 Inter, ui-sans-serif, system-ui, sans-serif;
  letter-spacing:.02em; cursor:pointer;
  transition:background .14s ease, border-color .14s ease;
}
#pause button:hover, #pause button:focus-visible {
  outline:none; background:rgba(255,255,255,.78); border-color:#fff;
}
#pause #pause-resume { background:rgba(255,255,255,.88); border-color:#fff; color:#453c55; }
#pause #pause-resume:hover, #pause #pause-resume:focus-visible {
  background:#fff; border-color:#fff;
}
#pause kbd {
  min-width:22px; height:20px; padding:0 5px; display:grid; place-items:center;
  border-radius:5px; background:rgba(78,66,96,.10); color:rgba(66,55,82,.58);
  font:650 9px/1 Inter, ui-sans-serif, system-ui, sans-serif;
  text-transform:uppercase;
}
#pause #pause-resume kbd { background:rgba(69,60,85,.10); color:rgba(69,60,85,.55); }
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
