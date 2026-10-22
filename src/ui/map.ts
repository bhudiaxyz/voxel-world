/**
 * The map — an aerial rendering of the world, on M.
 *
 * Drawn from the finished voxel grid rather than from a schematic, so it is a
 * *picture of the world* and not a diagram of it: every pixel is the colour of
 * whatever block is actually on top of that column. Tree canopies show as
 * blossom, bridges as timber, paths as pale stone, because that is literally
 * what is there. A legend-and-polygons map would need its own idea of where
 * everything is, and would drift out of step with the generator the first time
 * either changed.
 *
 * Two costs worth knowing about:
 *
 *   - The terrain layer is baked **once**, lazily, on first open. At 768 that
 *     is 590k column lookups and about a tenth of a second; doing it during
 *     world load would add to a load that is already long, and doing it every
 *     frame would be absurd for something that never changes.
 *   - Only the markers and the player are redrawn per frame, and only while
 *     the map is open.
 */

import * as THREE from 'three';
import { BLOCK_BY_ID, WATER } from '../core/palette';

/** Scene-kind marker colours. Warm for built things, cool for water ones. */
const KIND = {
  waterfall: { fill: '#eaf3ff', ring: '#7f8fc6', label: 'waterfall' },
  pond:      { fill: '#cdbde8', ring: '#6f5fa6', label: 'pond' },
  crossing:  { fill: '#f0dcc4', ring: '#a87f5c', label: 'crossing' },
  grove:     { fill: '#f6cfd9', ring: '#b3738b', label: 'grove' },
  overlook:  { fill: '#e2e0d2', ring: '#8d8a70', label: 'overlook' },
};

const CSS = `
#map { position:fixed; inset:0; z-index:44; display:none;
       align-items:center; justify-content:center;
       background:rgba(7,7,10,.60); backdrop-filter:blur(10px) saturate(1.04);
       font-family:Inter, ui-sans-serif, system-ui, sans-serif;
       color:var(--ink); opacity:0; transition:opacity .18s ease; }
#map.on { display:flex; }
#map.vis { opacity:1; }
#map .frame { position:relative; padding:8px; border-radius:14px;
  background:rgba(20,19,24,.90); border:1px solid var(--line);
  backdrop-filter:blur(18px) saturate(1.12);
  box-shadow:0 24px 72px rgba(0,0,0,.55); }
#map canvas { display:block; border-radius:9px; background:#0d0c0f;
  box-shadow:inset 0 0 0 1px rgba(201,173,115,.12); }
#map .north { position:absolute; left:18px; top:17px; z-index:2;
  width:25px; height:25px; display:grid; place-items:center; border-radius:6px;
  background:rgba(20,19,24,.88); border:1px solid var(--line);
  color:var(--gold); backdrop-filter:blur(9px); font-size:10px; font-weight:700;
  letter-spacing:.06em; box-shadow:0 4px 14px rgba(0,0,0,.35); }
#map .close { position:absolute; right:17px; top:16px; z-index:2;
  width:28px; height:28px; display:grid; place-items:center; padding:0;
  border:1px solid rgba(201,173,115,.18); border-radius:7px;
  background:rgba(30,28,35,.80); color:var(--ink-soft);
  backdrop-filter:blur(7px); font:400 18px/1 Inter, sans-serif; cursor:pointer; }
#map .close:hover { color:var(--gold); background:rgba(42,39,48,.88); border-color:var(--gold); }
#map .busy { position:absolute; inset:0; display:flex; align-items:center;
  justify-content:center; }
#map .busy::after { content:""; width:22px; height:22px; border-radius:50%;
  border:2px solid rgba(201,173,115,.18); border-top-color:var(--gold);
  animation:map-spin .75s linear infinite; }
@keyframes map-spin { to { transform:rotate(360deg); } }
`;

/** Linear (palette space) to 0..255 sRGB. */
const enc = (v: any) => Math.round(255 * Math.pow(Math.min(Math.max(v, 0), 1), 1 / 2.2));

/**
 * Bake the terrain layer.
 *
 * One pixel per block. Colour comes from the topmost block in the column, so
 * anything the generators placed — canopies, decks, lanterns, paved paths —
 * appears without this file knowing those things exist.
 */
