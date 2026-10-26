/**
 * Sub-voxel ground detail.
 *
 * The reference images are covered in tiny handcrafted marks — grass tufts,
 * single flowers, pebbles, fallen petals, reeds at the waterline. None of it
 * is legible as an object from the play camera; all of it is what makes the
 * grass shelves read as *made* rather than as fill. A voxel is a metre here,
 * so this layer cannot be blocks: it is one merged, wind-animated mesh of
 * cross-quads and sub-voxel boxes.
 *
 * Geometry is batched spatially. The visible cells remain a handful of draw
 * calls, while distant detail never reaches the vertex shader. Colours are
 * handed in from the caller, which reads them off palette blocks, so this file
 * owns no art direction of its own — only geometry.
 *
 * Wind lives in the vertex shader, driven by a per-vertex `sway` weight (0 at
 * the root, 1 at the tip) and a per-clump phase, so a whole meadow ripples
 * rather than pulsing in lockstep.
 */

import * as THREE from 'three';
import { PLANET_UNIFORMS_GLSL, PLANET_BEND_GLSL, planetUniformValues } from '../render/planet.glsl';

const UP = [0, 1, 0];
const DETAIL_CHUNK = 48;

/**
 * Face brightness ramp for the sub-voxel boxes. Deliberately identical in
 * spirit to the one in the voxel fragment shader — pebbles and flower heads
 * must sit in the same light as the blocks around them.
 */
const FACE_SHADE = { top: 1.0, side: 0.88, sideZ: 0.82, bottom: 0.7 };

export class DetailField {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  det: number[] = []; // (sway, phase)
  count = 0;
  _c = new THREE.Color();

  get empty() {
    return this.count === 0;
  }

  /** One quad. `sway` is applied to the last two corners (the "top" edge). */
  _quad(verts: any, n: any, colBot: any, colTop: any, sway: any, phase: any) {
    const cols = [colBot, colBot, colTop, colTop];
    const sw = [0, 0, sway, sway];
    for (let i = 0; i < 4; i++) {
      this.pos.push(verts[i][0], verts[i][1], verts[i][2]);
      this.nrm.push(n[0], n[1], n[2]);
      this.col.push(cols[i].r, cols[i].g, cols[i].b);
      this.det.push(sw[i], phase);
    }
    this.count += 4;
  }

  /**
   * A crossed pair of vertical blades — the workhorse. Normals point straight
   * up rather than out of the quad: blades lit like the ground they grow from
   * stay inside the high-key band instead of turning into dark slivers.
   */
  tuft(x: any, y: any, z: any, w: any, h: any, colBot: any, colTop: any, phase: any, leanX = 0, leanZ = 0, sway = 1) {
    const hw = w * 0.5;
    for (let k = 0; k < 2; k++) {
      const ax = k === 0 ? hw : 0;
      const az = k === 0 ? 0 : hw;
      const tx = x + leanX,
        tz = z + leanZ;
      this._quad(
        [
          [x - ax, y, z - az],
          [x + ax, y, z + az],
          [tx + ax * 0.62, y + h, tz + az * 0.62],
          [tx - ax * 0.62, y + h, tz - az * 0.62],
        ],
        UP,
        colBot,
        colTop,
        sway,
        phase,
      );
    }
  }

