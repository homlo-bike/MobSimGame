/**
 * Drawing guides for track, in the project metric frame (metres). Pure.
 *
 * Guides are rays from the last placed point:
 * - relative to the previous leg (or, for the first leg, to the track end it starts from):
 *   straight on, and every 45° from it;
 * - parallel and perpendicular to straight track near the cursor.
 * There are no global (north-based) references.
 */
import type { Vec } from './projection';

export interface Guide {
  /** The point the guide starts from (the last placed point). */
  origin: Vec;
  /** Direction of the guide, radians (atan2 convention of the metric frame). */
  heading: number;
  /** What the guide is, for display: "straight on", "90° to the previous leg", "parallel to track". */
  label: string;
}

export interface StraightRef {
  start: Vec;
  end: Vec;
}

export interface GuideInput {
  /** The last placed point; no guides without it. */
  last: Vec | null;
  /** The point before it, if any. */
  prev: Vec | null;
  /** Heading to continue when the drawing started at a track end and has one point only. */
  startHeading: number | null;
  /** Straight pieces of existing track near the cursor. */
  straights: readonly StraightRef[];
}

const RELATIVE: readonly [number, string][] = [
  [0, 'straight on'],
  [45, '45° to the previous leg'],
  [90, '90° to the previous leg'],
  [135, '135° to the previous leg'],
];

const headingOf = (a: Vec, b: Vec) => Math.atan2(b[1] - a[1], b[0] - a[0]);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Guides (rays from the last point) for the next point. */
export function drawingGuides(input: GuideInput): Guide[] {
  const { last } = input;
  if (!last) return [];
  const out: Guide[] = [];
  const ref = input.prev ? headingOf(input.prev, last) : input.startHeading;
  if (ref !== null)
    for (const [deg, label] of RELATIVE) {
      out.push({ origin: last, heading: ref + (deg * Math.PI) / 180, label });
      if (deg !== 0) out.push({ origin: last, heading: ref - (deg * Math.PI) / 180, label });
    }
  for (const s of input.straights) {
    const h = headingOf(s.start, s.end);
    for (const k of [0, 1, 2, 3])
      out.push({
        origin: last,
        heading: h + (k * Math.PI) / 2,
        label: k % 2 ? 'perpendicular to track' : 'parallel to track',
      });
  }
  return dedupe(out);
}

/** Drop guides that are the same ray (same origin, heading within 0.05°). */
function dedupe(guides: Guide[]): Guide[] {
  const out: Guide[] = [];
  const tol = (0.05 * Math.PI) / 180;
  for (const g of guides) {
    const same = out.some(
      (o) =>
        Math.abs(wrap(o.heading - g.heading)) < tol &&
        o.origin[0] === g.origin[0] &&
        o.origin[1] === g.origin[1],
    );
    if (!same) out.push(g);
  }
  return out;
}

export interface GuideSnap {
  point: Vec;
  guide: Guide;
  distanceM: number;
}

/** Foot of the perpendicular from `p` onto the guide, its distance along it, and the offset. */
function project(p: Vec, g: Guide): { point: Vec; along: number; off: number } {
  const ux = Math.cos(g.heading);
  const uy = Math.sin(g.heading);
  const dx = p[0] - g.origin[0];
  const dy = p[1] - g.origin[1];
  const along = dx * ux + dy * uy;
  return {
    point: [g.origin[0] + along * ux, g.origin[1] + along * uy],
    along,
    off: Math.abs(-dx * uy + dy * ux),
  };
}

/**
 * Snap the cursor to the nearest guide within `toleranceM`. Guides are rays: only the part
 * ahead of the last point counts. Null when no guide is close.
 */
export function snapToGuides(cursor: Vec, guides: readonly Guide[], toleranceM: number): GuideSnap | null {
  let best: GuideSnap | null = null;
  for (const g of guides) {
    const p = project(cursor, g);
    if (p.along <= 0 || p.off > toleranceM) continue;
    if (!best || p.off < best.distanceM) best = { point: p.point, guide: g, distanceM: p.off };
  }
  return best;
}

/** Straight pieces of track within `maxDistanceM` of a point. */
export function straightsNear(
  straights: readonly StraightRef[],
  p: Vec,
  maxDistanceM: number,
): StraightRef[] {
  return straights.filter((s) => {
    const dx = s.end[0] - s.start[0];
    const dy = s.end[1] - s.start[1];
    const len2 = dx * dx + dy * dy;
    const t =
      len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - s.start[0]) * dx + (p[1] - s.start[1]) * dy) / len2)) : 0;
    return Math.hypot(s.start[0] + t * dx - p[0], s.start[1] + t * dy - p[1]) <= maxDistanceM;
  });
}
