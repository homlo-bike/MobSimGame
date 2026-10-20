/**
 * Regions from a place lookup (city, district, neighbourhood). Pure: the caller
 * fetches candidates and boundaries. A boundary is only ever taken from the
 * source; when there is none, nothing is created and the user draws by hand.
 */
import type { Region, RegionType, Scenario } from './schema';
import { createRegion, toRegionGeometry } from './regions';

/** Region type for a geocoder address type; unknown kinds become user-defined. */
export function regionTypeForPlace(kind: string | null | undefined): RegionType {
  switch (kind) {
    case 'neighbourhood':
    case 'quarter':
    case 'suburb':
      return 'neighbourhood';
    case 'city_district':
    case 'district':
    case 'borough':
    case 'county':
      return 'district';
    case 'city':
    case 'town':
    case 'village':
    case 'municipality':
      return 'municipality';
    default:
      return 'user_defined';
  }
}

export interface PlaceCandidate {
  label: string;
  kind?: string | null;
  osmType?: string | null;
  osmId?: number | null;
  hierarchy?: string[];
}

export interface PlaceBoundary {
  geometry: { type: string; coordinates: unknown } | null;
}

/** Stable reference to the source object, kept in `region.source.sourceFeature`. */
export function placeFeatureRef(c: PlaceCandidate): string | null {
  return c.osmType && c.osmId ? `osm:${c.osmType}/${c.osmId}` : null;
}

export type RegionFromPlace =
  | { outcome: 'created'; scenario: Scenario; region: Region }
  /** A region from the same source object exists; it is left untouched. */
  | { outcome: 'exists'; scenario: Scenario; region: Region }
  /** The source has no polygon for the place: centre the map and draw by hand. */
  | { outcome: 'no_boundary'; scenario: Scenario };

export function regionFromPlace(
  scenario: Scenario,
  candidate: PlaceCandidate,
  boundary: PlaceBoundary,
  retrievedAt: string,
): RegionFromPlace {
  const ref = placeFeatureRef(candidate);
  const existing = ref ? scenario.regions.find((r) => r.source.sourceFeature === ref) : undefined;
  // Never overwrite: user edits to an existing region (values, shape, name) stay as they are.
  if (existing) return { outcome: 'exists', scenario, region: existing };
  const geometry = boundary.geometry ? toRegionGeometry(boundary.geometry) : null;
  if (!geometry) return { outcome: 'no_boundary', scenario };
  const name = candidate.label.split(',')[0]?.trim() || candidate.label;
  const res = createRegion(scenario, {
    name,
    type: regionTypeForPlace(candidate.kind),
    geometry,
    source: {
      source: 'OpenStreetMap boundary via Nominatim (© OpenStreetMap contributors, ODbL)',
      sourceUrl:
        candidate.osmType && candidate.osmId
          ? `https://www.openstreetmap.org/${candidate.osmType}/${candidate.osmId}`
          : null,
      sourceDate: retrievedAt,
      sourceFeature: ref,
      status: 'imported',
      confidence: 'medium',
    },
  });
  // Only the place hierarchy is recorded; no statistics are inferred from the lookup.
  const hierarchy: Record<string, string> = candidate.hierarchy?.length
    ? { Within: candidate.hierarchy.join(' › ') }
    : {};
  const region = { ...res.region, metadata: { ...res.region.metadata, ...hierarchy } };
  return {
    outcome: 'created',
    scenario: {
      ...res.scenario,
      regions: res.scenario.regions.map((r) => (r.id === region.id ? region : r)),
    },
    region,
  };
}
