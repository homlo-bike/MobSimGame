/**
 * Station-name suggestions from nearby features.
 *
 * Candidate priority (lower number wins, then distance):
 * 1 landmark · 2 transit station · 3 district · 4 intersection · 5 major street
 * 6 facility (university, hospital, market, park, civic) · 7 street
 * 8 generated geographic fallback.
 *
 * Suggestions never overwrite a user-edited name (see applyNameSuggestion).
 */
import type { LngLat, Scenario } from '../domain/schema';
import { distanceM } from '../geo/geometry';
import type { OsmFeature, OsmFeatureCategory } from '../providers/types';

export const CATEGORY_PRIORITY: Partial<Record<OsmFeatureCategory, number>> = {
  landmark: 1,
  transit_station: 2,
  district: 3,
  intersection: 4,
  major_street: 5,
  facility: 6,
  street: 7,
};

export interface NameSuggestion {
  name: string;
  sourceFeature: string;
  distanceM: number;
  provider: string;
  priority: number;
  /** District or street name used to disambiguate duplicates. */
  qualifier?: string;
}

/** Pick the localised name if available: name:<lang> → name. */
export function localName(f: OsmFeature, language?: string): string | null {
  if (language && f.names[`name:${language}`]) return f.names[`name:${language}`]!;
  return f.name;
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
    sourceFeature: 'Generated from coordinates',
    distanceM: 0,
    provider: 'MobSimGame',
    priority: 8,
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
