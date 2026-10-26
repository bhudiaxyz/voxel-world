/**
 * The dog.
 *
 * A companion rather than a follower. Left alone it mills about wherever you
 * happen to be — trotting a few paces, stopping to sniff, sitting down and
 * watching you — and it only actually *travels* when you get far enough away
 * that staying put would look like it had forgotten about you.
 *
 * Two decisions shape everything below.
 *
 * **It navigates on the same surface the player does.** `NavigationSurface`
 * already knows about terraces, bridge decks, swimmable water and which
 * diagonals squeeze between tree trunks. A pet with its own idea of what is
 * walkable is a pet that walks through cliffs, and — worse — a second thing to
 * keep in step every time the first one changes.
 *
 * **It has no physics body.** It rides the navigation surface directly: the
 * surface supplies the ground height of every cell, so there is nothing to
 * fall through and nothing to collide with. A dog does not need gravity, and
 * giving it a Controller would mean a second body to depenetrate, tune and
 * debug for an animal whose whole job is to look happy near you.
 */

import * as THREE from 'three';
import { createBoxEdges } from '../core/voxel';
import { IncrementalAStar, routePoints } from './pathfinding';

/**
 * World units per dog voxel.
 *
 * Tuned against the traveller standing next to it, which is the only test that
 * matters. A dog wants to read as roughly a third of a person's height: much
 * under and it disappears against the ground detail, much over and it becomes
 * a small pony walking beside you.
 */
const S = 0.205;

/* ---- behaviour ------------------------------------------------------
 * Distances in blocks. `LEASH` is the one that matters: inside it the dog
 * potters, outside it the dog comes to you. */
const LEASH = 9.0;
const HEEL = 3.0; // close enough to stop following
const WANDER_R = 6.5; // idle roaming radius, measured around the PLAYER
const REPATH_DRIFT = 3.5; // player left the goal by this much -> replan
const WARP = 72; // hopelessly far or unreachable -> reappear
/**
 * Hard minimum gap to the traveller, in blocks.
 *
 * Enforced as a positional clamp rather than a steering force. A soft push is
 * a suggestion: it loses to a route that wants to go straight through you, and
 * the two models end up interpenetrating for exactly as long as the dog is
 * trying to get past. Clamping the position cannot fail, and at this scale the
 * correction is small enough to be invisible.
 *
 * Sized from the traveller's collision radius (0.42) plus the dog's own half
 * length, so the boxes never touch however they are facing.
 */
const PERSONAL_SPACE = 1.5;

const TROT = 4.4; // idle pottering
const RUN = 7.6; // catching up; must beat the player's ~6.4
const TURN_RATE = 11; // heading ease, per second
/** After being told to stand, how long before it may idle-sit again. */
const STAND_GRACE = 5.0;
const Y_EASE = 14; // terrace-height ease, per second

/* ---- hopping --------------------------------------------------------
 * A terrace in this world is 3 blocks and the navigation surface permits a
 * 3.3-block step, so the dog has to be able to leave the ground properly. */
const HOP_MIN = 0.55; // height change that stops being a walk
const MAX_HOP = 3.45; // never exceed what the nav surface allowed
const HOP_LOOK = 0.62; // how far ahead the edge is spotted
const HOP_OVER = 0.62; // extra distance, so it lands past the lip
const HOP_CLEAR = 0.26; // arc height above the straight line
/**
 * Fraction of the hop spent changing height.
 *
 * Must be comfortably less than the lip's position along the arc, which is
 * HOP_LOOK / (HOP_LOOK + HOP_OVER) = 0.5. At 0.45 the dog is at full height
 * with a little clearance to spare by the time it crosses.
 */
const HOP_RISE = 0.45;

/* ---- rig geometry, in dog-voxel units -------------------------------
 * Named because the sit pose below is *derived* from them rather than hand
 * tuned. Guessed angles were how the old sit ended up pitching nose-down with
 * its hind legs driven through the floor. */
const LEG_PIVOT_Y = 2.45; // hip height, standing
const LEG_REACH = 2.31; // hip to underside of paw
const FRONT_Z = 1.62;
const HIND_Z = -1.72;
/** The neck is built tilted; the head cancels it. */
const HEAD_BASE_X = 0.3;
const EAR_BASE_X = 0.22;

/**
 * The sit, solved rather than guessed.
 *
 * A dog sits by dropping its rump to the ground and keeping its forelegs
 * straight, so the body pitches **nose-up**, not nose-down. Pick the pitch,
 * then everything else follows from the rig: how far the body must drop for
 * the front paws to stay on the ground, and how far the hind legs must fold
 * for the rear paws to reach it.
 *
 * Doing it by eye produced a body pitched the wrong way, a hip translation
 * that fought the rotation, and a fold angle that put the hind paws about a
 * block underground.
 */
