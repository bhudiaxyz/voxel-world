/**
 * Floating world-anchored labels.
 *
 * A short line of text that appears above something in the world, drifts up
 * and fades. Used first for the commands you give the dog — "Sit", "Stand",
 * "Fetch" — but it knows nothing about dogs or commands: it takes an anchor, a
 * string and a tone, which is what makes it worth having as a system rather
 * than as a div in the dog's key handler.
 *
 * **DOM, not sprites.** Text needs to be crisp at any distance and needs an
 * outline, and both are one CSS line here against a canvas-texture-per-label
 * in the scene. It also sidesteps `scene.matrixWorldAutoUpdate = false`
 * entirely — a sprite would need its matrix driven by hand every frame. The
 * cost is a projection and a transform write per live label, and there are
 * rarely more than one or two.
 *
 * Anchors may be an Object3D (the label follows it) or any {x, y, z}. Labels
 * are pooled, so a session's worth of commands allocates a handful of nodes
 * and then none.
 */

import * as THREE from 'three';

/* Timings, in seconds. Fast in, unhurried hold, gentle out — a label that
 * fades in slowly reads as a lag rather than as a response. */
const FADE_IN = 0.1;
const FADE_OUT = 0.42;
const DEFAULT_HOLD = 0.95;
/** How far it drifts up over its life, in screen pixels. */
const RISE = 38;
/**
 * Distance at which a label is drawn at its natural size.
 *
 * Labels shrink with distance so they sit in the scene rather than floating on
 * the glass, but only gently and never below the floor — text that scales
 * linearly with perspective is unreadable the moment you zoom out.
 */
const REF_DISTANCE = 26;
const MIN_SCALE = 0.62;
const MAX_SCALE = 1.15;

const CSS = `
#bubbles { position:fixed; inset:0; pointer-events:none; z-index:30;
  overflow:hidden; }
#bubbles .bubble {
  position:absolute; left:0; top:0; will-change:transform, opacity;
  transform-origin:50% 100%;
  font-family:Inter, ui-rounded, system-ui, sans-serif;
  font-weight:650; font-size:15px; letter-spacing:.015em;
  white-space:nowrap; color:var(--ink);
  text-shadow:
     0  1px 0 rgba(0,0,0,.72),  0 -1px 0 rgba(0,0,0,.72),
     1px 0   0 rgba(0,0,0,.72), -1px 0  0 rgba(0,0,0,.72),
     0  2px 8px rgba(0,0,0,.5);
}
#bubbles .bubble.soft  { font-size:13px; font-weight:600; color:var(--ink-soft); }
#bubbles .bubble.alert { color:var(--gold-bright); }
#bubbles .bubble.hush  { font-size:12.5px; font-weight:550; color:var(--ink-faint);
                         font-style:italic; }
`;

/**
 * @param camera    the render camera, for projection
 * @param container element the overlay is appended to
 * @param viewport  element whose rectangle defines clip space — the canvas.
 *   Distinct from `container` on purpose: projection produces coordinates in
 *   the *canvas* rectangle, so measuring anything else puts every label in the
 *   wrong place the moment the canvas is inset or letterboxed.
 */
export function createBubbles({ camera, container = document.body, viewport = null }: any) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'bubbles';
  container.appendChild(root);

  /* The clip-space rectangle is cached rather than measured per frame.
   * `getBoundingClientRect` inside the render loop forces a layout every frame
   * for numbers that only change on resize. The overlay is fixed-positioned,
   * so the offsets are viewport-relative and match. */
  const box = viewport || root;
  let vx = 0,
    vy = 0,
    vw = 1,
    vh = 1;
  const measure = () => {
    const r = box.getBoundingClientRect();
    vx = r.left;
    vy = r.top;
    vw = r.width || 1;
    vh = r.height || 1;
  };
  measure();
  addEventListener('resize', measure);

  const live: any[] = [];
  const pool: any[] = [];
  const v = new THREE.Vector3();
  const world = new THREE.Vector3();

  const takeEl = () => {
    const el = pool.pop();
    if (el) return el;
    const made = document.createElement('div');
    made.className = 'bubble';
    root.appendChild(made);
    return made;
  };

  const release = (b: any) => {
    b.el.style.opacity = '0';
    b.el.style.transform = 'translate3d(-9999px,-9999px,0)';
    pool.push(b.el);
  };

  /**
   * Show a label.
   *
   * @param anchor  Object3D to follow, or a fixed {x, y, z}
   * @param text    the line to show
   * @param tone    'command' | 'soft' | 'alert' | 'hush'
   * @param height  world units above the anchor's origin
   * @param hold    seconds at full opacity
   * @param channel labels on the same anchor and channel replace each other
   */
  function say(
    anchor: any,
    text: any,
    { tone = 'command', height = 0, hold = DEFAULT_HOLD, channel = 'default' } = {},
  ) {
    /* One label per anchor per channel.
     *
     * Toggling sit/stand quickly should read as the latest thing you said, not
     * as a stack of contradictions climbing the screen. Separate channels let
     * unrelated systems talk over the same head without fighting. */
    for (const b of live) {
      if (b.anchor === anchor && b.channel === channel) b.age = Math.max(b.age, b.life - FADE_OUT);
    }

    const el = takeEl();
    el.className = `bubble ${tone}`;
    el.textContent = text;
    const b = {
      el,
      anchor,
      channel,
      height,
      text,
      age: 0,
      life: FADE_IN + hold + FADE_OUT,
    };
    live.push(b);
    return b;
  }

  return {
    say,
    /** Re-read the canvas rectangle. Call if it moves for any reason other
     *  than a window resize — a layout change, a panel opening. */
    resize: measure,
    /** Drop everything immediately — scene changes, teleports, resets. */
    clear() {
      for (const b of live) release(b);
      live.length = 0;
    },
    get count() {
      return live.length;
    },

    update(dt: any) {
      if (!live.length) return;
      for (let i = live.length - 1; i >= 0; i--) {
        const b = live[i];
        b.age += dt;
        if (b.age >= b.life) {
          release(b);
          live.splice(i, 1);
          continue;
        }

        // Anchor position, this frame. Following a moving object is the whole
        // point of anchoring to one rather than to a coordinate.
        if (b.anchor.isObject3D) b.anchor.getWorldPosition(world);
        else world.set(b.anchor.x, b.anchor.y, b.anchor.z);
        world.y += b.height;

        v.copy(world).project(camera);
        // Behind the camera, or off the sides: nothing sensible to draw.
        if (v.z > 1 || v.x < -1.6 || v.x > 1.6 || v.y < -1.6 || v.y > 1.6) {
          b.el.style.opacity = '0';
          continue;
        }

        const t = b.age;
        const alpha = t < FADE_IN ? t / FADE_IN : t > b.life - FADE_OUT ? (b.life - t) / FADE_OUT : 1;

        // Drift: quick at first, easing off, so it decelerates as it fades
        // instead of sliding out of frame at constant speed.
        const p = t / b.life;
        const drift = RISE * (1 - (1 - p) * (1 - p));

        const dist = camera.position.distanceTo(world);
        const scale = THREE.MathUtils.clamp(REF_DISTANCE / Math.max(dist, 0.01), MIN_SCALE, MAX_SCALE);

        const sx = vx + (v.x * 0.5 + 0.5) * vw;
        const sy = vy + (-v.y * 0.5 + 0.5) * vh - drift;
        b.el.style.opacity = alpha.toFixed(3);
        b.el.style.transform =
          `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)` +
          ` translate(-50%, -100%) scale(${scale.toFixed(3)})`;
      }
    },
  };
}
