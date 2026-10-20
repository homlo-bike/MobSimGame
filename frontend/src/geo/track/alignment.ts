/**
 * Editable horizontal alignment: points of intersection (PI) with a radius at
 * each interior PI, the usual way railway alignments are laid out.
 *
 * Straight tangents join the PIs; at an interior PI with a radius, a circular
 * arc is fitted tangent to both legs, so every line meets its arcs with position
 * and tangent continuity by construction. The PI polygon and radii are the
 * stored, editable source; `buildPrimitives` derives the exact lines and arcs.
 *
 * When a radius is too large for the leg lengths (the arc would overrun the next
 * tangent), it is reduced to the largest radius that fits and a warning names the
 * vertex; the stored radius is never changed silently.
 */
import { z } from 'zod';
import type { Vec } from './projection';
import {
  add,
  arcCenter,
  cross,
  dist,
  dot,
  EPS,
  headingOf,
  leftNormal,
  line,
  scale,
  sub,
  unit,
  type ArcPrimitive,
  type Primitive,
} from './primitives';

export interface PiAlignment {
  /** PI positions in the project metric frame, metres. At least two. */
  points: Vec[];
  /** Radius at each point; null or 0 = sharp vertex (no arc). Ends are ignored. */
  radii: (number | null)[];
}

export type AlignmentWarning =
  | { kind: 'radius_reduced'; vertex: number; requestedM: number; usedM: number }
  | { kind: 'reversal'; vertex: number }
  | { kind: 'too_short'; vertex: number };

export interface BuiltAlignment {
  primitives: Primitive[];
  warnings: AlignmentWarning[];
  /** Radius actually used at each vertex (null where there is no arc). */
  usedRadii: (number | null)[];
}

const VecSchema = z.tuple([z.number().finite(), z.number().finite()]);
export const PiAlignmentSchema = z
  .object({
    points: z.array(VecSchema).min(2),
    radii: z.array(z.number().positive().finite().nullable()),
  })
  .refine((a) => a.radii.length === a.points.length, 'radii must have one entry per point');

/** Deflection angle at vertex i (0 = straight on, π = reversal). */
function deflection(points: readonly Vec[], i: number): { delta: number; turn: 1 | -1; u1: Vec; u2: Vec } {
  const u1 = unit(sub(points[i]!, points[i - 1]!));
  const u2 = unit(sub(points[i + 1]!, points[i]!));
  const c = cross(u1, u2);
  const delta = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))));
  return { delta, turn: c >= 0 ? 1 : -1, u1, u2 };
}

export function buildPrimitives(a: PiAlignment): BuiltAlignment {
  const pts = a.points;
  const n = pts.length;
  const warnings: AlignmentWarning[] = [];
  if (n < 2) return { primitives: [], warnings: [{ kind: 'too_short', vertex: 0 }], usedRadii: [] };
  const used: (number | null)[] = pts.map(() => null);
  const tangentLen: number[] = pts.map(() => 0);
  const geo = pts.map((_, i) => (i > 0 && i < n - 1 ? deflection(pts, i) : null));
  // Requested tangent lengths T = R tan(Δ/2).
  for (let i = 1; i < n - 1; i++) {
    const r = a.radii[i];
    const g = geo[i]!;
    if (!r || g.delta < 1e-9) continue;
    if (Math.PI - g.delta < 1e-6) {
      warnings.push({ kind: 'reversal', vertex: i });
      continue;
    }
    used[i] = r;
    tangentLen[i] = r * Math.tan(g.delta / 2);
  }
  // Fit: on every leg, the tangent lengths from both ends must not overlap.
  for (let i = 1; i < n - 1; i++) {
    if (used[i] === null) continue;
    const g = geo[i]!;
    const inLeg = dist(pts[i - 1]!, pts[i]!);
    const outLeg = dist(pts[i]!, pts[i + 1]!);
    const shareIn = tangentLen[i]! / (tangentLen[i]! + (tangentLen[i - 1] ?? 0) || 1);
    const shareOut = tangentLen[i]! / (tangentLen[i]! + (tangentLen[i + 1] ?? 0) || 1);
    const maxT = Math.min(inLeg * shareIn, outLeg * shareOut);
    if (tangentLen[i]! > maxT + 1e-9) {
      const usedR = maxT / Math.tan(g.delta / 2);
      warnings.push({ kind: 'radius_reduced', vertex: i, requestedM: used[i]!, usedM: usedR });
      used[i] = usedR;
      tangentLen[i] = maxT;
    }
  }
  const primitives: Primitive[] = [];
  let cursor: Vec = pts[0]!;
  for (let i = 1; i < n; i++) {
    const r = used[i];
    if (i === n - 1 || !r) {
      if (dist(cursor, pts[i]!) > EPS) primitives.push(line(cursor, pts[i]!));
      cursor = pts[i]!;
      continue;
    }
    const g = geo[i]!;
    const t = tangentLen[i]!;
    const t1 = add(pts[i]!, scale(g.u1, -t));
    const t2 = add(pts[i]!, scale(g.u2, t));
    if (dist(cursor, t1) > EPS) primitives.push(line(cursor, t1));
    const direction = g.turn > 0 ? 'left' : 'right';
    const arc: ArcPrimitive = {
      kind: 'arc',
      start: t1,
      end: t2,
      radius: r,
      direction,
      center: arcCenter(t1, headingOf(g.u1), r, direction),
    };
    primitives.push(arc);
    cursor = t2;
  }
  return { primitives, warnings, usedRadii: used };
}

