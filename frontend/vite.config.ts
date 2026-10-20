/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/**
 * Identity of this build. The running app compares its own build id with the
 * deployed /version.json to detect a newer deployment (see docs/CACHING.md).
 * MOBSIM_BUILD_ID (e.g. a commit hash) can be passed by CI; otherwise the build time is used.
 */
const builtAt = new Date().toISOString();
const buildId = process.env.MOBSIM_BUILD_ID || builtAt;
const versionInfo = { version: pkg.version, buildId, builtAt };

function versionFile(): Plugin {
  return {
    name: 'mobsim-version-file',
    // Served by the dev server too, so the update check behaves the same in development.
    configureServer(server) {
      server.middlewares.use('/version.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(versionInfo));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(versionInfo) });
    },
  };
}

// The dev server proxies /api to the FastAPI backend so the browser never needs
// to know backend credentials. Only VITE_* variables reach the bundle; never put
// secrets in them (see docs/PROVIDER_CONFIGURATION.md).
export default defineConfig({
  plugins: [react(), tailwindcss(), versionFile()],
  // Shown under Data & licences so a stale image or cached build is easy to spot.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(builtAt),
    __BUILD_ID__: JSON.stringify(buildId),
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
