/**
 * Chunk-meshing Web Worker.
 *
 * Purpose:
 *   Moves chunk meshing (face culling, baked AO, edge lines) off the main
 *   thread so world streaming doesn't hitch the frame loop.
 *
 * Operations / message protocol:
 *   in  { type: 'block-registry', definitions } — install block definitions;
 *       must arrive before any chunk request (voxel.ts sends it on creation
 *       and again whenever the registry changes).
 *   in  { key, window }  — mesh one chunk window via buildChunkTransferPayload.
 *   out { key, ci, ck, payload } on success, { key, ci, ck, error } on failure.
 *
 * Usage:
 *   Spawned by voxel.ts with
 *   `new Worker(new URL('./voxel-worker.ts', import.meta.url), { type: 'module' })`.
 *   Not imported directly.
 *
 * Important:
 *   - Geometry buffers are posted as transferables (zero-copy); after posting,
 *     the worker's copies are detached. collectTransfers de-duplicates
 *     buffers because transferring the same ArrayBuffer twice throws.
 *   - Any new buffer added to the payload must also be added to
 *     collectTransfers, or it will be structured-cloned (slow) instead.
 */
import { buildChunkTransferPayload, installBlockRegistry } from './voxel';

function collectTransfers(payload: any) {
    const transfers: any[] = [];
    const addGeometry = (geometry: any) => {
        if (!geometry) return;
        for (const attribute of Object.values(geometry.attributes) as any[]) {
            transfers.push((attribute as any).array.buffer);
        }
        if (geometry.index) transfers.push(geometry.index.array.buffer);
    };
    addGeometry(payload.solid);
    addGeometry(payload.glow);
    if (payload.edges) {
        transfers.push(payload.edges.positions.buffer);
        transfers.push(payload.edges.normalA.array.buffer);
        transfers.push(payload.edges.normalB.array.buffer);
        transfers.push(payload.edges.light.array.buffer);
        transfers.push(payload.edges.roundCaps.array.buffer);
    }
    return [...new Set(transfers)];
}

self.onmessage = ({ data }) => {
    if (data.type === 'block-registry') {
        installBlockRegistry(data.definitions);
        return;
    }

    const { key, window } = data;
    try {
        const payload = buildChunkTransferPayload(window);
        (self as any).postMessage({ key, ci: window.ci, ck: window.ck, payload }, collectTransfers(payload));
    } catch (error) {
        self.postMessage({
            key,
            ci: window.ci,
            ck: window.ck,
            error: error instanceof Error ? error.message : String(error),
        });
    }
};
