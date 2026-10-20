/**
 * Build a project from a real-city network loaded from OpenStreetMap.
 *
 * Track lines become a double track (two physical tracks) fitted with lines and
 * circular arcs to their OSM geometry, and a service routed over it;
 * bus lines become street-routed lines whose sections are the OSM route between
 * consecutive stops. Every line is marked as existing infrastructure, so its
 * findings stay informational until the user edits it. Nothing here invents
 * figures: names and positions come from OSM, everything else is an editor
 * default the user can change.
 */
import type { LngLat, Project, Provenance, RouteLeg, Station, TransportLine, TransportMode } from './schema';
import { SCHEMA_VERSION } from './schema';
import { MODES } from './modes';
import { emptyScenario, reorderStops } from './network';
import { legsGeometry } from './alignment';
import { fitPiAlignment } from '../geo/track/fit';
import { createTracks, networkFrame, nearestOnTrack } from './tracks';
import { applyServiceRoute } from './serviceRouting';
import { distanceM, pathLengthM, positionAtFraction, slicePath, snapToPath } from '../geo/geometry';
import { initialSegments } from '../geo/segments';
import { newId, nowIso } from '../util/id';

export interface NetworkStationData {
  key: string;
  name: string;
  position: LngLat;
}

export interface NetworkLineData {
  id: string;
  ref: string;
  name: string;
  colour: string | null;
  mode: 'tram' | 'light_rail' | 'metro' | 'bus' | 'brt';
  coordinates: LngLat[];
  returnCoordinates: LngLat[] | null;
  stops: string[];
  status: string;
  gaps: number;
}

export interface NetworkData {
  city: string;
  cityName: string;
  kind: 'tram' | 'metro' | 'bus';
  label: string;
  center: LngLat;
  zoom: number;
  lines: NetworkLineData[];
  stations: NetworkStationData[];
  notes: string[];
}

function baseLine(data: NetworkLineData, mode: TransportMode, index: number): TransportLine {
  const defaults = MODES[mode];
  return {
    id: newId('line'),
    name: data.name || `${defaults.label} ${data.ref}`,
    shortName: (data.ref || String(index + 1)).slice(0, 8),
    color: data.colour ?? defaults.color,
    mode,
    customModeLabel: '',
    systemId: null,
    direction: 'bidirectional',
    runningSide: 'right',
    coordinates: [],
    alignment: { kind: 'polyline' },
    origin: { source: 'osm', ref: data.id, edited: false, status: data.status },
    crossovers: [],
    transitSignalPriority: false,
    segments: initialSegments({
      structure: defaults.defaultStructure,
      rightOfWay: defaults.defaultRightOfWay,
      tracks: 'double',
      speedLimitKmh: null,
      notes: '',
    }),
    stops: [],
    termination: { kind: 'ends', start: 'terminal_station', end: 'terminal_station' },
    servicePatterns: [
      {
        id: newId('sp'),
        name: 'All stops',
        kind: 'all_stops',
        servedStationIds: [],
        // Editor defaults, not the real timetable (not loaded).
        peakHeadwayMin: 10,
        offPeakHeadwayMin: 15,
        serviceStart: '05:30',
        serviceEnd: '23:30',
      },
    ],
    vehicleTypeId: null,
    fleetSize: null,
    consistUnits: null,
    dwellTimeS: defaults.defaultDwellTimeS,
    maxSpeedKmh: defaults.defaultMaxSpeedKmh,
    metadata: {},
    notes: data.gaps
      ? `Imported from OpenStreetMap ${data.id}; the mapped route has ${data.gaps} gap(s).`
      : `Imported from OpenStreetMap ${data.id}.`,
  };
}

/** Street-routed line whose sections are the OSM route between consecutive stops. */
function routedFromOsm(line: TransportLine, path: LngLat[], stopPositions: LngLat[]): TransportLine {
  const total = pathLengthM(path);
  const marks = [0, ...stopPositions.map((p) => snapToPath(path, false, p)?.fraction ?? 0), 1]
    .sort((a, b) => a - b)
    .filter((f, i, arr) => i === 0 || f - arr[i - 1]! > 20 / Math.max(total, 1));
  if (marks[marks.length - 1] !== 1) marks.push(1);
  const waypoints: LngLat[] = [];
  const legs: RouteLeg[] = [];
  for (let i = 0; i < marks.length - 1; i++) {
    const g = slicePath(path, false, marks[i]!, marks[i + 1]!);
    if (g.length < 2) continue;
    if (!waypoints.length) waypoints.push(g[0]!);
    waypoints.push(g[g.length - 1]!);
    legs.push({
      status: 'routed',
      provider: 'OpenStreetMap route relation',
      routedAt: null,
      message: '',
      geometry: g,
    });
  }
  return {
    ...line,
    alignment: { kind: 'routed', waypoints, legs, returnCoordinates: null },
    coordinates: legsGeometry(legs, waypoints),
  };
}

/** A line whose ends are this close is treated as a ring. */
const RING_CLOSE_M = 60;

/** Resample a path every `stepM` metres (for fitting lines and arcs to uneven OSM vertices). */
function resample(path: readonly LngLat[], stepM: number): LngLat[] {
  const total = pathLengthM(path);
  if (total <= stepM) return [...path];
  const n = Math.ceil(total / stepM);
  return Array.from({ length: n + 1 }, (_, i) => positionAtFraction(path, false, i / n));
}

