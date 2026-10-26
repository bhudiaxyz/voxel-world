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
