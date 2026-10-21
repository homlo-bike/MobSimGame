/**
 * Station names from the labels the basemap already shows (R8): the OpenMapTiles layers of
 * the OpenStreetMap basemap (station and stop labels, points of interest, districts,
 * street names) become name candidates without any network request. Pure: the map
 * passes in the rendered label features; suggestStationNames ranks them.
 */
import type { LngLat } from '../domain/schema';
import type { OsmFeature, OsmFeatureCategory } from '../providers/types';

/** A label feature as the map renders it (OpenMapTiles schema). */
export interface RenderedLabel {
  sourceLayer: string;
  properties: Record<string, unknown>;
  /** Point, or the vertices of a line (street names). */
  coordinates: LngLat[];
}

const TRANSIT_SUBCLASS = new Set([
  'station',
  'halt',
  'tram_stop',
  'bus_stop',
  'subway',
  'bus_station',
  'stop',
]);
const LANDMARK_CLASS = new Set(['attraction', 'monument', 'castle', 'stadium', 'museum', 'place_of_worship']);
const DISTRICT_CLASS = new Set(['suburb', 'quarter', 'neighbourhood', 'borough']);
const MAJOR_STREET = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);

/** Category of a label, or null when it is not a useful station name. */
export function labelCategory(l: RenderedLabel): OsmFeatureCategory | null {
  const cls = String(l.properties.class ?? '');
  const sub = String(l.properties.subclass ?? '');
  switch (l.sourceLayer) {
    case 'poi':
      if (cls === 'railway' || cls === 'bus' || cls === 'rail' || TRANSIT_SUBCLASS.has(sub))
        return 'transit_station';
      if (LANDMARK_CLASS.has(cls) || LANDMARK_CLASS.has(sub)) return 'landmark';
      return 'facility';
    case 'place':
      if (DISTRICT_CLASS.has(cls)) return 'district';
      if (cls === 'village' || cls === 'hamlet' || cls === 'locality' || cls === 'isolated_dwelling')
        return 'place';
      return null;
    case 'transportation_name':
      if (cls === 'path' || cls === 'track') return null;
      return MAJOR_STREET.has(cls) ? 'major_street' : 'street';
    default:
      return null;
  }
}

function nearestVertex(coords: readonly LngLat[], p: LngLat): LngLat {
  let best = coords[0]!;
  let d = Infinity;
  for (const c of coords) {
    const k = Math.cos((p[1] * Math.PI) / 180);
    const dd = ((c[0] - p[0]) * k) ** 2 + (c[1] - p[1]) ** 2;
    if (dd < d) {
      d = dd;
      best = c;
    }
  }
  return best;
}

/** Turn rendered labels into name candidates around `at` (duplicates removed). */
export function featuresFromLabels(labels: readonly RenderedLabel[], at: LngLat): OsmFeature[] {
  const out: OsmFeature[] = [];
  const seen = new Set<string>();
  labels.forEach((l, i) => {
    const category = labelCategory(l);
    const name = typeof l.properties.name === 'string' ? l.properties.name.trim() : '';
    if (!category || !name || !l.coordinates.length) return;
    const key = `${category}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    const names: Record<string, string> = {};
    for (const [k, v] of Object.entries(l.properties))
      if (k.startsWith('name:') && typeof v === 'string') names[k] = v;
    out.push({
      id: `label/${l.sourceLayer}/${i}`,
      category,
      name,
      names,
      position: nearestVertex(l.coordinates, at),
      tags: { class: String(l.properties.class ?? '') },
    });
  });
  return out;
}

export const MAP_LABEL_PROVIDER = 'Basemap labels (OpenStreetMap via OpenFreeMap/OpenMapTiles)';

const RAIL_CLASSES = new Set(['railway', 'rail']);

/**
 * A rail station takes a rail station's label over a nearby bus stop's, and a bus stop the
 * other way round: transit labels of the other kind are dropped when one of the right kind
 * is present.
 */
export function preferTransitKind(
  features: readonly OsmFeature[],
  kind: 'rail' | 'bus' | null,
): OsmFeature[] {
  if (!kind) return [...features];
  const isRail = (f: OsmFeature) => RAIL_CLASSES.has(f.tags.class ?? '');
  const matches = (f: OsmFeature) => f.category === 'transit_station' && isRail(f) === (kind === 'rail');
  if (!features.some(matches)) return [...features];
  return features.filter((f) => f.category !== 'transit_station' || matches(f));
}
