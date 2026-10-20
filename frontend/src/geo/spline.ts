/**
 * Smooth alignments for guided modes (tram, light rail, metro, rail).
 *
 * A centripetal Catmull–Rom spline passes through every control point the user
 * placed, never overshoots into loops or cusps (Yuksel, Schaefer & Keyser 2011,
 * "Parameterization and applications of Catmull–Rom curves", Computer-Aided
 * Design 43(7)) and needs no extra handles, so it can be edited with the same
 * vertex tools as a polyline. The curve is sampled into a dense polyline that is
 * stored as the line's `coordinates` and used for every measurement.
 *
 * This is sketch geometry: it has no designed transition curves (clothoids) or
 * cant, so radii measured on it are estimates.
 */
import type { LngLat } from '../domain/schema';
import { circumradiusM, distanceM } from './geometry';

/** Target distance between samples on the curve. */
export const SPLINE_SAMPLE_STEP_M = 10;
const MIN_SAMPLES_PER_SPAN = 2;
const MAX_SAMPLES_PER_SPAN = 200;

type XY = [number, number];

const R = 6371008.8;

/** Local equirectangular frame around `ref` (adequate at city scale). */
function projector(ref: LngLat) {
  const kx = (Math.PI * R * Math.cos((ref[1] * Math.PI) / 180)) / 180;
  const ky = (Math.PI * R) / 180;
  return {
    to: (p: LngLat): XY => [(p[0] - ref[0]) * kx, (p[1] - ref[1]) * ky],
    from: (p: XY): LngLat => [ref[0] + p[0] / kx, ref[1] + p[1] / ky],
  };
}

function dist(a: XY, b: XY) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** One centripetal Catmull–Rom span from p1 to p2 evaluated at u ∈ [0, 1]. */
function evalSpan(p0: XY, p1: XY, p2: XY, p3: XY, u: number): XY {
  const alpha = 0.5;
  const t0 = 0;
  const t1 = t0 + Math.max(dist(p0, p1) ** alpha, 1e-6);
  const t2 = t1 + Math.max(dist(p1, p2) ** alpha, 1e-6);
  const t3 = t2 + Math.max(dist(p2, p3) ** alpha, 1e-6);
  const t = t1 + (t2 - t1) * u;
  const lerp = (a: XY, b: XY, ta: number, tb: number): XY => {
    const w = (t - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/** Remove consecutive duplicate control points (they would create zero-length spans). */
function dedupe(points: readonly LngLat[]): LngLat[] {
  const out: LngLat[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || distanceM(last, p) > 0.01) out.push([p[0], p[1]]);
  }
  return out;
}

/**
 * Sample the smooth curve through `controlPoints`.
 * Open curves start and end exactly at the first and last control point; rings
 * close smoothly (the first coordinate is not repeated, like ring lines).
 */
export function sampleSpline(
  controlPoints: readonly LngLat[],
  ring: boolean,
  stepM = SPLINE_SAMPLE_STEP_M,
): LngLat[] {
  let pts = dedupe(controlPoints);
  if (ring && pts.length > 3 && distanceM(pts[0]!, pts[pts.length - 1]!) <= 0.01) pts = pts.slice(0, -1);
  if (pts.length < 3) return pts;
  const proj = projector(pts[0]!);
  const xy = pts.map(proj.to);
  const n = xy.length;
  const at = (i: number): XY => {
    if (ring) return xy[((i % n) + n) % n]!;
    // Phantom end points mirror the neighbour, so the line leaves each end along its first chord
    // (a straight approach stays straight).
    if (i < 0) {
      const [a, b] = [xy[0]!, xy[1]!];
      return [2 * a[0] - b[0], 2 * a[1] - b[1]];
    }
    if (i >= n) {
      const [a, b] = [xy[n - 1]!, xy[n - 2]!];
      return [2 * a[0] - b[0], 2 * a[1] - b[1]];
    }
    return xy[i]!;
  };
  const spans = ring ? n : n - 1;
  const out: XY[] = [];
  for (let i = 0; i < spans; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const samples = Math.min(
      MAX_SAMPLES_PER_SPAN,
      Math.max(MIN_SAMPLES_PER_SPAN, Math.ceil(dist(p1, p2) / stepM)),
    );
    for (let k = 0; k < samples; k++) out.push(evalSpan(p0, p1, p2, p3, k / samples));
  }
  if (!ring) out.push(xy[n - 1]!);
  return out.map((p) => {
    const ll = proj.from(p);
    return [round(ll[0]), round(ll[1])] as LngLat;
  });
}

/** 1e-7 degrees ≈ 1 cm: keeps stored projects compact without visible loss. */
const round = (v: number) => Math.round(v * 1e7) / 1e7;

export interface CurvatureSample {
  /** Index into the sampled coordinates. */
  index: number;
  chainageM: number;
  radiusM: number;
  position: LngLat;
}

/**
 * Radius at every interior sample of a densely sampled curve (circle through the
 * sample and its neighbours). Infinity on straight track.
 */
export function sampledCurvature(coords: readonly LngLat[], ring: boolean): CurvatureSample[] {
  const n = coords.length;
  const out: CurvatureSample[] = [];
  if (n < 3) return out;
  // Neighbours two samples away (≈20 m chords) damp the centimetre rounding noise.
  const k = n >= 5 ? 2 : 1;
  const chain = [0];
  for (let i = 1; i < n; i++) chain.push(chain[i - 1]! + distanceM(coords[i - 1]!, coords[i]!));
  const indices = ring ? [...Array(n).keys()] : [...Array(n - 2 * k).keys()].map((i) => i + k);
  for (const i of indices) {
    out.push({
      index: i,
      chainageM: chain[i]!,
      radiusM: circumradiusM(coords[(i - k + n) % n]!, coords[i]!, coords[(i + k) % n]!),
      position: coords[i]!,
    });
  }
  return out;
}

export interface TightCurve {
  /** Smallest radius within the curve. */
  minRadiusM: number;
  position: LngLat;
  fromChainageM: number;
  toChainageM: number;
}

/**
 * Group consecutive samples below `thresholdM` into curves, so one tight bend
 * produces one finding instead of one per sample.
 */
export function curvesBelow(samples: readonly CurvatureSample[], thresholdM: number): TightCurve[] {
  const out: TightCurve[] = [];
  let cur: TightCurve | null = null;
  for (const s of samples) {
    if (s.radiusM < thresholdM) {
      if (!cur) {
        cur = {
          minRadiusM: s.radiusM,
          position: s.position,
          fromChainageM: s.chainageM,
          toChainageM: s.chainageM,
        };
      } else {
        cur.toChainageM = s.chainageM;
        if (s.radiusM < cur.minRadiusM) {
          cur.minRadiusM = s.radiusM;
          cur.position = s.position;
        }
      }
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}
