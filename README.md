# Voxel World

A first-person procedural voxel planet wilderness explorer written in Three.js. The island generates entirely in the browser: terraced terrain, rivers, blossom trees, bridges, a companion dog, and a real-time day/night cycle. Walk the curved surface of a tiny planet — the world bends away from you at the horizon.

## Highlights

- **Curved planet** — GPU vertex bending gives the island a Mario-Galaxy-style curvature. Physics stay flat; only the visuals curve.
- **Day/night cycle** — a 20-minute day with seven keyframed sky palettes. Watch the sun rise through orange haze, reach a pale noon, and set again.
- **Night sky** — procedural stars, a Milky Way with dust lane, emission nebulae, and a moon disc. Fades out near sunrise.
- **Volumetric-style atmosphere** — sunrise/sunset limb glow, crepuscular rays (eight-tap radial blur), and animated cloud cover.
- **Fly mode** — press F to enter free-flight. WASD moves in any direction; Space/C ascend and descend. You can climb as high as you like to view the planet from orbit, but you cannot fly below the terrain. Press F again to land.
- **Drone mode** — press G to take off. The drone always flies forward; A/D steer. Ascend and descend with Space/C. Press L to land smoothly; pulling up cancels the landing.
- **Ink edge rendering** — a custom analytic line pass draws toon-style dark and light strokes at block boundaries, composited in display space after tone mapping so outlines never bloom or saturate. Toggle with E.
- **LOD fade** — distant chunks dissolve in with a Bayer 4×4 ordered dither rather than popping.
- **Rich vegetation** — ferns, red ferns, thick moss, pale lichen on cliff faces, tall shrubs, grass tufts, willow trees, and spire trees join the existing oaks and blossoms.
- **Touch controls** — full nippleJS virtual joystick overlay on phones and tablets. Left stick moves, right-half swipe looks, dedicated buttons for jump, ascend/descend, sprint, drone, land, and edge toggle. Adapts automatically on load.
- **GPU tiering** — detects device capability at startup (cores + memory + UA) and adjusts DPR cap, shadow resolution, bloom, and blur samples across three tiers (high / mid / low). Tested against Samsung Galaxy S22 Ultra, Apple iPad, and budget devices up to seven years old.
- **TypeScript** — the entire codebase is strict-mode TypeScript.

## Run

Needs Node.js 18+.

```bash
npm install
npm run dev
```

Open [http://localhost:5180](http://localhost:5180). First load generates the island — give it a few seconds.

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
| G | Enter drone mode (auto-forward, A/D steer) |
| L | Land (drone) |
| Space / C | Ascend / descend (fly or drone) |
| E | Toggle edge outlines |
| Y | Tell the dog to sit or stand |
| M | Toggle map |
| Esc | Pause / release pointer |
| `` ` `` | Settings |

Click in the viewport to capture the pointer. Press Esc to release it. While landing the drone, press Space to abort and resume cruising.

### Touch (phone / tablet)

| Control | Action |
| --- | --- |
| Left joystick | Move |
| Swipe right half | Look |
| ↑ | Jump / ascend |
| ↓ | Descend (drone) |
| ⚡ | Sprint |
| ✈ | Toggle fly mode (tap again to exit) |
| 🚁 | Enter drone mode |
| 🛬 | Land drone (visible while drone is airborne) |
| ⬡ | Toggle edge outlines |

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
| `src/render/` | Renderer, FP camera, lighting/atmosphere, day/night, planet GLSL, post-FX, GPU tier |
| `src/player/` | Character, physics controller, pathfinding, dog AI, drone mode, fly mode |
| `src/ui/` | HUD, map, pause menu, settings panel, speech bubbles, touch controls |
| `src/fx/` | Particles |

### Rendering pipeline

Post-processing is built on Three.js `EffectComposer` with a custom pass chain:

```text
SceneDepthPass → EdgeMaskPass → Atmosphere → Bloom → Crepuscular → Grade/Output → FXAA
```

- **SceneDepthPass** — renders the scene to a dedicated FBO that owns the depth texture, then blits colour to the read buffer. Keeps the depth texture outside the ping-pong chain to prevent WebGL feedback loops.
- **EdgeMaskPass** — renders a dedicated edge layer to a separate render target sampled by the grade shader.
- **GradeShader** — composites the edge mask, applies colour grading, tone mapping, and outputs to the screen.

### GPU tiering

`src/render/gpu-tier.ts` buckets devices at startup:

| Tier | DPR cap | Shadow | Blur samples | Bloom |
| --- | --- | --- | --- | --- |
| high | 2× | 3072 px | 16 | ✓ |
| mid | 1.5× | 2048 px | 8 | ✓ |
| low | 1× | 1024 px | 4 | — |

Detection uses `hardwareConcurrency`, `deviceMemory`, and the mobile user-agent string.

### Touch input

`src/ui/touch-controls.ts` creates a nippleJS joystick zone on the left half of the screen and a raw-touch swipe-to-look zone on the right half. All touch state flows through `FPCamera` alongside keyboard/mouse state so the game loop is unaware of the input source. Fly and drone modes receive raw joystick axes; drone steers with its own internal yaw while fly strafe-moves in the camera's yaw direction.

## Dependencies

`three`, `nipplejs`, and `vite` are the only runtime dependencies. No image or model assets — every block, character, and effect is built in code.

## Deploy

The project is configured for GitHub Pages. Push to `main` and the `deploy-pages` workflow builds and publishes automatically.

## License

Released under the [MIT License](LICENSE).
