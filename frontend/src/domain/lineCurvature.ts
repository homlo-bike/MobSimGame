/**
 * Curve radii along a rail service (R15a): where the service runs through an arc of one
 * of its tracks, the arc's radius applies. Pure. Used for the curve resistance of the
 * running-time calculation; lines not routed over tracks have no radii here.
 */
import type { Scenario, TransportLine } from './schema';
import { trackGeometry } from './tracks';
import { length } from '../geo/track/primitives';

/** A curved part of a line: fractions of the line's length and the radius (m). */
export interface CurveSpan {
  fromFraction: number;
  toFraction: number;
  radiusM: number;
}

export function lineCurveProfile(scenario: Pick<Scenario, 'trackNetwork'>, line: TransportLine): CurveSpan[] {
  if (line.alignment.kind !== 'track' || !line.alignment.path.length) return [];
  const net = scenario.trackNetwork;
  const byId = new Map(net.tracks.map((t) => [t.id, t]));
  const steps = line.alignment.path
    .map((s) => {
      const t = byId.get(s.trackId);
      return t ? { s, g: trackGeometry(net, t) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const total = steps.reduce((a, x) => a + Math.abs(x.s.to - x.s.from) * x.g.lengthM, 0);
  if (total <= 0) return [];
  const out: CurveSpan[] = [];
  let at = 0;
  for (const { s, g } of steps) {
    const lo = Math.min(s.from, s.to) * g.lengthM;
    const hi = Math.max(s.from, s.to) * g.lengthM;
    const stepLen = hi - lo;
    let along = 0;
    for (const p of g.primitives) {
      const a = along;
      along += length(p);
      if (p.kind !== 'arc') continue;
      const x0 = Math.max(lo, a);
      const x1 = Math.min(hi, along);
      if (x1 <= x0) continue;
      // Distance along the step, in its direction of travel.
      const d0 = s.to >= s.from ? x0 - lo : hi - x1;
      const d1 = s.to >= s.from ? x1 - lo : hi - x0;
      out.push({ fromFraction: (at + d0) / total, toFraction: (at + d1) / total, radiusM: p.radius });
    }
    at += stepLen;
  }
  return out.sort((x, y) => x.fromFraction - y.fromFraction);
}

/** Radius at a fraction of the line, or null on straight track. */
export function radiusAtFraction(spans: readonly CurveSpan[], fraction: number): number | null {
  for (const c of spans) if (fraction >= c.fromFraction && fraction <= c.toFraction) return c.radiusM;
  return null;
}
