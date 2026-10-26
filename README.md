# Voxel World

A first-person explorer for a procedurally generated spherical voxel world (Three.js + TypeScript + Vite). Walk, drone, or fly across the planet, exploring terraced terrain, rivers, blossom trees, bridges, a companion dog, and a real-time day/night cycle with animated aurora. Walk the curved surface of a tiny planet — the world bends away from you at the horizon.

Inspired by **Verdant** [https://github.com/xikhar/verdant] and **Petalfell** [https://github.com/xikhar/voxel-game-original], along with aspects of **Beyond Fable** [https://github.com/xikhar/beyond-fable].

## Highlights

- **Curved planet** — GPU vertex bending gives the planet a Mario-Galaxy-style curvature. Physics stay flat; only the visuals curve.
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

For architecture and implementation details, see [DESIGN.md](DESIGN.md).

## Run

Needs Node.js 18+.

```bash
npm install
npm run dev
```

Open [http://localhost:5180/voxel-world](http://localhost:5180/voxel-world). First load generates the world — give it a few seconds.

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

## Dependencies

`three`, `nipplejs`, and `vite` are the only runtime dependencies. No image or model assets — every block, character, and effect is built in code.

## Deploy

The project is configured for GitHub Pages. Push to `main` and the `deploy-pages` workflow builds and publishes automatically.

## License

Released under the [MIT License](LICENSE).
