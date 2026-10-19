/**
 * Alignment kinds and the points the user edits for each of them.
 *
 * - Track-guided modes (tram, light rail, metro, rail) use smooth splines.
 * - Bus and BRT follow streets: waypoints routed on the street network.
 * - Cycling, walking and custom corridors use straight segments.
 *
 * `line.coordinates` is always the derived geometry; this module recomputes it.
 */
import type { Alignment, LngLat, RouteLeg, TransportLine, TransportMode } from './schema';
import { sampleSpline } from '../geo/spline';
import { snapToPath } from '../geo/geometry';

export type AlignmentKind = Alignment['kind'];

export const ALIGNMENT_LABELS: Record<AlignmentKind, string> = {
  spline: 'Smooth curve (track)',
  routed: 'Follows streets',
  polyline: 'Straight segments',
};

const SPLINE_MODES: TransportMode[] = ['tram', 'light_rail', 'metro', 'elevated_metro', 'commuter_rail'];
const ROUTED_MODES: TransportMode[] = ['bus', 'brt'];

export function defaultAlignmentKind(mode: TransportMode): AlignmentKind {
  if (SPLINE_MODES.includes(mode)) return 'spline';
  if (ROUTED_MODES.includes(mode)) return 'routed';
  return 'polyline';
}

export function unroutedLeg(a: LngLat, b: LngLat, message = ''): RouteLeg {
  return { status: 'unrouted', provider: null, routedAt: null, message, geometry: [a, b] };
}

/** Geometry of a routed line: its legs joined end to end. */
export function legsGeometry(legs: readonly RouteLeg[], waypoints: readonly LngLat[]): LngLat[] {
  const out: LngLat[] = [];
  legs.forEach((leg, i) => {
    const a = waypoints[i]!;
    const b = waypoints[(i + 1) % waypoints.length]!;
    const g = leg.geometry.length >= 2 ? leg.geometry : [a, b];
    out.push(...(out.length ? g.slice(1) : g));
  });
  return out.length ? out : waypoints.map((p) => [p[0], p[1]] as LngLat);
}

/** The vertices shown as editing handles on the map. */
export function editablePoints(line: Pick<TransportLine, 'alignment' | 'coordinates'>): LngLat[] {
  switch (line.alignment.kind) {
    case 'spline':
      return line.alignment.controlPoints;
    case 'routed':
      return line.alignment.waypoints;
    default:
      return line.coordinates;
  }
}

/**
 * Build an alignment of `kind` from user-edited points and return the derived
 * geometry. Routed legs whose endpoints did not move keep their routed geometry
 * only when `previous` is given and the leg is unchanged; otherwise the leg
 * becomes unrouted (straight placeholder) until it is routed again.
 */
export function buildAlignment(
  kind: AlignmentKind,
  points: readonly LngLat[],
  ring: boolean,
  previous?: Pick<TransportLine, 'alignment' | 'coordinates'>,
): { alignment: Alignment; coordinates: LngLat[] } {
  const pts = points.map((p) => [p[0], p[1]] as LngLat);
  if (kind === 'spline') {
    return { alignment: { kind: 'spline', controlPoints: pts }, coordinates: sampleSpline(pts, ring) };
  }
  if (kind === 'routed') {
    const legCount = Math.max(0, pts.length - 1 + (ring ? 1 : 0));
    const prev = previous?.alignment.kind === 'routed' ? previous.alignment : null;
    const legs: RouteLeg[] = [];
    for (let i = 0; i < legCount; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const j = prev ? findLeg(prev.waypoints, a, b) : -1;
      const old = j >= 0 ? prev!.legs[j] : undefined;
      // Legs whose two waypoints did not move keep their status and geometry.
      legs.push(old ?? unroutedLeg(a, b));
    }
    return {
      alignment: { kind: 'routed', waypoints: pts, legs, returnCoordinates: null },
      coordinates: ring ? legsGeometry(legs, pts).slice(0, -1) : legsGeometry(legs, pts),
    };
  }
  return { alignment: { kind: 'polyline' }, coordinates: pts };
}

function findLeg(waypoints: readonly LngLat[], a: LngLat, b: LngLat): number {
  const same = (p: LngLat, q: LngLat) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9;
  for (let i = 0; i < waypoints.length; i++) {
    const n = waypoints[(i + 1) % waypoints.length];
    if (n && same(waypoints[i]!, a) && same(n, b)) return i;
  }
  return -1;
}

