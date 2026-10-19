/**
 * Pure operations on a scenario's network. No React, no map. Every function
 * returns a new Scenario so the store can keep undo history by reference.
 */
import type { LngLat, Scenario, Station, TransportLine, TransportMode, Project, SharedTrack } from './schema';
import { MODES, defaultVehicleTypes } from './modes';
import { newId, nowIso } from '../util/id';
import {
  distanceM,
  overlapRanges,
  pathCoordinates,
  pathLengthM,
  positionAtFraction,
  snapToPath,
  endsMeet,
} from '../geo/geometry';
import { initialSegments, joinSegments, normalizeSegments, sliceSegments } from '../geo/segments';

/** A click within this distance of an existing station reuses it (shared station). */
export const STATION_MERGE_RADIUS_M = 60;
/** A station further than this from a line it serves is flagged by validation. */
export const STATION_ON_LINE_TOLERANCE_M = 80;

const touch = (s: Scenario): Scenario => ({ ...s, updatedAt: nowIso() });

export function isRing(line: TransportLine): boolean {
  return line.termination.kind === 'ring';
}

export function lineLengthM(line: TransportLine): number {
  return pathLengthM(line.coordinates, isRing(line));
}

export interface OrderedStop {
  station: Station;
  chainageM: number;
  fraction: number;
  offsetM: number;
}

/** Stops of a line sorted by position along the alignment. */
export function orderedStops(line: TransportLine, stations: readonly Station[]): OrderedStop[] {
  const byId = new Map(stations.map((s) => [s.id, s]));
  const out: OrderedStop[] = [];
  for (const stop of line.stops) {
    const station = byId.get(stop.stationId);
    if (!station) continue;
    const snap = snapToPath(line.coordinates, isRing(line), station.position);
    if (!snap) continue;
    out.push({ station, chainageM: snap.chainageM, fraction: snap.fraction, offsetM: snap.offsetM });
  }
  return out.sort((a, b) => a.chainageM - b.chainageM);
}

export function linesServingStation(scenario: Scenario, stationId: string): TransportLine[] {
  return scenario.lines.filter((l) => l.stops.some((s) => s.stationId === stationId));
}

export function isInterchange(scenario: Scenario, stationId: string): boolean {
  return linesServingStation(scenario, stationId).length >= 2;
}

