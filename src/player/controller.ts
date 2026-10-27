/**
 * Movement and collision.
 *
 * Game feel targets: instant response, a little inertia, generous forgiveness.
 * Concretely — high ground acceleration with a lower air control value, coyote
 * time, jump buffering, variable jump height, and step-up so single-block
 * ledges never interrupt a run. The player is an AABB swept against the voxel
 * grid one axis at a time, which is cheap and never tunnels at these speeds.
 */

import * as THREE from 'three';
import { WATER, BLOCK_BY_ID } from '../core/palette';
import { isTouchDevice } from '../ui/touch-controls';
import { wrapAxis } from '../world/terrain';

const GRAVITY = 58;
const MAX_SPEED = 13.5;
const ACCEL = 118;
const AIR_ACCEL = 46;
const FRICTION = 14.5;
const AIR_DRAG = 1.4;
const JUMP_VEL = 20.5;
const COYOTE = 0.12;
const BUFFER = 0.14;
const STEP_HEIGHT = 3.3;
/**
 * Rises up to this are taken in stride rather than jumped.
 *
 * A kerb is not a jump. Launching a ballistic arc over every one-block lip
 * makes ordinary walking bouncy and turns a gentle beach into a staircase of
 * hops; below this the body is simply placed and the drawn position eases up
 * to meet it, which is what taking a small step actually looks like.
 */
const STEP_SMALL = 1.25;
const TERMINAL = -70;

/* ---- swimming ------------------------------------------------------
 * The traveller floats rather than sinks. Water deeper than a stride is
 * now common — trenches run nineteen blocks — so walking the bed would
 * mean disappearing entirely, and the surface is where the scene is.
 */
/**
 * How deep the WATER must be before you swim rather than wade.
 *
 * Keyed on the depth of the bed beneath you, never on your own height in the
 * water. Testing your own Y is a feedback loop: buoyancy lifts you past the
 * threshold, you stop swimming, gravity drops you back under it, and you
 * oscillate several times a second. The bed does not move while you bob, so
 * the state derived from it is stable.
 *
 * Two thresholds, so walking the line between wading and swimming cannot
 * chatter as you cross a cell boundary.
 */
const SWIM_ENTER = 1.7;
const SWIM_EXIT = 1.25;
/** Where pos.y settles relative to the surface: chest deep, head clear. */
const FLOAT_LINE = 1.05;
/** Spring pulling the body to the waterline. Stiff enough to surface a dive. */
const BUOYANCY = 26;
/**
 * Vertical damping, kept separate from the horizontal drag.
 *
 * These were one constant, and the result bobbed once a second: a spring of
 * stiffness k oscillates at sqrt(k) rad/s, so 34 gives a 1.08s period, and the
 * shared drag of 6.5 left it at a damping ratio of 0.56 — visibly underdamped.
 * Critical damping is 2*sqrt(k); slightly past it settles without ringing at
 * all, which is what floating should look like.
 */
const FLOAT_DAMP = 2 * Math.sqrt(BUOYANCY) * 1.18;
const WATER_DRAG = 6.5;
const SWIM_SPEED = 6.4;
const SWIM_ACCEL = 34;
/** Downward push while the jump key is held, so you can duck under. */
const DIVE_VEL = -7.0;
/**
 * Collision radius while swimming.
 *
 * The swim pose is prone, so it occupies a horizontal volume close to the
 * figure's own length — around two units from centre. Reserving only the
 * standing radius of 0.38 let the model lie straight through banks it was
 * floating beside. This covers the torso and head; arms and cloak may still
 * brush, which reads as contact rather than as clipping.
 */
const SWIM_RADIUS = 1.02;

