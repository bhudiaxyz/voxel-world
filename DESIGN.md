# Voxel World — Design & Architecture

Developer reference: how the code is organised, the approach each subsystem takes, and why. For user-facing documentation see [README.md](README.md).

**Suggested reading order:** [Runtime architecture](#runtime-architecture) → [Procedural generation pipeline](#procedural-generation-pipeline) → [Voxel grid, meshing & streaming](#voxel-grid-meshing--streaming) → [Rendering pipeline](#rendering-pipeline) → [GPU tiering & performance](#gpu-tiering--performance). The remaining sections are per-subsystem reference.

---

## Contents

- [Stack & build](#stack--build)
- [Source layout](#source-layout)
- [Runtime architecture](#runtime-architecture)
- [Coordinate system & world constants](#coordinate-system--world-constants)
- [Determinism & seeding](#determinism--seeding)
- [Procedural generation pipeline](#procedural-generation-pipeline)
- [Voxel grid, meshing & streaming](#voxel-grid-meshing--streaming)
- [Rendering pipeline](#rendering-pipeline)
- [Ink edges](#ink-edges)
- [Materials & shader injection](#materials--shader-injection)
- [Weather & atmosphere](#weather--atmosphere) · [Sky model](#sky-model) · [Day/night cycle](#daynight-cycle) · [Water](#water) · [Planet bend](#planet-bend)
- [GPU tiering & performance](#gpu-tiering--performance)
- [Input & controls](#input--controls)
- [Player systems](#player-systems) · [Navigation & the dog](#navigation--the-dog)
- [Vegetation](#vegetation) · [Scene stamps](#scene-stamps) · [River system (detail)](#river-system-detail)
- [UI](#ui) · [Palette system](#palette-system) · [Boot screen](#boot-screen)
- [Debugging & diagnostics](#debugging--diagnostics)
- [Conventions & gotchas](#conventions--gotchas)

---

## Stack & build

| Piece      | Notes                                                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| Three.js   | `^0.185` — **WebGL2 only** (WebGL1 support was removed in r163). `WebGLRenderer` + `three/examples/jsm` postprocessing |
| TypeScript | `^5.9`; `tsc --noEmit` type-checks, Vite transpiles                                                                    |
| Vite       | `^8`; `npm run dev` serves on port 5180, `npm run build` = typecheck + bundle to `dist/`                               |
| nipplejs   | `^1.0`; virtual joystick on touch devices                                                                              |
| Prettier   | 4-space indent, 120 columns, single quotes (`.prettierrc`); `package-lock.json` is ignored (`.prettierignore`)         |

There is no test framework; changes are verified by running the app (see [Debugging & diagnostics](#debugging--diagnostics)). Much of the code is loosely typed (`any`) because it was ported from JavaScript — tighten types in a module when you work on it rather than in bulk.

The chunk mesher runs in a module worker (`new Worker(new URL('./voxel-worker.ts', import.meta.url), { type: 'module' })`), which Vite emits as a separate bundle.

---

## Source layout

```text
src/
├── main.ts                  ← entry: startup sequence, frame loop, shared input actions, window.__game debug handle
├── styles.css               ← boot screen + base page styles
├── global.d.ts              ← ambient `declare module '*.js'` for untyped imports
│
├── core/
│   ├── palette.ts           ← art bible: block registry (BLOCKS, BLOCK_BY_ID, registerBlock), VOXEL_PALETTES, setVoxelPalette(), SKY/LIGHT/WATER/GRADE/FOG
│   ├── voxel.ts             ← VoxelGrid, face mesher, edge-graph builder, voxel/glow/edge materials, chunk streamer
│   ├── voxel-worker.ts      ← worker entry: receives chunk windows, returns transferable geometry
│   └── rng.ts               ← seed words, mulberry32 PRNG, hash2/hash3, 2D/3D value noise, fbm2, ridge2, clamp/smoothstep
│
├── world/
│   ├── world.ts             ← buildWorld(): runs the generators in order, preloads spawn chunks, assembles the World object
│   ├── planner.ts           ← planWorld(): continents, stepping stones, regions, biomes, elevation field, rivers, lakes, scenic sites
│   ├── terrain.ts           ← generateTerrain(): contour composition, river/lake carving, banks, stairs, voxel fill; WORLD, wrapAxis()
│   ├── terrain-shape.ts     ← heightfield operators: modeFilter, despeckle, carveStairs, riseAbove, dropBelow
│   ├── props.ts             ← buildStructures(): bridges along plan.bridgeChains
│   ├── stamps.ts            ← buildStamps(): scenic grammars + landmark grammars
│   ├── vegetation.ts        ← scatterVegetation(): trees (14 forms), bushes, scrub; buildGroundDetail()
│   ├── veg-detail.ts        ← DetailField: sub-voxel quads (tufts, blades, flowers, petals, boxes), batched + distance-culled
│   └── water.ts             ← makeDepthMap(), createWater(): wave field, Beer-Lambert absorption, caustics
│
├── render/
│   ├── renderer.ts          ← WebGLRenderer setup, DPR cap × adaptive scale, shadow type & cadence, float-RT capability flag
│   ├── gpu-tier.ts          ← detectGpuTier(), hasWebGL2(), TIER_SETTINGS
│   ├── lighting.ts          ← Atmosphere: fog (+ near-plane patch), sky dome, sun with VSM shadows, hemi, fill, ambient
│   ├── sky.ts               ← shared GLSL: skyRadiance(), nightSkyAddons(), _aurora()
│   ├── day-night.ts         ← DayNight: keyframed sun/sky/light, voxel tint uniforms
│   ├── postfx.ts            ← createPostFX(): SceneDepth → EdgeMask → Atmosphere → Bloom → Crepuscular → Grade → AA
│   ├── planet.ts            ← PLANET_BEND_GLSL, planetUniformValues(), updatePlanetUniforms()
│   ├── weather.ts           ← Weather: clear/rain/snow fronts, ground wetness & snow cover
│   ├── fp-camera.ts         ← FPCamera: pointer lock, key state, mouse/touch look, wish vector, altitude axis
│   └── camera.ts            ← CameraRig — legacy third-person rig, not currently imported
│
├── player/
│   ├── controller.ts        ← Controller (AABB physics, swimming, step-up) + Input (keys, zoom, `paused`)
│   ├── character.ts         ← procedural voxel traveller + animation (hidden from the first-person camera via layer 1)
│   ├── drone.ts             ← createDroneMode(): rise → cruise → land state machine, terrain-follow
│   ├── fly.ts               ← createFlyMode(): free flight with a smoothed terrain floor
│   ├── pathfinding.ts       ← NavigationSurface + time-sliced A*; click-to-move navigator
│   └── dog.ts               ← companion dog: rest/wander/follow, hopping, solved sit pose
│
├── ui/
│   ├── touch-controls.ts    ← isTouchDevice, nippleJS joystick, swipe-to-look, touch buttons
│   ├── hud.ts               ← place name, shortcut hints, time/drone chips, ⚙ button
│   ├── map.ts               ← full-screen map: baked terrain, rivers, landmarks, player arrow
│   ├── pause.ts             ← pause menu + bindings list (keyboard or touch variant)
│   ├── settings.ts          ← settings panel, localStorage persistence, per-tier defaults
│   └── bubbles.ts           ← world-anchored speech bubbles (dog commands)
│
└── fx/
    └── particles.ts         ← GPU-animated instanced particles: petals, motes, pollen
```

---

## Runtime architecture

### Threads

| Thread      | Work                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------- |
| Main        | World generation (once, at startup), physics, AI, rendering — and chunk meshing if the worker fails |
| Mesh worker | Chunk meshing during play; one worker, one chunk in flight                                          |

World generation is **synchronous on the main thread**. `buildWorld()` awaits `setTimeout(0)` between stages so the loading bar repaints, but each stage blocks. For a 768² world it takes a few seconds on desktop and is the main startup cost. Moving it into a worker would mean transferring the grid and plan back; that hasn't been needed so far.

### Startup sequence (`start()` in `main.ts`)

1. `hasWebGL2()` — if false, throw a readable error, which the boot screen displays.
2. `detectGpuTier()` → `tier`; `ts = TIER_SETTINGS[tier]`.
3. `createRenderer(container, tier)`. `setTierDefaults()` seeds the settings panel defaults from the tier. A `webglcontextlost` listener reloads the page — same seed, same world.
4. `buildWorld(SEED, setProgress, ts.streamRadius, { density, distance })` — the generation pipeline plus the spawn-chunk preload.
5. Construct, in order: `FPCamera`, `Atmosphere`, `DayNight`, water, particles, character, `Controller`, drone/fly modes, `Input`, navigator, map, bubbles, dog, touch controls, post-FX, settings, HUD, pause.
6. Wire the shared actions (`cycleMode`, `land`, `toggleEdges`, `stepTime`) to keyboard and touch.
7. Call `scene.updateMatrixWorld(true)` once, then set `scene.matrixWorldAutoUpdate = false` (see [Conventions](#conventions--gotchas)).
8. Start `frame()`. The first frame marks the boot screen `.ready`; a click or tap dismisses it and, on desktop, requests pointer lock.

### Frame loop (`frame()` in `main.ts`)

Order matters, because later steps read state written by earlier ones:

```text
clock.update(); dt = min(rawDt, 1/20)             ← clamp so one long frame cannot tunnel the physics
wish = fpCam.getWish()                             ← keyboard or touch, world space, Y = 0
navigator.update(dt, wish, …)                      ← click-to-move may overwrite `wish`
controller.update(h, wish, …) × N                  ← fixed 1/60 s sub-steps
character.update / dog.update                      ← each calls updateMatrixWorld() itself
fly.update | drone.update | fpCam.update           ← exactly one of these owns the camera
world.streaming.update(player, camera, dt)         ← chunk load/unload queues
atmo.followTarget()  (only while moving)           ← shadow frustum follows the player
dayNight.update(dt)                                ← sun, sky, fog colour, voxel tints
wind uniforms; sun → screen position for rays
atmo / water / particles / decorations / bubbles / touch / map / hud / settings updates
planet-bend uniforms  (only after moving > 0.1)
wrap flash  (camera jumped > 50 units this frame)
shadow cadence: needsUpdate every ts.shadowInterval frames
post.render(dt)                                    ← the whole composer chain
adaptive-resolution governor (2 s window)
```

### The `World` object

`buildWorld()` returns everything downstream systems share:

- **Voxel data:** `grid` (`VoxelGrid`), `heights` (Int16 column tops), `size`, `wetness`.
- **Generation outputs:** `plan`, `spawn`, `props` (bridges), `stamps`, `trees`.
- **Scene objects:**
    - `group` — the scene root.
    - `meshes` — the `solid`, `glow` and `edges` groups and their materials.
    - `streaming` — the chunk streamer.
    - `decorations` — non-voxel Object3Ds such as the ground detail.
    - `animated` — the decorations that have an `update(dt, camera)`.
    - `allPlanetUnis` — every material's planet-bend uniforms.

---

## Coordinate system & world constants

Three.js axes throughout: **Y is up**, +X east, +Z south. One voxel is one world unit (a "block", roughly 1 m). Nothing remaps axes anywhere.

| Constant                | Value       | Defined in         | Meaning                                                                                         |
| ----------------------- | ----------- | ------------------ | ----------------------------------------------------------------------------------------------- |
| `WORLD.size`            | 768         | `world/terrain.ts` | World XZ extent in voxels (square, wraps toroidally)                                            |
| `WORLD.height`          | 96          | `world/terrain.ts` | Grid height in voxels                                                                           |
| `WORLD.step`            | 2           | `world/terrain.ts` | One terrace (one contour disc) in blocks                                                        |
| `WORLD.edgeGrid`        | 2           | `world/terrain.ts` | Lattice the contour field is sampled on; forces straight terrace edges                          |
| `WATER.level`           | 24.35       | `core/palette.ts`  | Water plane Y; fractional so the plane sits just above the top shore face                       |
| `SEA`                   | 24          | —                  | `Math.floor(WATER.level)`; the integer sea level for voxel comparisons                          |
| `CHUNK`                 | 16          | `core/voxel.ts`    | Chunk edge in voxels; a chunk is a full-height 16×96×16 column                                  |
| `REGION_SPACING`        | 30          | `world/planner.ts` | Poisson-disc spacing of planner regions, in blocks                                              |
| `CELL`                  | 8           | `world/planner.ts` | Planner raster resolution (one cell per 8×8 blocks)                                             |
| `K`                     | 256 / 192   | `world/terrain.ts` | Feature-length scale. Lengths were authored on a 192-block world and frozen at the 256 tuning   |
| `AREA`                  | (size/256)² | `world/terrain.ts` | Feature **counts** scale with this, so a bigger world has more features rather than bigger ones |
| `PLANET_RADIUS_DEFAULT` | 350         | `render/planet.ts` | Visual curvature radius (settings slider: 100–1000)                                             |

- **Voxel addressing:** `VoxelGrid.data` is a dense `Uint8Array` indexed `(y * sz + z) * sx + x`. X varies fastest, then Z, then Y, so each horizontal slab is contiguous. The column-top cache `height` is an `Int16Array` indexed `z * sx + x`, holding `-1` for empty columns. `set()` keeps it up to date incrementally.
- **Block IDs:** 8-bit, with `0` meaning air. `BLOCK_BY_ID[id]` holds the block's colours, pattern and flags (`isWater`, `emissive`, `sway`, `grassCap`, `lightEdge`, `fringe`). `isSolid()` returns `id !== 0 && !isWater`, so river-water voxels are meshed but you can walk and swim through them.
- **Toroidal wrap:** the world repeats at its edges. `wrapAxis(v)` (terrain.ts) wraps a coordinate into `[0, WORLD.size)`, and the controller, drone and fly modes apply it to their positions. The chunk streamer measures chunk distance from the player **and** from four ghost positions offset by ±size, so chunks across the seam are already loaded when the wrap happens. `main.ts` spots the jump (over 50 units in one frame) and plays a short aberration/vignette "warp flash".
- **Noise space:** noise is sampled at raw world coordinates multiplied by a frequency, e.g. `fbm2(n, x * 0.011, z * 0.011, 4)`. So feature size can be read off the call site: a frequency of 0.011 gives features about 90 blocks across.

---

## Determinism & seeding

The same seed word must produce the same world on every device and at every tier.

- **Seed word → number:** `hashSeedWord(word)` is a 31-multiplier string hash, `abs % 100000`. `genSeedWord()` builds a pronounceable word from consonant and vowel pools.
- **URL:** `?seed=<word>` overrides the default. `pushSeedUrl()` always writes the active seed back with `history.replaceState`, so it doesn't clutter the back button. "Generate new world" sets a new word and reloads.
- **PRNG:** `makeRng(seed)` is mulberry32, with helpers `range`, `int`, `pick`, `chance` and `bell` (the sum of three uniforms, roughly Gaussian on [-1, 1]).
- **Noise:** `makeNoise2D` / `makeNoise3D(seed)` give value noise on an integer lattice with a quintic fade (`6t⁵ − 15t⁴ + 10t³`). Corner values come from integer `hash2` / `hash3` (murmur-style finaliser), and output is in [-1, 1]. `fbm2(noise, x, z, octaves, lacunarity = 2, gain = 0.5)` sums octaves, and `ridge2` gives ridged noise.
- **Independent streams:** each generator derives its own seed (`seed ^ 0x5f3a`, `seed + 41`, per-region `seed ^ id * 0x85ebca6b`, and so on) rather than sharing one sequence.
    - **Rule:** anything optional or tier-dependent must draw from its own RNG stream.
    - Example: the tier-scaled meadow-sprite layer in `buildGroundDetail()` uses `makeRng(0x9e37 ^ S)`. If it drew from the shared `rng`, a phone and a desktop would place mushrooms, pebbles and everything generated after them differently.

---

## Procedural generation pipeline

`buildWorld()` in `world/world.ts` runs these synchronous stages, with a paint yield between each:

```text
planWorld(seed, size)                   → plan: continents, regions, biomes, elevation, rivers, lakes, scenic sites, landmarks
generateTerrain(seed, plan)             → grid, heights, wetness, river fields (writes voxels)
buildStructures(world)                  → bridges written into the grid
buildStamps(world)                      → scenic scenes + landmarks (reserve their footprints)
scatterVegetation(world)                → trees/bushes into the grid + the ground-detail decoration
findSpawn(world)                        → on the first bridge deck, else a spiral search for grass/path/sand
createWorldChunkStreamer + preload(3)   → spawn chunks meshed on the main thread before the veil lifts
```

**The plan is the contract.** Terrain, props, stamps, vegetation and the map all read `plan` instead of re-deriving where islands, rivers or biomes are. The stage order is deliberate:

- props run before stamps, so a scene can keep clear of a bridge
- stamps run before vegetation, so the scatter respects the clearings a scene reserves

### Planner (`world/planner.ts`)

The planner is pure: it writes no voxels, and works on a coarse raster (`CELL = 8` blocks).

1. **Continents:** 4–8 centres placed by _stratified_ sampling.
    - The map is split into a near-square grid of cells, and each continent gets one randomly chosen cell, jittered within its inner 60%. This gives even coverage without clumping.
    - Radius is `size × CONTINENT_RADIUS_FRAC` (0.18).
    - Each continent gets a climate tag (tropical, temperate, arid or tundra). With four or more continents, all four tags are guaranteed to appear.
2. **Stepping stones:**
    - For every pair of continents, 1–2 islands are placed along the connecting line, jittered sideways. The waypoints form `bridgeChains: [mainA, …stones, mainB]`.
    - Then 2–4 small **nearshore islands** are placed just outside every parent island's rim.
3. **`nearIsland(x, z)`:** distance to the nearest landmass. Each small island's radius is normalised to the continent radius, so terrain can use a single rim threshold for all of them.
4. **Regions:** centres from a Poisson-disc scatter (bucketed dart throwing, 30-block spacing). Region count therefore grows with world area, and a region stays the same size on screen.
5. **Macro fields:** sampled once per region, at its centre:
    - `elevation` comes from `nearIsland` plus FBM, so each island is a massif ringed by shore.
    - `temperature`, `moisture` and `magic` are FBM at fixed feature sizes (210–320 blocks), so biomes form whole provinces instead of a salt-and-pepper mix.
6. **Biome rule**, applied in this order: `elevation < 0.15` → SHORE; `> 0.82` → HIGHLAND; `moisture > 0.55 && magic > 0.44` → SAKURA; `moisture > 0.62` → WETLAND; otherwise MEADOW.
7. **Cell map:** each cell takes its nearest region, but the lookup point is domain-warped first, so the Voronoi borders look organic. The warp grows near island rims. Region adjacency is read off the cell map.
8. **Elevation field:** per cell, a blend of nearby region elevations weighted by `1/d⁴`. Biomes are hard-edged but relief stays continuous. `elevationAt()` samples the field bilinearly.
9. **Rivers & lakes (planned):**
    - Lakes go on low-lying inland regions.
    - Rivers are traced by **steepest descent with inertia**: each step samples a forward cone, takes the lowest point, then _blends_ that direction with the current heading. Pure descent zig-zags; the blend makes the river commit, overshoot and swing back, which is what produces the meander.
    - Trunks (order 0) start from the highest regions. Tributaries (1) and streams (2) join the nearest existing channel.
    - There's no depression filling: the field is smooth enough that inertia carries a river out of shallow basins.
10. **Scenic sites & landmarks:** scored candidate locations, handed to `stamps.ts`.

Spatial queries go through a bucket grid over the region centres (`nearby()`), so every pass stays linear in world area instead of quadratic.

### Terrain (`world/terrain.ts`)

**Approach: composed, not simulated.** The height field is a stack of hard-edged **contour discs**, each worth exactly one terrace step. Inside a disc the field is exactly constant, so flat ground comes for free. The only gradients are disc edges, and each becomes one clean cliff.

1. **Disc composition:**
    - **Crowns:** sets of shrinking discs with drifting centres, placed on the highest planned regions. There are `max(2, round(2·AREA))` of them.
    - **Knolls and dells:** single-step discs on a jittered grid (`GX = round(S/38)` per side), about a third of them negative.
    - **Sunken glades:** `round(3·AREA)` of them.
    - Every disc is domain-warped (an `fbm2` offset is added to the distance), so outlines are lobes rather than circles.
2. **Contour field:**
    - Evaluated per `edgeGrid` cell, not per column: `sum = (elevationAt − 0.34) × MACRO_RELIEF (12) + Σ discs + fine FBM`, and level = `BASE + step × round(sum)`.
    - Sampling on the 2-block lattice makes the field piecewise constant. That forces terrace edges into straight runs and right angles, which gives the built, masonry look.
    - Discs are bucketed by bounding box (32-block buckets), so each cell only tests nearby discs.
    - Per-cell evaluation gives exactly the same result as per-column and is about 36× cheaper. It's what makes a large world affordable.
3. **Island mask:** beyond `rimR = islandRadius + FBM` is seabed. Heights within `20·K` and `9·K` of the rim are capped low, so every island ends in a readable plinth wall.
4. **Clean-up:** `modeFilter` and `despeckle` remove slivers and one-column jitter. A **ledge pass** then adds a shelf to very tall cliffs (3 steps or more), followed by another despeckle.
5. **Rivers & lakes:**
    - Channel polylines are smoothed, resampled to one point per block, and stamped into distance fields (`rivD`, `rivHalf`, `rivFord`, `rivSide`).
    - Width tapers downstream, widens on tight bends (curvature is measured from the path), and narrows at one ford per trunk.
    - Carving runs _after_ terracing, so gorge walls keep their terrace levels; see [River system (detail)](#river-system-detail).
6. **Banks, beaches, stairs:** walkability passes. `carveStairs` cuts steps into cliffs until the land is walk-connected.
7. **Voxel fill:**
    - Columns get their surface material from the biome, and river-water voxels are added above sea level.
    - Boulders go on a jittered grid.
    - `decorateCliffs` adds outcrops and cave mouths below column tops, so walkability never changes.
    - `addCascades` adds waterfalls where a dry ravine meets a wet reach.

All absolute lengths are authored in blocks × `K`, and feature counts scale with `AREA`. Raising `WORLD.size` therefore adds places rather than stretching the existing ones.

### Startup progress sequence

`buildWorld` drives the loading bar through `onProgress(fraction, label)`. `generateTerrain` gets a sub-callback mapped into the 0.06–0.24 range.

| Progress    | Label                        | Source                                             |
| ----------- | ---------------------------- | -------------------------------------------------- |
| 0.02        | drawing the map              | `planWorld`                                        |
| 0.06        | sculpting the terrain        | `generateTerrain` — contour composition            |
| 0.14        | carving the rivers           | `generateTerrain` — river fields + carving         |
| 0.19        | shaping the banks            | `generateTerrain` — walkability, stairs, boulders  |
| 0.21        | filling the voxels           | `generateTerrain` — voxel fill                     |
| 0.26        | building the crossings       | `buildStructures`                                  |
| 0.34        | placing scenes and landmarks | `buildStamps`                                      |
| 0.40        | growing the forests          | `scatterVegetation` (trees, bushes, ground detail) |
| 0.50        | finding the path             | `findSpawn`                                        |
| 0.54 → 0.96 | meshing the world            | spawn-chunk preload (per-chunk sub-progress)       |
| 1.0         | ready                        | boot screen becomes dismissable                    |

---

## Voxel grid, meshing & streaming

### Face mesher (`meshRegion` in `voxel.ts`)

This is a **per-face culling mesher, not a greedy one.** For each solid voxel, every face whose neighbour isn't solid emits one quad. Greedy merging is left out on purpose: per-vertex AO, world-space pattern UVs, grass-fringe height and the edge graph all need per-block corners, and the packed vertex format below keeps the extra quads cheap.

For each face:

- **Colour:** `top`, `side` or `bottom` from the block, plus `tint` (the pattern's secondary colour) and `fringeColor` (grass spilling over the edge).
- **AO:** for each corner, the mesher checks the two in-plane neighbours and the diagonal, in the layer of air in front of the face: `ao = (s1 && s2) ? 0 : (3 − s1 − s2 − corner) / 3`. The quad's triangle split flips when `ao0 + ao2 > ao1 + ao3`, so the AO gradient never creases along the wrong diagonal.
- **UVs:** world-space in-plane coordinates, so patterns tile seamlessly across neighbouring blocks.
- **`aData`:** `(ao, pattern | sway << 3, fringe, localV)`, where `localV` is the height within the block, used for the grass fringe.
- **Edge masks:** which of the face's four borders are real convex or concave cube edges (see [Ink edges](#ink-edges)).

Emissive blocks go into a separate `glow` buffer, drawn with an unlit `MeshBasicMaterial` so they feed the bloom.

**Vertex packing** (`MeshBuffer.toGeometry()`): position `Int16`; normal `Int8`, normalized; colour, tint and fringe `Uint8`, normalized; `aUv` `Int16`; `aData` `Float32`. Indices are `Uint16` when a chunk has at most 65,535 vertices. That's roughly a quarter of the size of an all-float layout, and normalized integer attributes need no shader changes.

### Chunk streamer (`createWorldChunkStreamer`)

- **Unit:** a 16×16 full-height column, meshed into up to three objects: `terrain-ci-ck` (solid), `glow-ci-ck` and `voxel-edges-ci-ck`.
- **Desired set:**
    - Recomputed only when the player's or the camera's _chunk_ changes (`viewKey`).
    - Distance is measured to the player→camera _segment_, so a drone looking far ahead also loads along its line of view. When wrapping is on, it's measured from five positions: the player plus the four ±size ghosts.
    - Chunks load within `loadRadius × 16` and unload beyond `(loadRadius + 1) × 16`. The load queue is sorted nearest first.
- **Worker path:**
    - `makeChunkWindow()` copies the chunk plus a 2-block margin out of the grid into a transferable `Uint8Array` and posts it.
    - The worker meshes it (`buildChunkTransferPayload`) and posts the typed arrays back as transferables, so neither direction copies.
    - One chunk is in flight at a time.
    - The block registry is sent to the worker at start and again on `invalidateAll()` (palette change).
- **Fallback path:**
    - If `Worker` is unavailable or errors, meshing runs on the main thread in `requestIdleCallback` (or `setTimeout`) slices of 6 Y-layers.
    - Each idle callback runs up to 4 slices, and a timed-out callback still runs at least one, so a busy GPU can't starve streaming.
- **Unloads** are drained from the frame loop (4 per frame) _and_ from idle callbacks (3 each). The caps stop a chunk-boundary crossing from turning into a garbage-collection spike.
- **Preload:** before the boot screen lifts, chunks within radius 3 of spawn are meshed synchronously on the main thread.
- **No fade-in:** chunks appear at full opacity, and distance fog hides the pop at the edge of the stream radius.
    - An earlier dithered fade was removed.
    - A shared material only re-uploads uniforms when the bound material changes, so the per-mesh fade value never reached most chunks.
    - Meanwhile, the `discard` the fade needed switched off early-Z and mobile hidden-surface removal for all terrain.

`setLoadRadius(r)` (from the settings panel) forces a re-queue. `invalidateAll()` unloads everything and remeshes it with the current block registry.

---

## Rendering pipeline

`createPostFX()` in `render/postfx.ts` builds a Three.js `EffectComposer` over a HalfFloat HDR target, falling back to UnsignedByte when float render targets aren't supported. MSAA is off (`antialias: false`, `samples: 0`); anti-aliasing is done as a post pass instead.

```text
SceneDepthPass → [EdgeMaskPass] → Atmosphere → [Bloom] → [Crepuscular] → Grade → [SMAA | FXAA]
```

Bracketed passes depend on the tier or on current state. Everything before Grade is linear HDR. Grade does ACES tone mapping and the sRGB transfer itself, so Three's `OutputPass` isn't used — that saves one full-screen copy.

### SceneDepthPass

Renders the scene into a dedicated `sceneFBO` that owns the `DepthTexture`, then blits the colour into the composer's read buffer. The FBO is never part of the composer's ping-pong pair, so no pass can sample the depth texture while it's attached for writing (that would be a WebGL feedback loop).

### EdgeMaskPass (high tier only)

Re-renders the scene with the camera restricted to `EDGE_LAYER = 2`, into a two-channel coverage mask: `R` for dark ink, `G` for light ink, combined with MAX blending. For this render it turns off shadow-map and matrix updates (both are already current this frame), and it restores renderer state afterwards. See [Ink edges](#ink-edges).

### Atmosphere (`haze`)

One full-screen pass that does all of the following from a single depth fetch:

1. **Defocus:** up to 4 taps on a rotating pair, with the radius driven by total haze. Off when the tier's `dof` is false.
2. **Large-scale AO:**
    - `uAOTaps` (0, 4 or 8) rosette taps at a world-space radius, converted to pixels via `uFocal`. The 4-tap mode uses every other direction.
    - It catches canopy overhangs and cliff bases that baked AO can't see, and fades out with fog.
3. **Cloud shadow:** two drifting noise octaves in world space (gated by tier).
4. **Distance desaturation:** chroma falls off faster than brightness: `mix(col, lum, fog × uDesat)`.
5. **Aerial perspective:** pulls colour toward `skyRadiance(viewDir)`, the same function the sky dome uses, so there's no seam at the horizon.
6. **Ground mist:** an exponential height medium integrated analytically along the view ray (`heightAvg`), so mist pools in valleys.
7. **Sun in-scatter:** a forward-scatter lobe driven by fog and mist.

The fog curve here **must match** the material fog (the `FOG_NEAR` patch in `lighting.ts`, and `uAerialD`). Otherwise surfaces and post effects fade on different schedules and a visible ring appears.

Two shader rules apply here:

- **Early-out loops:** loops stop on a uniform (`if (i >= uAOTaps) break`) instead of masking iterations with `step()`, so a 4-tap tier really does half the work.
- **Explicit LOD:** every texture fetch inside a loop or a per-pixel branch uses `textureLod(…, 0.0)`.
    - Implicit derivatives are undefined there (ANGLE/D3D warning X3595).
    - No post buffer has mips, so the result is identical.

### Bloom

`UnrealBloomPass` runs after the atmosphere, so haze brightness feeds into it. Threshold is 1.25 (linear) and strength 0.22. Only emitters bloom (lanterns, and crystals at about 2.2× palette brightness), plus specular glints.

### Crepuscular rays

An 8-tap radial march toward the sun's screen position. `main.ts` projects the sun each frame. The pass is **enabled only while rays are visible** (sun near the horizon and on screen) and the tier allows taps; otherwise it would be a full-screen copy for nothing.

### Grade

Display-space colour grading:

- **Tone and colour:**
    - ACES tone mapping and sRGB
    - chromatic aberration at the frame edges only
    - lift/gamma/gain, saturation and split toning
    - "milk", which lifts the darkest values toward lilac
    - contrast around mid-grey
    - a monotonic highlight knee
- **Ink compositing** from the edge mask. It uses `mix`, never addition, so pale ink can't become an emitter.
- **Golden / blue hour:** `uGolden` warms highlights and mids (sun just above the horizon); `uBlue` cools and lifts the shadows (sun just below it). Both are luminance-weighted, set each frame by `main.ts` from the sun's elevation, and muted by overcast weather.
- **Finishing:** a tinted vignette and film grain.

### Anti-aliasing

| Tiers                  | AA   |
| ---------------------- | ---- |
| high, mobile-high, mid | SMAA |
| low                    | FXAA |
| very-low               | none |

The AA pass sets `needsSwap = false`. Without it, the composer alternates render targets and the depth attachment detaches every other frame, which shows as a full-screen flash.

Known warning: on Windows, Three's stock `FXAAShader` (low tier only) logs ANGLE warning X3595 at compile time. It's harmless, and fixing it would mean forking the shader.

---

## Ink edges

The illustrated look comes from explicit strokes along genuine cube edges, not from a post-process edge detector.

1. **Edge graph:** while meshing, each emitted face classifies its four borders:
    - **Convex:** the in-plane neighbour is air.
    - **Concave:** the neighbour exists and rises in front of the face.
    - **Flat seam:** anything else. These are never drawn — inking every quad border would draw a waffle grid on every lawn.

    Unit edges are keyed by sorted endpoints and deduplicated across the two faces that share them (`addEdgeFace`).

2. **Ownership:** a 1-block halo is scanned, so an edge on a chunk boundary sees both of its faces. `edgeBelongsToChunk` assigns each edge to exactly one chunk.
3. **Colour:** an edge gets _light ink_ when it isn't concave and either both of its faces are pale (sRGB luma ≥ 0.61) or a face is flagged `lightEdge` (grass tops). Everything else gets dark ink.
4. **Runs:** `mergeEdgeRuns` joins collinear unit edges that share normals and colour into long runs. Where light and dark runs meet, the dark runs lose their round caps so they can't bite into the pale stroke.
5. **Rendering:** runs become `LineSegments2` instances with a custom `ShaderMaterial` (`makeEdgeMaterial`):
    - screen-space width in CSS pixels (`linewidth`, set by the settings slider)
    - analytic anti-aliased coverage and round caps
    - a **manual depth test against the scene depth texture** (`tSceneDepth`) with a distance-scaled bias, so strokes are hidden correctly without z-fighting their own faces
    - fog and mist applied in the shader, so ink fades with the surface it's drawn on

Only `EdgeMaskPass` draws the edge layer, so ink exists only on the high tier. `B` / ⬡ toggles the ink opacities in the Grade pass.

---

## Materials & shader injection

Most world materials are stock Three.js materials extended through `onBeforeCompile` string replacement, so they keep Three's lighting, shadows and fog:

| Material                      | Base                  | Injected                                                                                                                                                                                                   | Cache key                 |
| ----------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Terrain (`makeVoxelMaterial`) | `MeshLambertMaterial` | procedural patterns (brick, stone, plank, bark, grass, tile), grass fringe, macro colour noise, face shading, sun/ambient tints, baked AO, waterline ink, coloured VSM shadow tint, wind sway, planet bend | `VoxelWorld-voxel-v11`    |
| Glow                          | `MeshBasicMaterial`   | face shading ×1.5, planet bend                                                                                                                                                                             | `VoxelWorld-glow-v3`      |
| Ground detail (`DetailField`) | `MeshLambertMaterial` | per-vertex wind (`aDetail` = sway, phase), planet bend. `DoubleSide`, `depthWrite: false`, `renderOrder = 2`                                                                                               | `VoxelWorld-vegdetail-v7` |
| Water, sky, edges, particles  | `ShaderMaterial`      | written in full                                                                                                                                                                                            | —                         |

Rules:

- **Bump the cache key:** change `customProgramCacheKey` whenever the injected GLSL changes, or Three reuses a stale compiled program.
- **No textures** apart from the water depth map. Patterns are procedural (`vxNoise`, `vxHash`) on world-space UVs, so a palette switch only rewrites vertex colours.
- **Shared uniforms:** uniforms used by many meshes live on `material.userData.uniforms` and are copied into `shader.uniforms` in `onBeforeCompile`.
    - **Per-mesh uniform values don't work with a shared material**, because Three only re-uploads uniforms when the bound material changes.
- **Wind sway** (terrain leaves):
    - Bit 3 of `aData.y` flags swayable blocks.
    - The vertex shader offsets XZ by two summed sines (phase taken from world XZ) × `uWindStrength` × `clamp(y / 28, 0, 1)`.
    - `main.ts` animates `uWindTime`, `uWindDir` and `uWindStrength`, with a slowly rotating direction and a gust envelope; `_windBase` holds the slider value.
    - Skipped on very-low.
- **Fog near-plane patch:**
    - At import, `lighting.ts` rewrites `THREE.ShaderChunk.fog_fragment` once to subtract `FOG_NEAR` (96) before the exp² curve, which keeps the play area at full colour.
    - It logs a warning if that chunk changes shape after a Three upgrade.

---

## Weather & atmosphere

`render/weather.ts` (`Weather`) is a state machine: `clear → rain → clear → snow → clear …`, with each front lasting a few minutes (randomised from the seed). It keeps two kinds of value separate:

- **Falling now:** `rain` and `snow`, eased in and out over about 20 s so a front _arrives_.
- **Remembered by the ground:** `wet` builds over about 25 s of rain and dries over about 2 min. `snowCover` builds over about 1 min of snow and melts slowly (four times faster in rain). Melting snow leaves the ground wet. Puddles and settled snow outlive the weather that made them, which is most of what sells them.

`?weather=` pins the state. In clear weather every consumer reads zero, so weather costs nothing until it rains.

`main.ts` feeds the weather and the sun into these consumers each frame:

| Effect                 | Where                          | How                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rain / snow            | `particles.ts` (`uKind` 1 / 2) | Camera-centred fields: rain is an upright streak, snow a fluttering round flake, both drifting with the wind. Buffers are allocated at full size, and `instanceCount = max × intensity`, so clear skies draw nothing. They use their own RNG stream, so petals don't move.                                                                                                                    |
| Puddles, wet ground    | terrain shader (`uWet`)        | Surfaces above the waterline darken; flat tops pool dark, sky-tinted puddles in noise hollows.                                                                                                                                                                                                                                                                                                |
| Settling snow          | terrain shader (`uSnow`)       | Tops cover first, with noise driving patchy accumulation. As cover grows it creeps over the top edge of side faces. It's tinted by `uAmbientTint` × face shading so it stays readable at dusk.                                                                                                                                                                                                |
| Wind gusts             | `GUST_GLSL` in `voxel.ts`      | `gustAt(xz, t, dir)`: travelling bands along the wind direction with two incommensurate frequencies. Trees lean and shake harder in a band; meadow blades swing harder back and forth along the wind, with only a slight downwind lean (`uGustStr`). Both share `uWindDir` and the clock, so a gust rolls over grass and canopy together. Weather multiplies the wind (rain ×1.6, snow ×1.3). |
| Shallow-water caustics | terrain shader (`uCausticStr`) | A drifting two-noise web projected onto underwater _tops_, fading exponentially with depth. Off on very-low and at night; reduced in rain. (The water's own surface web remains.)                                                                                                                                                                                                             |
| Sun glow in the haze   | atmosphere pass (`uHazeGlow`)  | A tight Mie-like lobe (`pow(s,24)` + `pow(s,8)`) in the live sun colour, carried by fog and mist, swelling as the sun gets low. Reduced when overcast.                                                                                                                                                                                                                                        |
| Golden / blue hour     | Grade (`uGolden`, `uBlue`)     | See [Grade](#grade).                                                                                                                                                                                                                                                                                                                                                                          |
| Sunlit dust motes      | `particles.ts` (`uSunLit`)     | Motes and pollen brighten when they sit between the eye and the sun (forward scatter, `pow(dot(view, sun), 6)`), strongest when the sun is low.                                                                                                                                                                                                                                               |
| Moonlight on water     | water shader (`uMoonLight`)    | A broad moon glint (`pow(N·H, 38)`) broken into flickering sparkles by a cell hash, plus a faint Fresnel sheen. Gated by night factor × moon elevation × clear sky.                                                                                                                                                                                                                           |

Two latent bugs were fixed along the way:

- **Haze didn't follow the time of day.** The atmosphere pass had its own copy of the sky uniforms, which nothing updated, so distant land faded toward the _noon_ sky at every hour and the haze in-scatter stayed pinned to the noon sun. `post.shareSky(atmo.sky.material.uniforms)` now makes both passes read the same uniform objects. The water's sun glint had the same problem; it now updates through `water.setLights()`.
- **The sun ran a quarter-day early.** `sin(2πt)` put the sun overhead at 06:00 and on the horizon at noon, out of step with the palette keyframes and the HUD clock. It's now phased `(t − 0.25)·2π`: horizon at 0.25 and 0.75, overhead at 0.5.

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
const d = Math.abs(this.timeOfDay - 0.5) * 2; // 0 at noon, 1 at midnight
return Math.max(0, (d - 0.3) / 0.7);
```

Returns 0 during daytime (±30% of the cycle around noon), ramping to 1 at midnight. Used to gate stars, aurora visibility, and `uNight` in the sky shader.

### Voxel time-of-day tints

`DayNight.voxelUniforms` (set to `world.meshes.material.userData.uniforms` in `main.ts`) receives live per-frame pushes:

- `uSunDir` — live sun direction vector.
- `uSunAmbient` — `0.08 + elev * 0.18` (scales diffuse contribution with sun elevation).
- `uFillAmbient` — slightly higher at night (`0.04 + (1 - elev) * 0.04`) to simulate moon bounce and prevent total black.
- `uSunTint` — warm orange-gold at the horizon, neutral white at noon. Driven by `horizonWarm = pow(max(0, 1 - elev * 2.5), 2)` and the keyframed sun colour.
- `uAmbientTint` — cool blue at night (`r -0.08 * night, g -0.04 * night, b +0.12 * night`), neutral at day.

---

## Water

`src/world/water.ts`. The water is a single translucent plane at sea level (`transparent`, `depthWrite: false`, drawn with fog), subdivided per tier and displaced in the vertex shader. Rivers above sea level are voxels instead (see [River system (detail)](#river-system-detail)).

### Depth map

`makeDepthMap(world)` bakes a `THREE.DataTexture` in `RGFormat`, one texel per column:

- **R** — signed water depth: `(WATER.level − (top + 1) + DEPTH_RANGE) / (2 × DEPTH_RANGE)`, with `DEPTH_RANGE = 34`. It's signed rather than clamped so the shader has a real path length for absorption, and the shore ink sits at the zero crossing.
- **G** — river proximity (0–255), from `rivFlow`.

It's baked from the heightfield, not read from the scene depth buffer. The water is drawn into that same buffer, so reading and writing it at once would be undefined. The terrain material samples the same texture to draw the waterline ink on banks.

### Shading

Vertex and fragment shaders share one `WAVE_GLSL` string (`h21`, `n2`, `waveField`):

- **Waves:** `waveField(p, t)` is a sum of four directional sines and returns height plus its analytic derivative. The vertex shader displaces by the height (true geometric crests, ~0.4 blocks), and the fragment shader uses the derivative as the normal. Sharing the code guarantees that lighting matches the geometry.
- **Effects that all use that one normal:** sun glint, Fresnel sky tint at grazing angles, and a small refraction offset when sampling the bed. There are no reflections, by design; they would fight the flat pastel look.
- **Beer–Lambert absorption** along the actual view ray, with per-channel extinction: `exp(−depth × uExtinction)`. Red is absorbed first, so depth reads as a hue shift toward blue-green. Path length grows as the camera lowers, so far water darkens while nearby shallows stay clear on the same surface.
- **Caustic web:** where two drifting noise fields nearly agree, their difference collapses into a bright filament. Two scales at non-integer ratios avoid moiré, and the strength is scaled by depth.
- **River proximity** (G channel) speeds up the waves, adds a bank-foam band and a slight cool tint.
- **Alpha** comes from optical depth along the slant (`1 − exp(−slant × density)`), plus a Fresnel term, and is clamped near the shoreline.

Plane subdivision by tier is 64 (high), 32 (mobile-high, mid), 16 (low) and 4 (very-low).

---

## Planet bend

`src/render/planet.ts`. The world is flat in data and physics, and only _looks_ curved. `PLANET_BEND_GLSL` is pasted into every world material: terrain, glow, water, ground detail and particles.

```glsl
void applyPlanetBend(inout vec3 worldPos, inout vec3 worldNormal) {
  vec2  d2   = worldPos.xz - uPlayerXZ;
  float r2   = dot(d2, d2);
  worldPos.y -= r2 / (2.0 * uPlanetRadius);       // parabolic approximation of a sphere
  float r    = sqrt(r2);
  if (r > 0.001) {
    worldNormal.xz -= (d2 / r) * (r / uPlanetRadius) * worldNormal.y;   // tilt normals to match
    worldNormal = normalize(worldNormal);
  }
}
```

- **Bend origin:** `main.ts` calls `updatePlanetUniforms()` on every entry of `world.allPlanetUnis`, but only once the bend origin has moved more than 0.1 units.
    - In flight modes the origin is the camera; otherwise it's the controller.
- **Chunk bounds:** chunk bounding spheres are computed on unbent geometry. Bending only lowers far vertices, so frustum culling stays conservative.

---

## GPU tiering & performance

### Detection (`detectGpuTier()` in `render/gpu-tier.ts`)

`?tier=<name>` forces a tier, for testing on real devices. Otherwise detection uses these signals:

| Signal                                    | Why                                                                                                                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebGL2 context                            | Required by the renderer. If it's missing, `main.ts` stops with a message before detection runs                                                                      |
| `WEBGL_debug_renderer_info` renderer name | The only reliable way to tell integrated from discrete GPUs, and to spot software renderers. On Windows, ANGLE reports `MAX_TEXTURE_SIZE = 16384` even for Intel UHD |
| iPadOS detection                          | iPadOS reports a desktop Mac user-agent, so it's detected as `Macintosh` UA + `maxTouchPoints > 1`                                                                   |
| `MAX_TEXTURE_SIZE`                        | On Apple devices, 16384 means an A12 (2018) or newer chip                                                                                                            |
| `hardwareConcurrency`, `deviceMemory`     | `deviceMemory` exists only in Chromium and is capped at 8; when missing it counts as "enough"                                                                        |

The probe context is released with `WEBGL_lose_context`, because mobile Safari caps how many live contexts a page can hold.

Rules, first match wins:

```text
software renderer (SwiftShader / llvmpipe / Basic Render)           → very-low
mobile:
  Apple GPU / iPad / iPhone   → maxTex ≥ 16384 ? mobile-high : mid
  cores ≤ 4 or mem ≤ 2        → very-low
  Mali-T / Adreno 3xx–5xx / PowerVR                                 → low
  cores ≥ 8 and mem ≥ 6       → mobile-high        (e.g. Galaxy S22 Ultra)
  cores ≥ 6 and mem ≥ 3       → mid, else low
desktop:
  cores ≤ 4 or mem ≤ 2        → low
  not integrated, cores ≥ 8, mem ≥ 6, maxTex ≥ 16384                → high
  cores ≥ 6 ? mid : low
```

Getting the tier slightly wrong is cheap, because the [adaptive-resolution governor](#adaptive-resolution) corrects for it at runtime.

### Settings table (`TIER_SETTINGS`)

| Tier        | DPR cap | Shadow px | Blur | Shadow every | Extent | Far  | Bloom | AO  | DoF | Rays | Ink | Cloud | AA   | Stream | Water sub | Particles | Detail ×, dist |
| ----------- | ------- | --------- | ---- | ------------ | ------ | ---- | ----- | --- | --- | ---- | --- | ----- | ---- | ------ | --------- | --------- | -------------- |
| high        | 2       | 4096      | 12   | 1 frame      | 120    | 6000 | ✓     | 8   | ✓   | 8    | ✓   | ✓     | SMAA | 12     | 64        | 1200      | 1.0, 140       |
| mobile-high | 1.5     | 2048      | 8    | 2            | 110    | 3000 | ✓     | 4   | ✓   | 4    | —   | ✓     | SMAA | 11     | 32        | 700       | 0.55, 90       |
| mid         | 1.25    | 2048      | 8    | 2            | 120    | 3000 | ✓     | 4   | ✓   | 4    | —   | ✓     | SMAA | 11     | 32        | 600       | 0.6, 100       |
| low         | 1       | 1024      | 4    | 3            | 100    | 1500 | —     | 0   | —   | 0    | —   | —     | FXAA | 8      | 16        | 200       | 0.25, 70       |
| very-low    | 1       | 512       | 4    | 6            | 80     | 1200 | —     | 0   | —   | 0    | —   | —     | none | 6      | 4         | 0         | 0, 50          |

Each tier value is used in one place:

- **`dprCap`:** applied as `min(devicePixelRatio, cap) × dprScale`, so it can only lower native DPR.
- **Shadow size and stream radius:** become the _defaults_ of the settings panel via `setTierDefaults()`. A user can override them, and the override is stored.
- **Detail density:** scales the meadow-sprite layer at generation time. `0` keeps only the authored sparse tufts.
- **Detail distance:** a per-batch distance cull applied every frame (`DetailField` `update()`).
- **Shadow cadence:** when `shadowInterval > 1`, `renderer.shadowMap.autoUpdate` is false. `main.ts` then sets `needsUpdate` every N frames, and `DayNight` also sets it whenever the sun moves noticeably (more than 0.009 in Y).

### Adaptive resolution

`main.ts` samples frame rate over 2-second windows (ignoring frames over 250 ms, such as tab switches):

- Below 40 fps, `dprScale` drops by 0.1, down to a minimum of 0.6.
- Above 57 fps, it climbs back by 0.1, up to 1.

Each change calls `renderer.setDprScale()` and then the normal resize path, which resizes the composer and all its targets.

### Robustness

- **No WebGL2:** readable message on the boot screen instead of a blank page.
- **`webglcontextlost`:** reload after 300 ms. The URL carries the seed, so it's the same world. Rebuilding every GPU resource in place would be a lot of code for a rare event.
- **No float render targets** (`EXT_color_buffer_float` / `_half_float` both missing):
    - HDR targets fall back to `UnsignedByteType`.
    - Shadows switch from VSM (which needs RG16F moments) to PCF.

### Performance principles

These are applied across the codebase. Keep them when adding features:

- **Don't use `discard` in opaque world shaders.** It disables early-Z and tile-based hidden-surface removal on mobile GPUs for every fragment of the material. (Edges and the ground detail are the exceptions: they're thin or depth-write-off and drawn last.)
- **Break out of loops on a uniform** rather than masking iterations, so lower tiers really do less work.
- **Turn passes off when their output isn't visible** (crepuscular rays when the sun is off-screen, EdgeMask below high tier).
- **Hidden meshes skip the shadow pass too.** VSM renders shadow _receivers_ as well as casters, so distance-culling the ground detail saves the shadow pass as well as the main pass.
- **Throttle per-frame work by change:**
    - planet-bend uniforms update only after the player moves
    - `followTarget` runs only while moving
    - the streamer re-queues only on a chunk change
    - map and settings redraw only while open
- **Avoid per-frame allocation:** scratch vectors are module-level (`_sunWorld`, `_sunNDC`), and `DayNight` exposes `sunDir` by reference.
- **Matrix updates are manual** (`scene.matrixWorldAutoUpdate = false`); only moving objects update theirs.
- **Pack vertex data** (see [Face mesher](#face-mesher-meshregion-in-voxelts)).

---

## Input & controls

Bindings follow `../planet-explorer` wherever the feature exists in both projects. Keyboard and touch expose the same actions, and both call the same functions in `main.ts`:

| Action               | Keyboard             | Touch                            | Implementation                                   |
| -------------------- | -------------------- | -------------------------------- | ------------------------------------------------ |
| Move / look          | WASD, arrows / mouse | left joystick / right-half swipe | `FPCamera.getWish()`, `applyTouchLook()`         |
| Jump / ascend        | Space                | ↑ (held)                         | `getJumpEdge()`; `touchAltAxis = 1` in the air   |
| Descend              | C                    | ↓ (held)                         | `drainDroneAltDelta()`                           |
| Sprint               | Shift                | ⚡ (held)                        | `touchSprint` injects `ShiftLeft` into `_keys`   |
| Cycle walk→drone→fly | F                    | ✈ (icon shows the next mode)     | `cycleMode()`                                    |
| Land                 | L (also from fly)    | 🛬 (visible while airborne)      | `land()`                                         |
| Map                  | M                    | 🗺                                | `map.toggle()`                                   |
| Dog sit / stand      | Y                    | 🐕                               | `dog.toggleSit()`                                |
| Settings             | G or `` ` ``         | ⚙ (HUD)                          | `settings` panel keydown / `hud.onSettingsClick` |
| Edges                | B                    | ⬡                                | `toggleEdges()`                                  |
| Time of day          | [ / ]                | ◀ / ▶                            | `stepTime(±0.125)`                               |
| Pause                | Esc                  | —                                | `pause.ts`                                       |

### Desktop

- **Pointer lock:** `FPCamera` requests pointer lock on a mouse `pointerdown` (never for touch pointers), and the boot-screen click also requests it.
- **When actions run:** gameplay keys run only while `canAct()` (locked or touch). L is the exception: it works even when unlocked, so Esc then L still lands.
- **Mouse look:** yaw/pitch at 0.0021 rad/px, with pitch clamped to ±(π/2 − 0.05).
    - In drone mode, mouse X turns the drone's heading instead, and mouse Y is deliberately ignored, so drifting the mouse never climbs.
- **Settings panel:** opening it releases pointer lock so the sliders can be used. Its G/backquote shortcut is ignored while typing a seed word.

### Touch (`ui/touch-controls.ts`)

- **Detection:** `isTouchDevice = (ontouchstart || maxTouchPoints > 0) && matchMedia('(pointer: coarse)')`. The coarse-pointer test stops touchscreen laptops from getting touch UI.
- **Joystick:** a nippleJS dynamic joystick in a `#joy-zone` div covering the left half of the screen.
    - It feeds `fpCam.setTouchMove(x, y)`, which stores the raw axes.
    - `getWish()` converts them to world space every frame using the current yaw, so a swipe-to-turn while holding the stick steers immediately.
- **Swipe-to-look:** raw `touchstart`/`touchmove` events on the canvas. The first touch on the right half becomes the look finger, at 0.004 rad/px.
- **Buttons:**
    - Held buttons (↑ ↓ ⚡) use `touchstart`/`touchend`/`touchcancel`; tap buttons use `touchend`. All of them `stopPropagation` so a tap isn't also treated as look.
    - `update()` shows 🛬 only while airborne and changes the cycle icon to show the next mode.
- **Layout:**
    - The button column wraps into extra columns (`flex-wrap: wrap-reverse`) instead of running off the top of short screens.
    - On screens under 500 px tall the buttons shrink to 46 px.
- **No pointer lock on touch:** pointer lock freezes touch coordinates, which used to make the joystick read zero. `touchActive = true` lets `canAct()` and `getWish()` work without lock.

### Altitude input — `drainDroneAltDelta(dt)`

```ts
const keyAxis = (Space ? 1 : 0) - (KeyC ? 1 : 0);
const scrollRate = dt > 0 ? this._droneAltDelta / dt : 0; // wheel gives a position delta → convert to a rate
this._droneAltDelta = 0;
return scrollRate + (keyAxis + this.touchAltAxis) * 12; // m/s; the caller multiplies by dt once
```

It returns a **rate**, not a delta. (Fly mode once applied it without `* dt`, and climbed at about 720 m/s.)

---

## Player systems

### Character controller (`player/controller.ts`)

The player is an AABB (radius 0.38; 1.02 while swimming) swept against the voxel grid one axis at a time. It's cheap, and at these speeds it never tunnels. `main.ts` runs it in fixed 1/60 s sub-steps.

- **Feel:**
    - Ground acceleration 118, air acceleration 46, friction 14.5, max speed 13.5, gravity 58, jump velocity 20.5, terminal velocity −70.
    - Coyote time is 0.12 s and jump buffering 0.14 s, and jump height is variable.
- **Step-up:**
    - Rises of up to 1.25 are taken in stride: the body is placed on top and the _drawn_ height (`visualY`) eases up to meet it.
    - Rises of up to 3.3 can be climbed onto.
- **Swimming:**
    - Whether you swim depends on the depth of the bed under you, not on your own height in the water. Testing your own height creates a feedback loop: buoyancy lifts you out of swimming, then gravity drops you back in.
    - Hysteresis between entering (1.7) and leaving (1.25) stops it chattering at the boundary.
    - Buoyancy is a critically-damped spring to a float line 1.05 below the surface.
    - The controller scans ±4 blocks for `isWater` voxels, so river water above sea level supplies its own surface height.
- **Wrap:** position is wrapped with `wrapAxis()` after each move.
- **`Input` class:** shared key state plus a `paused` flag. Menus set `paused` and restore its previous value on close; the navigator and the dog respect it.

### Camera modes

Exactly one mode owns the camera each frame. `fpCam.flyActive` / `droneActive` tell `FPCamera.update()` to step aside.

- **Walk (`FPCamera.update`):** eye height 1.75, plus head bob (0.022 m at 2.2 Hz × speed) while grounded.
- **Drone (`player/drone.ts`):** a state machine `idle → rising → cruising` (plus `landing`).
    - **Enter:** scans upward for clear air, then rises to `max(18, clearance + 4, current altitude)`. Entering from fly mode skips the rise.
    - **Cruise:** terrain-follow is a P-controller on a smoothed ground target: `smoothed += (raw − smoothed) × min(1, dt × 3.5)`, then vertical velocity `= clamp(error × 4, ±14)`.
    - **Speed and steering:** cruise speed 18, sprint 45; A/D or mouse X turns the heading; touch joystick Y below zero brakes.
    - **Land:** descends at 90 m/s until 2.5 blocks above ground, then hands back to walk mode. Any upward input (Space, ↑ or the scroll wheel) aborts the landing.
    - **Exit:** `exit()` leaves immediately, without landing; this is the F-cycle step from drone to fly.
- **Fly (`player/fly.ts`):** free 6-DoF movement at speed 20 (sprint 60).
    - The terrain floor (surface + 1.75) is smoothed downward at up to 8 m/s, so flying over a cliff doesn't snap you down.
    - A probe 6 blocks ahead pushes you upward (up to 14 m/s) before you hit a wall.
    - Leaving fly mode (F or L) places the controller on the ground directly beneath the camera.

`cycleMode()` in `main.ts` handles the mode transitions, including resetting yaw/pitch and syncing the controller position.

### Character (`player/character.ts`)

A procedural voxel traveller, animated from `speed01`, `grounded`, `vy`, `heading`, `groundY` and `swimming` (jump, step and land events trigger poses). It lives on render layer 1, which the first-person camera disables, but it still casts shadows, so the player sees their own shadow. Its root position is driven from `controller.pos` and `controller.visualY`.

---

## Navigation & the dog

### `NavigationSurface` (`player/pathfinding.ts`)

A 2.5D walkability graph shared by **everything that walks** — the click-to-move navigator and the dog — so they all agree on what's walkable.

- **Two layers per map cell:** layer 0 is natural ground or swimmable water; layer 1 is bridge decks, installed from `world.props.bridges`.
- **8-connected moves**, with diagonals costing √2. A diagonal is legal only if at least one of its two L-shaped routes around the corner is clear, which stops the path cutting through touching corners of trunks, posts or cliff blocks.
- **Step limits:** max step up 3.3 and max drop 3.35, matching the controller.
- **Validity cache:** a `Uint8Array` per node with values 0 (unknown), 1 (walkable) or 2 (blocked), filled lazily. The world never changes after generation, so the cache never needs invalidating.

### Click-to-move navigator

- **Picking a destination:** a mouse click (less than 6 px of movement between down and up) raycasts against the terrain group, snaps to `surface.nearestNode()`, and shows a pulse ring where it hit.
- **Search:** A* with a binary min-heap, **time-sliced** to 1.75 ms per frame and capped at 420k expansions, so a long route never causes a hitch.
- **Following the route:** the navigator outputs the same world-space wish vector as the keyboard, so acceleration, collision, stepping, swimming and animation stay with the `Controller`.
- **Cancelling:** any manual movement cancels the route. Getting stuck triggers a replan.

### Dog (`player/dog.ts`)

A companion, not a follower. Two design decisions:

1. **It navigates on the shared `NavigationSurface`.** A pet with its own idea of what's walkable would walk through cliffs, and would be a second system to keep in sync.
2. **It has no physics body.** It rides the navigation surface directly (ground height per cell, eased at 14/s), so there's nothing to fall through or collide with.

Behaviour states:

| State    | What the dog does                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| `rest`   | Sits or stands near the player                                                                             |
| `wander` | Trots (4.4 m/s) to points within 6.5 of the _player_                                                       |
| `follow` | Runs (7.6 m/s, faster than the player) along an A* path when beyond the 9-block leash, until it's within 3 |

- **Replanning and recovery:** the dog replans when the player has moved 3.5 from the goal, and warps next to the player when more than 72 away or unreachable.
- **Personal space:** a 1.5-block gap is enforced as a position clamp, not a steering force, so it can't lose to a path that runs through the player.
- **Hops:** height changes over 0.55 become a ballistic hop (at most 3.45, matching the nav surface's limit), timed so the dog is at full height before it crosses the lip.
- **Sit pose:** _solved_ from the rig geometry rather than tuned by eye. The body pitches nose-up by 0.5 rad, and the drop and hind-leg fold are derived so all four paws stay on the ground.
- **Commands:** Y or 🐕 toggles a standing order to sit (with a speech bubble). After a "stand" command, a 5 s grace period stops it sitting again by itself straight away.

---

## Vegetation

### Trees & bushes (`world/vegetation.ts`)

Trees are voxels written into the grid, so they get meshing, AO, edges and collision for free. `plantTree()` takes a `form`, and there are two families of form.

**Blossom forms** are the signature pastel look. The biome's `BIOME_FLORA.forms` list picks among them, and stamp scenes use them too:

| Form            | Silhouette                                                | Used by                            |
| --------------- | --------------------------------------------------------- | ---------------------------------- |
| `round`         | Classic round crown                                       | sakura, meadow, wetland, shore     |
| `stack`         | Tiered stacking (also the hero tree)                      | sakura, meadow                     |
| `twin`          | Two-lobed top                                             | sakura, meadow                     |
| `bunch`         | Tight cluster                                             | meadow, wetland, shore             |
| `nub`           | Small compact cap                                         | highland, shore                    |
| `umbrella`      | Flat wide canopy                                          | meadow, wetland, shore             |
| `broad`         | Low spreading crown                                       | sakura, wetland                    |
| `tall`          | Very tall bare trunk, small airy crown                    | sakura, meadow, wetland            |
| `layered`       | Pagoda/cedar: 2–4 tiered horizontal discs with gaps       | meadow, highland, shore            |
| `weeping`       | Weeping cherry: wide drooping skirt, lifted central crown | sakura, wetland, shore             |
| `spire`, `dead` | Legacy cone / bare stubs                                  | stamp scenes and `pickForm()` only |

**Named species** are placed **by altitude**. Each has a climate (from the continent's climate, via `plan.climateAt()`: 0 tropical, 1 temperate, 2 arid, 3 tundra) and an altitude band in blocks above sea level (`SPECIES` table):

| Species    | Silhouette                                             | Climates            | Altitude | Notes      |
| ---------- | ------------------------------------------------------ | ------------------- | -------- | ---------- |
| `mangrove` | Stilt roots, broad low crown                           | tropical, temperate | 0–3      | wet ground |
| `palm`     | Tall bare trunk, radiating frond disc                  | tropical, arid      | 0–5      |            |
| `willow`   | Rounded crown with hanging strands to near the ground  | all                 | 0–8      | wet ground |
| `cypress`  | Tall narrow column                                     | temperate, arid     | 2–10     |            |
| `kapok`    | Very tall trunk, plank buttress roots, high flat crown | tropical            | 2–10     |            |
| `baobab`   | Fat bottle trunk, sparse stubby crown                  | arid                | 3–11     |            |
| `acacia`   | Forked trunk, flat savanna umbrella                    | arid, tropical      | 3–13     |            |
| `oak`      | Broad heavy crown wider than tall                      | temperate           | 3–12     |            |
| `birch`    | Slim pale trunk, narrow airy clumps                    | temperate, tundra   | 7–16     |            |
| `pine`     | Tall bare trunk, compact crown with side whorls        | temperate, tundra   | 10–20    |            |
| `fir`      | Dense symmetric cone to near the ground                | temperate, tundra   | 13–24    |            |
| `spruce`   | Taller, narrower tiered spire with gaps                | tundra, temperate   | 16–30    |            |
| `juniper`  | Wind-twisted scrub, lopsided pads                      | arid, tundra        | 14–30    |            |
| `snag`     | Dead pale trunk, broken top, bare limbs                | all                 | 20–40    | treeline   |

- **Band fitting:** the bands are fitted to the relief as generated. About 36% of land is 0–6 blocks above sea, 30% is 6–12, 21% is 12–18 and 13% is above 18, with peaks in the low 30s. Retune them if terrain relief changes.
- **`pickSpecies(climate, alt, wet, rng)`:** a weighted pick. Weight is full inside a band and fades linearly to zero over `ALT_SOFT` (3) blocks outside it, so treelines blur rather than stop dead.
- **Species trunks:** proportions come from `SPECIES_TRUNK`. Birch and snag use pale bark; baobab, kapok and juniper use dark bark. Baobab and kapok trunks are 2–3 wide.
- **No extra tufts:** `NO_TUFTS` skips the generic extra-foliage tufts for species whose silhouette _is_ the shape (conifers, columns, hanging strands, palms) and for dead trees.

**Placement** (`scatterVegetation`):

1. **Hero tree:** one large `stack` on the broadest high plateau.
2. **Grove cores, then woodland:**
    - Each site goes to a named species with probability `1 − blossomShare`. The blossom share is sakura 0.85, meadow 0.45, highland 0.08, everything else 0.2.
    - Otherwise the site gets the biome's blossom forms.
    - Woodland density thins with altitude over the full ~34-block relief.
3. **Treeline pass:** above 12 blocks, on grass _or stone_, with a 1-block slope allowed. Species only, thinning toward the very top. This is the only way alpine species get sites, because the woodland pass needs flat grass.
4. **Waterside pass:** wet (wetness > 0.3), low (≤ 8 blocks) grass or sand, for mangrove and willow. The woodland pass rejects wet ground.

Species choice and species builders draw from their own stream (`speciesRng`), so adding or retuning a species never moves the rest of the world. Grove placement uses fixed-seed noise fields (`N_GROVE`, etc.) rather than the shared RNG, so forest layout doesn't depend on how many random draws came before it. An `occupied` mask records trunk cells for later passes.

### Ground detail (`buildGroundDetail` + `world/veg-detail.ts`)

Sub-voxel decoration that can't be expressed as blocks, collected into a `DetailField`:

| Primitive    | Geometry                                       | Used for                                                     |
| ------------ | ---------------------------------------------- | ------------------------------------------------------------ |
| `tuft`       | two crossed, tapered quads                     | grass tufts, reeds, flower and mushroom stems                |
| `blade`      | one thin quad at a random angle (cheaper)      | meadow grass blades (some tall, with pale seed tips)         |
| `fern`       | three leaning tufts                            | fern blocks                                                  |
| `flowerHead` | two crossed flat petal squares + a pale centre | lone wildflowers                                             |
| `petal`      | one flat quad, rotated in plan                 | fallen petals under large crowns and on blossom drifts       |
| `box`        | six-sided sub-voxel box                        | pebbles, lichen, flower heads, mushroom caps, crystal shards |

**Placement** (one pass over every column, plus mushroom, crystal and petal passes):

- **Reeds:** wet shallows within ±2 of sea level.
- **Ferns:** on fern blocks.
- **Grass:** tufts on all grass, plus the tier-scaled meadow blades on lush areas (a `meadow` FBM field).
- **Flowers:** drifts where a separate flower FBM field is high, and lone wildflowers elsewhere.
- **Small details:** pebbles, lichen on stone, mushrooms in damp groves (more likely next to `occupied` trunks), and crystals near landmarks and on high rock.

The meadow blades and lone wildflowers are scaled by `world.detail.density` and drawn from their **own RNG stream** (see [Determinism](#determinism--seeding)).

**Build** (`DetailField.build`):

- **Batches:** quads are bucketed into 48-block spatial batches, each with exact-size typed arrays and its own `Mesh`, so frustum culling works per batch.
- **Material:** one `MeshLambertMaterial` for all batches. Wind is in the vertex shader: `aDetail = (sway, phase)`, where sway is 0 at the root and 1 at the tip, combined with a travelling swell and a flutter.
- **Draw state:** `depthWrite: false`, so thousands of blades don't paint the depth buffer and pick up ink, and `renderOrder = 2`, so they draw after the terrain.
- **Shadows:** batches receive shadows but don't cast them.
- **Culling:** `update(dt, camera)` hides batches beyond `detailDistance` (plus the batch radius) every frame.

At 768² this comes to about 226k quads at high tier and about 90k at very-low.

---

## Scene stamps

`src/world/stamps.ts` — `buildStamps(world, rng)` runs after props (so stamps can see bridges) and before vegetation (so the scatter pass respects cleared areas).

### Scenic grammars

Each grammar re-validates the terrain before building. A site whose conditions are not met downgrades to the next grammar in the preference list rather than building on wrong terrain.

| Grammar           | Requires                          | Generates                                                                       |
| ----------------- | --------------------------------- | ------------------------------------------------------------------------------- |
| `waterfallGarden` | 6+ block cliff with water at foot | Cascade, plunge pool, spray rocks, viewing deck, framing trees, lanterns, reeds |
| `stoneCrossing`   | River node with dry banks         | Stepping stones, plank jetty, framing trees, reeds                              |
| `lilyPond`        | Level clearing near waterline     | Excavated basin, sand rim, lily pads, leaning tree                              |
| `blossomGrove`    | Level open ground                 | Torii gate, swept floor, great tree, secondary ring, lanterns                   |
| `cliffOverlook`   | Level ground with 7+ block drop   | Paved terrace, parapet, bench, lanterns, one tree                               |
| `hotSpring`       | Dry inland mid-elevation ground   | Oval RIVER_WATER pool on STONE_WARM floor, boulder rim, leaf-moss scatter       |

Separation: `MIN_SEPARATION = 34` blocks between any two scene centres. Quotas (`QUOTA`) cap each kind per 256×256 area so one type does not dominate. `hotspring` quota: 2 per area.

### Landmark grammars

One pass per continent after scenic stamps. Seven kinds, 2–3 per continent slot, shuffled per seed. Each landmark reserves its footprint against the vegetation scatter pass. All seven kinds are registered in `map.ts` and appear on the minimap as landmark circles.

| Grammar             | Generates                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `twistedSpire`      | 3×3 warm-stone base, 14–22 block drifting pale-stone shaft (shifts 1 block each 4 levels, max ±2), cap block                           |
| `obelisk`           | 3×3 base, 8–13 block straight shaft, lanterns on either side                                                                           |
| `monolithRing`      | 7–8 standing stones at radius 10–13, every-other lintel, PATH floor                                                                    |
| `tombstoneField`    | 14–22 scattered upright slabs 2–4 blocks tall, random lean caps                                                                        |
| `floatingBiosphere` | Ovoid voxel body floating 20–32 blocks above terrain (grass cap → soil → warm-stone core), 8 stalactite drips below, small tree on top |
| `ancientWell`       | Stone rim (3×3 ring), STONE_PALE crossbeam, PATH clearing radius 5, scattered worn stones                                              |
| `ruinedArch`        | Two pillars 5–7 blocks tall, partial lintel (1–2 centre blocks missing), rubble scatter                                                |

The floating biosphere uses `T.put()` at `floatY + dy` offsets, bypassing the heightfield entirely. Stalactite length tapers from `STONE_WARM` (tip) through `STONE_PALE` to `STONE` (base).

The ruined arch spans along the X axis; the gap is randomised per seed so no two arches look identical. `ancientWell` is the most common ancient-ruin type and appears in flat inland clearings.

---

## River system (detail)

Rivers are planned in `planner.ts`, carved in `terrain.ts`, and rendered as voxel blocks above sea level.

### Planning (`planner.ts`)

`planWorld` builds `plan.rivers`: an array of `{ order: 0|1|2, points: [x,z][], source, tributary?, outflow? }`.

- **Trunks (order 0)** — traced from the highest-elevation region nodes downslope to the coast. One per main island, traced by _steepest descent with inertia_ (see [Planner](#planner-worldplannerts), step 9). Tail-trimmed to exclude ocean-side points (`elevationAt < SHORE_ELEV = 0.15`).
- **Tributaries (order 1)** — sourced from 50th-percentile elevation regions, up to `trunkCount × 5` total. Each joins the nearest existing channel within a snap radius of 18 region units.
- **Streams (order 2)** — fine branches from lower mid-elevation regions, up to `min(trunkCount × 4, 32)` total. Join nearest channel within `REGION_SPACING × 8`.

### Carving (`terrain.ts`)

For each river channel point, a half-width `rivHalf[i]` is computed. Width by channel order (all × `K = 256/192`, plus FBM jitter and up to +6 on the outside of tight bends; fords ×0.55):

- Trunk: `3.2 + t × 5.4` (t = 0 at source, 1 at mouth)
- Tributary: `2.2 + t × 2.6`
- Stream: `1.2 + t × 1.4`

The water surface is one global plane, so a channel is only wet where its bed lies below it:

- **Above `SEA + 7`:** the column becomes a dry ravine. Its floor is notched one terrace below the surrounding height (two along the centreline), and never below `SEA + 1`.
- **At or below `SEA + 7`:** the column is carved into the wet channel, deeper mid-channel and shallower at the ford so it can be waded.

The point where a dry ravine meets a wet reach is where `addCascades()` places its waterfalls. `SEA = Math.floor(WATER.level) = 24`.

### RIVER_WATER voxels (`terrain.ts`)

Above sea level, river channels are filled with `RIVER_WATER` voxels (3 blocks above the carved bed) so the river is visible as a teal-blue channel rather than a dry ravine:

```ts
export const RIVER_WATER = registerBlock('RIVER_WATER', {
    top: lin(0x4fa8bc),
    side: lin(0x3d97ae),
    bottom: lin(0x2e8899),
    rough: 0.05,
    isWater: true,
});
```

`isWater: true` is checked by `VoxelGrid.isSolid()` (returns false, keeping the block passable) and by `Controller` when probing for water surface level.

Below sea level the water plane already covers the carved channel — no voxels needed.

### Physics integration

`Controller` scans up to 4 blocks above/below the player for any `isWater` block each physics tick. If found, `waterSurface = wy + 1` replaces `WATER.level` for all swimming calculations: `standDepth`, submersion, buoyancy rest, and step-reach. Walking into a river above sea level correctly triggers swimming physics.

### Map rendering (`map.ts`)

Rivers are drawn on the minimap in `bakeTerrain()` after the terrain image is written. Two-pass render per channel (glow then solid), sorted trunk→tributary→stream. Ocean clip: any point where `heights[hz*S+hx] <= SEA` lifts the pen. Styles: trunk 7 px glow / 3.2 px solid blue; tributary 4.5 / 2.0; stream 3 / 1.2.

---

## UI

All UI is plain DOM, created by each module and styled by an injected `<style>` block with no framework. Overlays stack by `z-index`:

| z-index | Element       |
| ------- | ------------- |
| 5       | `#joy-zone`   |
| 10      | `#touch-btns` |
| 20      | `#hud`        |
| 30      | `#bubbles`    |
| 44      | `#map`        |
| 45      | `#pause`      |
| 46      | `#settings`   |
| 50      | `#boot`       |

Every overlay that takes input sets `input.paused` while it's open and restores the previous value when it closes.

- **HUD (`hud.ts`):**
    - The place name fades in on start.
    - The desktop shortcut hints (F, M, Y, Esc) are hidden on touch or narrow screens.
    - The time-of-day chip is always shown; the altitude/speed chip only in drone mode.
    - The ⚙ button appears once the boot screen is dismissed.
    - `update()` writes text every frame, so keep it cheap.
- **Settings (`settings.ts`):** outline width, zoom limits (legacy, from the third-person rig), fog on/off and start distance, stream radius (with live loaded/queued counts), shadow resolution (0–4096 in steps of 512, where 0 is off), planet radius, day speed, wind, palette, seed field and a "new world" button. The header shows the frame rate.
    - **Persistence:** values are saved under `localStorage['VoxelWorld.settings']` together with a `_version`. `load()` migrates old versions. v3 resets the stream radius and shadow size to the tier defaults, because earlier versions saved desktop values on every device.
    - **Reset** returns to `DEFAULTS`, which `setTierDefaults()` has already adjusted for this device.
- **Pause (`pause.ts`):** Esc opens it. It has Resume, Map, and a bindings list: `KEYBOARD_BINDINGS` or `TOUCH_BINDINGS`, chosen by `isTouchDevice` and kept in the same action order.
- **Map (`map.ts`):** see [Map](#map) below.
- **Bubbles (`bubbles.ts`):** pooled DOM speech bubbles anchored to an `Object3D`, projected to the screen each frame. The dog's sit and stand commands use them.

### Map

`src/ui/map.ts`

`bakeTerrain()` reads `BLOCK_BY_ID[id].top` for each column's highest block and writes one RGBA pixel per column, with water columns using the water palette colours. It runs on first open, and again only after `invalidateTerrain()` (palette switches). While the map is open, `update()` redraws the cached terrain each frame, with rivers, landmarks and the player arrow on top. While it's closed, `update()` does nothing.

#### Player arrow

The heading arrow always reflects where the camera is facing — `fpCam.camera.rotation.y + Math.PI` converts Three.js camera convention (forward = -Z) to map-north-up heading regardless of walk, fly, or drone mode. Previously the arrow switched source between `fpCam` and `controller.heading`, causing it to snap when entering drone mode; it now reads camera yaw unconditionally.

#### Compass labels

N/E/S/W labels are drawn at fixed canvas-edge positions each frame, rotated opposite to the player heading so the correct compass point always faces up.

#### Touch

On touch devices the 🗺 button wires to the same `map.toggle()` as the M key. Touch tap-outside-panel closes the map.

---

## Palette system

`src/core/palette.ts`

`VOXEL_PALETTES` is the single source of truth for **all** environmental colours — block colours, sky, light, atmosphere, water, petals, and post-FX grade. There are no hardcoded palette-driven hex literals anywhere else in the codebase.

### `VoxelPalette` interface

Each palette stores top-face hex colours only. `setVoxelPalette()` derives side, bottom, tint, `topTint` and fringe colours by darkening the top colour (×0.88/0.78 for grass and foliage, ×0.9/0.8 for soil, sand and stone).

```ts
interface VoxelPalette {
    label: string;
    grass: number;
    grassLight: number;
    grassDeep: number; // also drive the *_STONE grass variants
    soil: number;
    sand: number;
    stone: number;
    stonePale: number;
    stoneWarm: number;
    foliage: [number, number, number, number, number, number]; // LEAF_PINK, BLUSH, LILAC, CREAM, MINT, ROSE
    water: { shoal: number; shallow: number; deep: number };
    sky: { zenith: number; horizon: number; ground: number; haze: number; sunTint: number };
    light: { sunColor; sunIntensity; skyColor; groundColor; hemiIntensity; ambient; fillColor; fillIntensity };
    petals: [number, number, number, number, number, number];
    grade: {
        exposure;
        lift: [r, g, b];
        gamma: [r, g, b];
        gain: [r, g, b];
        saturation;
        contrast;
        vignette;
        bloom: { strength; radius; threshold };
    };
}
```

Five palettes are defined: **Autumn** (default), **Spring**, **Alpine**, **Desert** and **Alien**. `activePaletteName` records the current one.

### Initialisation pattern

Palette-driven exports (`SKY`, `LIGHT`, `WATER`, `PETAL_COLORS`, `GRADE`, and the colours of palette-driven blocks) are created as placeholders (`z = () => new THREE.Color(0)`). The module ends with `setVoxelPalette('Autumn')`, which fills every one of them in place. So any importer sees valid colours, and later switches mutate the same objects rather than replacing them.

Non-palette blocks (PATH, PLANK, BEAM, TRUNK, CRYSTAL, CLOTH, ROOF and so on) keep fixed colours, and `setVoxelPalette` never touches them.

### `setVoxelPalette(name)`

Mutates in place:

1. **Block colours** — `BLOCK_BY_ID` entries for all palette-driven block IDs.
2. **`SKY`** — zenith, horizon, haze, ground, sunTint.
3. **`LIGHT`** — sunColor, skyColor, groundColor.
4. **`WATER`** — shoal, shallow, deep, extinction.
5. **`PETAL_COLORS`** — spliced to the new palette's petal array.
6. **`GRADE`** — lift/gamma/gain colours, saturation, bloom parameters.

After calling it, existing mesh buffers are stale — `world.streaming.invalidateAll()` triggers a remesh of all loaded chunks.

### Live palette switch propagation (`main.ts` `onPaletteChange`)

A palette change must propagate beyond block colours because many subsystems clone palette colours into their own uniforms or buffers at construction time:

```
setVoxelPalette(name)
  │
  ├─ water.planetUnis — uShoal, uShallow, uDeep, uExtinction (cloned at creation)
  ├─ atmo.sky material uniforms — uSkyZenith, uSkyHorizon, uSkyNadir, uSunGlow
  ├─ atmo.scene.fog.color + atmo.hazeColor (separate cloned objects)
  ├─ dayNight.applyNoonSky(sky, light.sunColor)  ← patches DayNight PALETTE[3] keyframes
  ├─ atmo.hemi.color / groundColor  ← hemisphere light (set at construction only)
  ├─ water.material uniforms — uHorizon, uSky (sky-reflection, cloned at creation)
  ├─ post.grade uniforms — uLift, uGamma, uGain, uSaturation
  ├─ post.bloom.strength / radius / threshold
  ├─ particles.recolorPetals()  ← re-randomises aColor vertex buffer
  ├─ world.streaming.invalidateAll()
  └─ map.invalidateTerrain()
```

### DayNight noon keyframes

`DayNight.update()` drives sky dome uniforms **every frame** from module-scoped `PALETTE` keyframe arrays (7 keyframes: midnight → predawn → sunrise → noon → sunset → dusk → midnight). Without patching the noon keyframe (index 3), any `onPaletteChange` sky update would be overwritten on the very next frame.

`applyNoonSky(sky, sunColorHex)` patches only the noon entry:

```ts
applyNoonSky(sky: { zenith: number; horizon: number; haze: number }, sunColorHex: number): void {
  PALETTE.zenith[3].set(sky.zenith);
  PALETTE.horizon[3].set(sky.horizon);
  PALETTE.haze[3].set(sky.haze);
  PALETTE.sunColor[3].set(sunColorHex);
}
```

### Petal recolouring

Petal layers use an `aColor` `InstancedBufferAttribute` baked at geometry creation time. `particles.recolorPetals()` iterates the two petal mesh layers, replaces every colour triple in the buffer with a random sample from `PETAL_COLORS`, and sets `attr.needsUpdate = true`. The two petal `Mesh` objects are tracked in a `petalMeshes: THREE.Mesh[]` array inside `createParticles()`.

---

## Boot screen

The loading overlay (`#boot` in `index.html`) shows a spinning CSS 3D voxel cube while the world generates.

### Cube structure

```html
<div class="ls-emblem">
    <div class="ls-cube">
        <div class="ls-face ls-face--top"></div>
        <div class="ls-face ls-face--bottom"></div>
        <div class="ls-face ls-face--front"></div>
        <div class="ls-face ls-face--back"></div>
        <div class="ls-face ls-face--left"></div>
        <div class="ls-face ls-face--right"></div>
    </div>
</div>
```

`.ls-cube` uses `transform-style: preserve-3d` with `perspective: 240px` on the parent. Each face is `translateZ(32px)` after the appropriate `rotateX/Y` so all six faces sit at ±32 px from centre. Face colours simulate ambient-occlusion shading: top (#d4922a brightest) → front/right (mid amber) → left/back (dark terracotta) → bottom (#4a1e02 darkest).

`@keyframes ls-voxel` rotates the cube around Y on a −20° X tilt (`rotateX(-20deg) rotateY(0deg → 360deg)`) over 3.2 s, giving an isometric-style spin that reads as a voxel block from all angles.

When the `.ready` class is added, `#boot.ready .ls-emblem { opacity: 0 }` fades the cube out over 0.5 s.

---

## Debugging & diagnostics

### URL parameters

| Parameter                    | Effect                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `?seed=word`                 | Choose the world. Always present after load                                         |
| `?tier=name`                 | Force a GPU tier (`high`, `mobile-high`, `mid`, `low`, `very-low`)                  |
| `?shadow=N`                  | Diagnostic shadow-map size, used only if the tier gives none                        |
| `?weather=clear\|rain\|snow` | Pin the weather (otherwise fronts cycle every few minutes)                          |
| `?capture=1`                 | `preserveDrawingBuffer: true`, so `canvas.toDataURL()` works for screenshot tooling |

### `window.__game`

`main.ts` exposes the live objects: `scene`, `renderer`, `fpCam`, `world`, `controller`, `character`, `post`, `atmo`, `water`, `particles`, `navigator`, `map`, `pause`, `settings`, `hud`, `input`, `dog`, `bubbles`, `tier`, `dayNight`, `drone` and `fly`. `window.__fps` holds the frame rate, smoothed over 0.75 s.

Useful console snippets:

```js
__game.tier; // detected tier
__game.renderer.info.render; // draw calls / triangles last frame
__game.world.streaming.loadedCount; // chunks resident
__game.dayNight.timeOfDay = 0.75; // jump to dusk
__game.controller.pos.set(400, 60, 400); // teleport (walk mode)
const gl = __game.renderer.getContext(); // which GPU did we get?
gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);
```

### Testing on devices

- **Real devices:** use the dev server on the LAN (`npx vite --host`), then try each tier with `?tier=`.
- **Desktop emulation:** Chrome DevTools device emulation (or Playwright `devices[...]`) sets the touch and mobile signals. However, headless Chrome renders with **SwiftShader**, which detection correctly classifies as very-low, so add `?tier=` when emulating. To see real GPU behaviour on Windows, including ANGLE/D3D shader warnings, launch Chrome with `--use-angle=d3d11`.
- **Shader warnings:** ANGLE prints HLSL line numbers, which don't map to GLSL. To find which program a warning belongs to, iterate `renderer.info.programs` and check `gl.getProgramInfoLog(p.program)`.

---

## Conventions & gotchas

- **Colours are linear.** Palette colours are stored linear. `THREE.Color.getHex()` encodes to sRGB. Never call `convertLinearToSRGB()` before handing a colour to Three, because lights, fog and clear colour all expect linear values.
- **Manual matrix updates.** `scene.matrixWorldAutoUpdate` is false after startup.
    - Anything that moves must call `updateMatrixWorld()` itself, as the character, dog, sun, sky and pulse do.
    - Static meshes set `matrixAutoUpdate = false`.
    - If you add a moving object and it doesn't move on screen, this is why.
- **`clock.update()` must run before `clock.getDelta()`.** `THREE.Timer.getDelta()` doesn't update itself; without the call, `dt` is 0 and physics freezes.
- **Shared materials can't have per-mesh uniform values** (see [Materials](#materials--shader-injection)). Use attributes or separate materials.
- **Bump `customProgramCacheKey`** whenever injected GLSL changes.
- **Inside loops and per-pixel branches, use `textureLod`** for every texture fetch (see [Atmosphere](#atmosphere-haze)).
- **New world materials** must include `PLANET_BEND_GLSL` and register their uniforms in `world.allPlanetUnis`. Otherwise they won't curve with the rest of the world.
- **Fog consistency:** any shader that fades with distance must use the same near-plane fog (`FOG_NEAR`, `aerialD`), or a ring appears where the two disagree.
- **Optional or tier-dependent generation must use its own RNG stream** (see [Determinism](#determinism--seeding)).
- **Palette changes must propagate** to every place that cloned a colour (see [Live palette switch propagation](#live-palette-switch-propagation-maints-onpalettechange)).
- **Wind guard:** test `_windBase > 0`, the scalar, not `uWindStrength`, the uniform object, which is always truthy.
- **Generation order is a contract:** plan → terrain → props → stamps → vegetation. A pass may only read results from passes before it.
- **Comments explain _why_.** Most modules open with a design note, and constants carry the reasoning behind their values. When you change a tuned number, update its comment.
- **`ponytail:` comments** mark deliberate simplifications that have a known ceiling, along with the upgrade path. Search for them before optimising.
