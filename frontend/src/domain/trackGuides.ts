/**
 * Drawing guides for the track being drawn, from the track network (pure). The geometry
 * lives in geo/track/guides.ts; this module finds the references: the last two placed
 * points, the track end the drawing starts from, and straight track near the cursor.
 */
import type { LngLat, TrackNetwork } from './schema';
import { drawingGuides, snapToGuides, straightsNear, type StraightRef } from '../geo/track/guides';
import { networkFrame, nodeEnds, outwardHeading, trackGeometry } from './tracks';
import { parameterValue } from './trackParameters';

/** Straight track within this distance of the cursor offers parallel guides (owner requirement). */
export const GUIDE_STRAIGHT_SEARCH_M = 100;

export interface TrackGuideSnap {
  /** Where the cursor snaps to. */
  position: LngLat;
  /** The guide from the last point through the snapped point and a little beyond, for display. */
  line: LngLat[];
  label: string;
}

/** Heading to continue when `p` is an open track end (one track ends there); null otherwise. */
function continuationAt(net: TrackNetwork, p: LngLat): number | null {
  const frame = networkFrame(net, p);
  const q = frame.toMetres(p);
  const snap = parameterValue(net, 'nodeSnapM');
  for (const n of net.nodes) {
    const v = frame.toMetres(n.position);
    if (Math.hypot(v[0] - q[0], v[1] - q[1]) > snap) continue;
    const ends = nodeEnds(net, n.id);
    if (ends.length !== 1) return null;
    const h = outwardHeading(net, ends[0]!);
    // The outward heading points into the existing track; continuing goes the other way.
    return h === null ? null : h + Math.PI;
  }
  return null;
}

export function trackGuideSnap(
  net: TrackNetwork,
  placed: readonly LngLat[],
  cursor: LngLat,
  toleranceM: number,
): TrackGuideSnap | null {
  if (!placed.length) return null;
  const frame = networkFrame(net, placed[0]!);
  const last = frame.toMetres(placed[placed.length - 1]!);
  const prev = placed.length >= 2 ? frame.toMetres(placed[placed.length - 2]!) : null;
  const c = frame.toMetres(cursor);
  const straights: StraightRef[] = [];
  for (const t of net.tracks)
    for (const p of trackGeometry(net, t).primitives)
      if (p.kind === 'line') straights.push({ start: p.start, end: p.end });
  const guides = drawingGuides({
    last,
    prev,
    startHeading: prev ? null : continuationAt(net, placed[0]!),
    straights: straightsNear(straights, c, GUIDE_STRAIGHT_SEARCH_M),
  });
  const snap = snapToGuides(c, guides, toleranceM);
  if (!snap) return null;
  const along = Math.hypot(snap.point[0] - last[0], snap.point[1] - last[1]);
  const ext = along * 1.5 + 20;
  const endPt: [number, number] = [
    last[0] + Math.cos(snap.guide.heading) * ext,
    last[1] + Math.sin(snap.guide.heading) * ext,
  ];
  return {
    position: frame.toLngLat(snap.point),
    line: [frame.toLngLat(last), frame.toLngLat(endPt)],
    label: snap.guide.label,
  };
}
