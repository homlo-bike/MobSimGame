/**
 * Track geometry primitives in a project metric frame (see projection.ts).
 *
 * An alignment is an ordered list of straight lines and circular arcs. Arcs are
 * real circles (centre, radius, turning direction), not splines; rendering may
 * densify them, but every length, radius and offset is computed from the
 * primitive itself. Transition curves (clothoids) are reserved for later.
 *
 * Conventions: x east, y north, metres. Headings are radians, counter-clockwise
 * from +x. A "left" arc turns counter-clockwise in the direction of travel.
 */
import type { Vec } from './projection';

export interface LinePrimitive {
  kind: 'line';
  start: Vec;
  end: Vec;
}

export interface ArcPrimitive {
  kind: 'arc';
  start: Vec;
  end: Vec;
  center: Vec;
  radius: number;
  direction: 'left' | 'right';
}

export type Primitive = LinePrimitive | ArcPrimitive;

export const EPS = 1e-9;

// --- Vector helpers -------------------------------------------------------------

export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
export const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k];
export const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Vec, b: Vec) => a[0] * b[1] - a[1] * b[0];
export const norm = (a: Vec) => Math.hypot(a[0], a[1]);
export const dist = (a: Vec, b: Vec) => norm(sub(a, b));
export const unit = (a: Vec): Vec => {
  const n = norm(a);
  return n < EPS ? [0, 0] : [a[0] / n, a[1] / n];
};
/** Left-hand normal of a direction. */
export const leftNormal = (d: Vec): Vec => [-d[1], d[0]];
export const fromHeading = (h: number): Vec => [Math.cos(h), Math.sin(h)];
export const headingOf = (d: Vec) => Math.atan2(d[1], d[0]);
/** Normalise an angle to (-π, π]. */
export const wrapAngle = (a: number) => {
  let x = a % (2 * Math.PI);
  if (x <= -Math.PI) x += 2 * Math.PI;
  if (x > Math.PI) x -= 2 * Math.PI;
  return x;
};

// --- Lines ------------------------------------------------------------------------

export function line(start: Vec, end: Vec): LinePrimitive {
  return { kind: 'line', start: [start[0], start[1]], end: [end[0], end[1]] };
}

export function lineLength(l: LinePrimitive): number {
  return dist(l.start, l.end);
}

// --- Arcs -------------------------------------------------------------------------

/** Signed sweep angle of an arc: positive for left (counter-clockwise) arcs. */
export function arcSweep(a: ArcPrimitive): number {
  const a0 = headingOf(sub(a.start, a.center));
  const a1 = headingOf(sub(a.end, a.center));
  let s = a1 - a0;
  if (a.direction === 'left') {
    while (s <= EPS) s += 2 * Math.PI;
  } else {
    while (s >= -EPS) s -= 2 * Math.PI;
  }
  return s;
}

export function arcLength(a: ArcPrimitive): number {
  return Math.abs(arcSweep(a)) * a.radius;
}

/** Centre of the circle of `radius` tangent to `heading` at `start`, turning to `direction`. */
export function arcCenter(start: Vec, heading: number, radius: number, direction: 'left' | 'right'): Vec {
  const n = leftNormal(fromHeading(heading));
  return add(start, scale(n, direction === 'left' ? radius : -radius));
}

/**
 * The arc that leaves `start` along `heading` and ends at `end` (tangent
 * continuation). Returns a line when `end` lies straight ahead.
 */
export function tangentArc(start: Vec, heading: number, end: Vec): Primitive {
  const chord = sub(end, start);
  const len = norm(chord);
  if (len < EPS) return line(start, end);
  const d = fromHeading(heading);
  const c = cross(d, chord);
  if (Math.abs(c) / len < 1e-9) return line(start, end);
  const sinTheta = c / len; // sine of the angle between heading and chord
  const radius = len / (2 * Math.abs(sinTheta));
  const direction = c > 0 ? 'left' : 'right';
  return { kind: 'arc', start, end, center: arcCenter(start, heading, radius, direction), radius, direction };
}