/** Stations of an imported line are matched to its own tracks within this distance (OSM stop positions). */
const IMPORT_STATION_TRACK_M = 80;
/** Fitting tolerance for OSM geometry, metres (an editor setting, not an engineering value). */
const IMPORT_FIT_TOLERANCE_M = 3;

export function networkToProject(network: NetworkData, provenance: Provenance): Project {
  const scenario = emptyScenario(`${network.cityName}: ${network.label}`);
  const stationByKey = new Map<string, Station>();
  for (const s of network.stations) {
    stationByKey.set(s.key, {
      id: newId('st'),
      name: s.name,
      nameSource: 'user',
      nameSuggestion: null,
      position: s.position,
      construction: 'surface',
      platformType: 'unknown',
      busStopType: 'unknown',
      layout: null,
      verticalOffsetM: null,
      entrances: [],
      accessibility: { stepFree: null, elevators: null, tactilePaving: null },
      catchmentRadiusM: MODES[network.kind === 'bus' ? 'bus' : network.kind].defaultCatchmentRadiusM,
      trackRefs: [],
      metadata: {},
      notes: 'From OpenStreetMap.',
      imageUrls: [],
    });
  }
  const lines: TransportLine[] = [];
  let sc0 = scenario;
  network.lines.forEach((data, i) => {
    if (data.coordinates.length < 2) return;
    const mode: TransportMode = data.mode;
    let line = baseLine(data, mode, i);
    const path = data.coordinates.map((c) => [c[0], c[1]] as LngLat);
    const ring = path.length > 3 && distanceM(path[0]!, path[path.length - 1]!) <= RING_CLOSE_M;
    if (ring) line = { ...line, termination: { kind: 'ring' } };
    const open = ring ? path.slice(0, -1) : path;
    const stops = data.stops.map((k) => stationByKey.get(k)).filter((s): s is Station => !!s);
    if (mode === 'bus' || mode === 'brt') {
      line = routedFromOsm(
        line,
        path,
        stops.map((s) => s.position),
      );
      line = { ...line, termination: { kind: 'ends', start: 'terminal_station', end: 'terminal_station' } };
      if (data.returnCoordinates && data.returnCoordinates.length >= 2 && line.alignment.kind === 'routed')
        line = { ...line, alignment: { ...line.alignment, returnCoordinates: data.returnCoordinates } };
    } else {
      // Physical double track fitted to the mapped route; a ring closes on itself.
      const pts = resample(ring ? [...open, open[0]!] : open, 10);
      if (!sc0.trackNetwork.frameOrigin)
        sc0 = { ...sc0, trackNetwork: { ...sc0.trackNetwork, frameOrigin: network.center } };
      const frame = networkFrame(sc0.trackNetwork);
      const fit = fitPiAlignment(
        pts.map((p) => frame.toMetres(p)),
        IMPORT_FIT_TOLERANCE_M,
      );
      const created = createTracks(sc0, {
        points: fit.alignment.points.map((v) => frame.toLngLat(v)),
        radii: fit.alignment.radii,
        mode,
        double: true,
        origin: { source: 'osm', ref: data.id, edited: false },
      });
      if (created.error) return;
      sc0 = created.scenario;
      for (const st of stops) {
        if (st.trackRefs.some((r) => created.trackIds.includes(r.trackId))) continue;
        const refs = created.trackIds
          .map((id) =>
            nearestOnTrack(
              sc0.trackNetwork,
              sc0.trackNetwork.tracks.find((t) => t.id === id)!,
              st.position,
            ),
          )
          .filter((h) => h.distanceM <= IMPORT_STATION_TRACK_M)
          .map((h) => ({ trackId: h.track.id, fraction: h.fraction }));
        stationByKey.forEach((v, k) => {
          if (v.id === st.id) stationByKey.set(k, { ...v, trackRefs: [...v.trackRefs, ...refs] });
        });
      }
      line = {
        ...line,
        alignment: { kind: 'track', path: [], returnPath: null, status: 'unrouted', message: '' },
        coordinates: open,
        notes: `${line.notes} Track fitted with lines and arcs (largest deviation ${Math.round(fit.maxDeviationM)} m).`,
      };
    }
    line = { ...line, stops: stops.map((s) => ({ stationId: s.id })) };
    lines.push(line);
  });
  // Structures (tunnel, viaduct) are not imported: stations follow the mode's default structure.
  const underground = new Set(
    lines
      .filter((l) => MODES[l.mode].defaultStructure === 'underground')
      .flatMap((l) => l.stops.map((s) => s.stationId)),
  );
  let sc = {
    ...sc0,
    description: `Existing ${network.label.toLowerCase()} of ${network.cityName} as mapped in OpenStreetMap.`,
    lines,
    stations: [...stationByKey.values()]
      .filter((s) => lines.some((l) => l.stops.some((x) => x.stationId === s.id)))
      .map((s): Station => (underground.has(s.id) ? { ...s, construction: 'underground' } : s)),
  };
  for (const l of lines) sc = reorderStops(sc, l.id);
  sc = { ...sc, lines: sc.lines.map((l) => applyServiceRoute(sc, l)) };
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('prj'),
    name: `${network.cityName}: ${network.label}`,
    description: `Real network loaded from OpenStreetMap. ${network.notes.join(' ')}`.trim(),
    metadata: {},
    fictional: false,
    mapView: { center: network.center, zoom: network.zoom, bearing: 0, pitch: 0 },
    scenarios: [sc],
    activeScenarioId: sc.id,
    assumptionSets: [],
    datasetReferences: [{ id: newId('ds'), provenance }],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}
