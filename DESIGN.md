# Voxel World — Design & Architecture

Developer reference. For user-facing documentation see [README.md](README.md).

---

## Source layout

| Path | Contents |
| --- | --- |
| `src/main.ts` | Entry point: scene setup, game loop (`frame()`), input wiring (keyboard, touch, drone/fly mode transitions), `window.__game` debug handle |
| `src/core/palette.ts` | Art bible — all colours, `BLOCK_BY_ID` array, `setVoxelPalette()`, `GRADE`/`SKY`/`LIGHT`/`WATER`/`FOG` constants |
| `src/core/voxel.ts` | `VoxelGrid` (dense `Uint8Array`), greedy mesher, chunk streamer, LOD fade, `CHUNK = 24`, `EDGE_LAYER` |
| `src/core/rng.ts` | Seeded PRNG, 2D/3D noise, FBM helpers used by terrain and vegetation |
| `src/world/terrain.ts` | Heightfield generator (contour-disc terracing, river carving, biome fields), river flow bake |
| `src/world/vegetation.ts` | `plantTree()`, `plantBush()` (4 silhouette forms), ferns, moss, lichen, grass |
| `src/world/water.ts` | `makeDepthMap()` (RG texture), `createWater()` (wave shader, Beer-Lambert absorption) |
| `src/world/props.ts` | Bridges, rocks, and other static props placed from terrain data |
| `src/render/renderer.ts` | Three.js WebGLRenderer setup, shadow map config per tier |
| `src/render/lighting.ts` | `Atmosphere` class: sun/hemi/fill lights, sky dome mesh, `skyUniformValues()` |
| `src/render/sky.ts` | Shared GLSL: `SKY_UNIFORMS_GLSL`, `SKY_FN_GLSL` (`skyRadiance`, `nightSkyAddons`, `_aurora`) |
| `src/render/day-night.ts` | `DayNight` class: keyframe palette animation, `getNightFactor()`, aurora and star uniforms |
| `src/render/postfx.ts` | `createPostFX()`: full post-processing chain — SceneDepth → EdgeMask → Atmosphere → Bloom → Crepuscular → Grade → SMAA |
| `src/render/planet.glsl.ts` | `PLANET_BEND_GLSL` vertex shader snippet, `updatePlanetUniforms()` |
| `src/render/fp-camera.ts` | `FPCamera`: pointer lock, key/mouse state, `drainDroneAltDelta()`, touch state (`_joyX/Y`, `touchAltAxis`) |
| `src/render/gpu-tier.ts` | `detectGpuTier()`, `TIER_SETTINGS` table |
| `src/player/controller.ts` | `Controller`: AABB physics, stepping, swimming, sprint |
| `src/player/drone.ts` | `createDroneMode()`: P-controller terrain-follow, landing state machine |
| `src/player/fly.ts` | `createFlyMode()`: free-flight with terrain floor |
| `src/player/character.ts` | Third-person character mesh and animation state |
| `src/player/dog.ts` | Dog AI: pathfinding to player, sit/stand commands |
| `src/player/pathfinding.ts` | A* grid pathfinder, path navigator |
| `src/ui/touch-controls.ts` | `createTouchControls()`: nippleJS joystick, swipe-to-look, button wiring |
| `src/ui/map.ts` | Minimap: `bakeTerrain()` reads `BLOCK_BY_ID`, `invalidateTerrain()` forces rebake |
| `src/ui/hud.ts`, `pause.ts`, `settings.ts`, `bubbles.ts` | HUD overlays and menus |
| `src/fx/particles.ts` | Billboarded particle system (leaves, dust) |

---

## Rendering pipeline

Post-processing runs on Three.js `EffectComposer` with a HalfFloat HDR target. The chain is:

```
SceneDepthPass → EdgeMaskPass → Atmosphere → Bloom → Crepuscular → Grade/Output → SMAA
```

