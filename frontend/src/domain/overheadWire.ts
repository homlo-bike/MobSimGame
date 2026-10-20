/**
 * Trolleybus overhead wire. Pure.
 *
 * The wire is not drawn separately (owner decision): it exists wherever a trolleybus
 * line runs, and is shared where several trolleybus lines use the same street. Where
 * a trolleybus line crosses rail track on the same level whose electrification is an
 * overhead line, the two overhead systems meet, which needs special design (wire
 * crossings, insulation, different voltages): that is reported as a warning.
 */
import type { LngLat, PhysicalTrack, Scenario, TransportLine } from './schema';
import { isRing, lineLengthM } from './network';
import { findConflicts } from '../simulation/conflicts';
import { isRailMode, levelOfStructure, trackGeometry } from './tracks';
import { pathCoordinates, pathLengthM, toLocalMetres } from '../geo/geometry';

/** The lines whose route has overhead wire. */
export function wiredLines(scenario: Pick<Scenario, 'lines'>): TransportLine[] {
  return scenario.lines.filter((l) => l.mode === 'trolleybus' && l.coordinates.length >= 2);
}

/** Paths of the overhead wire: every trolleybus route, and its separate return path. */
export function wirePaths(scenario: Pick<Scenario, 'lines'>): { lineId: string; coordinates: LngLat[] }[] {
  const out: { lineId: string; coordinates: LngLat[] }[] = [];
  for (const l of wiredLines(scenario)) {
    out.push({ lineId: l.id, coordinates: pathCoordinates(l.coordinates, isRing(l)) });
    if (l.alignment.kind === 'routed' && l.alignment.returnCoordinates?.length)
      out.push({ lineId: l.id, coordinates: l.alignment.returnCoordinates });
  }
  return out;
}

export interface WireRailCrossing {
  lineId: string;
  trackId: string;
  position: LngLat;
  /** True when the track has an overhead line; false when its electrification is not specified. */
  overhead: boolean;
}

type Pt = [number, number];

/**
 * Same-level crossings of a trolleybus line with rail track that has, or may have, an
 * overhead line. Tracks without electrification or with third rail are left out.
 */
export function wireRailCrossings(scenario: Scenario, line: TransportLine): WireRailCrossing[] {
  if (line.mode !== 'trolleybus' || line.coordinates.length < 2) return [];
  const tracks = scenario.trackNetwork.tracks.filter(
    (t) => isRailMode(t.designMode) && (t.electrification === 'overhead' || t.electrification === 'unknown'),
  );
  if (!tracks.length) return [];
  const ref = line.coordinates[0]!;
  const coords = pathCoordinates(line.coordinates, isRing(line));
  const pts = coords.map((c) => toLocalMetres(c, ref));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + dist(pts[i - 1]!, pts[i]!));
  const total = cum[cum.length - 1] || 1;
  const lineBox = box(pts);
  const out: WireRailCrossing[] = [];
  for (const track of tracks) {
    const tc = trackGeometry(scenario.trackNetwork, track).coordinates;
    const tp = tc.map((c) => toLocalMetres(c, ref));
    if (!overlaps(lineBox, box(tp))) continue;
    for (let i = 1; i < pts.length; i++)
      for (let j = 1; j < tp.length; j++) {
        const hit = intersect(pts[i - 1]!, pts[i]!, tp[j - 1]!, tp[j]!);
        if (!hit) continue;
        const at = (cum[i - 1]! + hit.t * dist(pts[i - 1]!, pts[i]!)) / total;
        if (levelAt(line, at) !== track.level) continue;
        const position = lerp(coords[i - 1]!, coords[i]!, hit.t);
        // One report per track and place (a crossing can fall on a shared vertex).
        if (out.some((o) => o.trackId === track.id && near(o.position, position, ref))) continue;
        out.push({ lineId: line.id, trackId: track.id, position, overhead: isOverhead(track) });
      }
  }
  return out;
}

function isOverhead(t: PhysicalTrack): boolean {
  return t.electrification === 'overhead';
}

function levelAt(line: TransportLine, fraction: number): number {
  const seg = line.segments.find((s) => fraction >= s.fromFraction - 1e-9 && fraction <= s.toFraction + 1e-9);
  return seg ? levelOfStructure(seg.structure) : 0;
}

function intersect(p: Pt, p2: Pt, q: Pt, q2: Pt): { t: number } | null {
  const r: Pt = [p2[0] - p[0], p2[1] - p[1]];
  const s: Pt = [q2[0] - q[0], q2[1] - q[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den;
  const u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t } : null;
}

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const lerp = (a: LngLat, b: LngLat, t: number): LngLat => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
const near = (a: LngLat, b: LngLat, ref: LngLat) => dist(toLocalMetres(a, ref), toLocalMetres(b, ref)) < 1;

function box(pts: readonly Pt[]): [number, number, number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

function overlaps(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

export interface WireSummary {
  /** Wire route length (outbound route plus a separate return path), metres. */
  lengthM: number;
  /** Other trolleybus lines using the same wire, with the shared length along this line. */
  sharedWith: { lineId: string; lengthM: number }[];
  railCrossings: WireRailCrossing[];
}

export function wireSummary(scenario: Scenario, line: TransportLine): WireSummary | null {
  if (line.mode !== 'trolleybus') return null;
  const own = wirePaths({ lines: [line] });
  const lengthM = own.reduce((s, w) => s + pathLengthM(w.coordinates), 0);
  const total = lineLengthM(line);
  const shared = new Map<string, number>();
  for (const sec of findConflicts(scenario).shared) {
    const i = sec.lineIds.indexOf(line.id);
    if (i < 0) continue;
    const other = scenario.lines.find((l) => l.id === sec.lineIds[1 - i]);
    if (other?.mode !== 'trolleybus') continue;
    const r = sec.ranges[i]!;
    shared.set(other.id, (shared.get(other.id) ?? 0) + (r.to - r.from) * total);
  }
  return {
    lengthM,
    sharedWith: [...shared].map(([lineId, m]) => ({ lineId, lengthM: m })),
    railCrossings: wireRailCrossings(scenario, line),
  };
}
