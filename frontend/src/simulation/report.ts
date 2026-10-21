/**
 * Waits for occupied track over a simulated period (R14b). Pure.
 *
 * Every trip of every line departing within the period is scheduled in the shared
 * context (the same deterministic order the map animation uses); the time vehicles
 * spend waiting for a single-track section, a junction or crossing zone, a shared
 * street or track ahead is summed per line and per place.
 */
import type { LngLat, Scenario } from '../domain/schema';
import { buildScenarioModels, interpolate, tripPhases, type SimulationOptions } from './engine';

export type WaitPlaceKind = 'single_track' | 'junction' | 'crossing' | 'shared' | 'track';

export interface WaitPlace {
  resourceId: string;
  kind: WaitPlaceKind;
  /** Where vehicles wait (the first wait seen). */
  position: LngLat;
  count: number;
  totalS: number;
  maxS: number;
}

export interface LineWaits {
  lineId: string;
  trips: number;
  waits: number;
  totalS: number;
  maxS: number;
  places: WaitPlace[];
}

export interface OperationsReport {
  periodS: number;
  lines: LineWaits[];
  /** Capacity messages from the scheduling (waits longer than the headway, …). */
  warnings: string[];
}

export function waitPlaceKind(resourceId: string): WaitPlaceKind {
  if (resourceId.startsWith('block:')) return 'single_track';
  if (resourceId.startsWith('zone:')) return 'junction';
  if (resourceId.startsWith('x:')) return 'crossing';
  if (resourceId.startsWith('s:') || resourceId.startsWith('line:')) return 'shared';
  return 'track';
}

export const WAIT_PLACE_LABELS: Record<WaitPlaceKind, string> = {
  single_track: 'single-track section',
  junction: 'junction, turnout or crossing of tracks',
  crossing: 'crossing with another line',
  shared: 'shared street or route',
  track: 'track ahead',
};

/** Simulate `periodS` seconds of service (after the start-up of every line) and collect the waits. */
export function operationsReport(
  scenario: Scenario,
  options: SimulationOptions = {},
  periodS = 3600,
): OperationsReport {
  const models = buildScenarioModels(scenario, options);
  const lines: LineWaits[] = [];
  for (const m of models) {
    const places = new Map<string, WaitPlace>();
    let trips = 0;
    let waits = 0;
    let totalS = 0;
    let maxS = 0;
    const n = Math.max(1, Math.floor(periodS / m.headwayS));
    for (const svc of m.services)
      for (let j = 0; j < n; j++) {
        trips++;
        for (const p of tripPhases(m, svc, j)) {
          if (p.kind !== 'occupied') continue;
          waits++;
          totalS += p.durationS;
          maxS = Math.max(maxS, p.durationS);
          const id = p.resourceId ?? 'unknown';
          const place = places.get(id) ?? {
            resourceId: id,
            kind: waitPlaceKind(id),
            position: interpolate(m.path, p.chainageM).position,
            count: 0,
            totalS: 0,
            maxS: 0,
          };
          place.count++;
          place.totalS += p.durationS;
          place.maxS = Math.max(place.maxS, p.durationS);
          places.set(id, place);
        }
      }
    lines.push({
      lineId: m.lineId,
      trips,
      waits,
      totalS,
      maxS,
      places: [...places.values()].sort((a, b) => b.totalS - a.totalS),
    });
  }
  const warnings = [...(models[0]?.context.warnings ?? [])];
  return { periodS, lines, warnings };
}