export class Controller {
  declare grid: any;
  declare pos: any;
  declare vel: any;
  declare radius: any;
  declare height: any;
  declare grounded: any;
  declare groundY: any;
  declare autoStep: any;
  declare swimming: any;
  declare submersion: any;
  declare visualY: any;
  declare coyote: any;
  declare buffered: any;
  declare heading: any;
  declare jumpHeld: any;
  declare speed01: any;
  declare events: any;
  declare _wish: any;
  constructor(grid: any, spawn: any) {
    this.grid = grid;
    this.pos = spawn.clone();
    this.vel = new THREE.Vector3();
    this.radius = 0.38;
    this.height = 1.75;

    this.grounded = false;
    this.groundY = spawn.y;
    /**
     * True from an auto-step launch until the next landing.
     *
     * Variable jump height cuts an un-held ascent with extra gravity, which is
     * right for a player-driven jump and fatal for this one: the launch solves
     * for exactly the height needed, then 2.55x gravity strands it at about
     * 40% of the ledge. Nobody is holding a button for a step-up, so the cut
     * has to be suppressed for its duration rather than compensated for.
     */
    this.autoStep = false;
    /** True while the water is carrying the body instead of the ground. */
    this.swimming = false;
    /** 0..1, how far under the surface the feet are — drives the pose. */
    this.submersion = 0;
    /**
     * The Y we actually draw the character at. Physics snaps — landing clamps
     * to a block top, and stepping up a ledge is an instantaneous teleport.
     * Rendering that raw makes the model visibly pop on every terrace lip, so
     * the visual Y chases the physics Y through a spring instead.
     */
    this.visualY = spawn.y;
    this.coyote = 0;
    this.buffered = -1;
    this.heading = 0;
    this.jumpHeld = false;
    this.speed01 = 0;

    this.events = { landed: 0, jumped: false, stepped: false, stepRise: 0, splash: false };
    this._wish = new THREE.Vector3();
  }

  solidAt(x: any, y: any, z: any) {
    return this.grid.isSolid(Math.floor(x), Math.floor(y), Math.floor(z));
  }

  /**
   * The surface directly beneath the player.
   *
   * `grid.columnTop` returns the highest solid block in the whole column,
   * which is the wrong answer whenever the player is under a tree canopy or
   * a bridge — it reports the canopy, and the contact shadow flies up to it.
   * Scan down from the feet instead.
   */
  groundBelow(x: any, y: any, z: any) {
    const xi = Math.floor(x),
      zi = Math.floor(z);
    for (let yy = Math.floor(y + 0.01); yy >= 0; yy--) {
      if (this.grid.isSolid(xi, yy, zi)) return yy + 1;
    }
    return 0;
  }

  /** Horizontal half-extent of the body right now. */
  get bodyRadius() {
    return this.swimming ? SWIM_RADIUS : this.radius;
  }

  /**
   * How many of the body's sample points sit inside solid voxels.
   *
   * A count rather than a yes/no, because escaping an overlap needs to know
   * whether a move makes things better or worse. Treating "already stuck" as
   * "collision off" — which is what a boolean forces — lets the player walk
   * straight through the terrain until they happen to emerge.
   */
  penetration(x: any, y: any, z: any, radius = this.bodyRadius) {
    const y0 = Math.floor(y + 0.02);
    const y1 = Math.floor(y + this.height - 0.02);
    let n = 0;
    for (let yy = y0; yy <= y1; yy++) {
      if (this.solidAt(x - radius, yy, z - radius)) n++;
      if (this.solidAt(x + radius, yy, z - radius)) n++;
      if (this.solidAt(x - radius, yy, z + radius)) n++;
      if (this.solidAt(x + radius, yy, z + radius)) n++;
    }
    return n;
  }

