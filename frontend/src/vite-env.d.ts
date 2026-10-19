/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_EXTRA_BASEMAPS?: string;
  readonly VITE_TERRAIN_TILES_URL?: string;
  readonly VITE_SOURCE_URL?: string;
}
