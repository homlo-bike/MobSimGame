/**
 * Clearance points of junctions (fouling points). Pure.
 *
 * Where tracks converge at a node, a train on one of them must stand far enough from the
 * node that a train on the other track can pass: up to the clearance marker, placed where
 * the track centres are a set distance apart (parameter `clearanceMarkerSpacingM`). This
 * module measures, along one track end, how far from the node that point lies, from the
 * drawn geometry in the project's metric frame.
 */
import type { TrackEndRef, TrackNetwork } from './schema';
import { nodeEnds, pointOnTrack, sameEnd, trackGeometry } from './tracks';

/** How far along the tracks the search looks (m). */
const SEARCH_M = 400;
const STEP_M = 1;

type Vec = [number, number];

/** Points of a track end, from the node outwards, every STEP_M up to the search distance. */
function samples(net: TrackNetwork, ref: TrackEndRef): Vec[] {
  const t = net.tracks.find((x) => x.id === ref.trackId);
  if (!t) return [];
  const len = trackGeometry(net, t).lengthM;
  if (len <= 0) return [];
  const out: Vec[] = [];
  const reach = Math.min(len, SEARCH_M);
  for (let s = 0; s <= reach + 1e-9; s += STEP_M) {
    const f = ref.end === 'start' ? s / len : 1 - s / len;
    out.push(pointOnTrack(net, t, f).metres as Vec);
  }
  return out;
}

function distToPolyline(p: Vec, line: readonly Vec[]): number {
  let d = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    d = Math.min(d, Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy));
  }
  return d;
}

/**
 * Distance (m) from the node along track end `ref` to its clearance point: the first point
 * from which the track is at least `spacingM` from every other track meeting at the node.
 * Capped at the search distance and at the track's length.
 */
export function clearanceDistanceM(
  net: TrackNetwork,
  nodeId: string,
  ref: TrackEndRef,
  spacingM: number,
): number {
  const key = `${nodeId}|${ref.trackId}|${ref.end}|${spacingM}`;
  let memo = cache.get(net);
  if (!memo) cache.set(net, (memo = new Map()));
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const d = search(net, nodeId, ref, spacingM);
  memo.set(key, d);
  return d;
}

/** Results per network object (a new object after every edit). */
const cache = new WeakMap<TrackNetwork, Map<string, number>>();

function search(net: TrackNetwork, nodeId: string, ref: TrackEndRef, spacingM: number): number {
  const own = samples(net, ref);
  if (own.length < 2) return 0;
  const others = nodeEnds(net, nodeId)
    .filter((e) => !sameEnd(e, ref))
    .map((e) => samples(net, e))
    .filter((x) => x.length >= 2);
  if (!others.length) return 0;
  for (let i = 0; i < own.length; i++) {
    const p = own[i]!;
    if (others.every((o) => distToPolyline(p, o) >= spacingM)) return i * STEP_M;
  }
  return (own.length - 1) * STEP_M;
}
