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

/** Scene-kind marker colours and icons — drawn from the world palette. */
const KIND: Record<string, { fill: string; ring: string; label: string; icon?: string; landmark?: boolean }> = {
  waterfall: { fill: 'rgba(106,160,154,0.82)', ring: 'rgba(40,58,58,0.90)',   label: 'Waterfall', icon: '💧' },
  pond:      { fill: 'rgba(80,130,130,0.75)',  ring: 'rgba(42,64,64,0.90)',   label: 'Pond',      icon: '🪷' },
  crossing:  { fill: 'rgba(192,144,82,0.82)',  ring: 'rgba(100,72,40,0.90)',  label: 'Crossing',  icon: '🌉' },
  grove:     { fill: 'rgba(130,168,82,0.82)',  ring: 'rgba(74,108,44,0.90)',  label: 'Grove',     icon: '🌸' },
  overlook:  { fill: 'rgba(170,162,150,0.75)', ring: 'rgba(96,90,82,0.90)',   label: 'Overlook',  icon: '🔭' },
  // Landmarks — drawn as circles to distinguish them from scene diamonds
  spire:     { fill: 'rgba(210,185,145,0.88)', ring: 'rgba(90,72,48,0.92)',   label: 'Twisted Spire',    icon: '⛰️',  landmark: true },
  obelisk:   { fill: 'rgba(195,175,140,0.88)', ring: 'rgba(80,66,44,0.92)',   label: 'Obelisk',          icon: '🪨',  landmark: true },
  ring:      { fill: 'rgba(180,165,138,0.85)', ring: 'rgba(72,60,42,0.92)',   label: 'Monolith Ring',    icon: '🗿',  landmark: true },
  tombs:     { fill: 'rgba(160,150,138,0.82)', ring: 'rgba(64,58,50,0.92)',   label: 'Tombstone Field',  icon: '🪦',  landmark: true },
  biosphere: { fill: 'rgba(130,185,170,0.88)', ring: 'rgba(50,100,88,0.92)',  label: 'Floating Biosphere', icon: '🌍', landmark: true },
  well:      { fill: 'rgba(190,178,155,0.88)', ring: 'rgba(78,66,44,0.92)',   label: 'Ancient Well',       icon: '🪣',  landmark: true },
  arch:      { fill: 'rgba(200,185,158,0.88)', ring: 'rgba(84,70,46,0.92)',   label: 'Ruined Arch',        icon: '🏛️',  landmark: true },
  hotspring: { fill: 'rgba(100,192,178,0.82)', ring: 'rgba(40,110,98,0.90)',  label: 'Hot Spring',         icon: '♨️' },
};

