import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const api = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@arrive/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) } },
  server: { port: 5173, proxy: { '/api': api } },
  preview: { port: 4173, proxy: { '/api': api } },
  build: { sourcemap: false, chunkSizeWarningLimit: 900 },
});