Everything before Grade is linear HDR. Grade performs ACES tone mapping and the sRGB transfer itself (so Three's `OutputPass` is not used — combining them saves one full-resolution copy per frame).

### SceneDepthPass

Renders the scene into a dedicated `sceneFBO` that owns a `DepthTexture`. That FBO is **never** part of the composer's ping-pong swap chain, which prevents WebGL feedback loops where a pass reads and writes the same depth buffer. After rendering, colour is blitted to the composer's read buffer.

### EdgeMaskPass

Renders a separate edge-coverage mask to `edgeMask` (an `UnsignedByteType` render target, no depth). The edge material (`world.meshes.edgeMaterial`) uses `EDGE_LAYER = 2` so the regular scene camera never draws it — only the edge pass does. The resulting texture is sampled by GradeShader to composite ink strokes in display space.

### Atmosphere (`haze` ShaderPass)

One fullscreen pass; does six things off a single depth fetch:

1. **Large-scale AO** — 8-tap depth rosette at wide radius, lavender-tinted. Catches canopy overhangs and cliff bases that per-vertex baked AO misses. Tap count is tier-scaled (`uAOTaps`: 8 / 4 / 4 / 0).
2. **Cloud shadow** — world-space reconstruction of drifting cloud noise. Very low amplitude; keeps large flat shelves from going dead.
3. **Distance desaturation** — chroma drops faster than value (matches the reference images). `mix(col, vec3(lum), fog * uDesat)`.
4. **Aerial perspective** — nudges each pixel toward `skyRadiance(wdir)` by fog amount. This is what erases the horizon line: the colour geometry fades toward is the exact sky colour in that direction (same GLSL function, no seam).
5. **Ground mist** — second exponential medium with height falloff, integrated analytically along the view ray so it pools in valleys.
6. **Sun in-scatter and 4-tap defocus** — driven by the already-computed fog amount, so near-free. DoF disabled on `low` and `very-low` tiers.

### UnrealBloomPass

Runs after Atmosphere so haze luminance feeds the bloom — gives the far field a soft luminous edge. Threshold raised to 1.25 (linear) so only genuine emitters and specular hits bloom, not the pastel palette.

### CrepuscularShader

8-tap radial march from the sun's screen position. Active only when the sun is near the horizon (`uSunVisible > 0`). `main.ts` projects the sun direction to NDC each frame and updates `uSunScreen`/`uSunVisible`.

### GradeShader

Composites the edge mask over the bloom output (display-space ink — never added before tone mapping, so pale strokes can't become emitters). Then: ACES + sRGB, lift/gamma/gain, saturation, vignette, film grain, chromatic aberration, a "milk" mix (flat lilac lightens the darkest values), and a highlight rolloff knee.

### SMAAPass

Final pass; writes directly to the screen. `needsSwap = false` — without this the composer would alternate the scene between rt1 and rt2 each frame, causing the depth texture to detach every other frame and producing a visible full-frame flash.

---

## Sky model

`src/render/sky.ts` exports two GLSL string chunks — `SKY_UNIFORMS_GLSL` and `SKY_FN_GLSL` — plus `skyUniformValues()`.

**Why shared:** both the sky dome mesh (`lighting.ts`) and the aerial-perspective pass (`postfx.ts`) need to evaluate the same sky colour. If they used separately tuned gradients, the colour distant geometry fades toward would never match the sky behind it — a subtle but persistent seam at the horizon. Sharing a single `skyRadiance(dir)` function makes the match exact.

### `skyRadiance(dir)`

Builds the daytime sky: zenith-to-horizon gradient, sun glow (two lobes), limb wash and disc. At the end: `col = mix(col, col * 0.04, uNight * 0.96)` dims the day sky, then adds `nightSkyAddons(dir)`.

### `nightSkyAddons(dir)`

Adds moon disc + glow, then (when `clearNight > 0.01`): Milky Way with Great Rift dust lane (4-octave FBM, longitude/latitude projection onto galaxy plane), emission nebulae (filament noise), and procedural stars. Finally calls `_aurora(dir)`.

### `_aurora(dir)`

Animated curtain aurora. Gated by `uNight * uAurora * smoothstep(0.04, 0.10, dir.y)`.

Layers:
- **Curtain band** — lower edge shaped by multi-frequency azimuthal ripple (slow drift + medium wave + fast flutter via `uAuroraTime * 4.0`); upper edge fades with `1.0 - smoothstep(0.38, 0.82, dir.y)` (edge0 < edge1; the original code had these inverted — that caused NaN on most drivers).
- **Vertical rays** — slow structural noise (`t * 0.5`) plus a 4× faster shimmer layer; the two beating together cause rays to appear to ignite and die.
- **Sweep pulse** — `sin(az * 1.7 + t * 0.5) * sin(az * 0.8 - t * 0.28)` — a brightness wave that travels across the azimuth.
- **Breathing** — two incommensurate frequencies (`sin(t*0.45) * sin(t*0.29 + 1.9)`) produce an irregular beating throb.
- **Ghostly white flare** — `pow(rays * coverage, 2.5)` is mixed toward `vec3(0.80, 1.00, 0.88)` at intensity peaks.

All noise in `_aurora` uses direct `_noise3()` calls (no `_fbm3` loop). The FBM loop triggers ANGLE warning X3595 ("gradient instruction used in a loop with varying iteration") on Windows via the HLSL translator. Two inline octaves are sufficient for aurora structure.

**Uniforms driven by `day-night.ts`:**
- `uNight` — `getNightFactor()` result
- `uAurora` — `max(0, (nightF - 0.5) / 0.5)` (fades in over second half of night)
- `uAuroraTime` — accumulates `+= dt * 0.3` (independent of star rotation speed)
- `uStarAngle` — increments `+= dt * 0.0001` (star rotation; also used as slow time in `nightSkyAddons`)

---

## Day/night cycle

`src/render/day-night.ts` — `DayNight` class.

`timeOfDay` is a `0–1` float: 0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk. Advances as `+= dt / dayLengthSeconds` (default 1200 s = 20 min).

### Keyframe system

```ts
const TIMES = [0.0, 0.2, 0.27, 0.5, 0.73, 0.8, 1.0];
// indices:  [midnight, predawn, sunrise, noon, sunset, dusk, midnight]
```

`keyframe(t)` returns `{ i, a }` — the segment index and interpolation alpha. All palette arrays (`zenith`, `horizon`, `sunColor`, `sunIntensity`, etc.) are lerped with `lerpColor` / `lerpScalar` against that `{ i, a }` pair.

Sun direction is `(−cos(2πt), sin(2πt)×1.1 − 0.1, 0.3).normalize()` — slight downward bias keeps the sun below the horizon at midnight without requiring a separate night branch.

### `getNightFactor()`

```ts
const d = Math.abs(this.timeOfDay - 0.5) * 2;  // 0 at noon, 1 at midnight
return Math.max(0, (d - 0.3) / 0.7);
```

Returns 0 during daytime (±30% of the cycle around noon), ramping to 1 at midnight. Used to gate stars, aurora visibility, and `uNight` in the sky shader.

---

## GPU tiering

`src/render/gpu-tier.ts`

### Detection

```ts
const mobile = /Mobi|Android|iPad|iPhone|iPod/i.test(navigator.userAgent);
if (mobile && (cores <= 4 || mem <= 2)) return 'very-low';
if (cores <= 4 || mem <= 2)            return 'low';
if (mobile && cores >= 8 && mem >= 8)  return 'high';
if (!mobile && cores >= 8 && mem >= 6) return 'high';
return 'mid';
```

`deviceMemory` is not available in Firefox/Safari — defaults to 4 GB. iPad is explicitly matched (plain `/Mobi|Android/` missed it, routing iPads through the desktop path).

### Settings table

| Tier | DPR cap | Shadow (px) | Blur samples | Bloom | AO taps | DoF |
| --- | --- | --- | --- | --- | --- | --- |
| high | 2× | 3072 | 16 | ✓ | 8 | ✓ |
| mid | 1.25× | 2048 | 8 | ✓ | 4 | ✓ |
| low | 1× | 1024 | 4 | — | 4 | — |
| very-low | 1× | 512 | 2 | — | 0 | — |

On `very-low`, `renderer.shadowMap.autoUpdate = false`. `DayNight.update()` sets `renderer.shadowMap.needsUpdate = true` once per animation frame — correct cadence without re-rendering the shadow map multiple times per frame.

---

## Voxel world & chunking

### Grid

`VoxelGrid` is a dense `Uint8Array` of size `sx × sy × sz`. Block IDs are 8-bit; 0 = air. `height[x*sz + z]` caches the highest solid voxel per column for fast ground queries (used by drone terrain-follow, character physics, map bake).

### Greedy mesher

Runs per chunk in a worker. For each axis direction and each slice, merges adjacent faces of the same block type into quads. Block colours are read from `BLOCK_BY_ID` at mesh-build time and baked into vertex buffers — no texture lookups at runtime. Per-vertex AO (4 taps at each quad corner) is baked at the same time.

### Chunk streaming

`createWorldChunkStreamer()` in `voxel.ts`. Chunk size `CHUNK = 24`. Default stream radius 8 chunks (~192 blocks). Each frame, `streaming.update(playerPos, cameraPos)` enqueues new chunks within the radius and unloads those beyond `loadRadius + unloadPadding`.

### LOD fade

Freshly loaded chunks fade in over ~0.5 s via a `uLodAlpha` uniform and Bayer 4×4 ordered dither in the fragment shader. The update loop only iterates `fadingMeshes` (a `Set`) — O(fading), not O(all loaded chunks). Meshes remove themselves from the set when `lodAlpha` reaches 1.

---

## Terrain generation

`src/world/terrain.ts` — `generateTerrain(seed, size)`.

The heightfield is built as a stack of **contour discs**: each disc is a domain-warped circle (using FBM noise to make the boundary organic) worth exactly one terrace step (`WORLD.step = 3` blocks). Inside a disc the field is exactly constant — flatness is free, cliffs are the disc boundaries.

Post-processing passes:
1. **River carving** — after terracing, a river path is carved as a smooth channel (un-stepped) through the valley.
2. **Ledge pass** — splits the tallest cliffs with long horizontal shelves.
3. **Stair carving** — cuts walkable steps into cliff faces until the world is fully walk-connected.
4. **Biome field** — large-scale noise assigns surface material (meadow / rock / sand) as regions.

### River flow bake

At the end of `generateTerrain()`, `rivFlow` (`Uint8Array`, one byte per column) is computed from the river distance field (`rivD`) and half-width (`rivHalf`). It is packed into the **G channel** of the water depth map (R = signed depth). The water shader reads it as `rivProx` to multiply wave speed and add bank foam tint.

---

## Water shader

`src/world/water.ts`

### Depth map

`makeDepthMap(world)` bakes a `THREE.DataTexture` in `RGFormat`:
- **R** — signed water depth: `(WATER.level − (top+1) + DEPTH_RANGE) / (2 × DEPTH_RANGE)`, range ±34 world units. Signed rather than clamped so the shader has a real path length for Beer-Lambert integration, and the waterline dark edge is drawn at the zero-crossing (clamped fields have no gradient at the shore).
- **G** — river proximity 0–255 from `rivFlow`.

### Wave field

Surface normal is computed from the **analytic derivative** of a sum of sin waves (`waveField(uv, time)` returns `vec3(nx, 1, nz)`). All angular effects — sun glint, Fresnel, refraction offset — hang off this one normal so they all agree with the visible wave.

### Beer-Lambert absorption

```glsl
float depth = max(0.0, waterLevel - sceneY); // actual path length
vec3 absorb = exp(-depth * uExtinction);      // per-channel extinction
```

Red goes first (`uExtinction.r` highest), which is why deep water reads as blue-green. Path length grows as the camera lowers, so far water darkens and near shallows stay clear from the same surface — a lerp keyed on position cannot do this.

### River proximity

`rivProx` from the G channel drives two effects:
- Wave speed multiplier: `float riverSpeed = 1.0 + rivProx * 1.8`
- Bank foam: `smoothstep` band near the shore blended toward `vec3(0.90, 0.92, 0.96)`
- Subtle blue tint: `col * vec3(0.88, 0.95, 1.06) * rivProx * 0.28`

Water plane subdivision: 64×64 on `high`, 32×32 on all other tiers.

---

## Planet bend

`src/render/planet.glsl.ts`

The vertex shader snippet `PLANET_BEND_GLSL` is pasted into every material that needs curvature (voxel mesh, water, vegetation, particles):

```glsl
void applyPlanetBend(inout vec3 worldPos, inout vec3 worldNormal) {
  vec2  d2   = worldPos.xz - uPlayerXZ;
  float r2   = dot(d2, d2);
  float drop = r2 / (2.0 * uPlanetRadius);   // parabolic approximation to sphere
  worldPos.y -= drop;
  float r   = sqrt(r2);
  float ang = r / uPlanetRadius;
  if (r > 0.001) {
    vec2 axis = d2 / r;
    worldNormal.xz -= axis * ang * worldNormal.y;
    worldNormal = normalize(worldNormal);
  }
}
```

`uPlanetRadius` defaults to 350. Physics stay flat — only the vertex positions and normals are bent. Normal correction (`worldNormal.xz -= axis * ang * worldNormal.y`) keeps lighting consistent on the curved surface.

`updatePlanetUniforms(unis, pos)` pushes the player's (x, z) to every registered material's `uPlayerXZ`. It is called in `main.ts` only when the player moves more than 0.1 units:

```ts
if (Math.abs(bendOrigin.x - _lastPlanetX) + Math.abs(bendOrigin.z - _lastPlanetZ) > 0.1) {
  for (const unis of world.allPlanetUnis) updatePlanetUniforms(unis, bendOrigin);
}
```

`world.allPlanetUnis` collects terrain, water, and particle uniform objects so a single loop hits everything.

---

## Player systems

### Character controller

`Controller` in `src/player/controller.ts`. AABB physics: sub-steps at 1/60 s fixed tick, WASD wish vector projected onto the ground plane, jump impulse + gravity, step-up for 1-block ledges, swimming in water volume. `speed01` and `heading` are passed to the character mesh for animation.

### Drone mode

`createDroneMode(grid)` in `src/player/drone.ts`.

State machine: `idle → rising → cruising`. On `enter()`, state becomes `rising` and the drone lifts to `hoverAltitude` (default 12 blocks above ground, or current height if already higher).

**Terrain-follow (cruising):**

```ts
smoothedTargetY += (rawTargetY - smoothedTargetY) * Math.min(1, dt * heightSmoothRate);
const error = smoothedTargetY - camera.position.y;
const vertV = clamp(error * heightPGain, -vertVelMax, vertVelMax);
camera.position.y += vertV * dt;
```

- `heightSmoothRate = 3.5` — lerp rate for the ground-height target. Lower values cause the drone to lag behind steep terrain.
- `heightPGain = 4.0` — proportional gain.
- `vertVelMax = 14.0 m/s` — enough for steep slopes at cruise speed.

`altitudeDelta` from `drainDroneAltDelta(dt)` adjusts `hoverAltitude` each frame. Landing: `hoverAltitude` decreases at `landingDescentRate = 45 m/s` until the camera is within `landingCompleteHeight = 2.5` blocks of the ground.

Touch joystick Y: negative values brake `speedMult = max(0, 1 + joyY)`; positive or zero = full cruise speed.

### Fly mode

`createFlyMode(grid)` in `src/player/fly.ts`. Free movement in any direction; terrain acts as a floor. `drainDroneAltDelta(dt)` returns a **rate in m/s** — caller applies `* dt` once. (A previous bug had fly mode apply `altDelta` without `* dt`, causing ~720 m/s altitude change per second.)

---

## Touch controls

`src/ui/touch-controls.ts` — only instantiated when `isTouchDevice` is true.

**Detection:** `('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.matchMedia('(pointer: coarse)').matches`. The `pointer: coarse` media query is the reliable discriminator — Windows laptops report `maxTouchPoints > 0` even without a touchscreen, but they use a fine (mouse) pointer.

**Joystick:** nippleJS dynamic joystick in a `#joy-zone` div covering the left half. On `move`, calls `fpCam.setTouchMove(v.x, v.y)` which sets `_joyX`, `_joyY` and converts to a `_touchWish` world-space vector. On `end`, zeros both.

**Swipe-to-look:** raw `touchstart`/`touchmove` on the right half (clientX ≥ innerWidth/2). Calls `fpCam.applyTouchLook(dyaw, dpitch)`.

**Button events** use the `held()` helper for Space/C (altitude) and Shift (sprint), and `touchend` listeners for tap-only actions (fly, drone, land, edges, time step).

**`touchActive = true`** bypasses the `isLocked` check in `canAct()` and `getWish()`, so touch devices never need pointer lock.

### `drainDroneAltDelta(dt)` design

```ts
drainDroneAltDelta(dt = 0): number {
  const keyAxis = (this._keys.has('Space') ? 1 : 0) - (this._keys.has('KeyC') ? 1 : 0);
  const scrollRate = dt > 0 ? this._droneAltDelta / dt : 0;
  this._droneAltDelta = 0;
  return scrollRate + (keyAxis + this.touchAltAxis) * 12;
}
```

Returns **m/s rate** (not a delta). The drone/fly caller does `hoverAltitude += result * dt`. Scroll wheel accumulates a raw position delta (`_droneAltDelta -= e.deltaY * 0.02`); dividing by `dt` converts it back to a rate so `rate * dt` restores the original per-frame offset. Mouse Y movement is intentionally **not** wired to altitude — any upward mouse drift would cause continuous climb.

---

## Palette system

`src/core/palette.ts`

`BLOCK_BY_ID` is a runtime array populated once at module load from the `BLOCKS` object. Each entry has `{ id, top: THREE.Color, side: THREE.Color, bottom: THREE.Color, pattern, fringe, rough, ... }`.

Block colours are baked into vertex buffers at mesh-build time by the greedy mesher, which reads `BLOCK_BY_ID[id].top` etc. at that moment.

**Palette switching** (`setVoxelPalette(name)`): mutates `BLOCK_BY_ID` entries in place. After calling it, the existing mesh buffers are stale — `world.streaming.invalidateAll()` triggers a remesh of all loaded chunks, and `map.invalidateTerrain()` forces the minimap to rebake on next draw.

Water uniforms are cloned into the water `ShaderMaterial` at creation time, so `pause.ts` explicitly pushes updated palette colours to `water.planetUnis` after a palette change:

```ts
wu.uShoal.value.copy(WATER.shoal);
wu.uShallow.value.copy(WATER.shallow);
wu.uDeep.value.copy(WATER.deep);
```