const SIT = (() => {
  const pitch = 0.5; // radians, nose up
  const c = Math.cos(pitch),
    sn = Math.sin(pitch);
  // With body.rotation.x = -pitch, a point (y, z) lands at y*cos + z*sin.
  const lift = (y: any, z: any) => y * c + z * sn;

  const frontHip = lift(LEG_PIVOT_Y, FRONT_Z);
  // Drop the body until the straight front legs put their paws on the floor.
  const drop = LEG_REACH - frontHip;
  const hindHip = lift(LEG_PIVOT_Y, HIND_Z) + drop;
  // Fold the hind legs until their paws reach the floor from that height.
  const fold = Math.acos(Math.min(Math.max(hindHip / LEG_REACH, -1), 1));

  return {
    pitch,
    drop,
    // Local rotations: world target minus the body's own rotation (-pitch).
    frontLeg: pitch, // stay vertical
    hindLeg: pitch - fold, // fold forward, under the body
  };
})();

/* ---- palette --------------------------------------------------------
 * The traveller is the one cool thing in a warm world, so the dog is its warm
 * counterpart and the pair reads as a pair. The collar is deliberately the
 * exact marigold of the traveller's scarf: one shared saturated note is the
 * cheapest way to say these two belong together. */
const CREAM = 0xd9ccb8;
const CREAM_PALE = 0xe1d9cb;
const TAN = 0xc09870;
const TAN_DIM = 0xab815e;
const LEATHER = 0x7c5c56;
const NOSE = 0x544444;
const COLLAR = 0xefb173;

function boxMesh(w: any, h: any, d: any, color: any, edgeMaterial: any, outlined = true) {
  const c = new THREE.Color(color);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w * S, h * S, d * S), new THREE.MeshLambertMaterial({ color: c }));
  m.castShadow = true;
  m.receiveShadow = false;
  // A child, so every bit of the animation carries its own outline without
  // any of it being restated — same arrangement the traveller uses.
  if (edgeMaterial && outlined) {
    m.add(createBoxEdges(w * S, h * S, d * S, c, edgeMaterial));
  }
  return m;
}

/**
 * Build the model. Forward is +Z, matching the traveller, so the same
 * `rotation.y = atan2(dx, dz)` convention drives both.
 *
 * The shape language is the world's: whole boxes, no bevels, every plane a
 * flat colour field. What separates a dog from a crate on four sticks is
 * almost entirely *taper* — chest deeper than hips, upper leg thicker than
 * lower, muzzle narrower than skull — so each of those is a separate box
 * rather than one block doing two jobs.
 */
