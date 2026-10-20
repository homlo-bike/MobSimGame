/**
 * Stations on tracks and passenger services routed over the track network.
 *
 * A rail service (a line with `alignment.kind = 'track'`) lists its stops; its
 * path is the shortest permitted route through the stations' tracks, in stop
 * order, without reversing between stops. The way back is routed separately, so
 * on double track it uses the other track. The service's `coordinates` and
 * structure `segments` are derived from the tracks it uses and never edited.
 */
import type {
  LngLat,
  PhysicalTrack,
  Scenario,
  Station,
  TrackSegment,
  TrackStep,
  TransportLine,
  TransportMode,
} from './schema';
import { MODES } from './modes';
import { isRing, stationMergeRadiusM, uniqueStationName } from './network';
import { parameterValue } from './trackParameters';
import { shortestPath, stepsLengthM, type Dir } from './trackGraph';
import { serviceCanUse } from './compatibility';
import {
  levelOfStructure,
  nearestOnTrack,
  pointOnTrack,
  removeTrack,
  trackGeometry,
  tracksNear,
  trackUsage,
} from './tracks';
import { distanceM, slicePath } from '../geo/geometry';
import { newId, nowIso } from '../util/id';

const touch = (s: Scenario): Scenario => ({ ...s, updatedAt: nowIso() });

export function stationLevel(station: Pick<Station, 'construction'>): number {
  return station.construction === 'underground' ? -1 : station.construction === 'elevated' ? 1 : 0;
}

/** Tracks a station at `position` should serve: within the configured distance and on the same level. */
export function suggestStationTracks(scenario: Scenario, position: LngLat, level: number) {
  const net = scenario.trackNetwork;
  return tracksNear(net, position, parameterValue(net, 'stationTrackSearchM'), level);
}

/** Replace a station's track references with the current suggestions. */
export function assignStationTracks(scenario: Scenario, stationId: string): Scenario {
  const st = scenario.stations.find((s) => s.id === stationId);
  if (!st) return scenario;
  const refs = suggestStationTracks(scenario, st.position, stationLevel(st)).map((h) => ({
    trackId: h.track.id,
    fraction: h.fraction,
  }));
  return touch({
    ...scenario,
    stations: scenario.stations.map((s) => (s.id === stationId ? { ...s, trackRefs: refs } : s)),
  });
}

export function setStationTrack(
  scenario: Scenario,
  stationId: string,
  trackId: string,
  served: boolean,
): Scenario {
  const st = scenario.stations.find((s) => s.id === stationId);
  const track = scenario.trackNetwork.tracks.find((t) => t.id === trackId);
  if (!st || !track) return scenario;
  const others = st.trackRefs.filter((r) => r.trackId !== trackId);
  const trackRefs = served
    ? [...others, { trackId, fraction: nearestOnTrack(scenario.trackNetwork, track, st.position).fraction }]
    : others;
  return rerouteServingLines(
    touch({
      ...scenario,
      stations: scenario.stations.map((s) => (s.id === stationId ? { ...s, trackRefs } : s)),
    }),
    stationId,
  );
}

export interface AddTrackStationResult {
  scenario: Scenario;
  station: Station | null;
  reused: boolean;
  error: string | null;
}

/**
 * Place a station on the track network at the nearest track point. An existing
 * station within the stop merge distance is reused. The station serves every
 * track within the configured distance on its level (both tracks of a double
 * track, for example).
 */