/** Deduplicate a station name within the scenario by appending a qualifier. */
export function uniqueStationName(
  scenario: Scenario,
  name: string,
  qualifier?: string,
  exceptId?: string,
): string {
  const taken = new Set(scenario.stations.filter((s) => s.id !== exceptId).map((s) => s.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  if (qualifier) {
    const q = `${name} (${qualifier})`;
    if (!taken.has(q.toLowerCase())) return q;
  }
  for (let i = 2; i < 1000; i++) {
    const candidate = `${name} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${name} ${newId('x')}`;
}

export interface CreateLineInput {
  coordinates: LngLat[];
  mode: TransportMode;
  name?: string;
  id?: string;
  color?: string;
  ring?: boolean;
}

export function createLine(
  scenario: Scenario,
  input: CreateLineInput,
): { scenario: Scenario; line: TransportLine } {
  const mode = MODES[input.mode];
  const n = scenario.lines.length + 1;
  let coords = input.coordinates;
  // A drawn line whose ends meet is treated as a ring; the closing vertex is dropped.
  const ring = input.ring ?? endsMeet(coords, 5);
  if (ring && coords.length > 3 && distanceM(coords[0]!, coords[coords.length - 1]!) <= 5) {
    coords = coords.slice(0, -1);
  }
  const vehicle = scenario.vehicleTypes.find((v) => v.mode === input.mode) ?? null;
  const line: TransportLine = {
    id: input.id ?? newId('line'),
    name: input.name ?? `${mode.label} line ${n}`,
    shortName: `L${n}`,
    color: input.color ?? mode.color,
    mode: input.mode,
    customModeLabel: '',
    systemId: scenario.systems[0]?.id ?? null,
    direction: 'bidirectional',
    runningSide: 'right',
    coordinates: coords,
    segments: initialSegments({
      structure: mode.defaultStructure,
      rightOfWay: mode.defaultRightOfWay,
      tracks: 'double',
      speedLimitKmh: null,
      notes: '',
    }),
    stops: [],
    termination: ring
      ? { kind: 'ring' }
      : { kind: 'ends', start: 'terminal_station', end: 'terminal_station' },
    servicePatterns: [
      {
        id: newId('sp'),
        name: 'All stops',
        kind: 'all_stops',
        servedStationIds: [],
        peakHeadwayMin: 10,
        offPeakHeadwayMin: 15,
        serviceStart: '05:30',
        serviceEnd: '23:30',
      },
    ],
    vehicleTypeId: vehicle?.id ?? null,
    dwellTimeS: mode.defaultDwellTimeS,
    maxSpeedKmh: mode.defaultMaxSpeedKmh,
    notes: '',
  };
  return { scenario: touch({ ...scenario, lines: [...scenario.lines, line] }), line };
}

export function updateLine(scenario: Scenario, lineId: string, patch: Partial<TransportLine>): Scenario {
  return touch({
    ...scenario,
    lines: scenario.lines.map((l) => (l.id === lineId ? { ...l, ...patch, id: l.id } : l)),
  });
}

/** Replace the alignment; segments keep their fractions, stops are re-ordered. */
export function updateLineGeometry(scenario: Scenario, lineId: string, coordinates: LngLat[]): Scenario {
  const line = scenario.lines.find((l) => l.id === lineId);
  if (!line) return scenario;
  let coords = coordinates;
  if (isRing(line) && coords.length > 3 && distanceM(coords[0]!, coords[coords.length - 1]!) <= 1) {
    coords = coords.slice(0, -1);
  }
  const updated = { ...line, coordinates: coords };
  return reorderStops(updateLine(scenario, lineId, updated), lineId);
}

export function reorderStops(scenario: Scenario, lineId: string): Scenario {
  const line = scenario.lines.find((l) => l.id === lineId);
  if (!line) return scenario;
  const ordered = orderedStops(line, scenario.stations);
  const known = new Set(ordered.map((o) => o.station.id));
  const stops = [
    ...ordered.map((o) => ({ stationId: o.station.id })),
    // Stops whose station cannot be projected stay at the end so nothing is silently dropped.
    ...line.stops.filter((s) => !known.has(s.stationId)),
  ];
  return updateLine(scenario, lineId, { stops });
}

export function deleteLine(scenario: Scenario, lineId: string): Scenario {
  return touch({
    ...scenario,
    lines: scenario.lines.filter((l) => l.id !== lineId),
    sharedTracks: scenario.sharedTracks
      .map((st) => ({ ...st, members: st.members.filter((m) => m.lineId !== lineId) }))
      .filter((st) => st.members.length >= 2),
    depots: scenario.depots.map((d) => ({ ...d, lineIds: d.lineIds.filter((id) => id !== lineId) })),
  });
}

export interface AddStationResult {
  scenario: Scenario;
  station: Station | null;
  reused: boolean;
  error: string | null;
}

/**
 * Add a stop to a line at the point nearest to `at`. If an existing station is
 * within STATION_MERGE_RADIUS_M of the snapped point it is shared instead of
 * duplicated (stations are referenced entities).
 */
export function addStationOnLine(
  scenario: Scenario,
  lineId: string,
  at: LngLat,
  options: { maxSnapDistanceM?: number; name?: string } = {},
): AddStationResult {
  const line = scenario.lines.find((l) => l.id === lineId);
  if (!line) return { scenario, station: null, reused: false, error: 'Line not found' };
  const snap = snapToPath(line.coordinates, isRing(line), at);
  if (!snap) return { scenario, station: null, reused: false, error: 'Line geometry is invalid' };
  const maxSnap = options.maxSnapDistanceM ?? Infinity;
  if (snap.offsetM > maxSnap) {
    return {
      scenario,
      station: null,
      reused: false,
      error: `The point is ${Math.round(snap.offsetM)} m from the line (limit ${maxSnap} m). Click closer to the line.`,
    };
  }
  const existing = scenario.stations
    .map((s) => ({ s, d: distanceM(s.position, snap.position) }))
    .filter((x) => x.d <= STATION_MERGE_RADIUS_M)
    .sort((a, b) => a.d - b.d)[0]?.s;
  if (existing) {
    if (line.stops.some((s) => s.stationId === existing.id)) {
      return {
        scenario,
        station: existing,
        reused: true,
        error: 'This station is already a stop of the line',
      };
    }
    const next = reorderStops(
      updateLine(scenario, lineId, { stops: [...line.stops, { stationId: existing.id }] }),
      lineId,
    );
    return { scenario: next, station: existing, reused: true, error: null };
  }
  const mode = MODES[line.mode];
  const firstSeg = line.segments.find(
    (s) => snap.fraction >= s.fromFraction && snap.fraction <= s.toFraction,
  );
  const construction =
    firstSeg && ['underground', 'tunnel', 'cut_and_cover'].includes(firstSeg.structure)
      ? 'underground'
      : firstSeg && ['elevated', 'bridge'].includes(firstSeg.structure)
        ? 'elevated'
        : 'surface';
  const station: Station = {
    id: newId('st'),
    name: uniqueStationName(scenario, options.name ?? `Station ${scenario.stations.length + 1}`),
    nameSource: options.name ? 'user' : 'generated',
    nameSuggestion: null,
    position: snap.position,
    construction,
    platformType: 'unknown',
    verticalOffsetM: null,
    entrances: [],
    accessibility: { stepFree: null, elevators: null, tactilePaving: null },
    catchmentRadiusM: mode.defaultCatchmentRadiusM,
    notes: '',
    imageUrls: [],
  };
  const withStation = touch({ ...scenario, stations: [...scenario.stations, station] });
  const next = reorderStops(
    updateLine(withStation, lineId, { stops: [...line.stops, { stationId: station.id }] }),
    lineId,
  );
  return { scenario: next, station, reused: false, error: null };
}

/** Add a stop at a chainage in metres (keyboard / non-map alternative). */
export function addStationAtChainage(
  scenario: Scenario,
  lineId: string,
  chainageM: number,
): AddStationResult {
  const line = scenario.lines.find((l) => l.id === lineId);
  if (!line) return { scenario, station: null, reused: false, error: 'Line not found' };
  const total = lineLengthM(line);
  if (!(chainageM >= 0 && chainageM <= total)) {
    return {
      scenario,
      station: null,
      reused: false,
      error: `Chainage must be between 0 and ${Math.round(total)} m`,
    };
  }
  return addStationOnLine(
    scenario,
    lineId,
    positionAtFraction(line.coordinates, isRing(line), chainageM / total),
  );
}

/** Make an existing station a stop of another line (shared station). */
export function addExistingStationToLine(scenario: Scenario, lineId: string, stationId: string): Scenario {
  const line = scenario.lines.find((l) => l.id === lineId);
  if (!line || line.stops.some((s) => s.stationId === stationId)) return scenario;
  if (!scenario.stations.some((s) => s.id === stationId)) return scenario;
  return reorderStops(updateLine(scenario, lineId, { stops: [...line.stops, { stationId }] }), lineId);
}

export function removeStopFromLine(scenario: Scenario, lineId: string, stationId: string): Scenario {
  const line = scenario.lines.find((l) => l.id === lineId);
  if (!line) return scenario;
  return updateLine(scenario, lineId, {
    stops: line.stops.filter((s) => s.stationId !== stationId),
    servicePatterns: line.servicePatterns.map((p) => ({
      ...p,
      servedStationIds: p.servedStationIds.filter((id) => id !== stationId),
    })),
  });
}

export function updateStation(scenario: Scenario, stationId: string, patch: Partial<Station>): Scenario {
  return touch({
    ...scenario,
    stations: scenario.stations.map((s) => (s.id === stationId ? { ...s, ...patch, id: s.id } : s)),
  });
}

/** Rename by the user: marks the name as user-owned so suggestions never overwrite it. */
export function renameStation(scenario: Scenario, stationId: string, name: string): Scenario {
  return updateStation(scenario, stationId, { name: name.trim() || 'Unnamed station', nameSource: 'user' });
}

/** Apply a name suggestion unless the user already chose a name. */
export function applyNameSuggestion(
  scenario: Scenario,
  stationId: string,
  suggestion: NonNullable<Station['nameSuggestion']>,
  qualifier?: string,
): Scenario {
  const station = scenario.stations.find((s) => s.id === stationId);
  if (!station || station.nameSource === 'user') return scenario;
  return updateStation(scenario, stationId, {
    name: uniqueStationName(scenario, suggestion.name, qualifier, stationId),
    nameSource: 'suggestion',
    nameSuggestion: suggestion,
  });
}

/**
 * Move a station. With exactly one serving line, the new position is snapped to it.
 * Interchange stations keep the free position; validation flags any line it drifts from.
 */
export function moveStation(scenario: Scenario, stationId: string, to: LngLat): Scenario {
  const lines = linesServingStation(scenario, stationId);
  let position = to;
  if (lines.length === 1) {
    const snap = snapToPath(lines[0]!.coordinates, isRing(lines[0]!), to);
    if (snap) position = snap.position;
  }
  let next = updateStation(scenario, stationId, { position });
  for (const l of lines) next = reorderStops(next, l.id);
  return next;
}

export function deleteStation(scenario: Scenario, stationId: string): Scenario {
  let next = scenario;
  for (const l of linesServingStation(scenario, stationId)) next = removeStopFromLine(next, l.id, stationId);
  return touch({
    ...next,
    stations: next.stations.filter((s) => s.id !== stationId),
    interchanges: next.interchanges
      .map((i) => ({ ...i, stationIds: i.stationIds.filter((id) => id !== stationId) }))
      .filter((i) => i.stationIds.length >= 2),
    platforms: next.platforms.filter((p) => p.stationId !== stationId),
  });
}

/** Split a line at a fraction into two lines. Stops go to the side they lie on. */
export function splitLine(scenario: Scenario, lineId: string, fraction: number): Scenario {
  const line = scenario.lines.find((l) => l.id === lineId);
  if (!line || isRing(line) || fraction <= 0.01 || fraction >= 0.99) return scenario;
  const path = pathCoordinates(line.coordinates, false);
  const total = pathLengthM(path);
  const splitAt = positionAtFraction(path, false, fraction);
  // Collect vertices on each side.
  const before: LngLat[] = [path[0]!];
  const after: LngLat[] = [splitAt];
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    acc += distanceM(path[i - 1]!, path[i]!);
    if (acc / total < fraction) before.push(path[i]!);
    else after.push(path[i]!);
  }
  before.push(splitAt);
  const stops = orderedStops(line, scenario.stations);
  const first: TransportLine = {
    ...line,
    coordinates: before,
    segments: normalizeSegments(sliceSegments(line.segments, 0, fraction), line.segments[0]!),
    stops: stops.filter((s) => s.fraction <= fraction).map((s) => ({ stationId: s.station.id })),
    termination: {
      kind: 'ends',
      start: line.termination.kind === 'ends' ? line.termination.start : 'terminal_station',
      end: 'terminal_station',
    },
  };
  const second: TransportLine = {
    ...line,
    id: newId('line'),
    name: `${line.name} (split)`,
    shortName: `${line.shortName}b`.slice(0, 8),
    coordinates: after,
    segments: normalizeSegments(
      sliceSegments(line.segments, fraction, 1),
      line.segments[line.segments.length - 1]!,
    ),
    stops: stops.filter((s) => s.fraction >= fraction).map((s) => ({ stationId: s.station.id })),
    termination: {
      kind: 'ends',
      start: 'terminal_station',
      end: line.termination.kind === 'ends' ? line.termination.end : 'terminal_station',
    },
    servicePatterns: line.servicePatterns.map((p) => ({ ...p, id: newId('sp') })),
  };
  return touch({
    ...scenario,
    lines: scenario.lines.flatMap((l) => (l.id === lineId ? [first, second] : [l])),
  });
}

/**
 * Join line `b` onto the end of line `a`. `b` is reversed if its end, not its
 * start, is nearer to `a`'s end. Returns an error when the ends are too far apart.
 */
export function joinLines(
  scenario: Scenario,
  aId: string,
  bId: string,
  maxGapM = 200,
): { scenario: Scenario; error: string | null } {
  const a = scenario.lines.find((l) => l.id === aId);
  const b = scenario.lines.find((l) => l.id === bId);
  if (!a || !b || a.id === b.id) return { scenario, error: 'Choose two different lines' };
  if (isRing(a) || isRing(b)) return { scenario, error: 'Ring lines cannot be joined' };
  const aEnd = a.coordinates[a.coordinates.length - 1]!;
  const dStart = distanceM(aEnd, b.coordinates[0]!);
  const dEnd = distanceM(aEnd, b.coordinates[b.coordinates.length - 1]!);
  const reverse = dEnd < dStart;
  const gap = Math.min(dStart, dEnd);
  if (gap > maxGapM)
    return { scenario, error: `Line ends are ${Math.round(gap)} m apart (limit ${maxGapM} m)` };
  const bCoords = reverse ? [...b.coordinates].reverse() : b.coordinates;
  const bSegs = reverse
    ? [...b.segments]
        .reverse()
        .map((s) => ({ ...s, fromFraction: 1 - s.toFraction, toFraction: 1 - s.fromFraction }))
    : b.segments;
  const joinedCoords = gap < 1 ? [...a.coordinates, ...bCoords.slice(1)] : [...a.coordinates, ...bCoords];
  const stops = [...a.stops, ...b.stops.filter((s) => !a.stops.some((x) => x.stationId === s.stationId))];
  const joined: TransportLine = {
    ...a,
    coordinates: joinedCoords,
    segments: normalizeSegments(
      joinSegments(a.segments, lineLengthM(a), bSegs, lineLengthM(b)),
      a.segments[0]!,
    ),
    stops,
  };
  let next = touch({
    ...scenario,
    lines: scenario.lines.filter((l) => l.id !== bId).map((l) => (l.id === aId ? joined : l)),
  });
  next = reorderStops(next, aId);
  return { scenario: next, error: null };
}

/** Detect geometric overlaps between lines and record them as shared-track references. */
export function detectSharedTracks(scenario: Scenario, toleranceM = 15): SharedTrack[] {
  const result: SharedTrack[] = [];
  const lines = scenario.lines;
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i]!;
      const b = lines[j]!;
      for (const r of overlapRanges(a.coordinates, isRing(a), b.coordinates, isRing(b), toleranceM)) {
        const startPos = positionAtFraction(a.coordinates, isRing(a), r.fromFraction);
        const endPos = positionAtFraction(a.coordinates, isRing(a), r.toFraction);
        const s1 = snapToPath(b.coordinates, isRing(b), startPos);
        const s2 = snapToPath(b.coordinates, isRing(b), endPos);
        if (!s1 || !s2) continue;
        result.push({
          id: `shared-${a.id}-${b.id}-${result.length}`,
          members: [
            { lineId: a.id, fromFraction: r.fromFraction, toFraction: r.toFraction },
            {
              lineId: b.id,
              fromFraction: Math.min(s1.fraction, s2.fraction),
              toFraction: Math.max(s1.fraction, s2.fraction),
            },
          ],
          notes: 'Detected automatically from overlapping geometry',
        });
      }
    }
  }
  return result;
}