function bakeTerrain(world: any) {
  const { grid, heights, size: S } = world;
  const SEA = Math.floor(WATER.level);
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const px = img.data;

  // Palette colours are linear; so are these, and they get encoded on the way
  // out with everything else.
  const shoal = new THREE.Color(WATER.shoal);
  const deep = new THREE.Color(WATER.deep);

  const at = (x: any, z: any) => heights[
    (z < 0 ? 0 : z >= S ? S - 1 : z) * S + (x < 0 ? 0 : x >= S ? S - 1 : x)];

  for (let z = 0; z < S; z++) {
    for (let x = 0; x < S; x++) {
      const i = z * S + x;
      const ter = heights[i];
      const top = grid.columnTop(x, z);
      let r, g, b;

      if (ter <= SEA && top <= SEA) {
        /* Water. Shaded by depth on the same Beer-Lambert-ish ramp the water
         * shader uses, so a lake reads deep in the middle on the map for the
         * same reason it does in the world. */
        const t = Math.min((SEA - ter) / 16, 1);
        const k = t * t * (3 - 2 * t);
        r = shoal.r + (deep.r - shoal.r) * k;
        g = shoal.g + (deep.g - shoal.g) * k;
        b = shoal.b + (deep.b - shoal.b) * k;
      } else {
        const blk = BLOCK_BY_ID[grid.get(x, top, z)];
        const c = blk && blk.top;
        if (!c) { r = g = b = 0.5; } else { r = c.r; g = c.g; b = c.b; }

        /* Hillshade off the terrain heightfield.
         *
         * Without it the map is a flat colour chart: the terraces are the
         * whole shape of this world and they are invisible from directly
         * above unless the slope is lit. The light comes from the north-west
         * so the shading agrees with the scene's own key light. */
        const dx = at(x + 1, z) - at(x - 1, z);
        const dz = at(x, z + 1) - at(x, z - 1);
        const lit = 1 + (-dx * 0.6 - dz * 0.6) * 0.085;
        const s = Math.min(Math.max(lit, 0.42), 1.5);
        r *= s; g *= s; b *= s;

        // A cliff of a whole terrace or more gets its edge picked out, which is
        // what makes the plateaus legible as plateaus rather than as blotches.
        const drop = Math.max(at(x, z) - at(x + 1, z), at(x, z) - at(x, z + 1));
        if (drop >= 3) { r *= 0.80; g *= 0.80; b *= 0.82; }
      }

      const o = i * 4;
      px[o] = enc(r); px[o + 1] = enc(g); px[o + 2] = enc(b); px[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

export function createMap({ world, controller, input }: any) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const S = world.size;
  const root = document.createElement('div');
  root.id = 'map';
  root.innerHTML = `
    <div class="frame" role="dialog" aria-label="Map" aria-modal="true">
      <div class="north" aria-hidden="true">N</div>
      <button class="close" type="button" aria-label="Close map">×</button>
      <canvas id="map-cv"></canvas>
    </div>
  `;
  document.body.appendChild(root);

  const cv = root.querySelector('#map-cv') as HTMLCanvasElement;
  const ctx = cv.getContext('2d')!;
  cv.width = S; cv.height = S;

  let terrain: any = null;      // baked once, on first open
  let open = false;
  let wasPaused = false;

  /* World units per displayed pixel.
   *
   * The canvas is one pixel per block internally and is then scaled down by
   * CSS, so anything drawn in world units shrinks with the map. Markers must
   * not: how big the "you are here" arrow needs to be is a fact about eyes and
   * screens, not about how many blocks the world happens to be. Every marker
   * below is sized in screen pixels and converted through this. */
  let unit = 1;
  const fit = () => {
    // Square, as large as the viewport comfortably allows.
    const side = Math.max(240, Math.min(innerWidth - 48, innerHeight - 48));
    cv.style.width = `${side}px`;
    cv.style.height = `${side}px`;
    unit = S / side;
  };
  fit();
  addEventListener('resize', fit);

  function draw() {
    if (!terrain) return;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(terrain, 0, 0);

    // ---- bridges: small timber ticks -------------------------------
    ctx.lineWidth = 1.4 * unit;
    for (const b of world.props?.bridges || []) {
      ctx.fillStyle = '#f0dcc4';
      ctx.strokeStyle = 'rgba(90,72,58,.8)';
      const r = 3.2 * unit;
      ctx.beginPath();
      ctx.rect(b.x - r, b.z - r, r * 2, r * 2);
      ctx.fill(); ctx.stroke();
    }

    // ---- scenes: a diamond per composed place ----------------------
    for (const s of world.stamps || []) {
      const k = (KIND as any)[s.kind] || KIND.grove;
      const r = 4.0 * unit;
      ctx.save();
      ctx.translate(s.at[0], s.at[1]);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = k.fill;
      ctx.strokeStyle = k.ring;
      ctx.lineWidth = 1.3 * unit;
      ctx.beginPath();
      ctx.rect(-r, -r, r * 2, r * 2);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    // ---- the player -------------------------------------------------
    const px = controller.pos.x, pz = controller.pos.z;
    // The camera's own facing, so the arrow answers "which way am I looking",
    // which is the only question anyone opens a map to ask.
    const h = controller.heading ?? 0;
    const dx = Math.sin(h), dz = Math.cos(h);
    const a = 11 * unit;

    /* A halo and a ring before the arrow.
     *
     * The arrow alone is a dozen pixels on a map that is mostly small
     * high-contrast dots, and finding it took longer than reading the rest of
     * the map. A pale disc under it and a dark ring around it separate it from
     * the terrain at any zoom. */
    const halo = ctx.createRadialGradient(px, pz, 0, px, pz, a * 3.2);
    halo.addColorStop(0, 'rgba(255,255,255,.85)');
    halo.addColorStop(0.55, 'rgba(255,255,255,.35)');
    halo.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(px, pz, a * 3.2, 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = 'rgba(58,50,78,.55)';
    ctx.lineWidth = 1.6 * unit;
    ctx.beginPath(); ctx.arc(px, pz, a * 1.5, 0, Math.PI * 2); ctx.stroke();

    ctx.save();
    ctx.translate(px, pz);
    ctx.beginPath();
    ctx.moveTo(dx * a, dz * a);                       // nose
    ctx.lineTo(-dz * a * 0.62 - dx * a * 0.5, dx * a * 0.62 - dz * a * 0.5);
    ctx.lineTo(dx * a * -0.16, dz * a * -0.16);       // notched tail
    ctx.lineTo(dz * a * 0.62 - dx * a * 0.5, -dx * a * 0.62 - dz * a * 0.5);
    ctx.closePath();
    ctx.fillStyle = '#5aa9c9';
    ctx.strokeStyle = '#fdfdff';
    ctx.lineWidth = 2.0 * unit;
    ctx.fill(); ctx.stroke();
    ctx.restore();

  }

  function setOpen(v: any) {
    if (v === open) return;
    open = v;
    if (open) {
      root.classList.add('on');
      // Bake on first open. Showing the frame first means the pause reads as
      // deliberate rather than as a hitch.
      if (!terrain) {
        const busy = document.createElement('div');
        busy.className = 'busy';
        root.querySelector('.frame')!.appendChild(busy);
        requestAnimationFrame(() => {
          terrain = bakeTerrain(world);
          busy.remove();
          draw();
        });
      }
      requestAnimationFrame(() => root.classList.add('vis'));
      // Walking blind while the map covers the screen is how you end up in a
      // lake. The previous pause state is restored, not assumed.
      wasPaused = input.paused;
      input.paused = true;
    } else {
      root.classList.remove('vis');
      input.paused = wasPaused;
      setTimeout(() => { if (!open) root.classList.remove('on'); }, 190);
    }
  }

  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'KeyM') {
      if (!open && input.paused) return;
      setOpen(!open);
      e.preventDefault();
    } else if (e.code === 'Escape' && open) {
      setOpen(false);
      e.preventDefault();
      // Do not let the same Escape continue into the pause-menu listener.
      e.stopImmediatePropagation();
    }
  });
  root.querySelector('.close')!.addEventListener('click', () => setOpen(false));
  root.addEventListener('click', (e) => { if (e.target === root) setOpen(false); });

  return {
    el: root,
    get open() { return open; },
    toggle: () => setOpen(!open),
    /** Cheap no-op while closed; the terrain layer is never re-baked. */
    update() { if (open && terrain) draw(); },
  };
}
