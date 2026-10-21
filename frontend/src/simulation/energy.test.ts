import { describe, expect, it } from 'vitest';
import { runEnvelope, type TrainPhysics } from './trainPhysics';
import { lineRoundTripEnergy, runEnergyKwh, supplyEnergy } from './energy';
import { buildLineModel } from './engine';
import { railLine, xy } from '../test/fixtures/tracks';

// Test values only (not a real vehicle).
const train: TrainPhysics = {
  massKg: 100_000,
  powerW: 1e9,
  maxForceN: 1e9,
  davis: { a: 0, b: 0, c: 0 },
  decelMs2: 1,
  accelCapMs2: 1,
};
const KWH = 3.6e6;

describe('energy of a run', () => {
  it('without resistance: the traction supplies the kinetic energy and the brakes absorb it', () => {
    const env = runEnvelope(train, { lengthM: 1000, limitAt: () => 20, gradientAt: () => 0 }, 0, 0, 0, 1);
    const e = runEnergyKwh(train, env);
    const kinetic = (0.5 * train.massKg * 20 * 20) / KWH;
    expect(e.tractionKwh).toBeCloseTo(kinetic, 3);
    expect(e.brakingKwh).toBeCloseTo(kinetic, 3);
  });

  it('uphill: traction minus braking is the potential energy m·g·h (start and end at rest)', () => {
    const up = runEnvelope(train, { lengthM: 1000, limitAt: () => 20, gradientAt: () => 20 }, 0, 0, 0, 1);
    const e = runEnergyKwh(train, up);
    const climb = (train.massKg * 9.80665 * 20) / KWH; // 20 per mille over 1000 m = 20 m
    expect(e.tractionKwh - e.brakingKwh).toBeCloseTo(climb, 2);
  });

  it('running resistance costs traction energy at constant speed', () => {
    const drag = { ...train, davis: { a: 1000, b: 0, c: 0 } };
    const env = runEnvelope(drag, { lengthM: 1000, limitAt: () => 20, gradientAt: () => 0 }, 20, 20, 0, 1);
    expect(runEnergyKwh(drag, env).tractionKwh).toBeCloseTo((1000 * 1000) / KWH, 3);
  });
});

describe('supply energy', () => {
  it('needs every efficiency and never assumes one', () => {
    const r = supplyEnergy(
      { tractionKwh: 10, brakingKwh: 4 },
      3600,
      5,
      {
        tractionEfficiency: null,
        regenerationShare: 0.5,
        auxiliaryPowerKw: null,
      },
      1,
    );
    expect(r.supplyKwh).toBeNull();
    expect(r.missing).toEqual(['efficiency from supply to wheel', 'auxiliary power']);
  });

  it('divides by the efficiency, subtracts what is fed back and adds the auxiliaries', () => {
    const r = supplyEnergy(
      { tractionKwh: 8, brakingKwh: 4 },
      1800,
      5,
      {
        tractionEfficiency: 0.8,
        regenerationShare: 0.25,
        auxiliaryPowerKw: 10,
      },
      2,
    );
    // 8 / 0.8 − 4 × 0.25 + 10 kW × 2 units × 0.5 h
    expect(r.supplyKwh).toBeCloseTo(10 - 1 + 10);
  });
});

describe('energy of a line', () => {
  it('sums the runs of one round trip when the vehicle gives mass and power', () => {
    const { s, line } = railLine([xy(0, 0), xy(2000, 0)], 'tram', [xy(0, 0), xy(2000, 0)], { double: false });
    const sc = {
      ...s,
      vehicleTypes: s.vehicleTypes.map((v) =>
        v.id === line.vehicleTypeId
          ? { ...v, massT: 40, tractionPowerKw: 500, startingTractiveEffortKn: 50 }
          : v,
      ),
    };
    const m = buildLineModel(sc.lines[0]!, sc)!;
    const e = lineRoundTripEnergy(m, sc.lines[0]!, sc)!;
    expect(e.tractionAtWheelKwh).toBeGreaterThan(0);
    expect(e.distanceKm).toBeCloseTo(4, 1);
    expect(e.supplyKwh).toBeNull();
    expect(lineRoundTripEnergy(buildLineModel(s.lines[0]!, s)!, s.lines[0]!, s)).toBeNull();
  });
});