function buildModel(edgeMaterial: any) {
  const root = new THREE.Group();
  root.name = 'dog';
  const body = new THREE.Group();
  root.add(body);

  /* Only the silhouette carries ink.
   *
   * Every outlined box contributes all twelve of its edges, including the ones
   * buried inside the box next to it, so outlining everything draws a cage
   * rather than an outline. The traveller already works this way — its belt,
   * strap and patches are all unoutlined overlays on outlined masses — and the
   * rule here is the same: if a box is inside, under or flush with another,
   * it passes `false` and lets colour alone do the work.
   *
   * Ink: the three barrel masses, skull, muzzle, ears, tail segments, and the
   * lower half of each leg. Everything else is paint. */
  const put = (group: any, w: any, h: any, d: any, color: any, x: any, y: any, z: any, outlined = true) => {
    const m = boxMesh(w, h, d, color, edgeMaterial, outlined);
    m.position.set(x * S, y * S, z * S);
    group.add(m);
    return m;
  };

  /* ---- barrel -------------------------------------------------------
   * Three masses, not one: a deep chest, a slimmer waist and a rounded rump.
   * A single box here reads as a loaf whatever is bolted to it.
   *
   * They ABUT rather than overlap, and that is the whole trick to keeping the
   * ink clean. Where two outlined boxes interpenetrate, each one's edges stop
   * dead inside the other's faces, and the result is a scribble of short lines
   * floating in the middle of the flank. Sharing a face instead gives exactly
   * one edge at each join — which is the line you actually wanted, because it
   * is where the animal changes shape. */
  put(body, 1.95, 2.0, 2.7, CREAM, 0, 3.3, -0.35); // waist   z -1.70..1.00
  put(body, 2.4, 2.45, 1.7, CREAM, 0, 3.42, 1.85); // chest   z  1.00..2.70
  put(body, 2.2, 2.15, 1.5, CREAM, 0, 3.34, -2.45); // rump    z -3.20..-1.70
  // Tan saddle and a paler underside. Two tones along the length are what
  // stop the flank being one flat acre of cream at this camera distance.
  put(body, 2.02, 0.85, 3.0, TAN, 0, 4.02, -0.9, false);
  put(body, 2.24, 0.55, 1.4, TAN_DIM, 0, 3.96, -2.5, false);
  put(body, 1.7, 0.45, 2.4, CREAM_PALE, 0, 2.38, -0.4, false);

  /* ---- neck and head ------------------------------------------------ */
  const neck = new THREE.Group();
  neck.position.set(0, 4.15 * S, 2.55 * S);
  neck.rotation.x = -0.3; // carried up and forward
  body.add(neck);
  // Buried between chest and skull, so it carries no ink of its own.
  put(neck, 1.5, 1.6, 1.45, CREAM, 0, 0.35, 0.05, false);
  // Proud of the neck by a clear margin, or the marigold has nothing to sit
  // on and reads as a stripe painted on the chest.
  put(neck, 1.78, 0.66, 1.72, COLLAR, 0, 0.82, 0.05, false);

  const head = new THREE.Group();
  head.position.set(0, 1.42 * S, 0.62 * S);
  head.rotation.x = HEAD_BASE_X; // cancel the neck's tilt
  neck.add(head);
  put(head, 1.9, 1.7, 1.9, CREAM, 0, 0, 0); // skull
  put(head, 1.66, 0.75, 1.94, TAN, 0, 0.62, 0, false); // brow patch
  // A blaze straight up the face. One asymmetric-free marking is the cheapest
  // thing that turns a head into a face.
  put(head, 0.52, 0.8, 0.36, CREAM, 0, 0.55, 0.92, false);

  const muzzle = new THREE.Group();
  muzzle.position.set(0, -0.35 * S, 0.95 * S);
  head.add(muzzle);
  put(muzzle, 1.0, 0.8, 1.2, CREAM, 0, 0, 0.5);
  put(muzzle, 0.86, 0.34, 1.05, TAN_DIM, 0, -0.52, 0.48, false); // jaw
  put(muzzle, 0.5, 0.42, 0.42, NOSE, 0, 0.28, 1.18, false);
  // Eyes: tiny, unoutlined and wide-set. Outlined they became goggles.
  put(head, 0.32, 0.32, 0.26, NOSE, 0.55, 0.22, 0.92, false);
  put(head, 0.32, 0.32, 0.26, NOSE, -0.55, 0.22, 0.92, false);

  /* Droopy ears, hung from a pivot at the top of the skull so they swing from
   * the right place. Upright ears made it read as a fox. */
  const ears = [-1, 1].map((side) => {
    const e = new THREE.Group();
    e.position.set(side * 0.82 * S, 0.75 * S, -0.15 * S);
    e.rotation.z = side * 0.3;
    e.rotation.x = EAR_BASE_X;
    head.add(e);
    put(e, 0.5, 1.35, 0.85, TAN_DIM, side * 0.16, -0.5, 0);
    return e;
  });

  /* ---- tail ----------------------------------------------------------
   * Two segments with a pivot between them, so the wag travels down the
   * length instead of the whole thing swinging as one rigid stick. */
  const tail = new THREE.Group();
  tail.position.set(0, 4.05 * S, -2.75 * S);
  body.add(tail);
  put(tail, 0.56, 0.56, 1.5, TAN, 0, 0.1, -0.65);
  const tailTip = new THREE.Group();
  tailTip.position.set(0, 0.16 * S, -1.35 * S);
  tail.add(tailTip);
  put(tailTip, 0.5, 0.5, 1.0, TAN, 0, 0, -0.45);
  put(tailTip, 0.56, 0.56, 0.5, CREAM, 0, 0.06, -1.05, false); // pale tip

  /* ---- legs ----------------------------------------------------------
   * Upper and lower segments of different thickness, plus a haunch on the
   * hind pair. Four identical sticks is the single most doll-like thing a
   * voxel animal can do. */
  const legs = [
    [0.66, FRONT_Z, 0],
    [-0.66, FRONT_Z, 0],
    [0.68, HIND_Z, 1],
    [-0.68, HIND_Z, 1],
  ].map(([x, z, hind]) => {
    const g = new THREE.Group();
    g.position.set(x * S, LEG_PIVOT_Y * S, z * S);
    body.add(g);
    if (hind) {
      put(g, 1.12, 1.4, 1.5, CREAM, 0, -0.3, -0.1, false); // haunch
      put(g, 0.66, 1.05, 0.72, CREAM, 0, -1.45, 0.12); // shank
      put(g, 0.76, 0.42, 0.95, LEATHER, 0, -2.1, 0.24);
    } else {
      put(g, 0.92, 1.2, 1.0, CREAM, 0, -0.38, 0, false); // shoulder
      put(g, 0.66, 1.05, 0.72, CREAM, 0, -1.45, 0.02);
      put(g, 0.76, 0.42, 0.95, LEATHER, 0, -2.1, 0.12);
    }
    return g;
  });

  return { root, body, neck, head, muzzle, ears, tail, tailTip, legs };
}

/**
 * @param world     the built world (for `size` and the spawn fallback)
 * @param surface   the player's NavigationSurface — shared, never rebuilt
 * @param player    the Controller; only `pos` is read
 */
