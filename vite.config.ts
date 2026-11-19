/**
 * Vite build/dev configuration.
 *
 * Purpose / operations:
 *   - Dev server defaults to port 5175, no auto-open. Note `npm run dev`
 *     overrides this with `--port 5170 --strictPort`.
 *   - Production build targets ES2020 and splits three.js into its own
 *     `three` chunk so app changes don't bust the large library cache.
 *
 * Important:
 *   - `base: '/voxel-world/'` — the app is served from that sub-path; asset
 *     URLs break if it is deployed elsewhere without changing this.
 */
import { defineConfig } from 'vite';

export default defineConfig({
    base: '/voxel-world/',
    server: {
        port: 5175,
        open: false,
    },
    build: {
        target: 'es2020',
        chunkSizeWarningLimit: 1000,
        rollupOptions: {
            output: {
                manualChunks: (id) => (id.includes('three') ? 'three' : undefined),
            },
        },
    },
});
