/**
 * Weather — a tiny state machine that drives precipitation and its traces on
 * the ground.
 *
 *   clear ──► rain ──► clear ──► snow ──► clear …   (one front every few minutes)
 *
 * Two kinds of value, deliberately separate:
 *
 *   - `rain` / `snow` — what is falling *now*. Eases in and out over ~20 s so a
 *     front arrives rather than switching on.
 *   - `wet` / `snowCover` — what the ground remembers. Wetness builds while it
 *     rains and dries slowly after; snow cover accumulates while it snows and
 *     melts (faster in rain, which washes it away). Puddles and settled snow
 *     outlive the weather that made them, which is most of what sells them.
 *
 * `?weather=clear|rain|snow` pins the state for testing. Everything downstream
 * reads zero in clear weather, so this costs nothing until it rains.
 */

export type WeatherKind = 'clear' | 'rain' | 'snow';

const FRONT_SECONDS: Record<WeatherKind, [number, number]> = {
    clear: [150, 320],
    rain: [70, 140],
    snow: [80, 160],
};
const EASE = 1 / 20; // fall intensity change per second
const WET_RATE = 1 / 25; // seconds of rain to soak the ground
const DRY_RATE = 1 / 120; // seconds to dry afterwards
const SNOW_RATE = 1 / 60; // seconds of snow to full cover
const MELT_RATE = 1 / 150; // slow melt in clear weather (×4 in rain)

export class Weather {
    kind: WeatherKind = 'clear';
    rain = 0;
    snow = 0;
    wet = 0;
    snowCover = 0;
    private next: WeatherKind = 'rain';
    private timer: number;
    private readonly pinned: WeatherKind | null;

    constructor(private rng: () => number = Math.random) {
        const q = new URLSearchParams(location.search).get('weather') as WeatherKind | null;
        this.pinned = q && q in FRONT_SECONDS ? q : null;
        if (this.pinned) this.kind = this.pinned;
        this.timer = this.duration('clear');
    }

    private duration(k: WeatherKind) {
        const [a, b] = FRONT_SECONDS[k];
        return a + (b - a) * this.rng();
    }

    update(dt: number): void {
        if (!this.pinned) {
            this.timer -= dt;
            if (this.timer <= 0) {
                if (this.kind === 'clear') {
                    this.kind = this.next;
                    this.next = this.next === 'rain' ? 'snow' : 'rain';
                } else {
                    this.kind = 'clear';
                }
                this.timer = this.duration(this.kind);
            }
        }
        const toward = (v: number, target: number, rate: number) =>
            v < target ? Math.min(target, v + rate * dt) : Math.max(target, v - rate * dt);

        this.rain = toward(this.rain, this.kind === 'rain' ? 1 : 0, EASE);
        this.snow = toward(this.snow, this.kind === 'snow' ? 1 : 0, EASE);
        // Ground memory.
        this.wet = this.rain > 0.05 ? toward(this.wet, 1, WET_RATE * this.rain) : toward(this.wet, 0, DRY_RATE);
        this.snowCover =
            this.snow > 0.05
                ? toward(this.snowCover, 1, SNOW_RATE * this.snow)
                : toward(this.snowCover, 0, MELT_RATE * (1 + this.rain * 3));
        // Melting snow leaves the ground wet.
        if (this.snowCover > 0 && this.snow < 0.05) this.wet = Math.max(this.wet, this.snowCover * 0.6);
    }
}
