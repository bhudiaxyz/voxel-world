/**
 * The traveller.
 *
 * A small voxel figure built from boxes, animated entirely procedurally:
 * a walk cycle driven by a single phase accumulator, squash-and-stretch on
 * jump and land, a cape that trails with simple verlet-ish lag, and a
 * breathing idle. No skeletons, no clips — it's all curves, which keeps the
 * motion snappy and easy to tune.
 */

import * as THREE from 'three';
import { createBoxEdges } from '../core/voxel';

const S = 0.3; // world units per character voxel

/**
 * @param edgeMaterial the world's edge material, shared so the traveller is
 *   inked by exactly the same rules as the terrain. Omit it and the figure
 *   simply goes unoutlined.
 */
function boxMesh(w: any, h: any, d: any, color: any, mat: any, edgeMaterial: any, outlined = true) {
  const g = new THREE.BoxGeometry(w * S, h * S, d * S);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = false;
  m.userData.baseColor = color;
  // A child, so every bit of the animation — the walk cycle, the squash, the
  // cape lag — carries the outline along without any of it being restated.
  if (edgeMaterial && outlined) {
    m.add(createBoxEdges(w * S, h * S, d * S, color, edgeMaterial));
  }
  return m;
}

export function createCharacter(edgeMaterial = null) {
  const root = new THREE.Group();
  root.name = 'player';

  /* ---- palette -------------------------------------------------------
   * Every hue in this world is warm or violet: sage grass, terracotta soil,
   * dusty-rose blossom, lilac stone. So the traveller is deliberately the one
   * COOL thing in frame. Muted petrol appears nowhere in the terrain, which
   * means the figure separates from whatever they happen to be standing
   * against — grass, cliff or blossom — without needing an outline to do it.
   *
   * Marigold is the single saturated note in the whole model, spent at the
   * collar because that is where the eye lands first.
   *
   * The values are also chosen against the ink's luminance threshold, so the
   * split falls where it flatters the form: tunic, scarf and face are pale
   * enough to catch a bright rim, while hood, cloak, trousers and boots stay
   * fully dark-outlined and read as one silhouette.
   */
  const skin = new THREE.Color(0xf3d2b8);
  const hood = new THREE.Color(0x8fb6ba);
  const hoodDeep = new THREE.Color(0x74a0a6);
  const tunic = new THREE.Color(0xf7e9cf);
  const scarf = new THREE.Color(0xefb173);
  const satchel = new THREE.Color(0xd6a374);
  const leather = new THREE.Color(0x8a6660);
  const trouser = new THREE.Color(0x7e93a6);
  const boots = new THREE.Color(0x7c5f5c);

  const mkMat = (c: any) => new THREE.MeshLambertMaterial({ color: c });
  const part = (w: any, h: any, d: any, color: any, x: any, y: any, z: any, mat: any = null, outlined = true) => {
    const m = boxMesh(w, h, d, color, mat || mkMat(color), edgeMaterial, outlined);
    m.position.set(x * S, y * S, z * S);
    return m;
  };

  const body = new THREE.Group();
  root.add(body);

  // torso, belted, with the satchel strap crossing it
  body.add(part(4, 5, 2.6, tunic, 0, 5.5, 0));
  body.add(part(4.2, 0.9, 2.8, leather, 0, 3.9, 0, null, false));

  // A rotated box is the cheapest diagonal available, and the diagonal is
  // what stops the chest reading as a plain rectangle from the front.
  const strap = part(5.4, 0.7, 0.45, leather, 0, 6.2, 1.35, null, false);
  strap.rotation.z = -0.58;
  body.add(strap);

  // Worn on one hip only. The asymmetry is doing most of the work of making
  // this figure recognisable in silhouette from any angle.
  body.add(part(2.2, 2.4, 1.3, satchel, 2.7, 4.5, 0.2, null, false));
  body.add(part(2.3, 0.5, 1.4, leather, 2.7, 5.6, 0.2, null, false));

  // Collar, sitting BELOW the chin rather than around the neck. At the neck
  // the head covered it completely from the front, which wasted the one
  // saturated colour on the model on a band only visible from above.
  body.add(part(4.6, 1.3, 3.2, scarf, 0, 6.4, 0, null, false));

  /* head, inside an open hood.
   * Five slabs rather than one shell, so the face is genuinely framed by an
   * opening instead of being a cube with a lighter square painted on the
   * front. The rear peak is what gives the profile its point. */
  const headGroup = new THREE.Group();
  headGroup.position.y = 8.6 * S;
  // Smaller than the hood that frames it, so the opening reads as an opening.
  // At its old size the face filled the whole hood and the figure was topped
  // by a blank peach rectangle.
  headGroup.add(part(4.0, 3.8, 3.8, skin, 0, 0, 0, null, false));
  const hoodMat = mkMat(hood);
  // Only the crown carries ink. Outlining every slab of the hood creates a
  // stack of tiny nested boxes at play zoom; the remaining slabs are colour
  // shapes inside that single, readable contour.
  headGroup.add(part(4.9, 1.2, 4.6, hood, 0, 2.3, -0.1, hoodMat));
  headGroup.add(part(4.9, 4.1, 1.0, hood, 0, 0.1, -1.85, hoodMat, false));
  headGroup.add(part(0.75, 3.8, 4.2, hood, -2.1, 0, -0.25, hoodMat, false));
  headGroup.add(part(0.75, 3.8, 4.2, hood, 2.1, 0, -0.25, hoodMat, false));
  headGroup.add(part(2.2, 1.5, 2.2, hoodDeep, 0, 3.0, -1.5, null, false));
  body.add(headGroup);

  // arms — cloak sleeves, so they belong to the hood rather than the tunic
  const sleeveMat = mkMat(hood);
  const cuffMat = mkMat(tunic);
  const mkArm = (side: any) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 2.7 * S, 7.6 * S, 0);
    pivot.add(part(1.6, 3.6, 1.6, hood, 0, -1.5, 0, sleeveMat));
    pivot.add(part(1.5, 1.3, 1.5, tunic, 0, -3.9, 0, cuffMat, false));
    body.add(pivot);
    return pivot;
  };
  const armL = mkArm(-1),
    armR = mkArm(1);

  // legs
  const trouserMat = mkMat(trouser);
  const bootMat = mkMat(boots);
  const mkLeg = (side: any) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 1.1 * S, 3.2 * S, 0);
    pivot.add(part(1.7, 3.4, 1.8, trouser, 0, -1.5, 0, trouserMat));
    // The trouser already provides the leg silhouette. A second boxed stroke
    // around the boot reads as an overlapping internal grid at small scale.
    pivot.add(part(1.9, 1.1, 2.4, boots, 0, -3.3, 0.25, bootMat, false));
    body.add(pivot);
    return pivot;
  };
  const legL = mkLeg(-1),
    legR = mkLeg(1);

  /** Chain of lagging segments, used for both the cloak and the scarf tail. */
  const mkTrail = (origin: any, count: any, mat: any, size: any, drop: any) => {
    const segs = [];
    let parent = origin;
    for (let i = 0; i < count; i++) {
      const seg = new THREE.Group();
      seg.position.y = i === 0 ? 0 : drop * S;
      const [w, h, d, taper] = size;
      // Trail panels overlap and articulate. Their colour boundary preserves
      // the form without accumulating several outlined rectangles.
      const panel = boxMesh(w - i * taper, h, d, mat.color, mat, edgeMaterial, false);
      panel.position.y = h * -0.5 * S;
      seg.add(panel);
      parent.add(seg);
      parent = seg;
      segs.push(seg);
    }
    body.add(origin);
    return segs;
  };

  const capeRoot = new THREE.Group();
  capeRoot.position.set(0, 7.9 * S, -1.75 * S);
  // Narrower than the shoulders and set back off them, so the tunic and the
  // collar still read from behind instead of the figure becoming one slab.
  const capePanels = mkTrail(capeRoot, 3, mkMat(hoodDeep), [3.6, 2.2, 0.55, 0.45], -2.0);

  // The scarf hangs off one shoulder, again off-centre, and being the only
  // saturated colour it is what the eye tracks while the figure moves.
  const scarfRoot = new THREE.Group();
  scarfRoot.position.set(1.5 * S, 7.9 * S, -1.1 * S);
  const scarfTail = mkTrail(scarfRoot, 2, mkMat(scarf), [1.5, 2.3, 0.6, 0.25], -2.1);

  // soft contact shadow blob — reads instantly even when the sun shadow is soft
  const blobGeo = new THREE.CircleGeometry(1.05, 24);
  blobGeo.rotateX(-Math.PI / 2);
  const blobMat = new THREE.MeshBasicMaterial({
    color: 0x6d5f7d,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  });
  const blob = new THREE.Mesh(blobGeo, blobMat);
  blob.renderOrder = 5;
  root.add(blob);

  const state = {
    phase: 0,
    idle: 0,
    squash: 1,
    squashVel: 0,
    lean: 0,
    turn: 0,
    air: 0,
    swim: 0,
  };

  return {
    root,
    body,
    blob,
    height: 10.5 * S,
    radius: 0.42,

    /**
     * @param speed01  0..1 normalised ground speed
     * @param grounded on the ground?
     * @param vy       vertical velocity, for the airborne pose
     */
    update(dt: any, { speed01, grounded, vy, heading, groundY, swimming = false }: any) {
      const t = state;

      /* Swim blend.
       *
       * Eased rather than switched, for the same reason the airborne flag is:
       * wading out of the shallows crosses the threshold repeatedly within a
       * stride, and a hard cut would flip the figure between upright and
       * prone every few frames. */
      t.swim += ((swimming ? 1 : 0) - t.swim) * (1 - Math.exp(-9 * dt));
      const swim = t.swim < 0.02 ? 0 : t.swim;

      // Smoothed airborne blend. `grounded` is a binary physics flag that can
      // change on any frame (a terrace lip, a single step off a ledge);
      // driving the pose from it directly snaps the limbs and cape between
      // two states. Blend through a short time constant instead so ground /
      // air transitions read as motion, not as a strobe.
      t.air += ((grounded ? 0 : 1) - t.air) * (1 - Math.exp(-12 * dt));
      // Airborne and swimming both mean "not on the ground", but they want
      // opposite poses, so the swim blend suppresses the fall pose entirely.
      const air = Math.max(t.air < 0.02 ? 0 : t.air - swim, 0);

      // --- walk cycle -----------------------------------------------
      const cadence = 6.2 + speed01 * 5.4;
      t.phase += dt * cadence * (0.35 + speed01) * (1 - air);
      const sw = Math.sin(t.phase),
        sw2 = Math.cos(t.phase);
      const amp = speed01;

      t.idle += dt * 1.9;
      const breathe = Math.sin(t.idle) * 0.028 * (1 - amp);

      legL.rotation.x = sw * 0.92 * amp;
      legR.rotation.x = -sw * 0.92 * amp;
      armL.rotation.x = -sw * 0.78 * amp;
      armR.rotation.x = sw * 0.78 * amp;
      armL.rotation.z = 0.11 + amp * 0.06 + breathe;
      armR.rotation.z = -0.11 - amp * 0.06 - breathe;

      if (air > 0) {
        // tuck for the jump, reach on the way down
        const up = THREE.MathUtils.clamp(vy * 0.16, -1, 1);
        legL.rotation.x = THREE.MathUtils.lerp(legL.rotation.x, -0.55 + up * 0.4, air);
        legR.rotation.x = THREE.MathUtils.lerp(legR.rotation.x, -0.2 - up * 0.3, air);
        armL.rotation.x = THREE.MathUtils.lerp(armL.rotation.x, -1.5 - up * 0.5, air);
        armR.rotation.x = THREE.MathUtils.lerp(armR.rotation.x, -1.5 - up * 0.5, air);
      }

      /* --- swim stroke -------------------------------------------------
       * Arms sweep alternately overhead and legs flutter in a much shallower
       * arc than a walk — the tell is the amplitude ratio, not the timing:
       * a swimmer's legs barely leave the line of the body while the arms
       * travel almost a half circle. */
      if (swim > 0) {
        const stroke = Math.sin(t.phase * 0.85);
        const kick = Math.sin(t.phase * 1.9);
        legL.rotation.x = THREE.MathUtils.lerp(legL.rotation.x, kick * 0.3, swim);
        legR.rotation.x = THREE.MathUtils.lerp(legR.rotation.x, -kick * 0.3, swim);
        armL.rotation.x = THREE.MathUtils.lerp(armL.rotation.x, -1.35 + stroke * 1.35, swim);
        armR.rotation.x = THREE.MathUtils.lerp(armR.rotation.x, -1.35 - stroke * 1.35, swim);
        armL.rotation.z = THREE.MathUtils.lerp(armL.rotation.z, 0.34, swim);
        armR.rotation.z = THREE.MathUtils.lerp(armR.rotation.z, -0.34, swim);
      }

      // --- bob + squash ---------------------------------------------
      const bob = Math.abs(sw2) * 0.09 * amp * (1 - air);
      // spring the squash back to 1
      const k = 190,
        damp = 17;
      t.squashVel += (1 - t.squash) * k * dt - t.squashVel * damp * dt;
      t.squash += t.squashVel * dt;
      // Hard clamp. The volume-preserving term below takes 1/sqrt(squash), so
      // a single bad frame that drives this to zero or negative produces NaN
      // scales and the model detonates into stray triangles.
      if (!Number.isFinite(t.squash)) {
        t.squash = 1;
        t.squashVel = 0;
      }
      t.squash = THREE.MathUtils.clamp(t.squash, 0.45, 1.6);

      body.position.y = bob + breathe;
      body.position.z = 0;

      const lateral = 1 / Math.sqrt(t.squash);
      body.scale.set(lateral, t.squash, lateral);

      // --- lean into the run ----------------------------------------
      // Swimming pitches the whole body toward prone. Not fully flat: kept
      // short of horizontal so the head still reads above the waterline and
      // the silhouette stays recognisable from the play camera.
      const targetLean = amp * 0.15 + air * 0.06;
      t.lean += (targetLean - t.lean) * (1 - Math.exp(-9 * dt));
      body.rotation.x = THREE.MathUtils.lerp(t.lean, 0.94, swim);

      /* Pitch about the body's mass centre, not its feet.
       *
       * The group's origin is at the ankles, so tilting there swings the head
       * forward by nearly the figure's whole height — far outside the 0.38
       * collision radius, which is why the model pushed into banks it was
       * standing clear of. Translating back by the arc the centroid travels
       * keeps the rotated silhouette centred on the collision cylinder, so
       * what you see occupies the space the physics reserved for it.
       *
       * The small lift compensates for the centroid dropping as it rotates,
       * which would otherwise sink the head under the surface. */
      if (swim > 0) {
        const CENTROID = 5.3 * S;
        const tilt = body.rotation.x;
        body.position.z = -Math.sin(tilt) * CENTROID * swim;
        body.position.y += (1 - Math.cos(tilt)) * CENTROID * swim * 0.85;
      }

      // --- facing ----------------------------------------------------
      if (heading !== undefined) {
        let d = heading - root.rotation.y;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        root.rotation.y += d * (1 - Math.exp(-13 * dt));
      }

      // --- cape lag ---------------------------------------------------
      for (let i = 0; i < capePanels.length; i++) {
        const seg = capePanels[i];
        const target = 0.16 + amp * 0.55 + air * 0.5 + Math.sin(t.phase * 0.5 + i) * 0.06 * amp;
        seg.rotation.x += (target - seg.rotation.x) * (1 - Math.exp(-(9 - i * 2) * dt));
        seg.rotation.z = Math.sin(t.idle * 0.7 + i * 1.1) * 0.05 * (0.4 + amp);
      }

      // --- scarf lag ---------------------------------------------------
      // Looser and quicker than the cloak, and it swings sideways as well as
      // back. Being much lighter it should never look like a strip of the
      // same cloth: the contrast between the two is what sells either.
      for (let i = 0; i < scarfTail.length; i++) {
        const seg = scarfTail[i];
        const target = 0.1 + amp * 0.95 + air * 0.75 + Math.sin(t.phase * 0.9 + i * 1.4) * 0.16 * amp;
        seg.rotation.x += (target - seg.rotation.x) * (1 - Math.exp(-(13 - i * 3) * dt));
        seg.rotation.z = Math.sin(t.idle * 1.5 + i * 1.7) * 0.13 * (0.5 + amp) - amp * 0.1;
      }

      // --- contact shadow --------------------------------------------
      if (groundY !== undefined) {
        const air = THREE.MathUtils.clamp(root.position.y - groundY, 0, 12);
        blob.position.y = groundY - root.position.y + 0.06;
        const s = THREE.MathUtils.clamp(1 - air * 0.055, 0.35, 1);
        blob.scale.setScalar(s);
        blobMat.opacity = 0.32 * s;
        blob.visible = air < 14;
      }
    },

    /** Call on landing to trigger the squash. */
    land(impact: any) {
      state.squash = THREE.MathUtils.clamp(1 - impact * 0.32, 0.55, 1);
      state.squashVel = 0;
    },
    /**
     * Call when the controller auto-steps a ledge.
     * @param rise how many blocks were climbed
     */
    step(rise: any) {
      // The arc is real now — the controller launches a genuine jump — so all
      // this owes is the push-off stretch, scaled to the height cleared.
      // Floor kept low so a kerb barely registers — the stretch should scale
      // with the effort, and a small step costs almost none.
      state.squash = 1 + 0.14 * THREE.MathUtils.clamp(rise / 3, 0.1, 1);
      state.squashVel = 0;
    },

    /** Call on jump to trigger the stretch. */
    jump() {
      state.squash = 1.22;
      state.squashVel = 0;
    },
  };
}
