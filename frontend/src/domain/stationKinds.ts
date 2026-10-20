/**
 * What a station or stop is, from what serves it: a rail station sits on
 * tracks or is served by track services; a bus stop is served by bus or BRT
 * lines only. Stations are referenced by lines and never own geometry.
 */
import type { Scenario, Station, TransportLine } from './schema';
import { isRailMode } from './tracks';

export type StationKind = 'rail' | 'bus' | 'mixed' | 'other' | 'orphan';

export const BUS_STOP_TYPE_LABELS: Record<Station['busStopType'], string> = {
  unknown: 'Not specified',
  roadside: 'Roadside (curb) stop',
  in_lane: 'In-lane stop',
  bay: 'Bus bay',
  island: 'Island stop',
  brt_platform: 'BRT platform (median or station)',
};

export function servingLines(scenario: Scenario, stationId: string): TransportLine[] {
  return scenario.lines.filter((l) => l.stops.some((s) => s.stationId === stationId));
}

export function stationKind(scenario: Scenario, station: Station): StationKind {
  const lines = servingLines(scenario, station.id);
  const rail = station.trackRefs.length > 0 || lines.some((l) => isRailMode(l.mode));
  const bus = lines.some((l) => l.mode === 'bus' || l.mode === 'brt');
  if (rail && bus) return 'mixed';
  if (rail) return 'rail';
  if (bus) return 'bus';
  return lines.length ? 'other' : 'orphan';
}

/** Stops that only the given lines serve (they become orphans when those lines are removed). */
export function stopsOnlyServedBy(scenario: Scenario, lineIds: readonly string[]): Station[] {
  const ids = new Set(lineIds);
  return scenario.stations.filter((st) => {
    const lines = servingLines(scenario, st.id);
    return lines.length > 0 && lines.every((l) => ids.has(l.id)) && st.trackRefs.length === 0;
  });
}
