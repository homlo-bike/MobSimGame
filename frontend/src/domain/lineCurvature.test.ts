import { describe, expect, it } from 'vitest';
import { lineCurveProfile, radiusAtFraction } from './lineCurvature';
import { railLine, xy } from '../test/fixtures/tracks';

describe('curve radii along a rail service', () => {
  it('finds the arc of an L-shaped track in the middle of the service', () => {
    const { s, line } = railLine([xy(0, 0), xy(600, 0), xy(600, 600)], 'tram', [xy(0, 0), xy(600, 600)], {
      double: false,
      radiusM: 150,
    });
    const spans = lineCurveProfile(s, line);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.radiusM).toBe(150);
    // The arc is centred on the corner: halfway along the service.
    const mid = (spans[0]!.fromFraction + spans[0]!.toFraction) / 2;
    expect(mid).toBeGreaterThan(0.45);
    expect(mid).toBeLessThan(0.55);
    expect(radiusAtFraction(spans, mid)).toBe(150);
    expect(radiusAtFraction(spans, 0.05)).toBeNull();
  });

  it('has no radii on a straight service', () => {
    const { s, line } = railLine([xy(0, 0), xy(800, 0)], 'tram', [xy(0, 0), xy(800, 0)], { double: false });
    expect(lineCurveProfile(s, line)).toEqual([]);
  });
});
