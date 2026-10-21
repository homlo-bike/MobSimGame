import { describe, expect, it } from 'vitest';
import {
  equivalentGradientPerMille,
  envelopeDistance,
  maxAcceleration,
  runEnvelope,
  tractiveForceN,
  type TrainPhysics,
} from './trainPhysics';
import { profile, profileDuration } from './kinematics';

// Test values only (not a real vehicle).
const strong: TrainPhysics = {
  massKg: 100_000,
  powerW: 1e9,
  maxForceN: 1e9,
  davis: { a: 0, b: 0, c: 0 },
  decelMs2: 1,
  accelCapMs2: 1,
};
const flat = (lengthM: number, limit = 20) => ({ lengthM, limitAt: () => limit, gradientAt: () => 0 });

describe('train physics', () => {
  it('is power-limited at speed and force-limited at start', () => {
    const p = { ...strong, powerW: 1e6, maxForceN: 2e5 };
    expect(tractiveForceN(p, 0)).toBe(2e5);
    expect(tractiveForceN(p, 2)).toBe(2e5);
    expect(tractiveForceN(p, 20)).toBeCloseTo(5e4);
  });

  it('adds the curve term 800 / r to the gradient', () => {
    expect(equivalentGradientPerMille(10, null)).toBe(10);
    expect(equivalentGradientPerMille(0, 400)).toBe(2);
  });

  it('loses acceleration uphill: g × gradient', () => {
    const p = { ...strong, accelCapMs2: null, powerW: 1e6, maxForceN: 1e5 };
    expect(maxAcceleration(p, 1, 0)).toBeCloseTo(1);
    expect(maxAcceleration(p, 1, 40)).toBeCloseTo(1 - 9.80665 * 0.04);
  });

  it('matches the constant-rate profile when traction is unlimited', () => {
    const env = runEnvelope(strong, flat(1000), 0, 0, 0, 1);
    const ref = profileDuration(profile(1000, 20, 0, 0, 1, 1));
    expect(env.durationS).toBeCloseTo(ref, 0);
    expect(Math.max(...env.vs)).toBeCloseTo(20);
    expect(env.v1).toBe(0);
  });

  it('runs slower uphill, with running resistance and with little power', () => {
    const base = runEnvelope(strong, flat(2000), 0, 0, 0).durationS;
    const real = { ...strong, accelCapMs2: null, powerW: 2e6, maxForceN: 1.5e5 };
    const level = runEnvelope(real, flat(2000), 0, 0, 0).durationS;
    const up = runEnvelope(real, { lengthM: 2000, limitAt: () => 20, gradientAt: () => 30 }, 0, 0, 0);
    expect(up.durationS).toBeGreaterThan(level);
    expect(runEnvelope({ ...strong, powerW: 5e5 }, flat(2000), 0, 0, 0).durationS).toBeGreaterThan(base);
    const drag = runEnvelope({ ...strong, davis: { a: 5000, b: 100, c: 20 } }, flat(2000), 0, 0, 0);
    expect(drag.durationS).toBeGreaterThanOrEqual(base);
  });

  it('holds a lower limit until the tail has left it', () => {
    // 10 m/s for the first 200 m, then 20 m/s; a 100 m train may only speed up after 300 m.
    const track = { lengthM: 2000, limitAt: (x: number) => (x < 200 ? 10 : 20), gradientAt: () => 0 };
    const env = runEnvelope(strong, track, 0, 0, 100, 1);
    const at = (x: number) => env.vs[Math.round(x)]!;
    expect(at(250)).toBeLessThanOrEqual(10 + 1e-9);
    expect(at(450)).toBeGreaterThan(10);
  });

  it('brakes before a speed drop', () => {
    const track = { lengthM: 2000, limitAt: (x: number) => (x < 1500 ? 20 : 5), gradientAt: () => 0 };
    const env = runEnvelope(strong, track, 0, 5, 0, 1);
    expect(env.vs[1500]).toBeLessThanOrEqual(5 + 1e-9);
    expect(env.vs[1400]).toBeLessThan(20);
  });

  it('reports a stall when traction cannot climb the gradient', () => {
    const weak = { ...strong, accelCapMs2: null, powerW: 1e5, maxForceN: 2e4 };
    const env = runEnvelope(weak, { lengthM: 500, limitAt: () => 20, gradientAt: () => 40 }, 5, 0, 0);
    expect(env.stalled).toBe(true);
    expect(Number.isFinite(env.durationS)).toBe(true);
  });

  it('gives the distance travelled over time, from 0 to the end', () => {
    const env = runEnvelope(strong, flat(1000), 0, 0, 0);
    expect(envelopeDistance(env, 0)).toBe(0);
    expect(envelopeDistance(env, env.durationS)).toBe(1000);
    let last = 0;
    for (let t = 0; t <= env.durationS; t += env.durationS / 50) {
      const x = envelopeDistance(env, t);
      expect(x).toBeGreaterThanOrEqual(last - 1e-9);
      last = x;
    }
  });
});