  /**
   * Climb a ledge that movement has run into.
   *
   * On the ground this is a REAL JUMP, not a placement: the body is given
   * exactly the upward velocity needed to clear the lip and is then carried
   * over by gravity and the collider like any other jump. Snapping to the top
   * and easing the drawn position toward it — which is what this did before —
   * can never look like jumping, because nothing is jumping; the arc, the
   * airtime and the landing are all absent and only a slide remains.
   *
   * Horizontal velocity is deliberately left alone. The wall still blocks the
   * step this frame, but once the body clears the lip the same run carries it
   * forward onto the ledge, so the climb is one continuous movement.
   *
   * Swimming is the exception and still places directly: buoyancy replaces
   * gravity, so a ballistic launch would be damped to nothing halfway up.
   */
  launchStep(top: any, x: any, z: any) {
    const rise = top - this.pos.y;
    // Small rises, and hauling out of water, are placements. Only a climb
    // worth committing to gets an arc.
    if (this.swimming || rise <= STEP_SMALL) {
      this.pos.y = top;
      this.pos.x = x;
      this.pos.z = z;
      return;
    }
    this.vel.y = Math.sqrt(2 * GRAVITY * Math.max(rise + 0.55, 0.1));
    this.grounded = false;
    this.coyote = 0;
    this.autoStep = true;
  }

  /** Does the player AABB centred at (x,y,z) hit anything? */
  blocked(x: any, y: any, z: any, radius = this.bodyRadius) {
    return this.penetration(x, y, z, radius) > 0;
  }

