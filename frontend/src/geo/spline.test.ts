import { describe, expect, it } from 'vitest';
import type { LngLat } from '../domain/schema';
import { curvesBelow, sampleSpline, sampledCurvature } from './spline';
import { distanceM } from './geometry';

const m = 1 / 111320;

describe('smooth alignment splines', () => {
  it('passes through every control point and keeps the ends', () => {
    const cps: LngLat[] = [
      [0, 0],
      [500 * m, 0],
      [800 * m, 300 * m],
      [800 * m, 800 * m],
    ];
    const curve = sampleSpline(cps, false);
    expect(curve[0]).toEqual(cps[0]);
    expect(distanceM(curve[curve.length - 1]!, cps[3]!)).toBeLessThan(0.05);
    for (const p of cps) expect(Math.min(...curve.map((c) => distanceM(c, p)))).toBeLessThan(0.05);
    // Samples are dense: no gap above ~10 m.
    for (let i = 1; i < curve.length; i++) expect(distanceM(curve[i - 1]!, curve[i]!)).toBeLessThan(11);
  });

  it('keeps a straight line straight', () => {
    const curve = sampleSpline(
      [
        [0, 0],
        [300 * m, 0],
        [900 * m, 0],
      ],
      false,
    );
    expect(curve.every((p) => Math.abs(p[1]) < 1e-9)).toBe(true);
    expect(sampledCurvature(curve, false).every((c) => c.radiusM > 1e5)).toBe(true);
  });

  it('measures the radius of control points on a circle', () => {
    const r = 300;
    const cps: LngLat[] = [...Array(9).keys()].map((i) => {
      const a = (i * Math.PI) / 8;
      return [r * Math.sin(a) * m, (r - r * Math.cos(a)) * m];
    });
    const radii = sampledCurvature(sampleSpline(cps, false), false).map((c) => c.radiusM);
    const middle = radii.slice(Math.floor(radii.length / 4), Math.floor((3 * radii.length) / 4));
    for (const x of middle) expect(Math.abs(x - r) / r).toBeLessThan(0.1);
  });

  it('closes rings smoothly without repeating the first point', () => {
    const cps: LngLat[] = [
      [0, 0],
      [0.01, 0],
      [0.01, 0.01],
      [0, 0.01],
    ];
    const curve = sampleSpline(cps, true);
    expect(curve[0]).toEqual(cps[0]);
    expect(distanceM(curve[0]!, curve[curve.length - 1]!)).toBeLessThan(15);
    expect(curve[0]).not.toEqual(curve[curve.length - 1]);
  });

  it('groups consecutive tight samples into one curve', () => {
    const samples = [500, 90, 80, 95, 500, 70, 500].map((radiusM, i) => ({
      index: i,
      chainageM: i * 10,
      radiusM,
      position: [i, 0] as LngLat,
    }));
    const curves = curvesBelow(samples, 100);
    expect(curves).toHaveLength(2);
    expect(curves[0]).toMatchObject({ minRadiusM: 80, fromChainageM: 10, toChainageM: 30 });
  });
});