  /** A sub-voxel box: pebbles, flower heads, tiny fungus caps. */
  box(cx: any, y: any, cz: any, sx: any, sy: any, sz: any, color: any, sway = 0, phase = 0) {
    const x0 = cx - sx * 0.5,
      x1 = cx + sx * 0.5;
    const y0 = y,
      y1 = y + sy;
    const z0 = cz - sz * 0.5,
      z1 = cz + sz * 0.5;
    const shade = (m: number) => this._c.copy(color).multiplyScalar(m).clone();

    const top = shade(FACE_SHADE.top);
    const bot = shade(FACE_SHADE.bottom);
    const sx_ = shade(FACE_SHADE.side);
    const sz_ = shade(FACE_SHADE.sideZ);

    // +Y / -Y
    this._quad(
      [
        [x0, y1, z0],
        [x0, y1, z1],
        [x1, y1, z1],
        [x1, y1, z0],
      ],
      [0, 1, 0],
      top,
      top,
      sway,
      phase,
    );
    this._quad(
      [
        [x0, y0, z1],
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
      ],
      [0, -1, 0],
      bot,
      bot,
      0,
      phase,
    );
    // +X / -X  (top edge sways)
    this._quad(
      [
        [x1, y0, z0],
        [x1, y0, z1],
        [x1, y1, z1],
        [x1, y1, z0],
      ],
      [1, 0, 0],
      sx_,
      sx_,
      sway,
      phase,
    );
    this._quad(
      [
        [x0, y0, z1],
        [x0, y0, z0],
        [x0, y1, z0],
        [x0, y1, z1],
      ],
      [-1, 0, 0],
      sx_,
      sx_,
      sway,
      phase,
    );
    // +Z / -Z
    this._quad(
      [
        [x1, y0, z1],
        [x0, y0, z1],
        [x0, y1, z1],
        [x1, y1, z1],
      ],
      [0, 0, 1],
      sz_,
      sz_,
      sway,
      phase,
    );
    this._quad(
      [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y1, z0],
        [x0, y1, z0],
      ],
      [0, 0, -1],
      sz_,
      sz_,
      0,
      phase,
    );
  }

  /** Three arching frond blades — wider and lower than a grass tuft. */
  fern(x: number, y: number, z: number, colBot: any, colTop: any, phase: number, rng: any) {
    const angles = [0, Math.PI * 0.66, Math.PI * 1.33];
    for (const ang of angles) {
      const lean = 0.35 + rng.range(-0.1, 0.1);
      const lx = Math.cos(ang) * lean;
      const lz = Math.sin(ang) * lean;
      this.tuft(x, y, z, 0.25, 0.55, colBot, colTop, phase, lx, lz, 0.7);
    }
  }

  /** A petal lying flat on the ground, rotated in plan. */
  petal(x: any, y: any, z: any, s: any, rot: any, color: any) {
    const c = Math.cos(rot) * s * 0.5,
      sn = Math.sin(rot) * s * 0.5;
    this._quad(
      [
        [x - c + sn, y, z - sn - c],
        [x + c + sn, y, z + sn - c],
        [x + c - sn, y, z + sn + c],
        [x - c - sn, y, z - sn + c],
      ],
      UP,
      color,
      color,
      0,
      0,
    );
  }

  /**
   * Batch into independently cullable meshes. Returns a `world.decorations`
   * entry: an Object3D plus an `update(dt)` that advances the shared wind
   * clock.
   */
  build({ windAmp = 0.1, windSpeed = 1.0, name = 'veg-detail' } = {}) {
    const uniforms = {
      uTime: { value: 0 },
      uWindAmp: { value: windAmp },
      uWindSpeed: { value: windSpeed },
      uLodAlpha: { value: 1.0 },
      ...planetUniformValues(new THREE.Vector3()),
    };

    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      dithering: true,
      // No depth write: the toon-outline pass draws ink wherever it sees a
      // depth edge, and thousands of tufts writing depth covered every lawn
      // in scratchy marks. Tufts still depth-test against the terrain.
      depthWrite: false,
    });
    mat.userData.uniforms = uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      // Bayer 4×4 dither for LOD fade-in (same as terrain).
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          uniform float uLodAlpha;
        `,
        )
        .replace(
          'void main() {',
          /* glsl */ `
          void main() {
          {
            const float bayer[16] = float[16](
               0.0,  8.0,  2.0, 10.0,
              12.0,  4.0, 14.0,  6.0,
               3.0, 11.0,  1.0,  9.0,
              15.0,  7.0, 13.0,  5.0
            );
            int bx = int(gl_FragCoord.x) & 3;
            int by = int(gl_FragCoord.y) & 3;
            float threshold = (bayer[by * 4 + bx] + 0.5) / 16.0;
            if (uLodAlpha < threshold) discard;
          }
        `,
        );
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          attribute vec2 aDetail;
          uniform float uTime;
          uniform float uWindAmp;
          uniform float uWindSpeed;
          ${PLANET_UNIFORMS_GLSL}
          ${PLANET_BEND_GLSL}
        `,
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          #include <begin_vertex>
          {
            float sway  = aDetail.x;
            float phase = aDetail.y;
            float t = uTime * uWindSpeed;
            // Two octaves: a long travelling swell plus a faster flutter, so
            // the meadow breathes instead of vibrating.
            float w = sin(t * 0.85 + transformed.x * 0.13 + transformed.z * 0.09 + phase) * 0.72
                    + sin(t * 2.30 + transformed.x * 0.41 + phase * 1.7) * 0.28;
            float a = sway * sway * uWindAmp;
            transformed.x += w * a;
            transformed.z += w * a * 0.55;
            transformed.y -= abs(w) * a * 0.18;   // tips dip as they bend
            applyPlanetBend(transformed, objectNormal);
          }
        `,
        );
    };
    mat.customProgramCacheKey = () => 'VoxelWorld-vegdetail-v3';

    // Every primitive emitted by DetailField is an isolated four-vertex quad.
    // Count those quads by spatial cell first, then fill exact-size typed
    // arrays. No vertex or attribute is altered; only the draw ownership
    // changes, which makes this a quality-neutral frustum-culling boundary.
    const buckets = new Map();
    for (let vertex = 0; vertex < this.count; vertex += 4) {
      let x = 0,
        z = 0;
      for (let corner = 0; corner < 4; corner++) {
        const p = (vertex + corner) * 3;
        x += this.pos[p];
        z += this.pos[p + 2];
      }
      const ci = Math.floor((x * 0.25) / DETAIL_CHUNK);
      const ck = Math.floor((z * 0.25) / DETAIL_CHUNK);
      const key = `${ci},${ck}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { ci, ck, quads: [] };
        buckets.set(key, bucket);
      }
      bucket.quads.push(vertex);
    }

    const group = new THREE.Group();
    group.name = name;
    group.matrixAutoUpdate = false;

    for (const bucket of buckets.values()) {
      const vertexCount = bucket.quads.length * 4;
      const pos = new Float32Array(vertexCount * 3);
      const nrm = new Float32Array(vertexCount * 3);
      const col = new Float32Array(vertexCount * 3);
      const det = new Float32Array(vertexCount * 2);
      const idx =
        vertexCount <= 65535 ? new Uint16Array(bucket.quads.length * 6) : new Uint32Array(bucket.quads.length * 6);

      for (let q = 0; q < bucket.quads.length; q++) {
        const sourceVertex = bucket.quads[q];
        const targetVertex = q * 4;
        for (let corner = 0; corner < 4; corner++) {
          const source = sourceVertex + corner;
          const target = targetVertex + corner;
          for (let axis = 0; axis < 3; axis++) {
            pos[target * 3 + axis] = this.pos[source * 3 + axis];
            nrm[target * 3 + axis] = this.nrm[source * 3 + axis];
            col[target * 3 + axis] = this.col[source * 3 + axis];
          }
          det[target * 2] = this.det[source * 2];
          det[target * 2 + 1] = this.det[source * 2 + 1];
        }
        const i = q * 6;
        idx[i] = targetVertex;
        idx[i + 1] = targetVertex + 1;
        idx[i + 2] = targetVertex + 2;
        idx[i + 3] = targetVertex;
        idx[i + 4] = targetVertex + 2;
        idx[i + 5] = targetVertex + 3;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geometry.setAttribute('aDetail', new THREE.BufferAttribute(det, 2));
      geometry.setIndex(new THREE.BufferAttribute(idx, 1));
      geometry.computeBoundingSphere();
      // Keep wind-displaced tips inside the culling volume at screen edges.
      geometry.boundingSphere!.radius += windAmp * 2 + 0.25;

      const mesh = new THREE.Mesh(geometry, mat);
      mesh.name = `${name}-${bucket.ci}-${bucket.ck}`;
      // Blades are far too fine to cast anything but shadow-map noise, but
      // they receive cliff and canopy shadows or they float off the ground.
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      // Depth write is off (see material above), so the blades draw after the
      // terrain or its chunks would paint over them.
      mesh.renderOrder = 2;
      mesh.userData.lodAlpha = 1.0;
      mesh.userData.lodFading = false;
      group.add(mesh);
    }

    return {
      object3d: group,
      material: mat,
      planetUnis: uniforms,
      update(dt: number) {
        uniforms.uTime.value += dt;
        for (const mesh of group.children as THREE.Mesh[]) {
          if (!mesh.userData.lodFading) continue;
          mesh.userData.lodAlpha = Math.min(1.0, mesh.userData.lodAlpha + dt * 1.5);
        }
      },
    };
  }
}