export function addStationOnTracks(
  scenario: Scenario,
  at: LngLat,
  options: { mode?: TransportMode; name?: string; maxDistanceM?: number } = {},
): AddTrackStationResult {
  const net = scenario.trackNetwork;
  const nearestHit = tracksNear(net, at, options.maxDistanceM ?? Infinity)[0];
  if (!nearestHit)
    return { scenario, station: null, reused: false, error: 'No track close enough. Draw a track first.' };
  const level = nearestHit.track.level;
  const position = pointOnTrack(net, nearestHit.track, nearestHit.fraction).position;
  const existing = scenario.stations
    .map((s) => ({ s, d: distanceM(s.position, position) }))
    .filter((x) => x.d <= stationMergeRadiusM(scenario) && stationLevel(x.s) === level)
    .sort((a, b) => a.d - b.d)[0]?.s;
  const refs = suggestStationTracks(scenario, position, level).map((h) => ({
    trackId: h.track.id,
    fraction: h.fraction,
  }));
  if (existing) {
    const merged = [
      ...existing.trackRefs,
      ...refs.filter((r) => !existing.trackRefs.some((e) => e.trackId === r.trackId)),
    ];
    const next = touch({
      ...scenario,
      stations: scenario.stations.map((s) => (s.id === existing.id ? { ...s, trackRefs: merged } : s)),
    });
    return { scenario: next, station: { ...existing, trackRefs: merged }, reused: true, error: null };
  }
  const mode = MODES[options.mode ?? nearestHit.track.designMode];
  const station: Station = {
    id: newId('st'),
    name: uniqueStationName(scenario, options.name ?? `Station ${scenario.stations.length + 1}`),
    nameSource: options.name ? 'user' : 'generated',
    nameSuggestion: null,
    position,
    construction: level < 0 ? 'underground' : level > 0 ? 'elevated' : 'surface',
    platformType: 'unknown',
    busStopType: 'unknown',
    layout: null,
    verticalOffsetM: null,
    entrances: [],
    accessibility: { stepFree: null, elevators: null, tactilePaving: null },
    catchmentRadiusM: mode.defaultCatchmentRadiusM,
    trackRefs: refs.length ? refs : [{ trackId: nearestHit.track.id, fraction: nearestHit.fraction }],
    metadata: {},
    notes: '',
    imageUrls: [],
  };
  return {
    scenario: touch({ ...scenario, stations: [...scenario.stations, station] }),
    station,
    reused: false,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export interface ServiceRoute {
  path: TrackStep[];
  returnPath: TrackStep[] | null;
  error: string | null;
}

interface Candidate {
  trackId: string;
  fraction: number;
}

/**
 * Route through stops in order: among all tracks each station serves, choose
 * the combination with the shortest total permitted path (dynamic programming
 * over (station track, arrival direction)).
 */
export function routeThroughStations(
  scenario: Scenario,
  stationIds: readonly string[],
  closeRing = false,
  mode?: TransportMode,
): {
  steps: TrackStep[];
  error: string | null;
} {
  const net = scenario.trackNetwork;
  const byId = new Map(scenario.stations.map((s) => [s.id, s]));
  const stops = stationIds.map((id) => byId.get(id)).filter((s): s is Station => !!s);
  if (stops.length < 2)
    return { steps: [], error: 'Add at least two stations on tracks to route the service.' };
  const missing = stops.find((s) => !s.trackRefs.length);
  if (missing) return { steps: [], error: `Station "${missing.name}" is not on a track.` };
  // Only tracks whose infrastructure class the service mode may use (domain/compatibility.ts).
  const byTrack = new Map(net.tracks.map((t) => [t.id, t]));
  const allow = mode ? (t: PhysicalTrack) => serviceCanUse(mode, t) : undefined;
  const refsOf = (s: Station) =>
    allow
      ? s.trackRefs.filter((r) => {
          const t = byTrack.get(r.trackId);
          return !!t && allow(t);
        })
      : s.trackRefs;
  const incompatible = mode ? stops.find((s) => !refsOf(s).length) : undefined;
  if (incompatible)
    return {
      steps: [],
      error: `Station "${incompatible.name}" has no track this ${MODES[mode!].label.toLowerCase()} service may use (see infrastructure compatibility).`,
    };
  const sequence = closeRing ? [...stops, stops[0]!] : stops;
  type State = { cand: Candidate; dir: Dir | null; cost: number; steps: TrackStep[] };
  let states: State[] = refsOf(sequence[0]!).map((r) => ({ cand: r, dir: null, cost: 0, steps: [] }));
  for (let i = 1; i < sequence.length; i++) {
    const next: State[] = [];
    for (const target of refsOf(sequence[i]!)) {
      for (const d of [1, -1] as Dir[]) {
        let best: State | null = null;
        for (const s of states) {
          const p = shortestPath(net, s.cand, target, s.dir ?? undefined, allow);
          if (!p || p.arrivalDir !== d) continue;
          const cost = s.cost + p.lengthM;
          if (!best || cost < best.cost)
            best = { cand: target, dir: d, cost, steps: [...s.steps, ...p.steps] };
        }
        if (best) next.push(best);
      }
    }
    if (!next.length)
      return {
        steps: [],
        error: `No permitted track path from "${sequence[i - 1]!.name}" to "${sequence[i]!.name}" (check connections and running directions).`,
      };
    states = next;
  }
  const best = states.reduce((a, b) => (b.cost < a.cost ? b : a));
  return { steps: mergeSteps(best.steps), error: null };
}

/** Join consecutive steps on the same track in the same direction. */
function mergeSteps(steps: TrackStep[]): TrackStep[] {
  const out: TrackStep[] = [];
  for (const s of steps) {
    const last = out[out.length - 1];
    if (
      last &&
      last.trackId === s.trackId &&
      last.reversed === s.reversed &&
      Math.abs(last.to - s.from) < 1e-9
    )
      out[out.length - 1] = { ...last, to: s.to };
    else if (Math.abs(s.to - s.from) > 1e-12 || !out.length) out.push(s);
  }
  return out.filter((s) => Math.abs(s.to - s.from) > 1e-12);
}

export function routeService(scenario: Scenario, line: TransportLine): ServiceRoute {
  const ids = line.stops.map((s) => s.stationId);
  const ring = isRing(line);
  const out = routeThroughStations(scenario, ids, ring, line.mode);
  if (out.error) return { path: [], returnPath: null, error: out.error };
  if (ring || line.direction === 'one_way') return { path: out.steps, returnPath: null, error: null };
  const back = routeThroughStations(scenario, [...ids].reverse(), false, line.mode);
  if (back.error) return { path: out.steps, returnPath: null, error: `Return direction: ${back.error}` };
  return { path: out.steps, returnPath: back.steps, error: null };
}

/** Geometry of a list of steps, [lng, lat]. */
export function stepsCoordinates(scenario: Scenario, steps: readonly TrackStep[]): LngLat[] {
  const net = scenario.trackNetwork;
  const byId = new Map(net.tracks.map((t) => [t.id, t]));
  const out: LngLat[] = [];
  for (const s of steps) {
    const t = byId.get(s.trackId);
    if (!t) continue;
    const g = trackGeometry(net, t);
    const lo = Math.min(s.from, s.to);
    const hi = Math.max(s.from, s.to);
    let part = slicePath(g.coordinates, false, lo, hi);
    if (s.reversed) part = [...part].reverse();
    out.push(...(out.length ? part.slice(1) : part));
  }
  return out;
}

/** Structure segments of a service, derived from the tracks it uses (adjacent equal parts merged). */
export function stepsSegments(
  scenario: Scenario,
  lineId: string,
  steps: readonly TrackStep[],
): TrackSegment[] {
  const net = scenario.trackNetwork;
  const byId = new Map(net.tracks.map((t) => [t.id, t]));
  const total = stepsLengthM(net, steps);
  const segs: TrackSegment[] = [];
  let at = 0;
  for (const s of steps) {
    const t = byId.get(s.trackId);
    if (!t) continue;
    const l = Math.abs(s.to - s.from) * trackGeometry(net, t).lengthM;
    const from = total > 0 ? at / total : 0;
    at += l;
    const to = total > 0 ? at / total : 1;
    const attrs = {
      structure: t.structure,
      rightOfWay: t.rightOfWay,
      tracks: t.groupId ? ('double' as const) : ('single' as const),
      speedLimitKmh: t.speedLimitKmh,
    };
    const last = segs[segs.length - 1];
    if (
      last &&
      last.structure === attrs.structure &&
      last.rightOfWay === attrs.rightOfWay &&
      last.tracks === attrs.tracks &&
      last.speedLimitKmh === attrs.speedLimitKmh
    )
      last.toFraction = to;
    else
      segs.push({
        id: `${lineId}-seg${segs.length}`,
        fromFraction: from,
        toFraction: to,
        notes: '',
        flipped: false,
        ...attrs,
      });
  }
  if (!segs.length)
    return [
      {
        id: `${lineId}-seg0`,
        fromFraction: 0,
        toFraction: 1,
        structure: 'at_grade',
        rightOfWay: 'dedicated_track',
        tracks: 'single',
        speedLimitKmh: null,
        notes: '',
        flipped: false,
      },
    ];
  segs[0]!.fromFraction = 0;
  segs[segs.length - 1]!.toFraction = 1;
  return segs;
}

/** Recompute a track service's path, geometry and segments. Other lines are returned unchanged. */
export function applyServiceRoute(scenario: Scenario, line: TransportLine): TransportLine {
  if (line.alignment.kind !== 'track') return line;
  const r = routeService(scenario, line);
  const coordinates = stepsCoordinates(scenario, r.path);
  const stopsPositions = line.stops
    .map((s) => scenario.stations.find((x) => x.id === s.stationId)?.position)
    .filter((p): p is LngLat => !!p);
  return {
    ...line,
    alignment: {
      kind: 'track',
      path: r.path,
      returnPath: r.returnPath,
      status: r.error && !r.path.length ? 'unrouted' : 'routed',
      message: r.error ?? '',
    },
    // Unrouted services keep a straight sketch between their stops so they stay visible.
    coordinates: coordinates.length >= 2 ? coordinates : stopsPositions,
    segments: stepsSegments(scenario, line.id, r.path),
  };
}

export function rerouteServices(scenario: Scenario, lineIds?: readonly string[]): Scenario {
  const only = lineIds ? new Set(lineIds) : null;
  return touch({
    ...scenario,
    lines: scenario.lines.map((l) =>
      l.alignment.kind === 'track' && (!only || only.has(l.id)) ? applyServiceRoute(scenario, l) : l,
    ),
  });
}

function rerouteServingLines(scenario: Scenario, stationId: string): Scenario {
  return rerouteServices(
    scenario,
    scenario.lines.filter((l) => l.stops.some((s) => s.stationId === stationId)).map((l) => l.id),
  );
}

/** Reroute services whose path uses any of these tracks (after an edit). */
export function rerouteServicesOnTracks(scenario: Scenario, trackIds: readonly string[]): Scenario {
  const ids = new Set(trackIds);
  const affected = scenario.lines
    .filter(
      (l) =>
        l.alignment.kind === 'track' &&
        (l.alignment.status === 'unrouted' ||
          [...l.alignment.path, ...(l.alignment.returnPath ?? [])].some((s) => ids.has(s.trackId))),
    )
    .map((l) => l.id);
  return affected.length ? rerouteServices(scenario, affected) : scenario;
}

export type DeleteTrackChoice = 'reroute' | 'break' | 'delete_services';

/**
 * Delete a track that services may use. `reroute` routes affected services
 * again (they become unrouted when no path remains); `break` keeps them as
 * unrouted services; `delete_services` removes them. Cancelling is the caller
 * not calling this function.
 */
export function deleteTrackWithServices(
  scenario: Scenario,
  trackId: string,
  choice: DeleteTrackChoice,
): Scenario {
  const usage = trackUsage(scenario, trackId);
  let sc = removeTrack(scenario, trackId);
  if (choice === 'delete_services')
    return touch({ ...sc, lines: sc.lines.filter((l) => !usage.lineIds.includes(l.id)) });
  if (choice === 'reroute') return rerouteServices(sc, usage.lineIds);
  sc = {
    ...sc,
    lines: sc.lines.map((l) =>
      usage.lineIds.includes(l.id) && l.alignment.kind === 'track'
        ? {
            ...l,
            alignment: {
              ...l.alignment,
              path: [],
              returnPath: null,
              status: 'unrouted' as const,
              message: 'A track used by this service was deleted.',
            },
          }
        : l,
    ),
  };
  return touch(sc);
}

/** Return-direction geometry of a service (null when it uses the same path both ways). */
export function returnCoordinates(scenario: Scenario, line: TransportLine): LngLat[] | null {
  if (line.alignment.kind === 'track')
    return line.alignment.returnPath?.length ? stepsCoordinates(scenario, line.alignment.returnPath) : null;
  if (line.alignment.kind === 'routed') return line.alignment.returnCoordinates;
  return null;
}

export { levelOfStructure };

/** Set the stops of a track service in the given order and route it again. */
export function setServiceStops(scenario: Scenario, lineId: string, stationIds: readonly string[]): Scenario {
  const line = scenario.lines.find((l) => l.id === lineId);
  if (!line) return scenario;
  const updated: TransportLine = { ...line, stops: stationIds.map((stationId) => ({ stationId })) };
  const sc = { ...scenario, lines: scenario.lines.map((l) => (l.id === lineId ? updated : l)) };
  return touch({ ...sc, lines: sc.lines.map((l) => (l.id === lineId ? applyServiceRoute(sc, l) : l)) });
}

/** Move one stop up (-1) or down (+1) in a service's stop order. */
export function moveServiceStop(
  scenario: Scenario,
  lineId: string,
  stationId: string,
  delta: -1 | 1,
): Scenario {
  const line = scenario.lines.find((l) => l.id === lineId);
  if (!line) return scenario;
  const ids = line.stops.map((s) => s.stationId);
  const i = ids.indexOf(stationId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return scenario;
  [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  return setServiceStops(scenario, lineId, ids);
}

/** After stations or tracks moved: refresh station track fractions and reroute the affected services. */
export function refreshStationTracks(scenario: Scenario, stationIds: readonly string[]): Scenario {
  const net = scenario.trackNetwork;
  const ids = new Set(stationIds);
  const stations = scenario.stations.map((st) => {
    if (!ids.has(st.id)) return st;
    const trackRefs = st.trackRefs
      .map((r) => {
        const t = net.tracks.find((x) => x.id === r.trackId);
        return t ? { trackId: t.id, fraction: nearestOnTrack(net, t, st.position).fraction } : null;
      })
      .filter((r): r is { trackId: string; fraction: number } => !!r);
    return { ...st, trackRefs };
  });
  const sc = { ...scenario, stations };
  return rerouteServices(
    sc,
    sc.lines.filter((l) => l.stops.some((s) => ids.has(s.stationId))).map((l) => l.id),
  );
}

/** Move a station that sits on tracks: it stays on its nearest served track. */
export function moveStationOnTracks(scenario: Scenario, stationId: string, to: LngLat): Scenario {
  const st = scenario.stations.find((s) => s.id === stationId);
  if (!st) return scenario;
  const net = scenario.trackNetwork;
  const served = net.tracks.filter((t) => st.trackRefs.some((r) => r.trackId === t.id));
  const hit = served.map((t) => nearestOnTrack(net, t, to)).sort((a, b) => a.distanceM - b.distanceM)[0];
  const position = hit ? pointOnTrack(net, hit.track, hit.fraction).position : to;
  const moved = {
    ...scenario,
    stations: scenario.stations.map((s) => (s.id === stationId ? { ...s, position } : s)),
  };
  return refreshStationTracks(moved, [stationId]);
}

/** After track geometry changed: keep stations on their tracks and reroute services. */
export function afterTrackEdit(scenario: Scenario, trackIds: readonly string[]): Scenario {
  const ids = new Set(trackIds);
  const stationIds = scenario.stations
    .filter((s) => s.trackRefs.some((r) => ids.has(r.trackId)))
    .map((s) => s.id);
  const sc = refreshStationTracks(scenario, stationIds);
  return rerouteServicesOnTracks(sc, trackIds);
}
