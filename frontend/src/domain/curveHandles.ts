/**
 * Curve handles for editing radii on the map (pure, project metric frame).
 *
 * Each interior point of a track (a PI) has a handle at the middle of its arc. The middle
 * of an arc of radius R with deflection Δ lies on the bisector of the corner, at
 * E = R (1 / cos(Δ/2) − 1) from the PI. Dragging the handle along the bisector therefore
 * sets R = E / (1 / cos(Δ/2) − 1): towards the corner is tighter, away is wider. A PI
 * without a curve has its handle at the corner itself.
 */
import type { LngLat, PhysicalTrack, TrackNetwork } from './schema';
import { networkFrame, trackGeometry } from './tracks';

export interface CurveHandle {
  /** Index into `track.points` / `track.radii`. */
  index: number;
  /** Curve number shown to the user (1-based), the same in the map label and the side panel. */
  number: number;
  position: LngLat;
  /** Radius entered for this point; null = sharp corner. */
  requestedM: number | null;
  /** Radius the geometry uses (smaller when the requested one does not fit). */
  usedM: number | null;
  /** Deflection angle at the point, radians. */
  deflection: number;
  /** Largest radius that fits between the neighbouring curves. */
  maxM: number;
}

const sub = (a: number[], b: number[]) => [a[0]! - b[0]!, a[1]! - b[1]!];
const len = (v: number[]) => Math.hypot(v[0]!, v[1]!);
const unit = (v: number[]) => {
  const l = len(v) || 1;
  return [v[0]! / l, v[1]! / l];
};

interface Corner {
  pi: number[];
  bisector: number[];
  delta: number;
  maxT: number;
}

function corner(net: TrackNetwork, track: PhysicalTrack, index: number): Corner | null {
  const g = trackGeometry(net, track);
  const pts = g.alignment.points;
  const i = index + 1;
  if (i <= 0 || i >= pts.length - 1) return null;
  const a = pts[i - 1]!;
  const p = pts[i]!;
  const b = pts[i + 1]!;
  const ua = unit(sub(a, p));
  const ub = unit(sub(b, p));
  const cos = Math.max(-1, Math.min(1, ua[0]! * ub[0]! + ua[1]! * ub[1]!));
  // Interior angle between the legs, and deflection Δ = π − interior.
  const delta = Math.PI - Math.acos(cos);
  if (delta < 1e-6 || Math.PI - delta < 1e-6) return null;
  // Room on each leg: what the neighbouring curves do not use.
  const used = g.built.usedRadii;
  const tanOf = (k: number) => {
    const r = used[k];
    if (!r || k <= 0 || k >= pts.length - 1) return 0;
    const u1 = unit(sub(pts[k - 1]!, pts[k]!));
    const u2 = unit(sub(pts[k + 1]!, pts[k]!));
    const d = Math.PI - Math.acos(Math.max(-1, Math.min(1, u1[0]! * u2[0]! + u1[1]! * u2[1]!)));
    return r * Math.tan(d / 2);
  };
  const maxT = Math.min(len(sub(a, p)) - tanOf(i - 1), len(sub(b, p)) - tanOf(i + 1));
  return { pi: p, bisector: unit([ua[0]! + ub[0]!, ua[1]! + ub[1]!]), delta, maxT: Math.max(0, maxT) };
}

export function curveHandles(net: TrackNetwork, track: PhysicalTrack): CurveHandle[] {
  const frame = networkFrame(net);
  const used = trackGeometry(net, track).built.usedRadii;
  const out: CurveHandle[] = [];
  track.points.forEach((_, index) => {
    const c = corner(net, track, index);
    if (!c) return;
    const r = used[index + 1] ?? null;
    const e = r ? r * (1 / Math.cos(c.delta / 2) - 1) : 0;
    out.push({
      index,
      number: index + 1,
      position: frame.toLngLat([c.pi[0]! + c.bisector[0]! * e, c.pi[1]! + c.bisector[1]! * e]),
      requestedM: track.radii[index] ?? null,
      usedM: r,
      deflection: c.delta,
      maxM: Math.floor(c.maxT / Math.tan(c.delta / 2)),
    });
  });
  return out;
}

/** Round a radius the way designers enter it: whole metres, 5 m steps above 100 m. */
export function roundRadius(r: number): number {
  return r >= 100 ? Math.round(r / 5) * 5 : Math.max(1, Math.round(r));
}

/** Radius for a handle dragged to `at` (projected onto the bisector), within what fits; null = no curve. */
export function radiusFromHandle(
  net: TrackNetwork,
  track: PhysicalTrack,
  index: number,
  at: LngLat,
): number | null {
  const c = corner(net, track, index);
  if (!c) return null;
  const q = networkFrame(net).toMetres(at);
  const e = (q[0] - c.pi[0]!) * c.bisector[0]! + (q[1] - c.pi[1]!) * c.bisector[1]!;
  if (e <= 0.5) return null;
  const r = e / (1 / Math.cos(c.delta / 2) - 1);
  const max = Math.floor(c.maxT / Math.tan(c.delta / 2));
  return roundRadius(Math.min(r, Math.max(1, max)));
}