/** Move one PI; connected geometry follows because the primitives are rebuilt from the PIs. */
export function moveVertex(a: PiAlignment, index: number, to: Vec): PiAlignment {
  return { points: a.points.map((p, i) => (i === index ? [to[0], to[1]] : p)), radii: [...a.radii] };
}

export function setRadius(a: PiAlignment, index: number, radius: number | null): PiAlignment {
  return { points: a.points, radii: a.radii.map((r, i) => (i === index ? radius : r)) };
}

/** Insert a PI after `index` (to add a curve), with an optional radius. */
export function insertVertex(
  a: PiAlignment,
  index: number,
  at: Vec,
  radius: number | null = null,
): PiAlignment {
  return {
    points: [...a.points.slice(0, index + 1), at, ...a.points.slice(index + 1)],
    radii: [...a.radii.slice(0, index + 1), radius, ...a.radii.slice(index + 1)],
  };
}

export function removeVertex(a: PiAlignment, index: number): PiAlignment {
  if (a.points.length <= 2) return a;
  return { points: a.points.filter((_, i) => i !== index), radii: a.radii.filter((_, i) => i !== index) };
}

/** Reverse the direction of the alignment (radii stay with their PIs). */
export function reverse(a: PiAlignment): PiAlignment {
  return { points: [...a.points].reverse(), radii: [...a.radii].reverse() };
}

/** Intersection of two lines given by point + direction; null when parallel. */
function intersect(p: Vec, d: Vec, q: Vec, e: Vec): Vec | null {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(q, p), e) / den;
  return add(p, scale(d, t));
}

export interface ParallelResult {
  alignment: PiAlignment;
  /** Vertices whose offset radius would be ≤ 0 (the arc collapses on the inside). */
  collapsed: number[];
}

/**
 * The parallel alignment `d` metres to the left of travel (negative = right):
 * legs are offset exactly and arcs become concentric (radius − d on left turns,
 * radius + d on right turns).
 */
export function parallel(a: PiAlignment, d: number): ParallelResult {
  const pts = a.points;
  const n = pts.length;
  const legs = pts.slice(0, -1).map((p, i) => {
    const u = unit(sub(pts[i + 1]!, p));
    return { p: add(p, scale(leftNormal(u), d)), u };
  });
  const points: Vec[] = [];
  const radii: (number | null)[] = [];
  const collapsed: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) points.push(legs[0]!.p);
    else if (i === n - 1) {
      const last = legs[n - 2]!;
      points.push(add(pts[n - 1]!, scale(leftNormal(last.u), d)));
    } else {
      const v = intersect(legs[i - 1]!.p, legs[i - 1]!.u, legs[i]!.p, legs[i]!.u);
      points.push(v ?? add(pts[i]!, scale(leftNormal(legs[i]!.u), d)));
    }
    const r = a.radii[i];
    if (!r || i === 0 || i === n - 1) {
      radii.push(r ?? null);
      continue;
    }
    const turn = cross(legs[i - 1]!.u, legs[i]!.u) >= 0 ? 1 : -1;
    const nr = r - turn * d;
    if (nr <= EPS) {
      collapsed.push(i);
      radii.push(null);
    } else radii.push(nr);
  }
  return { alignment: { points, radii }, collapsed };
}

/** Radii of the inner and outer track of a double-track curve with centre-line radius R. */
export function innerOuterRadii(radiusM: number, spacingM: number): { inner: number; outer: number } {
  return { inner: radiusM - spacingM / 2, outer: radiusM + spacingM / 2 };
}

export function serializeAlignment(a: PiAlignment): string {
  return JSON.stringify({ points: a.points, radii: a.radii });
}

export function deserializeAlignment(text: string): PiAlignment {
  return PiAlignmentSchema.parse(JSON.parse(text)) as PiAlignment;
}
