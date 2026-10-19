/** Access to the live map for UI actions outside the map component (search, fit to network). */
import type { Map as MlMap } from 'maplibre-gl';

let instance: MlMap | null = null;

export function setMapInstance(map: MlMap | null) {
  instance = map;
}

export function getMapInstance(): MlMap | null {
  return instance;
}
