/**
 * GeoJSON (RFC 7946) import/export and CSV export.
 *
 * GeoJSON coordinates are ALWAYS [longitude, latitude]. Files that look like
 * [latitude, longitude] are rejected with an explanatory message rather than
 * silently swapped.
 */
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import type { LngLat, Scenario, TransportMode } from '../domain/schema';
import { TransportModeSchema } from '../domain/schema';
import {
  addExistingStationToLine,
  addStationOnLine,
  createLine,
  isRing,
  orderedStops,
  STATION_ON_LINE_TOLERANCE_M,
} from '../domain/network';
import { pathCoordinates, samplePath, slicePath } from './geometry';
import { STRUCTURE_LABELS } from '../domain/modes';

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_FEATURES = 5000;

export function scenarioToGeoJSON(
  scenario: Scenario,
  meta: { projectName: string; fictional: boolean },
): FeatureCollection {
  const features: Feature[] = [];
  for (const line of scenario.lines) {
    const ring = isRing(line);
    features.push({
      type: 'Feature',
      id: line.id,
      geometry: { type: 'LineString', coordinates: pathCoordinates(line.coordinates, ring) },
      properties: {
        kind: 'line',
        id: line.id,
        name: line.name,
        shortName: line.shortName,
        mode: line.mode,
        color: line.color,
        direction: line.direction,
        termination: line.termination.kind,
        stationIds: orderedStops(line, scenario.stations).map((s) => s.station.id),
      },
    });
    for (const seg of line.segments) {
      const coords = slicePath(line.coordinates, ring, seg.fromFraction, seg.toFraction);
      if (coords.length < 2) continue;
      features.push({
        type: 'Feature',
        id: seg.id,
        geometry: { type: 'LineString', coordinates: coords },
        properties: {
          kind: 'segment',
          lineId: line.id,
          structure: seg.structure,
          structureLabel: STRUCTURE_LABELS[seg.structure],
          rightOfWay: seg.rightOfWay,
          tracks: seg.tracks,
          fromFraction: seg.fromFraction,
          toFraction: seg.toFraction,
        },
      });
    }
  }
  for (const st of scenario.stations) {
    features.push({
      type: 'Feature',
      id: st.id,
      geometry: { type: 'Point', coordinates: st.position },
      properties: {
        kind: 'station',
        id: st.id,
        name: st.name,
        nameSource: st.nameSource,
        construction: st.construction,
        lineIds: scenario.lines.filter((l) => l.stops.some((s) => s.stationId === st.id)).map((l) => l.id),
      },
    });
  }
  return {
    type: 'FeatureCollection',
    features,
    // Foreign members (allowed by RFC 7946 §6.1).
    ...({
      mobsimgame: {
        project: meta.projectName,
        scenario: scenario.name,
        fictional: meta.fictional,
        coordinateOrder: '[longitude, latitude] (RFC 7946, WGS84)',
        exportedAt: new Date().toISOString(),
      },
    } as object),
  } as FeatureCollection;
}

export function sampledCoordinatesCsv(scenario: Scenario, stepM = 50): string {
  const rows = ['line_id,line_name,chainage_m,longitude,latitude,structure'];
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  for (const line of scenario.lines) {
    const ring = isRing(line);
    const samples = samplePath(line.coordinates, ring, stepM);
    const total = samples[samples.length - 1]?.chainageM ?? 0;
    for (const s of samples) {
      const f = total ? s.chainageM / total : 0;
      const seg = line.segments.find((x) => f >= x.fromFraction && f <= x.toFraction);
      rows.push(
        [
          esc(line.id),
          esc(line.name),
          s.chainageM.toFixed(1),
          s.position[0].toFixed(6),
          s.position[1].toFixed(6),
          seg?.structure ?? '',
        ].join(','),
      );
    }
  }
  return rows.join('\n') + '\n';
}

export interface ImportReport {
  linesAdded: number;
  stationsAdded: number;
  stationsShared: number;
  skipped: string[];
}

function checkPosition(p: Position, where: string): string | null {
  if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== 'number' || typeof p[1] !== 'number') {
    return `${where}: coordinate is not a [longitude, latitude] number pair`;
  }
  const [x, y] = p as [number, number];
  if (!Number.isFinite(x) || !Number.isFinite(y)) return `${where}: coordinate is not finite`;
  if (Math.abs(y) > 90 && Math.abs(x) <= 90) {
    return `${where}: latitude ${y} is out of range. GeoJSON uses [longitude, latitude]; the file may use [latitude, longitude].`;
  }
  if (Math.abs(x) > 180 || Math.abs(y) > 90)
    return `${where}: coordinate [${x}, ${y}] is outside WGS84 bounds`;
  return null;
}

