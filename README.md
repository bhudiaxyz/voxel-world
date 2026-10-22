# Voxel World

A first-person procedural voxel planet wilderness explorer written in Three.js. The island generates entirely in the browser: terraced terrain, rivers, blossom trees, bridges, a companion dog, and a day/night cycle that runs in real time. Walk the curved surface of a tiny planet — the world bends away from you at the horizon.

## Highlights

- **Curved planet** — GPU vertex bending gives the island a Mario-Galaxy-style curvature. Physics stay flat; only the visuals curve.
- **Day/night cycle** — a 20-minute day with seven keyframed sky palettes. Watch the sun rise through orange haze, reach a pale noon, and set again.
- **Night sky** — procedural stars, a Milky Way with dust lane, emission nebulae, and a moon disc. Fades out near sunrise.
- **Volumetric-style atmosphere** — sunrise/sunset limb glow, crepuscular rays (eight-tap radial blur), and animated cloud cover.
- **Drone mode** — float above the terrain and cruise hands-free. The drone follows the ground height at a smooth altitude.
- **Ink edge rendering** — a custom analytic line pass draws toon-style dark and light strokes at block boundaries, composited in display space after tone mapping so outlines never bloom or saturate.
- **LOD fade** — distant chunks dissolve in with a Bayer 4×4 ordered dither rather than popping.
- **Rich vegetation** — ferns, red ferns, thick moss, pale lichen on cliff faces, tall shrubs, grass tufts, willow trees, and spire trees join the existing oaks and blossoms.
- **TypeScript** — the entire codebase is strict-mode TypeScript.

## Run

Needs Node.js 18+.

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). First load generates the island — give it a few seconds.

```bash
npm run build     # production bundle → dist/
npm run preview   # serve that bundle locally
```

## Controls

| Input | Action |
| --- | --- |
| WASD | Move |
| Mouse | Look |
| Space | Jump (hold in water to swim up) |
| E | Toggle edge outlines |
| G | Toggle drone mode |
| Y | Tell the dog to sit or stand |
| M | Toggle map |
| Esc | Pause / release pointer |
| `` ` `` | Settings |

In drone mode, mouse pitch controls altitude and WASD steers. The drone lands automatically when you press G again.

Click in the viewport to capture the pointer. Press Esc to release it.

## Settings

The settings panel (`` ` ``) exposes:

| Setting | Range | Effect |
| --- | --- | --- |
| Planet radius | 100 – 1000 | Tighter or looser horizon curve |
| Day speed | 0.1× – 5× | Slow sunrise or fast time-lapse |
| Load radius | — | How many chunks stream around the player |
| Shadow resolution | — | Shadow map quality |
| Bloom | — | Post-process bloom intensity |

## Source

| Path | What it does |
| --- | --- |
| `src/main.ts` | Scene, loop, and wiring |
| `src/core/` | Voxel grid, mesher, workers, palette, RNG |
| `src/world/` | Terrain, planner, vegetation, props, stamps, water |
| `src/render/` | Renderer, FP camera, lighting, sky, day/night, planet GLSL, post-FX |
| `src/player/` | Character, controller, pathfinding, dog, drone mode |
| `src/ui/` | HUD, map, pause, settings, speech bubbles |
| `src/fx/` | Particles |

`three` and `vite` are the only runtime dependencies. No image or model assets — every block, character, and effect is built in code.

## Deploy

The project is configured for GitHub Pages. Push to `main` and the `deploy-pages` workflow builds and publishes automatically.

## License

Released under the [MIT License](LICENSE).
