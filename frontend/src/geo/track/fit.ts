/**
 * Approximate an existing curve (e.g. a sampled spline from schema v2) by a PI
 * alignment of straight tangents and circular arcs. Used by project migration;
 * the result is marked "needs review" because a spline has no designed radii.
 *
 * Method: simplify the sampled curve to its turning points (Douglas–Peucker in
 * metres), then, at each interior PI, use the median of the sampled radii between
 * its neighbouring PIs as the arc radius (bounded to what fits on the legs).
 */
import type { Vec } from './projection';
import { cross, dist, sub } from './primitives';
import { buildPrimitives, type AlignmentWarning, type PiAlignment } from './alignment';

function douglasPeucker(points: readonly Vec[], tol: number): number[] {
  const keep = new Set([0, points.length - 1]);
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const a = points[i]!;
    const b = points[j]!;
    const ab = sub(b, a);
    const len = Math.hypot(ab[0], ab[1]);
    let best = -1;
    let idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = len < 1e-9 ? dist(points[k]!, a) : Math.abs(cross(ab, sub(points[k]!, a))) / len;
      if (d > best) {
        best = d;
        idx = k;
      }
    }
    if (idx >= 0 && best > tol) {
      keep.add(idx);
      stack.push([i, idx], [idx, j]);
    }
  }
  return [...keep].sort((x, y) => x - y);
}

function circumradius(a: Vec, b: Vec, c: Vec): number {
  const ab = dist(a, b);
  const bc = dist(b, c);
  const ca = dist(c, a);
  const area2 = Math.abs(cross(sub(b, a), sub(c, a)));
  return area2 < 1e-9 ? Infinity : (ab * bc * ca) / (2 * area2);
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : Infinity;
};

export interface FitResult {
  alignment: PiAlignment;
  warnings: AlignmentWarning[];
  /** Largest distance between the input points and the fitted lines and arcs, metres. */
  maxDeviationM: number;
}

/** Point-wise radius (circle through the points `stride` samples before and after). */
function localRadii(points: readonly Vec[], stride: number): number[] {
  return points.map((p, m) => {
    const a = points[m - stride];
    const c = points[m + stride];
    return a && c ? circumradius(a, p, c) : Infinity;
  });
}

function intersectLines(p: Vec, d: Vec, q: Vec, e: Vec): Vec | null {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(q, p), e) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

/**
 * Straight runs are found by curvature; consecutive straights are intersected to
 * get the true PI, and the curve samples between them give the radius. Where no
 * straight separates two curves, a Douglas–Peucker vertex is used instead.
 */
export function fitPiAlignment(points: readonly Vec[], toleranceM = 2, straightRadiusM = 3000): FitResult {
  if (points.length < 2) throw new RangeError('At least two points are needed');
  const radii = localRadii(points, 2);
  const straight = radii.map((r) => r >= straightRadiusM);
  // Runs of consecutive straight samples (at least 3 points).
  const runs: { from: number; to: number }[] = [];
  for (let m = 0; m < points.length;) {
    if (!straight[m] && m !== 0 && m !== points.length - 1) {
      m++;
      continue;
    }
    let k = m;
    while (k + 1 < points.length && (straight[k + 1] || k + 1 === points.length - 1)) k++;
    if (k - m >= 2) runs.push({ from: m, to: k });
    m = k + 1;
  }
  const pis: Vec[] = [points[0]!];
  const piRadii: (number | null)[] = [null];
  for (let r = 0; r + 1 < runs.length; r++) {
    const a = runs[r]!;
    const b = runs[r + 1]!;
    const da = sub(points[a.to]!, points[a.from]!);
    const db = sub(points[b.to]!, points[b.from]!);
    const pi = intersectLines(points[a.to]!, da, points[b.from]!, db);
    const curve = radii.slice(a.to + 1, b.from).filter((x) => Number.isFinite(x) && x < straightRadiusM);
    if (pi && curve.length) {
      pis.push(pi);
      piRadii.push(Math.round(median(curve)));
    } else {
      // No clear tangent intersection (e.g. reverse curves): fall back to turning points.
      for (const k of douglasPeucker(points.slice(a.to, b.from + 1), toleranceM).slice(1, -1)) {
        pis.push(points[a.to + k]!);
        piRadii.push(null);
      }
    }
  }
  if (runs.length < 2) {
    // A single curve or a line: turning points only.
    const idx = douglasPeucker(points, toleranceM);
    for (const k of idx.slice(1, -1)) {
      pis.push(points[k]!);
      const r = radii[k]!;
      piRadii.push(Number.isFinite(r) ? Math.round(r) : null);
    }
  }
  pis.push(points[points.length - 1]!);
  piRadii.push(null);
  const alignment: PiAlignment = { points: pis, radii: piRadii };
  const built = buildPrimitives(alignment);
  let maxDeviationM = 0;
  for (const p of points) {
    let best = Infinity;
    for (const prim of built.primitives) {
      const d = prim.kind === 'line' ? segDist(p, prim.start, prim.end) : arcDist(p, prim);
      best = Math.min(best, d);
    }
    maxDeviationM = Math.max(maxDeviationM, best);
  }
  return { alignment, warnings: built.warnings, maxDeviationM };
}

function arcDist(p: Vec, a: { start: Vec; end: Vec; center: Vec; radius: number }): number {
  // Distance to the circle, or to the nearer end when outside the arc's span is not needed for a bound.
  return Math.min(Math.abs(dist(p, a.center) - a.radius), dist(p, a.start), dist(p, a.end));
}

function segDist(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const len2 = ab[0] * ab[0] + ab[1] * ab[1];
  const t =
    len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / len2));
  return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]);
}
