/**
 * Where vehicles of different lines can meet (owner rules, 2026-10-20). Pure.
 *
 * - **Crossings**: two lines' paths intersect on the same level without sharing
 *   track. Any modes, also two bus lines or two tram lines on unconnected track.
 *   Only one vehicle is inside a crossing at a time.
 * - **Shared street sections**: two street-routed lines (bus, BRT, trolleybus) on
 *   the same street. Vehicles in the same direction keep the following distance and
 *   wait where they merge; opposite directions use their own lanes.
 * Rail lines that merge onto the same track already share that track's resource
 * (simulation/occupancy.ts), so they are not repeated here.
 *
 * Priority: the mode order (`MODE_PRIORITY`, higher first); within one rank the
 * vehicle that reaches the conflict first goes first.
 */
import type { LngLat, Scenario, TransportLine, TransportMode } from '../domain/schema';
import { isRing } from '../domain/network';
import { levelOfStructure } from '../domain/tracks';
import { pathCoordinates } from '../geo/geometry';

export { MODE_PRIORITY } from '../domain/modeSeparation';

const ROAD: readonly TransportMode[] = ['bus', 'brt', 'trolleybus'];
const SIMULATED = (l: TransportLine) =>
  !['cycling', 'pedestrian'].includes(l.mode) && l.coordinates.length >= 2;

/** Rank of a mode: 0 = highest priority. */
export function modeRank(order: readonly TransportMode[], mode: TransportMode): number {
  const i = order.indexOf(mode);
  return i < 0 ? order.length : i;
}

export interface CrossingPoint {
  /** Stable for the same two lines and place. */
  id: string;
  position: LngLat;
  lineIds: [string, string];
  /** Where along each line's drawn geometry, as a fraction of its length. */
  fractions: [number, number];
}

export interface SharedSection {
  id: string;
  lineIds: [string, string];
  /** Ranges along each line, as fractions of its length (from < to). */
  ranges: [{ from: number; to: number }, { from: number; to: number }];
  /** True when both lines run the same way along it. */
  sameDirection: boolean;
}

interface Measured {
  line: TransportLine;
  pts: [number, number][];
  cum: number[];
  /** Segment indices (1-based: segment i runs from point i−1 to i) by grid cell, for fast lookups. */
  grid: Map<string, number[]>;
}

const CELL_M = 50;

function buildGrid(pts: [number, number][]): Map<string, number[]> {
  const grid = new Map<string, number[]>();
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const x0 = Math.floor(Math.min(a[0], b[0]) / CELL_M);
    const x1 = Math.floor(Math.max(a[0], b[0]) / CELL_M);
    const y0 = Math.floor(Math.min(a[1], b[1]) / CELL_M);
    const y1 = Math.floor(Math.max(a[1], b[1]) / CELL_M);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const k = `${x},${y}`;
        const list = grid.get(k);
        if (list) list.push(i);
        else grid.set(k, [i]);
      }
  }
  return grid;
}

/** Segment indices of `m` whose cells touch the box. */
function segmentsNear(m: Measured, x0: number, y0: number, x1: number, y1: number): Set<number> {
  const out = new Set<number>();
  for (let x = Math.floor(x0 / CELL_M); x <= Math.floor(x1 / CELL_M); x++)
    for (let y = Math.floor(y0 / CELL_M); y <= Math.floor(y1 / CELL_M); y++)
      for (const i of m.grid.get(`${x},${y}`) ?? []) out.add(i);
  return out;
}

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

function measure(line: TransportLine, origin: LngLat): Measured {
  const coords = pathCoordinates(line.coordinates, isRing(line));
  const k = Math.cos(rad(origin[1]));
  const pts = coords.map(
    (c) => [rad(c[0] - origin[0]) * R * k, rad(c[1] - origin[1]) * R] as [number, number],
  );
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  return { line, pts, cum, grid: buildGrid(pts) };
}

function toLngLat(p: [number, number], origin: LngLat): LngLat {
  const k = Math.cos(rad(origin[1]));
  return [origin[0] + (p[0] / (R * k)) * (180 / Math.PI), origin[1] + (p[1] / R) * (180 / Math.PI)];
}

/** Level (0 ground, −1 below, +1 above) of a line at a chainage, from its structure segments. */
function levelAt(m: Measured, chainageM: number): number {
  const total = m.cum[m.cum.length - 1] || 1;
  const f = chainageM / total;
  const seg = m.line.segments.find((s) => f >= s.fromFraction - 1e-9 && f <= s.toFraction + 1e-9);
  return seg ? levelOfStructure(seg.structure) : 0;
}

/** Nearest point of a polyline to `p`: distance and chainage. */
function nearest(m: Measured, p: [number, number], within: number): { d: number; at: number } {
  let best = { d: Infinity, at: 0 };
  for (const i of segmentsNear(m, p[0] - within, p[1] - within, p[0] + within, p[1] + within)) {
    const a = m.pts[i - 1]!;
    const b = m.pts[i]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
    const d = Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
    if (d < best.d) best = { d, at: m.cum[i - 1]! + t * Math.sqrt(len2) };
  }
  return best;
}

function sample(m: Measured, stepM: number): { at: number; p: [number, number] }[] {
  const out: { at: number; p: [number, number] }[] = [];
  const total = m.cum[m.cum.length - 1] ?? 0;
  let i = 1;
  for (let at = 0; at <= total; at += stepM) {
    while (i < m.cum.length - 1 && m.cum[i]! < at) i++;
    const a = m.pts[i - 1]!;
    const b = m.pts[i]!;
    const seg = m.cum[i]! - m.cum[i - 1]!;
    const t = seg > 0 ? (at - m.cum[i - 1]!) / seg : 0;
    out.push({ at, p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] });
  }
  return out;
}

