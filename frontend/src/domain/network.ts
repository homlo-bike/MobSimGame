/**
 * Pure operations on a scenario's network. No React, no map. Every function
 * returns a new Scenario so the store can keep undo history by reference.
 */
import type { LngLat, Scenario, Station, TransportLine, TransportMode, Project, SharedTrack } from './schema';
import { EMPTY_TRACK_NETWORK, PLACEHOLDER_PEAK_PERIODS, PLACEHOLDER_SIGNAL_SETTINGS } from './schema';
import { MODES, defaultVehicleTypes } from './modes';
import { parameterValue } from './trackParameters';
import { compatibleVehicles } from './vehicles';
import { newId, nowIso } from '../util/id';
import {
  distanceM,
  overlapRanges,
  pathLengthM,
  positionAtFraction,
  snapToPath,
  endsMeet,
} from '../geo/geometry';
import { initialSegments, joinSegments, normalizeSegments, sliceSegments } from '../geo/segments';
import {
  buildAlignment,
  defaultAlignmentKind,
  editablePoints,
  waypointChainages,
  withEditedPoints,
  type AlignmentKind,
} from './alignment';

/** A click within this distance of an existing station reuses it (project parameter, default 20 m). */
export function stationMergeRadiusM(scenario: Pick<Scenario, 'trackNetwork'>): number {
  return parameterValue(scenario.trackNetwork, 'stopMergeRadiusM');
}
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
  // A stop placed as a waypoint of a street route sits at that waypoint's chainage, even
  // where the route passes it again on the other side of the street.
  const wpChainage = waypointChainages(line);
  const waypoints = line.alignment.kind === 'routed' ? line.alignment.waypoints : [];
  const used = new Set<number>();
  const total = lineLengthM(line);
  for (const stop of line.stops) {
    const station = byId.get(stop.stationId);
    if (!station) continue;
    const snap = snapToPath(line.coordinates, isRing(line), station.position);
    if (!snap) continue;
    const w = wpChainage
      ? waypoints.findIndex((p, i) => !used.has(i) && distanceM(p, station.position) <= 1)
      : -1;
    if (w >= 0 && total > 0) {
      used.add(w);
      const chainageM = Math.min(wpChainage![w]!, total);
      out.push({ station, chainageM, fraction: chainageM / total, offsetM: snap.offsetM });
      continue;
    }
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
  /** The points the user placed: control points, waypoints or vertices depending on `alignment`. */
  coordinates: LngLat[];
  /** Defaults to the mode's alignment kind (smooth curve for track, streets for bus). */
  alignment?: AlignmentKind;
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
  const vehicle = compatibleVehicles(scenario.vehicleTypes, input.mode)[0] ?? null;
  const built = buildAlignment(input.alignment ?? defaultAlignmentKind(input.mode), coords, ring);
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
    coordinates: built.coordinates,
    alignment: built.alignment,
    origin: { source: 'user', ref: null, edited: false, status: '' },
    crossovers: [],
    transitSignalPriority: false,
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
    fleetSize: null,
    peakDemandPphpd: null,
    consistUnits: null,
    // New lines follow the project settings of their mode (G1).
    dwellTimeS: scenario.trackNetwork.modeDefaults?.[input.mode]?.dwellTimeS ?? mode.defaultDwellTimeS,
    maxSpeedKmh: scenario.trackNetwork.modeDefaults?.[input.mode]?.maxSpeedKmh ?? mode.defaultMaxSpeedKmh,
    inherits: ['dwellTimeS', 'maxSpeedKmh'],
    metadata: {},
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

/**
 * Replace the edited points (control points, waypoints or vertices) and
 * recompute the geometry; segments keep their fractions, stops are re-ordered
 * and stations of this line only are snapped back onto the new geometry.
 */
export function updateLineGeometry(scenario: Scenario, lineId: string, points: LngLat[]): Scenario {
  const line = scenario.lines.find((l) => l.id === lineId);
  // Track services take their geometry from the tracks.
  if (!line || line.alignment.kind === 'track') return scenario;
  let coords = points;
  if (isRing(line) && coords.length > 3 && distanceM(coords[0]!, coords[coords.length - 1]!) <= 1) {
    coords = coords.slice(0, -1);
  }
  const updated = withEditedPoints(line, coords, isRing(line));
  return reorderStops(updateLine(scenario, lineId, updated), lineId);
}

/** Switch a line between smooth curve, street routing and straight segments. */
export function setLineAlignmentKind(scenario: Scenario, lineId: string, kind: AlignmentKind): Scenario {
  const line = scenario.lines.find((l) => l.id === lineId);
  // Track services always run on tracks; other modes cannot be switched onto tracks.
  if (!line || line.alignment.kind === kind || line.alignment.kind === 'track' || kind === 'track')
    return scenario;
  const { alignment, coordinates } = buildAlignment(kind, editablePoints(line), isRing(line));
  return reorderStops(updateLine(scenario, lineId, { alignment, coordinates }), lineId);
}

export function reorderStops(scenario: Scenario, lineId: string): Scenario {
  const line = scenario.lines.find((l) => l.id === lineId);
  // A track service keeps the stop order the user chose; its path follows that order.
  if (!line || line.alignment.kind === 'track') return scenario;
  const ordered = orderedStops(line, scenario.stations);
  const known = new Set(ordered.map((o) => o.station.id));
  const stops = [
    ...ordered.map((o) => ({ stationId: o.station.id, trackId: null })),
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
 * within the stop merge distance (`stationMergeRadiusM`) of the snapped point it is shared instead of
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
    .filter((x) => x.d <= stationMergeRadiusM(scenario))
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
      updateLine(scenario, lineId, { stops: [...line.stops, { stationId: existing.id, trackId: null }] }),
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
    busStopType: 'unknown',
    layout: null,
    verticalOffsetM: null,
    entrances: [],
    accessibility: { stepFree: null, elevators: null, escalators: null, ramp: null, tactilePaving: null },
    catchmentRadiusM: mode.defaultCatchmentRadiusM,
    notes: '',
    trackRefs: [],
    metadata: {},
    imageUrls: [],
  };
  const withStation = touch({ ...scenario, stations: [...scenario.stations, station] });
  const next = reorderStops(
    updateLine(withStation, lineId, { stops: [...line.stops, { stationId: station.id, trackId: null }] }),
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
  return reorderStops(
    updateLine(scenario, lineId, { stops: [...line.stops, { stationId, trackId: null }] }),
    lineId,
  );
}

export function removeStopFromLine(scenario: Scenario, lineId: string, stationId: string): Scenario {
  const line = scenario.lines.find((l) => l.id === lineId);
  if (!line) return scenario;
  return updateLine(scenario, lineId, {
    stops: line.stops.filter((s) => s.stationId !== stationId),
    crossovers: line.crossovers.filter((c) => c.stationId !== stationId),
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

/** Fraction along the line's geometry of each edited point. */
function pointFractions(line: TransportLine, points: readonly LngLat[]): number[] {
  return points.map((p) => snapToPath(line.coordinates, false, p)?.fraction ?? 0);
}

/** Split a line at a fraction into two lines. Stops go to the side they lie on. */
export function splitLine(scenario: Scenario, lineId: string, fraction: number): Scenario {
  const line = scenario.lines.find((l) => l.id === lineId);
  if (!line || isRing(line) || line.alignment.kind === 'track' || fraction <= 0.01 || fraction >= 0.99)
    return scenario;
  const splitAt = positionAtFraction(line.coordinates, false, fraction);
  const points = editablePoints(line);
  const fractions = pointFractions(line, points);
  const before: LngLat[] = [...points.filter((_, i) => fractions[i]! < fraction), splitAt];
  const after: LngLat[] = [splitAt, ...points.filter((_, i) => fractions[i]! >= fraction)];
  const a = buildAlignment(line.alignment.kind, before, false, line);
  const b = buildAlignment(line.alignment.kind, after, false, line);
  const stops = orderedStops(line, scenario.stations);
  const first: TransportLine = {
    ...line,
    coordinates: a.coordinates,
    alignment: a.alignment,
    segments: normalizeSegments(sliceSegments(line.segments, 0, fraction), line.segments[0]!),
    stops: stops
      .filter((s) => s.fraction <= fraction)
      .map((s) => ({ stationId: s.station.id, trackId: null })),
    termination: {
      kind: 'ends',
      start: line.termination.kind === 'ends' ? line.termination.start : 'terminal_station',
      end: 'terminal_station',
    },
    crossovers: [],
  };
  const second: TransportLine = {
    ...line,
    id: newId('line'),
    name: `${line.name} (split)`,
    shortName: `${line.shortName}b`.slice(0, 8),
    coordinates: b.coordinates,
    alignment: b.alignment,
    segments: normalizeSegments(
      sliceSegments(line.segments, fraction, 1),
      line.segments[line.segments.length - 1]!,
    ),
    stops: stops
      .filter((s) => s.fraction >= fraction)
      .map((s) => ({ stationId: s.station.id, trackId: null })),
    termination: {
      kind: 'ends',
      start: 'terminal_station',
      end: line.termination.kind === 'ends' ? line.termination.end : 'terminal_station',
    },
    servicePatterns: line.servicePatterns.map((p) => ({ ...p, id: newId('sp') })),
    crossovers: [],
  };
  const keep = (l: TransportLine) =>
    l.crossovers.filter((c) => l.stops.some((s) => s.stationId === c.stationId));
  return touch({
    ...scenario,
    lines: scenario.lines.flatMap((l) =>
      l.id === lineId
        ? [
            { ...first, crossovers: keep({ ...first, crossovers: line.crossovers }) },
            { ...second, crossovers: keep({ ...second, crossovers: line.crossovers }) },
          ]
        : [l],
    ),
  });
}

/**
 * Join line `b` onto the end of line `a`. `b` is reversed if its end, not its
 * start, is nearer to `a`'s end. Returns an error when the ends are too far apart.
 * The joined line keeps `a`'s alignment kind.
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
  if (a.mode !== b.mode) return { scenario, error: 'Lines of different modes cannot be joined' };
  if (a.alignment.kind === 'track' || b.alignment.kind === 'track')
    return { scenario, error: 'Services on tracks are extended by adding stops, not by joining lines' };
  const aEnd = a.coordinates[a.coordinates.length - 1]!;
  const dStart = distanceM(aEnd, b.coordinates[0]!);
  const dEnd = distanceM(aEnd, b.coordinates[b.coordinates.length - 1]!);
  const reverse = dEnd < dStart;
  const gap = Math.min(dStart, dEnd);
  if (gap > maxGapM)
    return { scenario, error: `Line ends are ${Math.round(gap)} m apart (limit ${maxGapM} m)` };
  const aPts = editablePoints(a);
  const bPtsRaw = editablePoints(b);
  const bPts = reverse ? [...bPtsRaw].reverse() : bPtsRaw;
  const bSegs = reverse
    ? [...b.segments]
        .reverse()
        .map((s) => ({ ...s, fromFraction: 1 - s.toFraction, toFraction: 1 - s.fromFraction }))
    : b.segments;
  const joinedPts =
    distanceM(aPts[aPts.length - 1]!, bPts[0]!) < 1 ? [...aPts, ...bPts.slice(1)] : [...aPts, ...bPts];
  // Routed legs of both lines survive the join (reversed legs are re-routed: one-way streets may differ).
  const previous =
    a.alignment.kind === 'routed'
      ? {
          coordinates: a.coordinates,
          alignment: {
            ...a.alignment,
            waypoints: [...a.alignment.waypoints, ...(reverse ? [] : bPts)],
            legs: [
              ...a.alignment.legs,
              ...(reverse || b.alignment.kind !== 'routed'
                ? []
                : [
                    {
                      status: 'unrouted' as const,
                      provider: null,
                      routedAt: null,
                      message: '',
                      geometry: [],
                    },
                    ...b.alignment.legs,
                  ]),
            ],
          },
        }
      : a;
  const built = buildAlignment(a.alignment.kind, joinedPts, false, previous);
  const stops = [...a.stops, ...b.stops.filter((s) => !a.stops.some((x) => x.stationId === s.stationId))];
  const joined: TransportLine = {
    ...a,
    coordinates: built.coordinates,
    alignment: built.alignment,
    segments: normalizeSegments(
      joinSegments(a.segments, lineLengthM(a), bSegs, lineLengthM(b)),
      a.segments[0]!,
    ),
    stops,
    crossovers: [...a.crossovers, ...b.crossovers.filter((c) => !a.crossovers.some((x) => x.id === c.id))],
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
    trackNetwork: { ...EMPTY_TRACK_NETWORK },
    regions: [],
    lines: [],
    stations: [],
    platforms: [],
    interchanges: [],
    depots: [],
    sharedTracks: [],
    trafficSignals: [],
    signalSettings: { ...PLACEHOLDER_SIGNAL_SETTINGS },
    vehicleTypes: defaultVehicleTypes(),
    assumptionSetId: null,
    peakPeriods: PLACEHOLDER_PEAK_PERIODS.map((p) => ({ ...p })),
    schematicOffsets: {},
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

/**
 * Crossovers are drawn this far before or after their station (or halfway to the
 * neighbouring stop if that is closer). This is a display position only: the
 * real location would follow from track design, which a sketch does not have.
 */
export const CROSSOVER_DISPLAY_OFFSET_M = 80;

export interface PlacedCrossover {
  id: string;
  stationId: string;
  side: 'before' | 'after';
  chainageM: number;
  position: LngLat;
}

/** Crossovers of a line with their chainage, in line order. */
export function placedCrossovers(line: TransportLine, stations: readonly Station[]): PlacedCrossover[] {
  const stops = orderedStops(line, stations);
  const total = lineLengthM(line);
  if (total <= 0) return [];
  const out: PlacedCrossover[] = [];
  for (const c of line.crossovers) {
    const i = stops.findIndex((s) => s.station.id === c.stationId);
    if (i < 0) continue;
    const here = stops[i]!.chainageM;
    const neighbour =
      c.side === 'before' ? (stops[i - 1]?.chainageM ?? 0) : (stops[i + 1]?.chainageM ?? total);
    const room = Math.abs(here - neighbour) / 2;
    const d = Math.min(CROSSOVER_DISPLAY_OFFSET_M, room);
    const chainageM = Math.min(total, Math.max(0, here + (c.side === 'before' ? -d : d)));
    out.push({
      ...c,
      chainageM,
      position: positionAtFraction(line.coordinates, isRing(line), chainageM / total),
    });
  }
  return out.sort((a, b) => a.chainageM - b.chainageM);
}

/** Add or remove the crossover before or after a station of the line. */
export function toggleCrossover(
  scenario: Scenario,
  lineId: string,
  stationId: string,
  side: 'before' | 'after',
): Scenario {
  const line = scenario.lines.find((l) => l.id === lineId);
  if (!line || !line.stops.some((s) => s.stationId === stationId)) return scenario;
  const existing = line.crossovers.find((c) => c.stationId === stationId && c.side === side);
  return updateLine(scenario, lineId, {
    crossovers: existing
      ? line.crossovers.filter((c) => c !== existing)
      : [...line.crossovers, { id: newId('xo'), stationId, side }],
  });
}

/**
 * Reverse the drawn direction of a line: geometry, segments, ends and crossover
 * sides follow. Street-routed legs are re-routed because one-way streets may differ.
 */
export function reverseLineDirection(scenario: Scenario, lineId: string): Scenario {
  const line = scenario.lines.find((l) => l.id === lineId);
  if (!line) return scenario;
  const points = [...editablePoints(line)].reverse();
  const built = buildAlignment(line.alignment.kind, points, isRing(line));
  const updated: TransportLine = {
    ...line,
    alignment: built.alignment,
    coordinates: built.coordinates,
    segments: [...line.segments]
      .reverse()
      .map((s) => ({ ...s, fromFraction: 1 - s.toFraction, toFraction: 1 - s.fromFraction })),
    termination:
      line.termination.kind === 'ends'
        ? { kind: 'ends', start: line.termination.end, end: line.termination.start }
        : line.termination,
    crossovers: line.crossovers.map((c) => ({ ...c, side: c.side === 'before' ? 'after' : 'before' })),
    origin: line.origin.source === 'osm' ? { ...line.origin, edited: true } : line.origin,
  };
  return reorderStops(updateLine(scenario, lineId, updated), lineId);
}