export function createDog({
  world,
  surface,
  player,
  edgeMaterial,
  input = null,
  rng = Math.random,
  /**
   * Called with the name of a command whenever one is issued — 'Sit',
   * 'Stand', and whatever else gets added later.
   *
   * A callback rather than a direct call into the label system: the dog has
   * no business knowing that commands are displayed at all, let alone where
   * or by whom. Whoever wires it up decides that.
   */
  onCommand = null,
}: any) {
  const model = buildModel(edgeMaterial);
  const { root } = model;

  /* Its own search state, sharing the surface.
   *
   * The surface holds the expensive part — the walkability cache — and is
   * read-only once built. The search arrays are per-agent because a search in
   * progress is per-agent, and at 768 blocks they are about 12 MB. Sharing one
   * searcher between two navigators would mean whichever asked last cancelled
   * the other's route. */
  const search = new IncrementalAStar(surface);

  const pos = new THREE.Vector3();
  const drawY = { v: 0 };
  let heading = 0;
  let route: any = null;
  let waypoint = 0;
  let goalX = 0,
    goalZ = 0;
  let layer = 0;

  let mode = 'rest'; // 'rest' | 'wander' | 'follow'
  /**
   * The standing order from the Y key.
   *
   * Deliberately sticky. Recall suspends it — the dog gets up and comes when
   * you walk off — but does not clear it, so once it has caught up it sits
   * again. The alternative, cancelling on recall, means the toggle silently
   * flips state behind your back and the next Y press does the opposite of
   * what you expect.
   */
  let commanded = false;
  let restFor = 0;
  let sit = 0; // 0..1 eased sit pose
  /* The dog's OWN decision to sit while pottering — distinct from the standing
   * order above, and that distinction is the bug fix.
   *
   * One shared `sitWanted` flag conflated the two. Standing up cleared it, and
   * the very next frame the idle-rest roll saw an un-sat dog with an expired
   * timer and re-sat it with 35% probability — so roughly one Y press in three
   * appeared to do nothing at all. */
  let idleSit = false;
  /** Seconds during which the dog will not sit down of its own accord. */
  let sitBlock = 0;
  let phase = 0; // stride accumulator
  let speed01 = 0;
  let swim = 0;
  let bark = 0; // little excitement pulse on arrival
  let hop: any = null; // active jump arc, or null
  let air = 0; // 0..1 eased airborne pose
  let stuckFor = 0;
  let lastX = 0,
    lastZ = 0;
  let failedPaths = 0;

  const clampCell = (v: any) => THREE.MathUtils.clamp(Math.floor(v), 1, world.size - 2);

  /** Ground height at a position, preferring the layer we are already on. */
  const groundAt = (x: any, z: any, preferred: any) => {
    const cx = clampCell(x),
      cz = clampCell(z);
    for (const l of preferred === 1 ? [1, 0] : [0, 1]) {
      const info = surface.info(surface.encode(cx, cz, l));
      if (info) return info;
    }
    return null;
  };

  const placeAt = (x: any, z: any) => {
    const g = groundAt(x, z, layer);
    pos.set(x, g ? g.y : player.pos.y, z);
    drawY.v = pos.y;
    if (g) layer = g.layer;
  };

  const clearRoute = () => {
    route = null;
    waypoint = 0;
    search.cancel();
  };

  /** Begin a search from where the dog actually is to a world position. */
  const pathTo = (x: any, z: any, expectedY: any) => {
    const start = surface.nearestNode(pos.x, pos.z, pos.y, 4);
    const goal = surface.nearestNode(x, z, expectedY, 6);
    if (start < 0 || goal < 0) {
      clearRoute();
      return false;
    }
    clearRoute();
    goalX = x;
    goalZ = z;
    search.begin(start, goal);
    return true;
  };

  /* Somewhere to potter off to: a point around the PLAYER, not around the dog.
   *
   * Around the dog, a wander is a random walk, and a random walk drifts — over
   * a minute of standing still the dog ends up a field away for no reason
   * anyone watching could name. Anchoring to the player keeps it milling about
   * *your* patch, which is what having a dog near you actually looks like. */
  const pickWander = () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = rng() * Math.PI * 2;
      const r = PERSONAL_SPACE + 0.9 + rng() * WANDER_R;
      const x = player.pos.x + Math.cos(a) * r;
      const z = player.pos.z + Math.sin(a) * r;
      if (x < 2 || z < 2 || x > world.size - 3 || z > world.size - 3) continue;
      if (pathTo(x, z, player.pos.y)) {
        mode = 'wander';
        return true;
      }
    }
    mode = 'rest';
    restFor = 0.8 + rng() * 1.4;
    return false;
  };

  /* Reappear, for when the world has genuinely separated you.
   *
   * A pet stranded across a gorge it cannot path over is not a charming
   * detail, it is a lost feature — you never see it again and nothing tells
   * you why. Warping is the standard answer because it is the only one that
   * always terminates. It happens behind you where possible, and only when
   * the dog is far enough away that the pop cannot be seen. */
  const warpNear = () => {
    for (let attempt = 0; attempt < 24; attempt++) {
      const a = rng() * Math.PI * 2;
      const r = 2.2 + rng() * 3.0;
      const x = player.pos.x + Math.cos(a) * r;
      const z = player.pos.z + Math.sin(a) * r;
      const node = surface.nearestNode(x, z, player.pos.y, 3);
      if (node < 0) continue;
      const info = surface.info(node);
      if (!info) continue;
      pos.set(info.x + 0.5, info.y, info.z + 0.5);
      drawY.v = info.y;
      layer = info.layer;
      clearRoute();
      failedPaths = 0;
      mode = 'rest';
      restFor = 0.35;
      return true;
    }
    return false;
  };

  // Start beside the traveller.
  placeAt(player.pos.x + 1.4, player.pos.z + 1.4);
  lastX = pos.x;
  lastZ = pos.z;

  /**
   * Choose a direction for this frame. Deliberately does not move anything:
   * a step up has to be spotted *before* the body is committed to it, and the
   * old version moved first and asked questions afterwards.
   */
  function steer(speed: any) {
    if (!route?.length) return null;
    let target = route[waypoint];
    let dx = target.x - pos.x,
      dz = target.z - pos.z;
    let dist = Math.hypot(dx, dz);
    const arrive = waypoint === route.length - 1 ? 0.34 : 0.62;

    while (dist <= arrive && waypoint < route.length - 1) {
      target = route[++waypoint];
      dx = target.x - pos.x;
      dz = target.z - pos.z;
      dist = Math.hypot(dx, dz);
    }
    if (waypoint === route.length - 1 && dist <= arrive) {
      clearRoute();
      return null;
    }
    if (dist < 1e-5) return null;

    // Ease off over the last stride so arrivals settle rather than snap.
    const v = speed * THREE.MathUtils.clamp(dist / 0.9, 0.35, 1);
    return { nx: dx / dist, nz: dz / dist, v, layer: target.layer };
  }

  /**
   * Start a hop if there is a terrace edge in front.
   *
   * This is the fix for walking through risers. Moving horizontally at the old
   * height and easing the *drawn* height afterwards means the body is inside
   * the cliff for the whole of the transition — the eased height was only ever
   * cosmetic, and cosmetic is exactly what a solid wall is not.
   *
   * A hop takes the dog off the ground entirely: position is driven by an arc
   * for its duration, with no ground sampling, and it lands on a cell the
   * navigation surface has already agreed is standable.
   */
  function beginHop(st: any, speed: any) {
    const ax = pos.x + st.nx * HOP_LOOK,
      az = pos.z + st.nz * HOP_LOOK;
    const ahead = groundAt(ax, az, st.layer ?? layer);
    if (!ahead) return false;
    const dy = ahead.y - pos.y;
    if (Math.abs(dy) < HOP_MIN) return false;

    // Land well inside the new cell so the paws clear the lip rather than
    // touching down on the very edge of it.
    const lx = pos.x + st.nx * (HOP_LOOK + HOP_OVER);
    const lz = pos.z + st.nz * (HOP_LOOK + HOP_OVER);
    const land = groundAt(lx, lz, ahead.layer) || ahead;
    // Refuse a hop the navigation surface would not have allowed as a step;
    // the route should never contain one, and if it does, walking is safer.
    if (Math.abs(land.y - pos.y) > MAX_HOP) return false;

    hop = {
      x0: pos.x,
      z0: pos.z,
      y0: pos.y,
      x1: lx,
      z1: lz,
      y1: land.y,
      layer: land.layer,
      water: land.water,
      up: land.y > pos.y,
      t: 0,
      dur: Math.max((HOP_LOOK + HOP_OVER) / Math.max(speed, 0.1), 0.24 + Math.abs(land.y - pos.y) * 0.055),
      speed,
    };
    return true;
  }

  /** Advance the arc. Drives position outright while it runs. */
  function stepHop(dt: any) {
    hop.t += dt / hop.dur;
    const t = Math.min(hop.t, 1);
    pos.x = hop.x0 + (hop.x1 - hop.x0) * t;
    pos.z = hop.z0 + (hop.z1 - hop.z0) * t;

    /* Finish the climb BEFORE the lip; start the drop AFTER it.
     *
     * The lip sits at `HOP_LOOK / (HOP_LOOK + HOP_OVER)` along the arc — half
     * way, as tuned. So the vertical has to be *done* by then, not halfway
     * through: an exponent-shaped curve still had the dog 0.6 blocks inside a
     * three-block riser as it crossed, which is the clipping this hop exists
     * to remove. Completing the rise over the first 45% and holding it means
     * the lip is always crossed from above, with the whole body clear.
     *
     * Coming down is the mirror image: hold the departure height until past
     * the edge, then fall. Otherwise the dog sinks into the ledge it is
     * stepping off. */
    const k = hop.up ? THREE.MathUtils.smoothstep(t, 0, HOP_RISE) : THREE.MathUtils.smoothstep(t, 1 - HOP_RISE, 1);
    pos.y = hop.y0 + (hop.y1 - hop.y0) * k + Math.sin(Math.PI * t) * (hop.up ? HOP_CLEAR : HOP_CLEAR * 1.3);
    // The arc *is* the visual. Easing it as well would flatten the thing the
    // arc exists to produce.
    drawY.v = pos.y;

    if (t >= 1) {
      pos.y = hop.y1;
      drawY.v = hop.y1;
      layer = hop.layer;
      hop = null;
    }
  }

  /* The key lives here rather than in Input, following the map's precedent:
   * a command that belongs to one object is easiest to reason about when it
   * is bound next to that object. It respects `paused` so it cannot fire
   * while a menu or the map is up. */
  const setSit = (v: any, announce = true) => {
    if (v === commanded) {
      // Still worth echoing: pressing the key must always give feedback, even
      // when the order has not changed.
      if (announce) onCommand?.(v ? 'Sit' : 'Stand');
      return;
    }
    commanded = v;
    if (announce) onCommand?.(commanded ? 'Sit' : 'Stand');
    if (!commanded) {
      // Get up now, and do not spontaneously flop back down straight away:
      // an idle sit half a second after you asked it to stand is
      // indistinguishable from the key not working.
      idleSit = false;
      sitBlock = STAND_GRACE;
      restFor = 0;
    }
  };
  addEventListener('keydown', (e) => {
    if (e.repeat || e.code !== 'KeyY') return;
    if (input?.paused) return;
    setSit(!commanded);
  });

  return {
    root,
    get mode() {
      return mode;
    },
    get position() {
      return pos;
    },
    /** True when the standing order is "sit", whether or not it is sitting yet. */
    get commandedSit() {
      return commanded;
    },
    /** True only once the pose has actually settled. */
    get sitting() {
      return sit > 0.5;
    },
    /** Named `setSit`, not `sit` — the internal `sit` is the eased pose
     *  value, and two things called sit in one file is a trap. */
    setSit,
    toggleSit: () => setSit(!commanded),

    update(dt: any) {
      const px = player.pos.x,
        pz = player.pos.z;
      const toPlayer = Math.hypot(px - pos.x, pz - pos.z);
      if (sitBlock > 0) sitBlock -= dt;

      if (toPlayer > WARP && warpNear()) {
        /* recovered */
      }

      /* ---- advance any search in flight ---------------------------
       * Budgeted and incremental, exactly like the player's. A wander is a
       * handful of cells and finishes on the frame it starts; a recall across
       * a valley spreads over a few. */
      if (search.searching) {
        const result = search.step();
        if (Array.isArray(result)) {
          route = routePoints(result, surface);
          waypoint = Math.min(1, route.length - 1);
          stuckFor = 0;
          failedPaths = 0;
        } else if (result === false) {
          // No route exists. Two of those in a row and the dog is genuinely
          // cut off rather than merely inconvenienced.
          clearRoute();
          if (++failedPaths >= 2 && toPlayer > LEASH * 1.5) warpNear();
          else {
            mode = 'rest';
            restFor = 0.6;
          }
        }
      }

      /* ---- decide what to be doing ---------------------------------
       * Recall outranks everything, including a standing order to sit: a dog
       * that stays put while you walk out of sight is a dog you lose. Once
       * following has started it runs all the way in to HEEL rather than
       * stopping the instant it re-enters the leash, so an obedient dog
       * finishes the job and sits at your feet rather than nine blocks off. */
      const recall = toPlayer > LEASH || (mode === 'follow' && toPlayer > HEEL);
      if (recall) {
        // Repath when the player has walked away from wherever this route was
        // aimed, so the dog tracks you instead of arriving at where you were.
        const drift = Math.hypot(px - goalX, pz - goalZ);
        if (mode !== 'follow' || (!search.searching && (!route || drift > REPATH_DRIFT))) {
          if (pathTo(px, pz, player.pos.y)) mode = 'follow';
        }
      } else if (mode === 'follow') {
        // Caught up. A beat of excitement, then back to pottering — or back
        // to sitting, if that is what it was told to do.
        clearRoute();
        mode = 'rest';
        restFor = 0.25 + rng() * 0.5;
        bark = 1;
      } else if (commanded) {
        // Told to sit. Hold position and hold the pose.
        if (route || search.searching) clearRoute();
        mode = 'rest';
        restFor = 1;
      } else if (mode === 'rest') {
        restFor -= dt;
        if (restFor <= 0) {
          // Sit sometimes instead of moving off straight away — but never
          // during the grace period after being told to stand.
          if (!idleSit && sitBlock <= 0 && rng() < 0.35) {
            idleSit = true;
            restFor = 1.8 + rng() * 2.6;
          } else {
            idleSit = false;
            pickWander();
          }
        }
      } else if (mode === 'wander' && !route && !search.searching) {
        mode = 'rest';
        restFor = 0.5 + rng() * 1.8;
      }

      if (mode !== 'rest') idleSit = false;

      /* ---- move ----------------------------------------------------- */
      const speed = mode === 'follow' ? RUN : TROT;
      let v = 0;
      if (!hop) {
        const st = steer(speed);
        if (st) {
          heading = Math.atan2(st.nx, st.nz);
          v = st.v;
          if (st.layer !== undefined) layer = st.layer;
          // A terrace edge ahead becomes a hop instead of a slide-and-rise.
          if (!beginHop(st, speed)) {
            pos.x += st.nx * st.v * dt;
            pos.z += st.nz * st.v * dt;
          }
        }
      }
      if (hop) {
        v = Math.max(v, hop.speed);
        stepHop(dt);
      }

      /* Never share space with the traveller.
       *
       * Recomputed after the move, not before: `toPlayer` above is a frame
       * stale, and a stale radius is exactly what lets the two models overlap
       * for a frame at closing speed. */
      let gapX = pos.x - px,
        gapZ = pos.z - pz;
      let gap = Math.hypot(gapX, gapZ);
      if (gap < 1e-4) {
        // Exactly coincident: pick a direction rather than divide by zero.
        gapX = Math.sin(heading + Math.PI);
        gapZ = Math.cos(heading + Math.PI);
        gap = 1;
      }
      if (gap < PERSONAL_SPACE) {
        pos.x = px + (gapX / gap) * PERSONAL_SPACE;
        pos.z = pz + (gapZ / gap) * PERSONAL_SPACE;
        // Standing on the boundary with a route that wants to go through the
        // traveller is a wedge. Drop the route and potter instead.
        if (route && mode !== 'follow') {
          clearRoute();
          mode = 'rest';
          restFor = 0.4;
        }
      }

      /* ---- settle onto the ground -----------------------------------
       * Skipped entirely while a hop is running: sampling the ground under a
       * jumping animal is what would snap it back down mid-arc. */
      if (!hop) {
        const ground = groundAt(pos.x, pos.z, layer);
        if (ground) {
          pos.y = ground.y;
          layer = ground.layer;
          swim += ((ground.water ? 1 : 0) - swim) * (1 - Math.exp(-8 * dt));
        }
        /* The ease now only ever absorbs sub-hop wobble — anything worth
         * seeing goes through the arc above. It is kept because the surface
         * still returns half-block differences at bank edges and in water,
         * and a hop for those would look twitchy. */
        drawY.v += (pos.y - drawY.v) * (1 - Math.exp(-Y_EASE * dt));
      }

      /* A route that cannot make progress is a route to abandon. The surface
       * is authoritative about what is walkable, but the dog can still be
       * wedged by the personal-space push or by arriving mid-terrace. */
      const moved = Math.hypot(pos.x - lastX, pos.z - lastZ);
      if (route && moved < 0.004) stuckFor += dt;
      else stuckFor = 0;
      lastX = pos.x;
      lastZ = pos.z;
      if (stuckFor > 0.9) {
        clearRoute();
        stuckFor = 0;
        mode = 'rest';
        restFor = 0.3;
      }

      /* ================================================================
       * Animation
       * ================================================================ */
      const target01 = THREE.MathUtils.clamp(v / RUN, 0, 1);
      speed01 += (target01 - speed01) * (1 - Math.exp(-12 * dt));
      // Either source can seat the dog; only a standing order can be revoked
      // by the player, which is why they are tracked apart.
      const wantSit = commanded || idleSit;
      sit += ((wantSit && speed01 < 0.05 ? 1 : 0) - sit) * (1 - Math.exp(-9 * dt));
      bark = Math.max(0, bark - dt * 2.2);
      // Snappy on the way in, softer on the way out, so a landing settles
      // instead of popping straight back to a stride.
      const airTarget = hop ? 1 : 0;
      air += (airTarget - air) * (1 - Math.exp((hop ? -22 : -11) * dt));
      const s = sit < 0.02 ? 0 : sit;
      const a = air < 0.02 ? 0 : air;
      const w = swim < 0.02 ? 0 : swim;

      // Stride frequency rises with speed, so a trot and a run are the same
      // curve at different rates rather than two separate animations.
      phase += dt * (2.4 + speed01 * 13);
      const gait = speed01 * (1 - s) * (1 - w * 0.6) * (1 - a);

      /* A trot moves diagonal pairs together: front-left with back-right.
       * Legs are ordered [FL, FR, BL, BR], so the phase offset is a lookup
       * rather than four hand-written cases. */
      const OFFSET = [0, Math.PI, Math.PI, 0];
      /* Tuck in the air: front legs reach forward, hind legs trail. Held
       * through the whole arc rather than cycled — a dog mid-jump is a shape,
       * not a walk cycle played faster. */
      const reach = hop ? (hop.up ? 1 : -1) : 1;
      model.legs.forEach((leg, i) => {
        const swingBase = Math.sin(phase + OFFSET[i]) * 0.85 * gait;
        // Paddling in water: front legs only, smaller and faster.
        const paddle = i < 2 ? Math.sin(phase * 1.7 + OFFSET[i]) * 0.7 * w : 0;
        // Sitting folds the back legs under and leaves the front ones straight.
        // Blended into, not added to. Adding the sit on top of a walk cycle
        // meant a sitting dog kept swinging its folded legs.
        const seated = i >= 2 ? SIT.hindLeg : SIT.frontLeg;
        const tucked = i < 2 ? -0.85 * reach : 0.95 * reach;
        const walking = (swingBase + paddle) * (1 - s) + seated * s;
        leg.rotation.x = walking * (1 - a) + tucked * a;
        // The hip pivot is fixed. It used to be translated down for the sit,
        // which fought the body rotation doing the same job and drove the
        // hind paws through the floor.
      });

      // The body bobs at twice stride frequency — two footfalls per cycle —
      // and tips nose-down into a run.
      const bob = Math.sin(phase * 2) * 0.055 * gait;
      model.body.position.y = bob + SIT.drop * s * S - w * 1.5 * S;
      /* Pitch along the arc: nose up on the climb, nose down on the fall.
       * Taken from the parabola's own slope rather than a hand-picked angle,
       * so it tips over automatically at the apex. */
      const climb = !hop
        ? 0
        : hop.up
          ? 1 - THREE.MathUtils.smoothstep(hop.t, 0, HOP_RISE)
          : -THREE.MathUtils.smoothstep(hop.t, 1 - HOP_RISE, 1);
      // Negative is nose-up. The old `+ s * 0.30` tipped the dog forward onto
      // its face, which is the opposite of sitting.
      model.body.rotation.x = (-speed01 * 0.07 - SIT.pitch * s + w * 0.1) * (1 - a) - climb * 0.34 * a;
      model.body.rotation.z = Math.sin(phase) * 0.05 * gait;

      /* The tail is the whole emotional readout, so it gets the most
       * attention: a fast wag when moving or when the traveller is close, a
       * slow sway otherwise, and a flourish on catching up. */
      const near = 1 - THREE.MathUtils.clamp((toPlayer - HEEL) / LEASH, 0, 1);
      /* Amplitude in radians, and it has to stay small. At the first tuning
       * this peaked near 0.9 rad and the tail swept ninety degrees a stroke,
       * which reads as a windscreen wiper rather than as pleasure. Frequency
       * carries the excitement instead. */
      const wag = 0.16 + near * 0.22 + speed01 * 0.16 + bark * 0.24;
      model.tail.rotation.y = Math.sin(phase * 2.6 + 1.1) * wag;
      // The tip lags a quarter cycle, so the wag travels outward instead of
      // the tail swinging as one rigid stick.
      model.tailTip.rotation.y = Math.sin(phase * 2.6 + 0.3) * wag * 0.9;
      model.tail.rotation.x = (-0.55 - near * 0.35 - bark * 0.4 + w * 0.5 + SIT.pitch * s * 1.1) * (1 - a) - a * 0.15; // streams out straight in the air

      // Head: bobs with the gait, lifts to look at you when sitting or idle.
      const look = (1 - speed01) * (0.4 + s * 0.6);
      /* The base tilt has to be part of the sum.
       *
       * `head.rotation.x` is set at build time to cancel the neck's forward
       * tilt, and this line *assigned* over it every frame — so the head hung
       * 17 degrees low permanently and nothing in the pose ever looked level.
       * Sitting adds most of the body's pitch back so the head stays up. */
      model.head.rotation.x =
        HEAD_BASE_X + Math.sin(phase * 2 + 0.6) * 0.06 * gait - look * 0.12 + w * 0.34 + SIT.pitch * s * 0.75;
      if (look > 0.01) {
        // Turn the head toward the traveller rather than the body: a dog that
        // swivels its whole body to watch you reads as a turret.
        let dy = Math.atan2(px - pos.x, pz - pos.z) - heading;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        model.head.rotation.y +=
          (THREE.MathUtils.clamp(dy, -0.9, 0.9) * look - model.head.rotation.y) * (1 - Math.exp(-7 * dt));
      } else {
        model.head.rotation.y *= Math.exp(-6 * dt);
      }

      // Ears flop against the bob, a beat behind it.
      model.ears.forEach((ear, i) => {
        const side = i === 0 ? 1 : -1;
        ear.rotation.x =
          EAR_BASE_X + // built-in hang, kept
          Math.sin(phase * 2 - 0.9) * 0.3 * gait -
          look * 0.15 -
          a * 0.55; // blown back by the jump
        ear.rotation.z = side * (0.22 + Math.sin(phase * 2 - 0.5) * 0.12 * gait);
      });

      /* ---- place the object ----------------------------------------- */
      root.position.set(pos.x, drawY.v, pos.z);
      let d = heading - root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      root.rotation.y += d * (1 - Math.exp(-TURN_RATE * dt));
      // The scene no longer walks its own graph — see main.js.
      root.updateMatrixWorld(true);
    },
  };
}
