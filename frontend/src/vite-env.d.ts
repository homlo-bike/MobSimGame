/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_EXTRA_BASEMAPS?: string;
  readonly VITE_TERRAIN_TILES_URL?: string;
  readonly VITE_SOURCE_URL?: string;
  /** Minimum browser log level: debug | info (log) | warn (warning) | error | silent. */
  readonly VITE_LOG_LEVEL?: string;
}

/** Package version and build time, injected by vite.config.ts. */
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;