/** Apply edited handle positions to a line, keeping its alignment kind. */
export function withEditedPoints<T extends TransportLine>(
  line: T,
  points: readonly LngLat[],
  ring: boolean,
): T {
  const { alignment, coordinates } = buildAlignment(line.alignment.kind, points, ring, line);
  return {
    ...line,
    alignment,
    coordinates,
    origin: line.origin.source === 'osm' ? { ...line.origin, edited: true } : line.origin,
  };
}

/** Unrouted legs make a street-routed line incomplete; manual legs are accepted sketches. */
export function routeStatus(line: Pick<TransportLine, 'alignment'>) {
  if (line.alignment.kind !== 'routed') return null;
  const legs = line.alignment.legs;
  return {
    total: legs.length,
    routed: legs.filter((l) => l.status === 'routed').length,
    manual: legs.filter((l) => l.status === 'manual').length,
    unrouted: legs.filter((l) => l.status === 'unrouted').length,
  };
}

export interface LegRouteResult {
  status: 'routed' | 'failed';
  coordinates: LngLat[];
  message: string;
}

/**
 * Apply street-routing results to a routed line. Legs the user marked manual
 * stay manual; failed legs stay unrouted with the router's message.
 */
export function applyRouteResults<T extends TransportLine>(
  line: T,
  results: readonly LegRouteResult[],
  provider: string,
  ring: boolean,
  at = new Date().toISOString(),
): T {
  if (line.alignment.kind !== 'routed') return line;
  const a = line.alignment;
  const legs: RouteLeg[] = a.legs.map((leg, i) => {
    const r = results[i];
    if (!r || leg.status === 'manual') return leg;
    const from = a.waypoints[i]!;
    const to = a.waypoints[(i + 1) % a.waypoints.length]!;
    if (r.status !== 'routed' || r.coordinates.length < 2)
      return unroutedLeg(from, to, r.message || 'No route found');
    // Start and end exactly at the waypoints so legs join without gaps.
    const geometry = [from, ...r.coordinates.slice(1, -1), to];
    return { status: 'routed', provider, routedAt: at, message: '', geometry };
  });
  const coords = legsGeometry(legs, a.waypoints);
  return {
    ...line,
    alignment: { ...a, legs },
    coordinates: ring ? coords.slice(0, -1) : coords,
  };
}

/** Mark one leg as an accepted manual sketch (or back to unrouted). */
export function setLegManual<T extends TransportLine>(
  line: T,
  index: number,
  manual: boolean,
  ring: boolean,
): T {
  if (line.alignment.kind !== 'routed') return line;
  const a = line.alignment;
  const from = a.waypoints[index]!;
  const to = a.waypoints[(index + 1) % a.waypoints.length]!;
  const legs = a.legs.map((leg, i) =>
    i !== index
      ? leg
      : manual
        ? { status: 'manual' as const, provider: null, routedAt: null, message: '', geometry: [from, to] }
        : unroutedLeg(from, to),
  );
  const coords = legsGeometry(legs, a.waypoints);
  return { ...line, alignment: { ...a, legs }, coordinates: ring ? coords.slice(0, -1) : coords };
}

/** Return trips that leave the outbound streets by more than this are drawn as their own path. */
export const RETURN_PATH_TOLERANCE_M = 25;

/**
 * Store the return direction's route when one-way streets make it differ from
 * the outbound route; otherwise the return uses the same streets (null).
 * `results` are legs routed through the waypoints in reverse order.
 */
export function applyReturnRoute<T extends TransportLine>(line: T, results: readonly LegRouteResult[]): T {
  if (line.alignment.kind !== 'routed') return line;
  const ok = results.length > 0 && results.every((r) => r.status === 'routed' && r.coordinates.length >= 2);
  let returnCoordinates: LngLat[] | null = null;
  if (ok) {
    const path: LngLat[] = [];
    for (const r of results) path.push(...(path.length ? r.coordinates.slice(1) : r.coordinates));
    const differs = path.some(
      (p) => (snapToPath(line.coordinates, false, p)?.offsetM ?? 0) > RETURN_PATH_TOLERANCE_M,
    );
    returnCoordinates = differs ? path : null;
  }
  return { ...line, alignment: { ...line.alignment, returnCoordinates } };
}
