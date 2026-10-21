/**
 * Name new stations after the labels the basemap shows around them (R8): station and stop
 * labels first, then landmarks, districts and streets (see names/suggest.ts). Runs on the
 * rendered map, so it needs no network request; a station is named once it is on screen
 * with labels around it, and a name the user typed is never replaced.
 */
import type * as maplibregl from 'maplibre-gl';
import type { LngLat, Scenario } from '../domain/schema';
import { applyNameSuggestion } from '../domain/network';
import { stationKind } from '../domain/stationKinds';
import {
  featuresFromLabels,
  MAP_LABEL_PROVIDER,
  preferTransitKind,
  type RenderedLabel,
} from '../names/mapLabels';
import { suggestStationNames } from '../names/suggest';

/** Search radius around a station (m), as for the Overpass lookup. */
export const MAP_LABEL_RADIUS_M = 500;
const LABEL_LAYERS = new Set(['poi', 'place', 'transportation_name']);

function labelsAround(map: maplibregl.Map, at: LngLat): RenderedLabel[] {
  const p = map.project(at);
  const { width, height } = map.getCanvas().getBoundingClientRect();
  if (p.x < 0 || p.y < 0 || p.x > width || p.y > height) return [];
  // Metres per CSS pixel at this latitude (512-pixel tiles).
  const mPerPx = (40075016.686 * Math.cos((at[1] * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
  const r = MAP_LABEL_RADIUS_M / mPerPx;
  const layers = (map.getStyle().layers ?? [])
    .filter((l) => l.type === 'symbol' && 'source-layer' in l && LABEL_LAYERS.has(l['source-layer'] ?? ''))
    .map((l) => l.id);
  if (!layers.length) return [];
  const flat = (g: GeoJSON.Geometry): LngLat[] =>
    g.type === 'Point'
      ? [g.coordinates as LngLat]
      : g.type === 'LineString' || g.type === 'MultiPoint'
        ? (g.coordinates as LngLat[])
        : g.type === 'MultiLineString'
          ? (g.coordinates.flat() as LngLat[])
          : [];
  return map
    .queryRenderedFeatures(
      [
        [p.x - r, p.y - r],
        [p.x + r, p.y + r],
      ],
      { layers },
    )
    .map((f) => ({
      sourceLayer: f.sourceLayer ?? '',
      properties: f.properties ?? {},
      coordinates: flat(f.geometry),
    }));
}

/**
 * Stations still carrying a generated name get the best basemap label near them. Returns
 * the renamed scenario and the ids that were named, or null when nothing changed.
 */
export function nameStationsFromMap(
  map: maplibregl.Map,
  scenario: Scenario,
  language: string,
  skip: ReadonlySet<string> = new Set(),
): { scenario: Scenario; named: string[] } | null {
  let next = scenario;
  const named: string[] = [];
  for (const station of scenario.stations) {
    if (station.nameSource !== 'generated' || skip.has(station.id)) continue;
    const kind = stationKind(scenario, station);
    const prefer = station.layout || kind === 'rail' ? 'rail' : kind === 'bus' ? 'bus' : null;
    const features = preferTransitKind(
      featuresFromLabels(labelsAround(map, station.position), station.position),
      prefer,
    );
    if (!features.length) continue;
    const best = suggestStationNames(station.position, features, {
      provider: MAP_LABEL_PROVIDER,
      language,
      maxDistanceM: MAP_LABEL_RADIUS_M,
    }).find((s) => !s.coordinateFallback);
    if (!best) continue;
    const { name, sourceFeature, distanceM, provider } = best;
    next = applyNameSuggestion(
      next,
      station.id,
      { name, sourceFeature, distanceM, provider },
      best.qualifier,
    );
    named.push(station.id);
  }
  return named.length ? { scenario: next, named } : null;
}