  /**
   * @param wish  desired world-space move direction, length 0..1
   * @param jump  jump pressed this frame
   * @param jumpHeld jump currently held (variable height)
   */
  update(dt: any, wish: any, jump: any, jumpHeld: any) {
    const ev = this.events;
    ev.landed = 0;
    ev.jumped = false;
    ev.stepped = false;
    ev.stepRise = 0;

    if (jump) this.buffered = BUFFER;
    else if (this.buffered > 0) this.buffered -= dt;

    /* ---- water ------------------------------------------------------
     * Swimming begins once the feet are more than a stride under. Below
     * that you are wading: the ground still carries you, which keeps fords
     * and shallow shelves walkable rather than turning every puddle into a
     * swim. */
    // Effective water surface: global plane OR the top of any river-water voxel
    // stack immediately above the player's feet (for rivers above sea level).
    let waterSurface = WATER.level;
    {
      const px = Math.floor(this.pos.x), pz = Math.floor(this.pos.z);
      const scanTop = Math.floor(this.pos.y + 4);
      const scanBot = Math.floor(this.pos.y - 1);
      for (let wy = scanTop; wy >= scanBot; wy--) {
        if (BLOCK_BY_ID[this.grid.get(px, wy, pz)]?.isWater) {
          waterSurface = Math.max(waterSurface, wy + 1);
          break;
        }
      }
    }
    const underBy = waterSurface - this.pos.y;
    this.submersion = THREE.MathUtils.clamp(underBy / 1.8, 0, 1);
    /* Depth of water underfoot: the surface, less the ground beneath you.
     *
     * Probed across the whole footprint, taking the HIGHEST ground under any
     * corner, because that is what actually carries the body. A centre-column
     * probe reports the distant bed the moment you stand with your toes over
     * a lip — which reads as deep water and drops the figure into a swim pose
     * on dry land at every cliff edge.
     *
     * And never while grounded: if the ground is holding you up you are not
     * swimming, whatever the column below happens to say. */
    const wasSwimming = this.swimming;
    let bedY = -1;
    for (let i = 0; i < 4; i++) {
      const cx = this.pos.x + (i & 1 ? this.radius : -this.radius);
      const cz = this.pos.z + (i & 2 ? this.radius : -this.radius);
      const t = this.groundBelow(cx, this.pos.y + 0.2, cz);
      if (t > bedY) bedY = t;
    }
    const standDepth = waterSurface - bedY;
    this.swimming = !this.grounded && (wasSwimming ? standDepth > SWIM_EXIT : standDepth > SWIM_ENTER);

    /* Entering the water kills most of the fall.
     *
     * A drop from a terrace arrives at terminal velocity, and buoyancy is a
     * spring — it lets that speed carry the body far under, deep enough to
     * intersect the basin walls, where the depenetration rule can leave it
     * with no move that reduces the overlap. Bleeding the entry speed keeps
     * the plunge shallow enough that the situation never arises. */
    if (this.swimming && !wasSwimming) {
      this.vel.y = Math.max(this.vel.y, -6.5);
    }

    /* ---- horizontal ------------------------------------------------ */
    const accel = this.swimming ? SWIM_ACCEL : this.grounded ? ACCEL : AIR_ACCEL;
    const target = this._wish.copy(wish).multiplyScalar(this.swimming ? SWIM_SPEED : MAX_SPEED);
    const dvx = target.x - this.vel.x,
      dvz = target.z - this.vel.z;
    const dv = Math.hypot(dvx, dvz);
    if (dv > 1e-5) {
      const step = Math.min(dv, accel * dt);
      this.vel.x += (dvx / dv) * step;
      this.vel.z += (dvz / dv) * step;
    }

    if (wish.lengthSq() < 1e-4) {
      const f = Math.exp(-(this.swimming ? WATER_DRAG : this.grounded ? FRICTION : AIR_DRAG) * dt);
      this.vel.x *= f;
      this.vel.z *= f;
    }

    /* ---- jump ------------------------------------------------------ */
    if (this.grounded) this.coyote = COYOTE;
    else this.coyote -= dt;

    if (this.buffered > 0 && this.coyote > 0 && !this.swimming) {
      this.vel.y = JUMP_VEL;
      this.autoStep = false;
      this.buffered = -1;
      this.coyote = 0;
      this.grounded = false;
      ev.jumped = true;
    }
    // variable height: cut the rise short when the button is released
    if (!jumpHeld && this.vel.y > 0 && !this.swimming && !this.autoStep) {
      this.vel.y -= GRAVITY * 1.55 * dt;
    }

    if (this.swimming) {
      /* Buoyancy instead of gravity.
       *
       * A spring toward the waterline rather than a hard clamp, so entering
       * the water at speed carries you under and you bob back up — and so a
       * dive is possible at all. Damping is what stops that bob turning into
       * a permanent oscillation. */
      const rest = waterSurface - FLOAT_LINE;
      this.vel.y += (rest - this.pos.y) * BUOYANCY * dt;
      if (jumpHeld) this.vel.y += (DIVE_VEL - this.vel.y) * 4.0 * dt;
      this.vel.y *= Math.exp(-FLOAT_DAMP * dt);
      this.buffered = -1;
    } else {
      this.vel.y = Math.max(this.vel.y - GRAVITY * dt, TERMINAL);
    }

    /* ---- integrate, axis by axis ----------------------------------- */
    const p = this.pos;

    // Step-ups land on the actual block top rather than being nudged up by a
    // fractional STEP_HEIGHT — otherwise the player floats 0.06 above the
    // ledge and then drops onto it, which reads as a stutter on every step.
    /**
     * Height of the ledge the player is walking into.
     *
     * This must sample the whole AABB footprint, not the centre column. The
     * body has a 0.38 radius, so contact with a ledge happens while the centre
     * is still over the *lower* block — probing the centre just returns the
     * floor already underfoot, the rise computes as zero, and auto-step never
     * fires at all. Take the highest surface under any corner instead.
     */
    const stepTo = (x: any, z: any) => {
      const r = this.bodyRadius;
      // Swimming, the reach is measured from the WATERLINE rather than from
      // the floating body. Chest-deep in the water the body sits about a
      // block low, so measuring from it would refuse banks that are plainly
      // within arm's reach of someone at the surface.
      const from = this.swimming ? waterSurface : p.y;
      let top = -1;
      for (let i = 0; i < 4; i++) {
        const cx = x + (i & 1 ? r : -r);
        const cz = z + (i & 2 ? r : -r);
        const t = this.groundBelow(cx, from + STEP_HEIGHT, cz);
        if (t > top) top = t;
      }
      // Ignore anything level with us, or we would emit a step every frame.
      if (top <= p.y + 0.05) return null;
      const reach = this.swimming ? waterSurface + STEP_HEIGHT - p.y : STEP_HEIGHT;
      return top - p.y <= reach + 0.001 ? top : null;
    };

    /* Depenetration, not a free pass.
     *
     * The swim radius is much larger than the standing one, so entering the
     * water beside a wall can leave the body overlapping it. A move is allowed
     * while overlapped only if it STRICTLY REDUCES the overlap — an exit, not
     * a licence. Permitting any move while stuck let the player stroll around
     * inside the terrain until they wandered out the far side. */
    const pen = this.penetration(p.x, p.y, p.z);

    /* Overlapping while swimming always resolves UPWARD.
     *
     * The surface is the one direction guaranteed to be clear, so rising is a
     * reliable exit even when no horizontal move reduces the overlap. Without
     * it a body wedged against a basin wall has nowhere to go and simply
     * stops responding. */
    if (this.swimming && pen > 0) this.vel.y = Math.max(this.vel.y, 5.0);
    const barred = (nx: any, nz: any) => {
      const next = this.penetration(nx, p.y, nz);
      return next > 0 && next >= pen;
    };

    // X
    const nx = p.x + this.vel.x * dt;
    if (barred(nx, p.z)) {
      const up = this.grounded || this.swimming ? stepTo(nx, p.z) : null;
      if (up !== null && this.penetration(nx, up, p.z) <= pen) {
        ev.stepRise = up - p.y;
        ev.stepped = true;
        this.launchStep(up, nx, p.z);
      } else {
        this.vel.x = 0;
      }
    } else p.x = nx;
    p.x = wrapAxis(p.x);

    // Z
    const nz = p.z + this.vel.z * dt;
    if (barred(p.x, nz)) {
      const up = this.grounded || this.swimming ? stepTo(p.x, nz) : null;
      if (up !== null && this.penetration(p.x, up, nz) <= pen) {
        ev.stepRise = up - p.y;
        ev.stepped = true;
        this.launchStep(up, p.x, nz);
      } else {
        this.vel.z = 0;
      }
    } else p.z = nz;
    p.z = wrapAxis(p.z);

    // Y
    const wasGrounded = this.grounded;
    const impactVel = this.vel.y;
    let ny = p.y + this.vel.y * dt;
    this.grounded = false;
    if (this.vel.y <= 0) {
      // Probe at the feet exactly, not through blocked() as-is: blocked()
      // starts its scan 0.02 *above* the feet, and a resting player only
      // sinks ~0.016 per 60 Hz substep, so ground contact registered only on
      // every other substep. That alternating grounded flag strobed the
      // character between its walk and airborne poses.
      /* Ground is probed at the STANDING radius even while swimming.
       *
       * At the swim radius the body's corners reach a block sideways, so
       * floating next to a bank registered the bank as floor: the swimmer
       * snapped upright and stood on the surface of the water. What holds you
       * up is what is beneath your feet. */
      if (this.blocked(p.x, ny - 0.02, p.z, this.radius)) {
        p.y = Math.floor(ny) + 1.0;
        this.grounded = true;
        this.autoStep = false;
        if (!wasGrounded && impactVel < -8 && !this.swimming) {
          ev.landed = Math.min(-impactVel / 26, 1);
        }
        this.vel.y = 0;
      } else p.y = ny;
    } else if (this.blocked(p.x, ny, p.z, this.radius)) {
      p.y = Math.ceil(ny + this.height) - this.height - 0.001;
      this.vel.y = 0;
    } else p.y = ny;

    // clamp to the world
    const g = this.grid;
    p.x = THREE.MathUtils.clamp(p.x, 1.5, g.sx - 1.5);
    p.z = THREE.MathUtils.clamp(p.z, 1.5, g.sz - 1.5);
    if (p.y < -20) {
      p.set(g.sx / 2, g.sy - 4, g.sz / 2);
      this.vel.set(0, 0, 0);
    }

    /* ---- bookkeeping ----------------------------------------------- */
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.speed01 = THREE.MathUtils.clamp(sp / MAX_SPEED, 0, 1);
    if (sp > 0.35) this.heading = Math.atan2(this.vel.x, this.vel.z);

    this.groundY = this.groundBelow(p.x, p.y, p.z);

    // Chase the physics Y so ledges glide instead of popping. Snap when the
    // gap is large (a real fall or a respawn) so the model never lags behind.
    /* The snap threshold has to clear a whole terrace.
     *
     * It was 2.5, tuned when a terrace was two blocks. Terraces are three now,
     * so EVERY auto-step exceeded it and took the snap path — which is why the
     * climb read as a teleport: the smoothing that exists for exactly this
     * case was being skipped by exactly this case. Anything past a step is
     * still a real fall and must not lag. */
    const gap = p.y - this.visualY;
    if (Math.abs(gap) > STEP_HEIGHT + 1.2 || !this.grounded) this.visualY = p.y;
    else this.visualY += gap * (1 - Math.exp(-15 * dt));
    if (!Number.isFinite(this.visualY)) this.visualY = p.y;

    return ev;
  }
}

