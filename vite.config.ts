import { defineConfig } from 'vite';

export default defineConfig({
  base: '/voxel-world/',
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2020',
  },
});
