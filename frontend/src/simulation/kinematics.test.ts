import { describe, expect, it } from 'vitest';
import type { Scenario } from '../domain/schema';
import { addStationOnLine, createLine, emptyScenario, updateLine } from '../domain/network';
import { buildLineModel, roundTripS, tripPhases, vehicleStates } from './engine';
import { defaultRates, lineRates, profile, profileDistance, profileDuration, stopLossS } from './kinematics';

describe('speed profile', () => {
  it('accelerates, cruises and brakes over a long section', () => {
    // 1000 m at 10 m/s with a = 1, b = 2: 50 m to accelerate, 25 m to brake.
    const p = profile(1000, 10, 0, 0, 1, 2);
    expect(p.vp).toBeCloseTo(10);
    expect(p.t1).toBeCloseTo(10);
    expect(p.t3).toBeCloseTo(5);
    expect(profileDuration(p)).toBeCloseTo(100 + stopLossS(10, 1, 2));
    expect(profileDistance(p, profileDuration(p))).toBeCloseTo(1000);
    expect(profileDistance(p, 10)).toBeCloseTo(50);
  });

  it('never reaches the cruise speed on a short section', () => {
    const p = profile(30, 20, 0, 0, 1, 1);
    expect(p.vp).toBeCloseTo(Math.sqrt(30));
    expect(p.t2).toBeCloseTo(0);
    expect(profileDistance(p, profileDuration(p))).toBeCloseTo(30);
  });

  it('brakes harder only when the section is too short to stop at the service rate', () => {
    const p = profile(10, 20, 20, 0, 1, 1);
    expect(p.b).toBeCloseTo(20);
    expect(profileDistance(p, profileDuration(p))).toBeCloseTo(10);
  });

  it('distance never decreases', () => {
    const p = profile(400, 15, 3, 5, 1.2, 4);
    let last = -1;
    for (let t = 0; t <= profileDuration(p); t += 0.5) {
      const x = profileDistance(p, t);
      expect(x).toBeGreaterThanOrEqual(last - 1e-9);
      last = x;
    }
  });
});

describe('rates', () => {
  it('uses the documented SUMO class defaults, overridden by the vehicle profile', () => {
    expect(defaultRates('bus')).toMatchObject({ accelMs2: 1.2, decelMs2: 4, sumoClass: 'bus' });
    expect(defaultRates('tram')).toMatchObject({ accelMs2: 1, decelMs2: 3 });
    expect(defaultRates('metro').note).toMatch(/rail_urban/);
    let s: Scenario = emptyScenario();
    const c = createLine(s, {
      coordinates: [
        [0, 0],
        [0.02, 0],
      ],
      mode: 'tram',
    });
    s = c.scenario;
    s = {
      ...s,
      vehicleTypes: s.vehicleTypes.map((v) =>
        v.id === c.line.vehicleTypeId ? { ...v, accelerationMs2: 1.3 } : v,
      ),
    };
    expect(lineRates(s.lines[0]!, s)).toMatchObject({
      accelMs2: 1.3,
      decelMs2: 3,
      source: 'vehicle_profile',
    });
  });
});

describe('simulation with acceleration and braking', () => {
  function line() {
    let s: Scenario = emptyScenario();
    const r = createLine(s, {
      coordinates: [
        [0, 0],
        [0.02, 0],
      ],
      mode: 'tram',
    });
    s = r.scenario;
    for (const p of [
      [0, 0],
      [0.01, 0],
      [0.02, 0],
    ] as [number, number][])
      s = addStationOnLine(s, r.line.id, p).scenario;
    s = updateLine(s, r.line.id, { direction: 'bidirectional' });
    return { s, l: s.lines[0]! };
  }

  it('takes longer than at constant speed by about one stop loss per stop', () => {
    const { s, l } = line();
    const constant = buildLineModel(l, s, { constantSpeed: true })!;
    const real = buildLineModel(l, s)!;
    const extra = roundTripS(real) - roundTripS(constant);
    // Out and back: two runs each way, each run starts and ends at a stop.
    const v = (l.maxSpeedKmh ?? 60) / 3.6;
    expect(extra).toBeGreaterThan(0);
    expect(extra).toBeLessThanOrEqual(4 * stopLossS(v, 1, 3) + 1);
  });

  it('is slow next to a stop and moves smoothly (pure function of time)', () => {
    const { s, l } = line();
    const m = buildLineModel(l, s)!;
    const runs = tripPhases(m, m.services[0]!, 0).filter((p) => p.kind === 'run');
    expect(runs.every((p) => p.kind === 'run' && p.profile && p.profile.v0 === 0 && p.profile.v1 === 0)).toBe(
      true,
    );
    const a = vehicleStates(m, 1)[0]!;
    const b = vehicleStates(m, 1)[0]!;
    expect(a.chainageM).toBe(b.chainageM);
    // One second after starting, the tram has moved ½·a·t² = 0.5 m (a = 1 m/s² for trams).
    const firstRun = runs[0]!;
    if (firstRun.kind === 'run') expect(profileDistance(firstRun.profile!, 1)).toBeCloseTo(0.5);
  });
});