const CSS = `
#map { position:fixed; inset:0; z-index:44; display:none;
       align-items:center; justify-content:center;
       background:rgba(7,7,10,.60); backdrop-filter:blur(10px) saturate(1.04);
       font-family:var(--font-body, 'Outfit', system-ui, sans-serif);
       color:var(--ink); opacity:0; transition:opacity .18s ease; }
#map.on { display:flex; }
#map.vis { opacity:1; }
#map .frame { position:relative; padding:8px; border-radius:14px;
  background:rgba(20,19,24,.90); border:1px solid var(--line);
  backdrop-filter:blur(18px) saturate(1.12);
  box-shadow:0 24px 72px rgba(0,0,0,.55); }
#map canvas { display:block; border-radius:9px; background:#0d0c0f;
  box-shadow:inset 0 0 0 1px rgba(201,173,115,.12); }
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
 * Equirectangular projection helpers — flat 2:1 world-map rectangle.
 *
 * The canvas is W×H with W = 2·H. World (x,z) maps linearly: x → canvas x,
 * z → canvas y, with uniform scaling so the full world fits inside the canvas.
 * This matches the standard equirectangular (plate carrée) look of world maps.
 */
function makeRect(S: number) {
  const W = S, H = S / 2; // canvas dimensions

  /** World (wx, wz) → canvas (cx, cy). Always returns a value. */
  const toCanvas = (wx: number, wz: number) => ({
    cx: (wx / S) * W,
    cy: (wz / S) * H,
  });

  /** Canvas (cx, cy) → world (wx, wz). Always returns a value. */
  const fromCanvas = (cx: number, cy: number) => ({
    wx: (cx / W) * S,
    wz: (cy / H) * S,
  });

  return { toCanvas, fromCanvas, W, H };
}

/** Sample one world column and return its map colour. */
function worldPixel(
  wx: number, wz: number,
  grid: any, heights: any, S: number, SEA: number,
  shoal: THREE.Color, deep: THREE.Color,
) {
  const x = Math.max(0, Math.min(S - 1, Math.round(wx)));
  const z = Math.max(0, Math.min(S - 1, Math.round(wz)));
  const ter = heights[z * S + x];
  const top = grid.columnTop(x, z);
  const at = (xx: number, zz: number) =>
    heights[(zz < 0 ? 0 : zz >= S ? S - 1 : zz) * S + (xx < 0 ? 0 : xx >= S ? S - 1 : xx)];

  let r: number, g: number, b: number;

  if (ter <= SEA && top <= SEA) {
    const t = Math.min((SEA - ter) / 16, 1);
    const k = t * t * (3 - 2 * t);
    r = shoal.r + (deep.r - shoal.r) * k;
    g = shoal.g + (deep.g - shoal.g) * k;
    b = shoal.b + (deep.b - shoal.b) * k;
  } else {
    const blk = BLOCK_BY_ID[grid.get(x, top, z)];
    const c = blk && blk.top;
    r = c ? c.r : 0.5;
    g = c ? c.g : 0.5;
    b = c ? c.b : 0.5;

    const dx = at(x + 1, z) - at(x - 1, z);
    const dz = at(x, z + 1) - at(x, z - 1);
    const lit = 1 + (-dx * 0.6 - dz * 0.6) * 0.085;
    const s = Math.min(Math.max(lit, 0.42), 1.5);
    r *= s; g *= s; b *= s;

    const drop = Math.max(at(x, z) - at(x + 1, z), at(x, z) - at(x, z + 1));
    if (drop >= 3) { r *= 0.8; g *= 0.8; b *= 0.82; }
  }
  return { r, g, b };
}

/**
 * Bake the terrain layer using an equirectangular (flat rectangle) projection.
 *
 * Canvas is W×H (2:1). Each canvas pixel maps 1:1 to world (x,z) via a simple
 * scale, so the full world square is displayed as a 2:1 rectangle — the same
 * plate carrée layout used in standard world atlas maps.
 */
function bakeTerrain(world: any) {
  const { grid, heights, size: S } = world;
  const SEA = Math.floor(WATER.level);
  const proj = makeRect(S);
  const cv = document.createElement('canvas');
  cv.width = proj.W;
  cv.height = proj.H;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(proj.W, proj.H);
  const px = img.data;

  const shoal = new THREE.Color(WATER.shoal);
  const deep  = new THREE.Color(WATER.deep);

  for (let cy = 0; cy < proj.H; cy++) {
    for (let cx = 0; cx < proj.W; cx++) {
      const w = proj.fromCanvas(cx, cy);
      const { r, g, b } = worldPixel(w.wx, w.wz, grid, heights, S, SEA, shoal, deep);
      const o = (cy * proj.W + cx) * 4;
      px[o]   = enc(r);
      px[o+1] = enc(g);
      px[o+2] = enc(b);
      px[o+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Draw river network over the baked terrain.
  // Two passes per river: a soft glow, then a solid line — the same technique
  // cartographers use to lift water above the terrain without boxing it.
  const rivers: any[] = world.plan?.rivers ?? [];
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Order → [glowWidth, glowAlpha, lineWidth, lineColor]
  const RIVER_STYLE: Record<number, [number, string, number, string]> = {
    0: [7,   'rgba(60,150,210,0.22)', 3.2, 'rgba(70,165,230,0.92)'],  // trunk
    1: [4.5, 'rgba(60,150,210,0.18)', 2.0, 'rgba(80,170,225,0.82)'],  // tributary
    2: [3,   'rgba(60,150,210,0.14)', 1.2, 'rgba(100,180,230,0.68)'], // stream
  };

  // Sort so wider trunks are drawn first, streams last (on top).
  const sorted = [...rivers].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  for (const pass of [0, 1] as const) { // 0=glow, 1=solid
    for (const r of sorted) {
      if (!r.points || r.points.length < 2) continue;
      const order: number = r.order ?? 0;
      const style = RIVER_STYLE[order] ?? RIVER_STYLE[1];
      ctx.lineWidth   = pass === 0 ? style[0] : style[2];
      ctx.strokeStyle = pass === 0 ? style[1] : style[3];
      ctx.beginPath();
      let penDown = false;
      for (let i = 0; i < r.points.length; i++) {
        const [wx, wz] = r.points[i];
        // Clip to land — river paths extend to the geometric island rim which
        // can be below sea level; skip any point that is ocean or sea floor.
        const hx = Math.max(0, Math.min(S - 1, Math.round(wx)));
        const hz = Math.max(0, Math.min(S - 1, Math.round(wz)));
        if (heights[hz * S + hx] <= SEA) { penDown = false; continue; }
        const c = proj.toCanvas(wx, wz);
        if (!penDown) { ctx.moveTo(c.cx, c.cy); penDown = true; }
        else ctx.lineTo(c.cx, c.cy);
      }
      ctx.stroke();
    }
  }

  return cv;
}

export function createMap({ world, controller, input, fpCam }: any) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const S = world.size;
  const root = document.createElement('div');
  root.id = 'map';
  root.innerHTML = `
    <div class="frame" role="dialog" aria-label="Map" aria-modal="true">
      <canvas id="map-cv"></canvas>
    </div>
  `;
  document.body.appendChild(root);

  const cv = root.querySelector('#map-cv') as HTMLCanvasElement;
  const ctx = cv.getContext('2d')!;
  const proj = makeRect(S);
  cv.width  = proj.W;
  cv.height = proj.H;

  let terrain: any = null; // baked once, on first open
  let open = false;
  let wasPaused = false;

  /* World units per displayed pixel. The canvas is 2:1 (W×H); fit it inside
   * the viewport keeping that aspect ratio. */
  let unit = 1;
  const fit = () => {
    const maxW = innerWidth  - 48;
    const maxH = innerHeight - 48;
    const w = Math.min(maxW, maxH * 2, 1200);
    const h = w / 2;
    cv.style.width  = `${Math.max(240, w)}px`;
    cv.style.height = `${Math.max(120, h)}px`;
    unit = proj.W / Math.max(240, w);
  };
  fit();
  addEventListener('resize', fit);

  function draw() {
    if (!terrain) return;
    ctx.clearRect(0, 0, proj.W, proj.H);
    ctx.drawImage(terrain, 0, 0);

    // ---- bridges: small timber ticks -------------------------------
    ctx.lineWidth = 1.4 * unit;
    for (const b of world.props?.bridges || []) {
      const p = proj.toCanvas(b.x, b.z);
      ctx.fillStyle = 'rgba(184,130,74,0.88)';
      ctx.strokeStyle = 'rgba(90,58,28,0.85)';
      const r = 3.2 * unit;
      ctx.beginPath();
      ctx.rect(p.cx - r, p.cy - r, r * 2, r * 2);
      ctx.fill();
      ctx.stroke();
    }

    // ---- scenes + landmarks: shape + icon + label ----------------------
    // Font sizes in canvas pixels so they appear consistent at any display scale.
    const iconPx  = Math.round(18 * unit);
    const labelPx = Math.round(13 * unit);
    ctx.lineWidth = 1.3 * unit;
    for (const s of world.stamps || []) {
      const p = proj.toCanvas(s.at[0], s.at[1]);
      const k = KIND[s.kind] || KIND.grove;
      ctx.fillStyle = k.fill;
      ctx.strokeStyle = k.ring;

      if (k.landmark) {
        // Landmark: filled circle
        const r = 4.5 * unit;
        ctx.beginPath();
        ctx.arc(p.cx, p.cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        // Scenic stamp: rotated square (diamond)
        const r = 4.0 * unit;
        ctx.save();
        ctx.translate(p.cx, p.cy);
        ctx.rotate(Math.PI / 4);
        ctx.beginPath();
        ctx.rect(-r, -r, r * 2, r * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      if (k.icon) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.font = `${iconPx}px sans-serif`;
        // Shadow pass (offset +1 px for readability over terrain)
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillText(k.icon, p.cx + 1, p.cy - 5 * unit + 1);
        ctx.fillStyle = '#fff';
        ctx.fillText(k.icon, p.cx, p.cy - 5 * unit);

        ctx.font = `${labelPx}px sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillText(k.label, p.cx + 1, p.cy + 6 * unit + 1);
        ctx.fillStyle = '#e8dcc1';
        ctx.fillText(k.label, p.cx, p.cy + 6 * unit);
        ctx.restore();
      }
    }

    // ---- the player -------------------------------------------------
    // In drone/fly mode the camera moves independently of controller.pos, so
    // read the live camera world position instead.
    const airborne = fpCam && (fpCam.droneActive || fpCam.flyActive);
    const mapX = airborne ? fpCam.camera.position.x : controller.pos.x;
    const mapZ = airborne ? fpCam.camera.position.z : controller.pos.z;
    const { cx: px, cy: pz } = proj.toCanvas(mapX, mapZ);
    // Camera yaw always reflects where the player is facing (walk, fly, drone).
    // rot.y + π converts Three.js camera convention to map-north-up heading.
    const h = fpCam
      ? fpCam.camera.rotation.y + Math.PI
      : (controller.heading ?? 0);
    const dx = Math.sin(h),
      dz = Math.cos(h);
    const a = 11 * unit;

    /* A halo and a ring before the arrow.
     *
     * The arrow alone is a dozen pixels on a map that is mostly small
     * high-contrast dots, and finding it took longer than reading the rest of
     * the map. A pale disc under it and a dark ring around it separate it from
     * the terrain at any zoom. */
    // Warm amber halo — echoes the palette's gold/terracotta accent
    const halo = ctx.createRadialGradient(px, pz, 0, px, pz, a * 3.2);
    halo.addColorStop(0, 'rgba(192,88,40,0.55)');
    halo.addColorStop(0.55, 'rgba(192,88,40,0.18)');
    halo.addColorStop(1, 'rgba(192,88,40,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(px, pz, a * 3.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(20,12,6,0.55)';
    ctx.lineWidth = 1.6 * unit;
    ctx.beginPath();
    ctx.arc(px, pz, a * 1.5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.save();
    ctx.translate(px, pz);
    ctx.beginPath();
    ctx.moveTo(dx * a, dz * a); // nose
    ctx.lineTo(-dz * a * 0.62 - dx * a * 0.5, dx * a * 0.62 - dz * a * 0.5);
    ctx.lineTo(dx * a * -0.16, dz * a * -0.16); // notched tail
    ctx.lineTo(dz * a * 0.62 - dx * a * 0.5, -dx * a * 0.62 - dz * a * 0.5);
    ctx.closePath();
    ctx.fillStyle = '#c05828'; // palette --gold
    ctx.strokeStyle = 'rgba(232,220,193,0.92)'; // palette --ink
    ctx.lineWidth = 2.0 * unit;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // ---- compass rose (top-right) ------------------------------------
    const cr = 18 * unit;          // outer radius
    const cx2 = proj.W - cr * 1.8; // centre x
    const cy2 = cr * 1.8;          // centre y

    // Subtle disc background
    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = 'rgba(18,14,10,0.55)';
    ctx.beginPath();
    ctx.arc(cx2, cy2, cr * 1.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;

    // Four cardinal points — N/S in red-white, E/W in grey-white
    const CARDS = [
      { label: 'N', angle: 0,             color: '#e84040' },
      { label: 'E', angle: Math.PI / 2,   color: '#c8c0b0' },
      { label: 'S', angle: Math.PI,       color: '#c8c0b0' },
      { label: 'W', angle: -Math.PI / 2,  color: '#c8c0b0' },
    ] as const;
    ctx.font = `bold ${Math.round(cr * 0.72)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const { label, angle, color } of CARDS) {
      const lx = cx2 + Math.sin(angle) * cr * 1.05;
      const ly = cy2 - Math.cos(angle) * cr * 1.05;
      ctx.fillStyle = color;
      ctx.fillText(label, lx, ly);
    }

    // Small tick marks between cardinals
    for (let t = 0; t < 8; t++) {
      const a = (t * Math.PI) / 4;
      const inner = t % 2 === 0 ? cr * 0.52 : cr * 0.62;
      ctx.strokeStyle = 'rgba(200,192,176,0.5)';
      ctx.lineWidth = unit;
      ctx.beginPath();
      ctx.moveTo(cx2 + Math.sin(a) * inner, cy2 - Math.cos(a) * inner);
      ctx.lineTo(cx2 + Math.sin(a) * cr * 0.78, cy2 - Math.cos(a) * cr * 0.78);
      ctx.stroke();
    }
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
      // In drone/fly mode leave input running so the player can navigate by map.
      // In ground mode, pause to prevent walking blind into a lake.
      wasPaused = input.paused;
      if (!fpCam?.droneActive && !fpCam?.flyActive) input.paused = true;
    } else {
      root.classList.remove('vis');
      input.paused = wasPaused;
      setTimeout(() => {
        if (!open) root.classList.remove('on');
      }, 190);
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
  root.addEventListener('click', (e) => {
    if (e.target === root) setOpen(false);
  });

  return {
    el: root,
    get open() {
      return open;
    },
    toggle: () => setOpen(!open),
    /** Force terrain re-bake on next open (e.g. after a palette change). */
    invalidateTerrain() {
      terrain = null;
    },
    /** Cheap no-op while closed; the terrain layer is never re-baked. */
    update() {
      if (open && terrain) draw();
    },
  };
}