/** An arc with the given centre, radius, start angle and signed sweep. */
export function arcFromCenter(center: Vec, radius: number, startAngle: number, sweep: number): ArcPrimitive {
  return {
    kind: 'arc',
    center,
    radius,
    direction: sweep >= 0 ? 'left' : 'right',
    start: add(center, scale(fromHeading(startAngle), radius)),
    end: add(center, scale(fromHeading(startAngle + sweep), radius)),
  };
}

// --- Common operations --------------------------------------------------------------

export function length(p: Primitive): number {
  return p.kind === 'line' ? lineLength(p) : arcLength(p);
}

export function totalLength(ps: readonly Primitive[]): number {
  return ps.reduce((s, p) => s + length(p), 0);
}

/** Heading of travel at the start or end of a primitive. */
export function headingAt(p: Primitive, where: 'start' | 'end'): number {
  if (p.kind === 'line') return headingOf(sub(p.end, p.start));
  const pt = where === 'start' ? p.start : p.end;
  const radial = sub(pt, p.center);
  // Tangent is the radial direction turned by ±90° depending on the turning direction.
  return headingOf(p.direction === 'left' ? leftNormal(radial) : scale(leftNormal(radial), -1));
}

/** Point and heading at distance `s` from the start. */
export function pointAt(p: Primitive, s: number): { point: Vec; heading: number } {
  const len = length(p);
  const t = len < EPS ? 0 : Math.min(1, Math.max(0, s / len));
  if (p.kind === 'line') {
    return { point: add(p.start, scale(sub(p.end, p.start), t)), heading: headingAt(p, 'start') };
  }
  const a0 = headingOf(sub(p.start, p.center));
  const ang = a0 + arcSweep(p) * t;
  const point = add(p.center, scale(fromHeading(ang), p.radius));
  const radial = fromHeading(ang);
  const tangent = p.direction === 'left' ? leftNormal(radial) : scale(leftNormal(radial), -1);
  return { point, heading: headingOf(tangent) };
}

export interface NearestPoint {
  point: Vec;
  /** Distance along the primitive from its start. */
  along: number;
  /** Signed lateral offset: positive to the left of travel. */
  offset: number;
}

export function nearestOnLine(l: LinePrimitive, q: Vec): NearestPoint {
  const d = sub(l.end, l.start);
  const len2 = dot(d, d);
  const t = len2 < EPS ? 0 : Math.min(1, Math.max(0, dot(sub(q, l.start), d) / len2));
  const point = add(l.start, scale(d, t));
  const len = Math.sqrt(len2);
  const offset = len < EPS ? dist(q, l.start) : cross(d, sub(q, point)) / len;
  return { point, along: t * len, offset: Math.abs(offset) < EPS ? 0 : offset };
}

