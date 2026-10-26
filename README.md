# Voxel World

A first-person explorer for a procedurally generated spherical voxel world (Three.js + TypeScript + Vite). Walk, drone, or fly across the planet, exploring terraced terrain, rivers, blossom trees, bridges, a companion dog, and a real-time day/night cycle with animated aurora. Walk the curved surface of a tiny planet — the world bends away from you at the horizon.

*Voxel World* inspiration came from **Verdant** [https://github.com/xikhar/verdant] and **Petalfell** [https://github.com/xikhar/voxel-game-original], along with aspects of **Beyond Fable** [https://github.com/xikhar/beyond-fable].

## Highlights

- **Curved planet** — GPU vertex bending gives the island a Mario-Galaxy-style curvature. Physics stay flat; only the visuals curve.
- **Day/night cycle** — a 20-minute day with seven keyframed sky palettes. Watch the sun rise through orange haze, reach a pale noon, and set again.
- **Night sky** — procedural stars, a Milky Way with Great Rift dust lane, emission nebulae, and a moon disc. Fades out near sunrise.
- **Aurora** — animated curtain aurora appears at deep night: flickering vertical rays, sweeping pulse waves, slow breathing intensity, and colour that shifts from green through cyan to magenta and ghostly white at peaks.
- **Volumetric-style atmosphere** — sunrise/sunset limb glow, crepuscular rays (eight-tap radial blur), and animated cloud cover.
- **Fly mode** — press F to enter free-flight. WASD moves in any direction; Space/C ascend and descend. You can climb as high as you like to view the planet from orbit, but you cannot fly below the terrain. Press F again to land.
- **Drone mode** — press G to take off. The drone always flies forward; A/D steer. The drone terrain-follows smoothly, gradually adjusting altitude to match the ground contours. Ascend and descend with Space/C or scroll. Press L to land; pulling up cancels the landing.
- **Ink edge rendering** — a custom analytic line pass draws toon-style dark and light strokes at block boundaries, composited in display space after tone mapping so outlines never bloom or saturate. Toggle with E.
- **LOD fade** — distant chunks dissolve in with a Bayer 4×4 ordered dither rather than popping.
- **Rich vegetation** — ferns, red ferns, thick moss, pale lichen on cliff faces, tall shrubs, grass tufts, willow trees, and spire trees join the existing oaks and blossoms. Bushes generate in four silhouette forms: mound, spread, tall, and cluster.
- **Touch controls** — full nippleJS virtual joystick overlay on phones and tablets. Left stick moves, right-half swipe looks, dedicated buttons for jump, ascend/descend, sprint, drone, land, edge toggle, and time stepping. Adapts automatically on load.
- **GPU tiering** — detects device capability at startup (cores + memory + UA) and adjusts DPR cap, shadow resolution, bloom, AO taps, and blur samples across four tiers (high / mid / low / very-low). Tested against Samsung Galaxy S22 Ultra, Apple iPad, and budget devices up to seven years old.
- **TypeScript** — the entire codebase is strict-mode TypeScript.

## Run

Needs Node.js 18+.

```bash
npm install
npm run dev
```

Open [http://localhost:5180/voxel-world](http://localhost:5180/voxel-world). First load generates the island — give it a few seconds.

```bash
npm run build     # production bundle → dist/
npm run preview   # serve that bundle locally
```

## Controls

### Keyboard & mouse

| Input | Action |
| --- | --- |
| WASD | Move |
| Mouse | Look |
| Space | Jump (hold in water to swim up) |
| Shift | Sprint |
| F | Toggle fly mode (free flight, terrain floor) |
| G | Enter drone mode (terrain-following, A/D steer) |
| L | Land (drone) |
| Space / C | Ascend / descend (fly or drone) |
| Scroll | Ascend / descend (drone) |
| E | Toggle edge outlines |
| Y | Tell the dog to sit or stand |
| M | Toggle map |
| [ / ] | Step time of day back / forward by 3 hours |
| Esc | Pause / release pointer |
| `` ` `` | Settings |

Click in the viewport to capture the pointer. Press Esc to release it. While landing the drone, press Space to abort and resume cruising.

### Touch (phone / tablet)

| Control | Action |
| --- | --- |
| Left joystick | Move / steer (joystick Y brakes the drone) |
| Swipe right half | Look |
| ↑ | Jump / ascend |
| ↓ | Descend (drone or fly) |
| ⚡ | Sprint |
| ✈ | Toggle fly mode (tap again to exit) |
| 🚁 | Enter drone mode |
| 🛬 | Land drone (visible while drone is airborne) |
| ⬡ | Toggle edge outlines |
| ◀ / ▶ | Step time of day back / forward by 3 hours |

The joystick overlay appears automatically on touch devices and is hidden on desktop.

## Settings

The settings panel (`` ` ``) exposes:

| Setting | Range | Effect |
| --- | --- | --- |
| Planet radius | 100 – 1000 | Tighter or looser horizon curve |
| Day speed | 0.1× – 5× | Slow sunrise or fast time-lapse |
| Load radius | — | How many chunks stream around the player |
| Shadow resolution | — | Shadow map quality |
| Bloom | — | Post-process bloom intensity |

## Architecture

### Source layout

| Path | What it does |
| --- | --- |
| `src/main.ts` | Scene setup, game loop, and input wiring |
| `src/core/` | Voxel grid, greedy mesher, worker threads, palette, RNG |
| `src/world/` | Terrain generator, vegetation, props, stamps, water |
| `src/render/` | Renderer, FP camera, lighting/atmosphere, sky shader, day/night, planet GLSL, post-FX, GPU tier |
| `src/player/` | Character, physics controller, pathfinding, dog AI, drone mode, fly mode |
| `src/ui/` | HUD, map, pause menu, settings panel, speech bubbles, touch controls |
| `src/fx/` | Particles |

### Rendering pipeline

Post-processing is built on Three.js `EffectComposer` with a custom pass chain:

```text
SceneDepthPass → EdgeMaskPass → Atmosphere → Bloom → Crepuscular → Grade/Output → SMAA
```

- **SceneDepthPass** — renders the scene to a dedicated FBO that owns the depth texture, then blits colour to the read buffer. Keeps the depth texture outside the ping-pong chain to prevent WebGL feedback loops.
- **EdgeMaskPass** — renders a dedicated edge layer to a separate render target sampled by the grade shader.
- **Atmosphere** — large-scale AO via 8-tap depth rosette (tier-scaled), defocus blur, and aerial perspective using the shared sky model so distant land fades seamlessly into the sky colour.
- **GradeShader** — composites the edge mask, applies colour grading, tone mapping, and outputs to the screen.

### Sky model

`src/render/sky.ts` exports a shared GLSL function block (`skyRadiance`) used by both the sky dome mesh and the aerial-perspective atmosphere pass. Sharing the same function ensures the colour distant geometry fades toward is bit-for-bit the sky colour in that direction — no seam at the horizon. The same file implements `nightSkyAddons` (stars, Milky Way, nebulae, moon) and `_aurora` (animated curtain).

### GPU tiering

`src/render/gpu-tier.ts` buckets devices at startup:

| Tier | DPR cap | Shadow | Blur samples | Bloom | AO taps | DoF |
| --- | --- | --- | --- | --- | --- | --- |
| high | 2× | 3072 px | 16 | ✓ | 8 | ✓ |
| mid | 1.25× | 2048 px | 8 | ✓ | 4 | ✓ |
| low | 1× | 1024 px | 4 | — | 4 | — |
| very-low | 1× | 512 px | 2 | — | 0 | — |

Detection uses `hardwareConcurrency`, `deviceMemory`, and the mobile user-agent string (including iPad). Shadow map auto-update is disabled on very-low tier; the day/night cycle triggers a single update per animation frame instead.

### Touch input

`src/ui/touch-controls.ts` creates a nippleJS joystick zone on the left half of the screen and a raw-touch swipe-to-look zone on the right half. All touch state flows through `FPCamera` alongside keyboard/mouse state so the game loop is unaware of the input source. Fly and drone modes receive raw joystick axes (`_joyX`, `_joyY`): drone steers yaw with `joyX` and brakes with negative `joyY`; fly strafe-moves in the camera's yaw direction.

## Dependencies

`three`, `nipplejs`, and `vite` are the only runtime dependencies. No image or model assets — every block, character, and effect is built in code.

## Deploy

The project is configured for GitHub Pages. Push to `main` and the `deploy-pages` workflow builds and publishes automatically.

## License

Released under the [MIT License](LICENSE).
