import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Forward all /api/* and /stream/* calls to the Express backend
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/stream': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
