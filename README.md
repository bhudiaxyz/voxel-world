# Voxel World

A first-person explorer for a procedurally generated spherical voxel world (Three.js + TypeScript + Vite). Walk, drone, or fly across an archipelago of continents connected by bridges, exploring terraced terrain, rivers, blossom trees, a companion dog, and a real-time day/night cycle with animated aurora. The world bends away from you at the horizon — a Mario-Galaxy-style curve applied entirely on the GPU.

Inspired by **Verdant** [https://github.com/xikhar/verdant] and **Petalfell** [https://github.com/xikhar/voxel-game-original], along with aspects of **Beyond Fable** [https://github.com/xikhar/beyond-fable].

## Highlights

- **Archipelago worldgen** — 3–5 main continents scattered across the ocean, connected by chains of stepping-stone islands and arched wooden bridges. Each seed produces a distinct layout.
- **Curved planet** — GPU vertex bending gives the world a sphere-like horizon. Physics stay flat; only the visuals curve.
- **Day/night cycle** — a 20-minute day with seven keyframed sky palettes and time-of-day tints pushed live to the voxel material. Watch the sun rise through orange haze, reach a pale noon, and set again.
- **Night sky** — procedural stars, a Milky Way with Great Rift dust lane, emission nebulae, and a moon disc.
- **Aurora** — animated curtain aurora at deep night: flickering vertical rays, sweeping pulse waves, and colour that shifts from green through cyan to magenta and ghostly white at peaks.
- **Volumetric-style atmosphere** — sunrise/sunset limb glow, crepuscular rays (eight-tap radial blur), and animated cloud cover.
- **Fly and drone modes** — free-flight (F) or terrain-following drone (G) with P-controller altitude hold and smooth landing state machine.
- **Ink edge rendering** — toon-style dark and light strokes at block boundaries, composited in display space after tone mapping. Toggle with E.
- **Rich vegetation** — nine tree silhouette forms (oak, blossom, willow, spire, umbrella, broad, tall birch, layered pagoda, weeping cherry), ferns, moss, lichen, grass, and scattered mushrooms and crystals.
- **Touch controls** — full nippleJS virtual joystick overlay with compass-aware minimap, auto-detected on load.
- **GPU tiering** — five quality tiers (high / mobile-high / mid / low / very-low) tuned at startup from device cores, memory, texture-unit size, and UA. Flagship phones and iPads land on `mobile-high`; desktop discrete GPUs on `high`.
- **Rivers** — trunks meander from highland peaks to the coast, fed by tributaries and fine streams. Above sea level they are filled with teal-blue voxels (true swimming physics); at sea level the ocean water plane takes over. All rivers are drawn on the minimap with glow outlines, clipped at the coastline.
- **Scenic stamps** — hand-crafted micro-scenes seeded across each continent: waterfall gardens, stone crossings over rivers, lily ponds, blossom groves with torii gates, and cliff overlooks with parapets. Each re-validates the terrain before building and downgrades gracefully if conditions aren't met.
- **Landmarks** — ancient structures appear on each continent: twisted spires, obelisks, monolith rings, tombstone fields, and floating biospheres. All marked on the map.
- **Real wave geometry** — the water plane has true vertex displacement driven by the same analytic wave field as the surface normal, so crests cast light consistently.
- **Seeded worlds** — the seed word is always visible in the URL (`?seed=word`). Share a URL to share an exact world; generate a new one from the pause menu.

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
| World seed | text | The seed word for the current world |

The pause menu (Esc) also has a **Generate new world** button that picks a random seed, writes it to the URL, and reloads.

## Dependencies

`three`, `nipplejs`, and `vite` are the only runtime dependencies. No image or model assets — every block, character, and effect is built in code.

## Deploy

The project is configured for GitHub Pages. Push to `main` and the `deploy-pages` workflow builds and publishes automatically.

## License

Released under the [MIT License](LICENSE).
