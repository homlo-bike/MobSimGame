import { describe, expect, it } from 'vitest';
import { emptyScenario } from './network';
import { createTracks, networkFrame, setCurveRadius, trackGeometry } from './tracks';
import { curveHandles, radiusFromHandle } from './curveHandles';
import { xy } from '../test/fixtures/tracks';

describe('curve handles', () => {
  it('sit at the middle of each arc and map a drag along the bisector to a radius', () => {
    const s = createTracks(emptyScenario(), {
      points: [xy(0, 0), xy(400, 0), xy(400, 400)],
      mode: 'tram',
      radiusM: 100,
    }).scenario;
    const net = s.trackNetwork;
    const t = net.tracks[0]!;
    const [h] = curveHandles(net, t);
    expect(h).toMatchObject({ index: 0, number: 1, requestedM: 100, usedM: 100 });
    // 90° corner: the arc middle is R(√2 − 1) ≈ 41.4 m from the corner, towards (−1, 1)/√2.
    const m = networkFrame(net).toMetres(h!.position);
    expect(Math.hypot(m[0] - 400, m[1])).toBeCloseTo(100 * (Math.SQRT2 - 1), 1);
    // Dragging to a point 2 × 41.4 m from the corner on the bisector doubles the radius.
    const e = 2 * 100 * (Math.SQRT2 - 1);
    const to = networkFrame(net).toLngLat([400 - e / Math.SQRT2, e / Math.SQRT2]);
    expect(radiusFromHandle(net, t, 0, to)).toBe(200);
    // Onto the corner: no curve. Far out: limited to what fits on the 400 m legs.
    expect(radiusFromHandle(net, t, 0, xy(400, 0))).toBeNull();
    expect(radiusFromHandle(net, t, 0, xy(0, 400))).toBe(h!.maxM - (h!.maxM % 5));
    expect(h!.maxM).toBe(400);
  });
});

describe('editing a curve of a double track', () => {
  it('keeps both tracks concentric', () => {
    const s = createTracks(emptyScenario(), {
      points: [xy(0, 0), xy(400, 0), xy(400, 400)],
      mode: 'tram',
      double: true,
      radiusM: 50,
    }).scenario;
    const [a, b] = s.trackNetwork.tracks;
    const next = setCurveRadius(s, a!.id, 0, 150);
    const used = next.trackNetwork.tracks.map((t) => trackGeometry(next.trackNetwork, t).built.usedRadii[1]!);
    expect(Math.abs(used[0]! - used[1]!)).toBeCloseTo(s.trackNetwork.groups[0]!.spacingM, 6);
    expect(used.some((r) => Math.abs(r - 150) < 1e-6)).toBe(true);
    expect(b).toBeDefined();
  });
});
