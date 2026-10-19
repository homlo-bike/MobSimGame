/**
 * Operations on a line's track segments. Invariant: segments are sorted, contiguous
 * and cover [0, 1] exactly. Every function returns a new array.
 */
import type { TrackSegment } from '../domain/schema';
import { newId } from '../util/id';

const EPS = 1e-9;

export type SegmentAttributes = Pick<
  TrackSegment,
  'structure' | 'rightOfWay' | 'tracks' | 'speedLimitKmh' | 'notes'
>;

export function initialSegments(attrs: SegmentAttributes): TrackSegment[] {
  return [{ id: newId('seg'), fromFraction: 0, toFraction: 1, ...attrs }];
}

/** Repair ordering, gaps and overlaps so the invariant holds. */
export function normalizeSegments(
  segments: readonly TrackSegment[],
  fallback: SegmentAttributes,
): TrackSegment[] {
  const sorted = [...segments]
    .filter((s) => s.toFraction - s.fromFraction > EPS)
    .sort((a, b) => a.fromFraction - b.fromFraction);
  if (sorted.length === 0) return initialSegments(fallback);
  const out: TrackSegment[] = [];
  let cursor = 0;
  for (const s of sorted) {
    const from = cursor;
    const to = Math.min(1, Math.max(s.toFraction, from));
    if (to - from <= EPS) continue;
    out.push({ ...s, fromFraction: from, toFraction: to });
    cursor = to;
  }
  if (out.length === 0) return initialSegments(fallback);
  out[out.length - 1] = { ...out[out.length - 1]!, toFraction: 1 };
  return out;
}

export function validateSegments(segments: readonly TrackSegment[]): string[] {
  const errors: string[] = [];
  if (segments.length === 0) return ['Line has no segments'];
  if (Math.abs(segments[0]!.fromFraction) > EPS) errors.push('First segment does not start at 0');
  if (Math.abs(segments[segments.length - 1]!.toFraction - 1) > EPS)
    errors.push('Last segment does not end at 1');
  for (let i = 1; i < segments.length; i++) {
    if (Math.abs(segments[i]!.fromFraction - segments[i - 1]!.toFraction) > EPS) {
      errors.push(`Gap or overlap between segments ${i} and ${i + 1}`);
    }
  }
  return errors;
}

/** Split the segment containing `fraction` into two (both inherit its attributes). */
export function splitSegmentsAt(segments: readonly TrackSegment[], fraction: number): TrackSegment[] {
  if (fraction <= EPS || fraction >= 1 - EPS) return [...segments];
  const out: TrackSegment[] = [];
  for (const s of segments) {
    if (fraction > s.fromFraction + EPS && fraction < s.toFraction - EPS) {
      out.push({ ...s, toFraction: fraction });
      out.push({ ...s, id: newId('seg'), fromFraction: fraction });
    } else {
      out.push(s);
    }
  }
  return out;
}

export function updateSegment(
  segments: readonly TrackSegment[],
  id: string,
  patch: Partial<SegmentAttributes>,
): TrackSegment[] {
  return segments.map((s) => (s.id === id ? { ...s, ...patch } : s));
}

/** Merge a segment with the following one; the earlier segment's attributes win. */
export function mergeWithNext(segments: readonly TrackSegment[], id: string): TrackSegment[] {
  const i = segments.findIndex((s) => s.id === id);
  if (i < 0 || i >= segments.length - 1) return [...segments];
  const merged = { ...segments[i]!, toFraction: segments[i + 1]!.toFraction };
  return [...segments.slice(0, i), merged, ...segments.slice(i + 2)];
}

/** Move the boundary between segment `id` and the next one. */
export function moveBoundary(
  segments: readonly TrackSegment[],
  id: string,
  toFraction: number,
): TrackSegment[] {
  const i = segments.findIndex((s) => s.id === id);
  if (i < 0 || i >= segments.length - 1) return [...segments];
  const lo = segments[i]!.fromFraction + 0.001;
  const hi = segments[i + 1]!.toFraction - 0.001;
  const f = Math.min(hi, Math.max(lo, toFraction));
  return segments.map((s, j) =>
    j === i ? { ...s, toFraction: f } : j === i + 1 ? { ...s, fromFraction: f } : s,
  );
}

/** Join two lines' segment lists into one, rescaling by their lengths. */
export function joinSegments(
  a: readonly TrackSegment[],
  aLengthM: number,
  b: readonly TrackSegment[],
  bLengthM: number,
): TrackSegment[] {
  const total = aLengthM + bLengthM;
  if (total <= 0) return [...a];
  const ka = aLengthM / total;
  return [
    ...a.map((s) => ({ ...s, fromFraction: s.fromFraction * ka, toFraction: s.toFraction * ka })),
    ...b.map((s) => ({
      ...s,
      id: newId('seg'),
      fromFraction: ka + s.fromFraction * (1 - ka),
      toFraction: ka + s.toFraction * (1 - ka),
    })),
  ];
}

/** Segments of a sub-range [from, to] rescaled to [0, 1] (used when splitting a line). */
export function sliceSegments(segments: readonly TrackSegment[], from: number, to: number): TrackSegment[] {
  const span = to - from;
  if (span <= EPS) return [];
  return segments
    .filter((s) => s.toFraction > from + EPS && s.fromFraction < to - EPS)
    .map((s) => ({
      ...s,
      id: newId('seg'),
      fromFraction: (Math.max(s.fromFraction, from) - from) / span,
      toFraction: (Math.min(s.toFraction, to) - from) / span,
    }));
}
