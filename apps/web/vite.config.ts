import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite proxies /api to the Node API so the browser sees one origin in development,
// mirroring same-origin Workers Static Assets in production (FR-D.6).
export default defineConfig({
  plugins: [react()],
  // Pinned explicitly: newer esbuild (see root package.json overrides) fails to transform
  // destructuring for Vite's default legacy browser target list — both for the production build
  // AND the dev-server's dependency pre-bundler (a separate esbuild pass with its own target).
  build: {
    target: 'es2022',
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2022',
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