export function nearestOnArc(a: ArcPrimitive, q: Vec): NearestPoint {
  const sweep = arcSweep(a);
  const a0 = headingOf(sub(a.start, a.center));
  const aq = headingOf(sub(q, a.center));
  // Angle from the start in the arc's turning sense, in [0, 2π).
  let rel = (aq - a0) * Math.sign(sweep);
  rel = ((rel % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const span = Math.abs(sweep);
  let along: number;
  if (rel <= span) along = rel * a.radius;
  else {
    // Outside the arc: the nearer end point.
    along = dist(q, a.start) <= dist(q, a.end) ? 0 : span * a.radius;
  }
  const { point } = pointAt(a, along);
  const r = dist(q, a.center);
  // Left of travel is towards the centre on a left arc and away from it on a right arc.
  const towardCentre = a.radius - r;
  const offset =
    rel <= span ? (a.direction === 'left' ? towardCentre : -towardCentre) : signedEndOffset(a, along, q);
  return { point, along, offset };
}

function signedEndOffset(p: Primitive, along: number, q: Vec): number {
  const { point, heading } = pointAt(p, along);
  return cross(fromHeading(heading), sub(q, point));
}

export function nearest(p: Primitive, q: Vec): NearestPoint {
  return p.kind === 'line' ? nearestOnLine(p, q) : nearestOnArc(p, q);
}

/** Split a primitive at distance `s` from its start. */
export function split(p: Primitive, s: number): [Primitive, Primitive] {
  const len = length(p);
  const at = Math.min(len, Math.max(0, s));
  const { point } = pointAt(p, at);
  if (p.kind === 'line') return [line(p.start, point), line(point, p.end)];
  return [
    { ...p, start: p.start, end: point },
    { ...p, start: point, end: p.end },
  ];
}

/**
 * Join two consecutive primitives into one when they form a single line or a
 * single arc (same circle and turning direction); otherwise null.
 */
export function join(a: Primitive, b: Primitive, tolerance = 1e-6): Primitive | null {
  if (dist(a.end, b.start) > tolerance) return null;
  if (a.kind === 'line' && b.kind === 'line') {
    const da = unit(sub(a.end, a.start));
    const db = unit(sub(b.end, b.start));
    return Math.abs(cross(da, db)) < 1e-9 && dot(da, db) > 0 ? line(a.start, b.end) : null;
  }
  if (a.kind === 'arc' && b.kind === 'arc') {
    const same =
      dist(a.center, b.center) < tolerance &&
      Math.abs(a.radius - b.radius) < tolerance &&
      a.direction === b.direction;
    if (!same) return null;
    const joined: ArcPrimitive = { ...a, end: b.end };
    return Math.abs(arcLength(joined) - (arcLength(a) + arcLength(b))) < tolerance * 10 ? joined : null;
  }
  return null;
}

/** Angle between the end heading of `a` and the start heading of `b` (radians, ≥ 0). */
export function tangentDeviation(a: Primitive, b: Primitive): number {
  return Math.abs(wrapAngle(headingAt(b, 'start') - headingAt(a, 'end')));
}

export interface ContinuityReport {
  /** Index i: problem between primitive i and i + 1. */
  gaps: { index: number; distanceM: number }[];
  kinks: { index: number; angleDeg: number }[];
}

/** Position and tangent continuity of an alignment. */
export function continuity(
  ps: readonly Primitive[],
  positionTolM = 0.01,
  angleTolDeg = 0.1,
): ContinuityReport {
  const report: ContinuityReport = { gaps: [], kinks: [] };
  for (let i = 0; i + 1 < ps.length; i++) {
    const d = dist(ps[i]!.end, ps[i + 1]!.start);
    if (d > positionTolM) report.gaps.push({ index: i, distanceM: d });
    const ang = (tangentDeviation(ps[i]!, ps[i + 1]!) * 180) / Math.PI;
    if (ang > angleTolDeg) report.kinks.push({ index: i, angleDeg: ang });
  }
  return report;
}

/**
 * Offset a primitive to the left of travel by `d` metres (negative = right).
 * On an arc this changes the radius: a left arc's left side is the inside.
 * Returns null when the offset would collapse the arc (radius ≤ 0).
 */
export function offset(p: Primitive, d: number): Primitive | null {
  if (p.kind === 'line') {
    const n = scale(leftNormal(unit(sub(p.end, p.start))), d);
    return line(add(p.start, n), add(p.end, n));
  }
  const r = p.direction === 'left' ? p.radius - d : p.radius + d;
  if (r <= EPS) return null;
  const k = r / p.radius;
  return {
    ...p,
    radius: r,
    start: add(p.center, scale(sub(p.start, p.center), k)),
    end: add(p.center, scale(sub(p.end, p.center), k)),
  };
}

/** Densify for rendering: points every `stepM` metres along each arc (lines keep their ends). */
export function sample(ps: readonly Primitive[], stepM = 5): Vec[] {
  const out: Vec[] = [];
  for (const p of ps) {
    const len = length(p);
    const n = p.kind === 'line' ? 1 : Math.max(2, Math.ceil(len / stepM));
    for (let i = out.length ? 1 : 0; i <= n; i++) out.push(pointAt(p, (len * i) / n).point);
  }
  return out;
}

export interface RadiusViolation {
  index: number;
  radiusM: number;
  limitM: number;
}

/** Arcs tighter than `minRadiusM`. */
export function radiusViolations(ps: readonly Primitive[], minRadiusM: number): RadiusViolation[] {
  return ps.flatMap((p, index) =>
    p.kind === 'arc' && p.radius < minRadiusM ? [{ index, radiusM: p.radius, limitM: minRadiusM }] : [],
  );
}
