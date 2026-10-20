/**
 * Station-name suggestions from nearby features.
 *
 * Candidate priority (lower number wins, then distance):
 * 1 existing transport station · 2 major landmark · 3 district or neighbourhood
 * 4 facility (university, hospital, market, park, civic building)
 * 5 major road intersection · 6 major street · 7 nearby street
 * 8 local geographic place name · 9 coordinates (last resort only).
 *
 * Suggestions never overwrite a user-edited name (see applyNameSuggestion).
 */
import type { LngLat, Scenario } from '../domain/schema';
import { distanceM } from '../geo/geometry';
import type { OsmFeature, OsmFeatureCategory } from '../providers/types';

export const CATEGORY_PRIORITY: Partial<Record<OsmFeatureCategory, number>> = {
  transit_station: 1,
  landmark: 2,
  district: 3,
  facility: 4,
  intersection: 5,
  major_street: 6,
  street: 7,
  place: 8,
};

export const COORDINATE_FALLBACK_PRIORITY = 9;

export interface NameSuggestion {
  name: string;
  sourceFeature: string;
  distanceM: number;
  provider: string;
  priority: number;
  /** District or street name used to disambiguate duplicates. */
  qualifier?: string;
  /** True only for the coordinate name offered when nothing else is available. */
  coordinateFallback?: boolean;
}

/** Pick the localised name if available: name:<lang> → name → name:en. */
export function localName(f: OsmFeature, language?: string): string | null {
  const name = (language && f.names[`name:${language}`]) || f.name || f.names['name:en'] || null;
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed ? trimmed : null;
}

export function generatedName(position: LngLat): string {
  const lat = `${Math.abs(position[1]).toFixed(4)}°${position[1] >= 0 ? 'N' : 'S'}`;
  const lng = `${Math.abs(position[0]).toFixed(4)}°${position[0] >= 0 ? 'E' : 'W'}`;
  return `Station ${lat} ${lng}`;
}

export function suggestStationNames(
  position: LngLat,
  features: readonly OsmFeature[],
  options: { language?: string; provider: string; maxDistanceM?: number },
): NameSuggestion[] {
  const max = options.maxDistanceM ?? 500;
  const district = features
    .filter((f) => f.category === 'district' && localName(f, options.language))
    .sort((a, b) => distanceM(a.position, position) - distanceM(b.position, position))[0];
  const street = features
    .filter(
      (f) => (f.category === 'street' || f.category === 'major_street') && localName(f, options.language),
    )
    .sort((a, b) => distanceM(a.position, position) - distanceM(b.position, position))[0];

  const candidates: NameSuggestion[] = [];
  for (const f of features) {
    if (
      !f ||
      !Array.isArray(f.position) ||
      !Number.isFinite(f.position[0]) ||
      !Number.isFinite(f.position[1])
    )
      continue;
    const priority = CATEGORY_PRIORITY[f.category];
    const name = localName(f, options.language);
    if (!priority || !name) continue;
    const d = distanceM(f.position, position);
    if (d > max) continue;
    const qualifierSource = f.category === 'district' ? street : (district ?? street);
    candidates.push({
      name,
      sourceFeature: `${f.category}: ${name} (${f.id})`,
      distanceM: Math.round(d),
      provider: options.provider,
      priority,
      qualifier: qualifierSource ? (localName(qualifierSource, options.language) ?? undefined) : undefined,
    });
  }
  candidates.sort((a, b) => a.priority - b.priority || a.distanceM - b.distanceM);
  candidates.push({
    name: generatedName(position),
    sourceFeature: 'Coordinates (last resort: no named place found)',
    distanceM: 0,
    provider: 'MobSimGame',
    priority: COORDINATE_FALLBACK_PRIORITY,
    coordinateFallback: true,
  });
  // Remove duplicate names, keeping the best-ranked one.
  const seen = new Set<string>();
  return candidates.filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)));
}

/** True when the name is already used by another station of the scenario. */
export function isNameTaken(scenario: Scenario, name: string, exceptStationId?: string): boolean {
  return scenario.stations.some(
    (s) => s.id !== exceptStationId && s.name.toLowerCase() === name.toLowerCase(),
  );
}

/**
 * The name a suggestion would get in this scenario: unchanged when free,
 * otherwise with its district or street qualifier, otherwise numbered.
 */
export function resolvedName(scenario: Scenario, s: NameSuggestion, exceptStationId?: string): string {
  if (!isNameTaken(scenario, s.name, exceptStationId)) return s.name;
  if (s.qualifier && s.qualifier !== s.name) {
    const q = `${s.name} (${s.qualifier})`;
    if (!isNameTaken(scenario, q, exceptStationId)) return q;
  }
  for (let i = 2; i < 100; i++) {
    const n = `${s.name} ${i}`;
    if (!isNameTaken(scenario, n, exceptStationId)) return n;
  }
  return s.name;
}