/** Same street: closer than this (metres) for at least `SHARED_MIN_M`. */
const SHARED_TOLERANCE_M = 4;
const SHARED_MIN_M = 30;
const STEP_M = 5;

function overlaps(a: Measured, b: Measured): { aFrom: number; aTo: number; bAts: number[] }[] {
  const runs: { aFrom: number; aTo: number; bAts: number[] }[] = [];
  let cur: { aFrom: number; aTo: number; bAts: number[] } | null = null;
  for (const s of sample(a, STEP_M)) {
    const n = nearest(b, s.p, SHARED_TOLERANCE_M);
    if (n.d <= SHARED_TOLERANCE_M) {
      if (!cur) cur = { aFrom: s.at, aTo: s.at, bAts: [] };
      cur.aTo = s.at;
      cur.bAts.push(n.at);
    } else if (cur) {
      runs.push(cur);
      cur = null;
    }
  }
  if (cur) runs.push(cur);
  return runs.filter((r) => r.aTo - r.aFrom >= SHARED_MIN_M);
}

function segmentIntersections(a: Measured, b: Measured): { p: [number, number]; atA: number; atB: number }[] {
  const out: { p: [number, number]; atA: number; atB: number }[] = [];
  for (let i = 1; i < a.pts.length; i++) {
    const p = a.pts[i - 1]!;
    const r: [number, number] = [a.pts[i]![0] - p[0], a.pts[i]![1] - p[1]];
    const cand = segmentsNear(
      b,
      Math.min(p[0], a.pts[i]![0]),
      Math.min(p[1], a.pts[i]![1]),
      Math.max(p[0], a.pts[i]![0]),
      Math.max(p[1], a.pts[i]![1]),
    );
    for (const j of cand) {
      const q = b.pts[j - 1]!;
      const s: [number, number] = [b.pts[j]![0] - q[0], b.pts[j]![1] - q[1]];
      const den = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(den) < 1e-9) continue;
      const t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den;
      const u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      out.push({
        p: [p[0] + t * r[0], p[1] + t * r[1]],
        atA: a.cum[i - 1]! + t * Math.hypot(r[0], r[1]),
        atB: b.cum[j - 1]! + u * Math.hypot(s[0], s[1]),
      });
    }
  }
  return out;
}

/** Bounding boxes in metres, for skipping line pairs that cannot meet. */
function bbox(m: Measured): [number, number, number, number] {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of m.pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

export function findConflicts(scenario: Scenario): { crossings: CrossingPoint[]; shared: SharedSection[] } {
  const lines = scenario.lines.filter(SIMULATED);
  if (lines.length < 2) return { crossings: [], shared: [] };
  const origin = lines[0]!.coordinates[0]!;
  const ms = lines.map((l) => measure(l, origin));
  const boxes = ms.map(bbox);
  const crossings: CrossingPoint[] = [];
  const shared: SharedSection[] = [];
  for (let i = 0; i < ms.length; i++)
    for (let j = i + 1; j < ms.length; j++) {
      const a = ms[i]!;
      const b = ms[j]!;
      const ba = boxes[i]!;
      const bb = boxes[j]!;
      if (ba[0] > bb[2] + 10 || bb[0] > ba[2] + 10 || ba[1] > bb[3] + 10 || bb[1] > ba[3] + 10) continue;
      const bothRail = a.line.alignment.kind === 'track' && b.line.alignment.kind === 'track';
      const bothRoad = ROAD.includes(a.line.mode) && ROAD.includes(b.line.mode);
      // Where the two run together: shared street (road) or shared track (rail, handled by
      // the track resources). Crossings inside such a run are not crossings.
      const runs = bothRoad || bothRail ? overlaps(a, b) : [];
      const la = a.cum[a.cum.length - 1] || 1;
      const lb = b.cum[b.cum.length - 1] || 1;
      if (bothRoad)
        runs.forEach((run, k) => {
          const bFrom = Math.min(...run.bAts);
          const bTo = Math.max(...run.bAts);
          const first = run.bAts[0]!;
          const last = run.bAts[run.bAts.length - 1]!;
          shared.push({
            id: `s:${a.line.id}:${b.line.id}:${k}`,
            lineIds: [a.line.id, b.line.id],
            ranges: [
              { from: run.aFrom / la, to: run.aTo / la },
              { from: bFrom / lb, to: bTo / lb },
            ],
            sameDirection: last >= first,
          });
        });
      for (const x of segmentIntersections(a, b)) {
        if (runs.some((r) => x.atA >= r.aFrom - 2 * STEP_M && x.atA <= r.aTo + 2 * STEP_M)) continue;
        if (levelAt(a, x.atA) !== levelAt(b, x.atB)) continue;
        // A crossing at a shared vertex is found on both neighbouring segments: keep one.
        if (
          crossings.some(
            (c) =>
              c.lineIds[0] === a.line.id &&
              c.lineIds[1] === b.line.id &&
              Math.abs(c.fractions[0] * la - x.atA) < 3,
          )
        )
          continue;
        crossings.push({
          id: `x:${a.line.id}:${b.line.id}:${Math.round(x.atA)}`,
          position: toLngLat(x.p, origin),
          lineIds: [a.line.id, b.line.id],
          fractions: [x.atA / la, x.atB / lb],
        });
      }
    }
  return { crossings, shared };
}