export function duplicateScenario(project: Project, scenarioId: string, name?: string): Project {
  const source = project.scenarios.find((s) => s.id === scenarioId);
  if (!source) return project;
  const copy: Scenario = {
    ...structuredClone(source),
    id: newId('sc'),
    name: name ?? `${source.name} (copy)`,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  return {
    ...project,
    scenarios: [...project.scenarios, copy],
    activeScenarioId: copy.id,
    updatedAt: nowIso(),
  };
}

export function activeScenario(project: Project): Scenario {
  return project.scenarios.find((s) => s.id === project.activeScenarioId) ?? project.scenarios[0]!;
}

export function replaceScenario(project: Project, scenario: Scenario): Project {
  return {
    ...project,
    scenarios: project.scenarios.map((s) => (s.id === scenario.id ? scenario : s)),
    updatedAt: nowIso(),
  };
}

export function emptyScenario(name = 'Scenario A'): Scenario {
  return {
    id: newId('sc'),
    name,
    description: '',
    systems: [{ id: newId('sys'), name: 'Network', color: '#0f766e', visible: true }],
    lines: [],
    stations: [],
    platforms: [],
    interchanges: [],
    depots: [],
    sharedTracks: [],
    vehicleTypes: defaultVehicleTypes(),
    assumptionSetId: null,
    schematicOffsets: {},
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}
