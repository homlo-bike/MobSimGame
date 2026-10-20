/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// The dev server proxies /api to the FastAPI backend so the browser never needs
// to know backend credentials. Only VITE_* variables reach the bundle; never put
// secrets in them (see docs/PROVIDER_CONFIGURATION.md).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Shown under Data & licences so a stale image or cached build is easy to spot.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.MOBSIM_API_PROXY_TARGET ?? 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 2500,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
