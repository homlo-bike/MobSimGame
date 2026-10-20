/**
 * Street lines (bus, BRT, trolleybus) created by clicking their stops in order. Pure.
 *
 * Every click is a stop and a waypoint. The line runs one way through the stops in the
 * clicked order and returns to the first stop (a one-way loop), so each stop is served
 * from one side of the street. Stops are placed where clicked, at the kerb of the side
 * the vehicle should approach on; the router is asked to arrive on that side.
 */
import type { LngLat, Scenario, Station, TransportLine, TransportMode } from './schema';
import { MODES } from './modes';
import { stationMode } from './modeSeparation';
import { createLine, STATION_MERGE_RADIUS_M, uniqueStationName, updateLine } from './network';
import { distanceM } from '../geo/geometry';
import { newId } from '../util/id';

/** Modes whose lines are drawn by clicking stops and routed on streets. */
export const STOP_LINE_MODES: readonly TransportMode[] = ['bus', 'brt', 'trolleybus'];

export function isStopLineMode(mode: TransportMode): boolean {
  return STOP_LINE_MODES.includes(mode);
}

/** An existing stop of the same mode near `at`, which a click there reuses. */
export function stopNear(
  scenario: Scenario,
  mode: TransportMode,
  at: LngLat,
  radiusM = STATION_MERGE_RADIUS_M,
): Station | null {
  let best: { s: Station; d: number } | null = null;
  for (const s of scenario.stations) {
    if (s.layout || s.trackRefs.length) continue;
    if (stationMode(scenario, s) !== mode) continue;
    const d = distanceM(s.position, at);
    if (d <= radiusM && (!best || d < best.d)) best = { s, d };
  }
  return best?.s ?? null;
}

export interface StopLineResult {
  scenario: Scenario;
  line: TransportLine | null;
  created: number;
  reused: number;
  error: string | null;
}

/**
 * Create a one-way loop line through the clicked stops. A click near an existing stop
 * of the same mode reuses it; other modes' stops are never shared.
 */
export function createStopLine(
  scenario: Scenario,
  input: { points: readonly LngLat[]; mode: TransportMode; name?: string },
): StopLineResult {
  if (!isStopLineMode(input.mode))
    return {
      scenario,
      line: null,
      created: 0,
      reused: 0,
      error: 'Only bus, BRT and trolleybus lines are drawn by stops',
    };
  let sc = scenario;
  const ids: string[] = [];
  const positions: LngLat[] = [];
  let created = 0;
  let reused = 0;
  const fresh = new Set<string>();
  for (const p of input.points) {
    // Stops created earlier in this drawing have no line yet, so they are matched here.
    const own = sc.stations.filter(
      (s) => fresh.has(s.id) && distanceM(s.position, p) <= STATION_MERGE_RADIUS_M,
    );
    const existing = own[0] ?? stopNear(sc, input.mode, p);
    let station = existing;
    if (existing) reused++;
    else {
      station = newStop(sc, p, input.mode);
      fresh.add(station.id);
      sc = { ...sc, stations: [...sc.stations, station] };
      created++;
    }
    // Clicking the same stop twice in a row adds nothing.
    if (ids[ids.length - 1] === station!.id) continue;
    ids.push(station!.id);
    positions.push([station!.position[0], station!.position[1]]);
  }
  // The loop returns to the first stop by itself: a final click on it adds nothing.
  if (ids.length > 2 && ids[ids.length - 1] === ids[0]) {
    ids.pop();
    positions.pop();
  }
  if (ids.length < 2)
    return { scenario, line: null, created: 0, reused: 0, error: 'Place at least two stops' };
  const c = createLine(sc, {
    coordinates: positions,
    mode: input.mode,
    alignment: 'routed',
    ring: true,
    ...(input.name ? { name: input.name } : {}),
  });
  const next = updateLine(c.scenario, c.line.id, {
    direction: 'one_way',
    stops: ids.map((stationId) => ({ stationId })),
  });
  return {
    scenario: next,
    line: next.lines.find((l) => l.id === c.line.id)!,
    created,
    reused,
    error: null,
  };
}

function newStop(scenario: Scenario, at: LngLat, mode: TransportMode): Station {
  return {
    id: newId('st'),
    name: uniqueStationName(scenario, `Stop ${scenario.stations.length + 1}`),
    nameSource: 'generated',
    nameSuggestion: null,
    position: [at[0], at[1]],
    construction: 'surface',
    platformType: 'unknown',
    busStopType: 'unknown',
    layout: null,
    verticalOffsetM: null,
    entrances: [],
    accessibility: { stepFree: null, elevators: null, tactilePaving: null },
    catchmentRadiusM: MODES[mode].defaultCatchmentRadiusM,
    notes: '',
    trackRefs: [],
    metadata: {},
    imageUrls: [],
  };
}