function linesOf(g: Geometry): Position[][] {
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
  return [];
}

/**
 * Import lines (LineString/MultiLineString) and stations (Point) into a scenario.
 * Stations with `lineIds` properties referencing imported lines are attached to
 * them; other points attach to the nearest line within tolerance.
 */
export function importGeoJSON(
  scenario: Scenario,
  data: unknown,
  defaultMode: TransportMode,
): { scenario: Scenario; report: ImportReport } | { error: string } {
  const report: ImportReport = { linesAdded: 0, stationsAdded: 0, stationsShared: 0, skipped: [] };
  if (!data || typeof data !== 'object') return { error: 'The file is not a JSON object' };
  const obj = data as { type?: string; features?: unknown[] };
  let features: Feature[];
  if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) features = obj.features as Feature[];
  else if (obj.type === 'Feature') features = [obj as unknown as Feature];
  else return { error: 'Expected a GeoJSON FeatureCollection or Feature' };
  if (features.length > MAX_IMPORT_FEATURES)
    return { error: `Too many features (${features.length}; limit ${MAX_IMPORT_FEATURES})` };

  // Validate all coordinates first so a bad file changes nothing.
  for (const [i, f] of features.entries()) {
    if (!f || f.type !== 'Feature' || !f.geometry) {
      report.skipped.push(`Feature ${i + 1}: not a Feature with geometry`);
      continue;
    }
    const g = f.geometry;
    const positions: Position[] =
      g.type === 'Point'
        ? [g.coordinates]
        : g.type === 'LineString' || g.type === 'MultiLineString'
          ? linesOf(g).flat()
          : [];
    for (const p of positions) {
      const err = checkPosition(p, `Feature ${i + 1}`);
      if (err) return { error: err };
    }
  }

  let next = scenario;
  const idMap = new Map<string, string>();
  const createdLineIds: string[] = [];
  for (const [i, f] of features.entries()) {
    if (!f?.geometry) continue;
    const props = (f.properties ?? {}) as Record<string, unknown>;
    if (props.kind === 'segment') continue; // Derived on export; segments travel with lines in project JSON.
    const parts = linesOf(f.geometry);
    if (!parts.length) continue;
    const modeParse = TransportModeSchema.safeParse(props.mode);
    for (const [j, part] of parts.entries()) {
      if (part.length < 2) {
        report.skipped.push(`Feature ${i + 1}: line with fewer than two coordinates`);
        continue;
      }
      const res = createLine(next, {
        coordinates: part.map((p) => [p[0]!, p[1]!] as LngLat),
        mode: modeParse.success ? modeParse.data : defaultMode,
        name:
          typeof props.name === 'string'
            ? parts.length > 1
              ? `${props.name} ${j + 1}`
              : props.name
            : undefined,
        color:
          typeof props.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(props.color) ? props.color : undefined,
        ring: props.termination === 'ring' ? true : undefined,
        // Imported bus geometry is kept as drawn; it can be switched to street routing in the inspector.
        alignment: modeParse.success && ['bus', 'brt'].includes(modeParse.data) ? 'polyline' : undefined,
      });
      next = res.scenario;
      report.linesAdded++;
      createdLineIds.push(res.line.id);
      const sourceId = typeof props.id === 'string' ? props.id : f.id != null ? String(f.id) : null;
      if (sourceId) idMap.set(sourceId, res.line.id);
    }
  }

  for (const [i, f] of features.entries()) {
    if (f?.geometry?.type !== 'Point') continue;
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const at: LngLat = [f.geometry.coordinates[0]!, f.geometry.coordinates[1]!];
    const name = typeof props.name === 'string' ? props.name : undefined;
    const requested = Array.isArray(props.lineIds)
      ? (props.lineIds as unknown[]).map((x) => idMap.get(String(x))).filter((x): x is string => !!x)
      : [];
    const candidates = requested.length ? requested : [...createdLineIds, ...scenario.lines.map((l) => l.id)];
    let stationId: string | null = null;
    for (const lineId of candidates) {
      if (stationId) {
        next = addExistingStationToLine(next, lineId, stationId);
        report.stationsShared++;
        continue;
      }
      const res = addStationOnLine(next, lineId, at, {
        name,
        maxSnapDistanceM: requested.length ? Infinity : STATION_ON_LINE_TOLERANCE_M,
      });
      if (res.station && !res.error) {
        next = res.scenario;
        stationId = res.station.id;
        if (res.reused) report.stationsShared++;
        else report.stationsAdded++;
        if (!requested.length) break;
      }
    }
    if (!stationId) report.skipped.push(`Feature ${i + 1}: point is not near any line, skipped`);
  }
  return { scenario: next, report };
}