/* ------------------------------------------------------------------ *
 * Input
 * ------------------------------------------------------------------ */
export class Input {
  declare keys: any;
  declare axis: any;
  declare jumpPressed: any;
  declare jumpHeld: any;
  declare rotateL: any;
  declare rotateR: any;
  declare zoom: any;
  declare _touch: any;
  declare paused: any;
  constructor(dom: any) {
    this.keys = new Set();
    this.axis = new THREE.Vector2();
    this.jumpPressed = false;
    this.jumpHeld = false;
    this.rotateL = false;
    this.rotateR = false;
    this.zoom = 0;
    this._touch = null;
    /** When true, movement / jump / zoom are ignored (settings menu). */
    this.paused = false;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (this.paused) return;
      this.keys.add(e.code);
      if (e.code === 'Space') {
        this.jumpPressed = true;
        e.preventDefault();
      }
      if (e.code === 'KeyQ') this.rotateL = true;
      if (e.code === 'KeyE') this.rotateR = true;
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space') this.jumpHeld = false;
    });
    addEventListener('blur', () => this.keys.clear());
    dom.addEventListener(
      'wheel',
      (e: any) => {
        if (this.paused) return;
        this.zoom += e.deltaY * 0.045;
        e.preventDefault();
      },
      { passive: false },
    );

    // Legacy touch stick — only active on non-touch devices (nipplejs handles touch).
    if (!isTouchDevice) {
      dom.addEventListener('pointerdown', (e: any) => {
        if (e.pointerType !== 'touch') return;
        if (e.clientX < innerWidth * 0.5) this._touch = { id: e.pointerId, x: e.clientX, y: e.clientY };
        else this.jumpPressed = true;
      });
      dom.addEventListener('pointermove', (e: any) => {
        if (!this._touch || e.pointerId !== this._touch.id) return;
        const dx = (e.clientX - this._touch.x) / 58;
        const dy = (e.clientY - this._touch.y) / 58;
        this.axis.set(THREE.MathUtils.clamp(dx, -1, 1), THREE.MathUtils.clamp(dy, -1, 1));
      });
      const end = (e: any) => {
        if (this._touch && e.pointerId === this._touch.id) {
          this._touch = null;
          this.axis.set(0, 0);
        }
      };
      dom.addEventListener('pointerup', end);
      dom.addEventListener('pointercancel', end);
    }
  }

  /** Read and clear the per-frame edge flags. */
  sample() {
    if (this.paused) {
      this.jumpPressed = false;
      this.rotateL = false;
      this.rotateR = false;
      this.zoom = 0;
      return { x: 0, y: 0, jump: false, jumpHeld: false, rotateL: false, rotateR: false, zoom: 0 };
    }
    const k = this.keys;
    let x = 0,
      y = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (x === 0 && y === 0 && this._touch) {
      x = this.axis.x;
      y = this.axis.y;
    }

    const out = {
      x,
      y,
      jump: this.jumpPressed,
      jumpHeld: this.jumpHeld || k.has('Space'),
      rotateL: this.rotateL,
      rotateR: this.rotateR,
      zoom: this.zoom,
    };
    if (this.jumpPressed) this.jumpHeld = true;
    this.jumpPressed = false;
    this.rotateL = false;
    this.rotateR = false;
    this.zoom = 0;
    return out;
  }
}
