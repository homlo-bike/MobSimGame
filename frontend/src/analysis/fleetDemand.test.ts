import { describe, expect, it } from 'vitest';
import { lineFleet } from './fleet';
import { buildLineModel, roundTripS } from '../simulation/engine';
import { consistCapacity } from '../domain/vehicles';
import { railLine, xy } from '../test/fixtures/tracks';

describe('fleet from capacity, length and expected demand', () => {
  const { s, line } = railLine([xy(0, 0), xy(4000, 0)], 'tram', [xy(0, 0), xy(2000, 0), xy(4000, 0)]);
  const capacity = consistCapacity(
    line,
    s.vehicleTypes.find((v) => v.id === line.vehicleTypeId),
  )!;

  it('sizes the fleet for the demand when the timetable headway would be too sparse', () => {
    const policy = line.servicePatterns[0]!.peakHeadwayMin;
    // Demand that needs twice as many vehicles as the timetable headway gives.
    const demand = (2 * 60 * capacity) / policy;
    const f = lineFleet({ ...line, peakDemandPphpd: demand }, s, { cycleMin: 60 })!;
    expect(f.cycleSource).toBe('simulation');
    expect(f.demandHeadwayMin).toBeCloseTo(policy / 2);
    expect(f.designHeadwayMin).toBeCloseTo(policy / 2);
    expect(f.peakRequired).toBe(Math.ceil(60 / (policy / 2)));
    // Spares: 20 % (documented default), rounded up.
    expect(f.spares).toBe(Math.ceil(f.peakRequired * 0.2));
    expect(f.loadRatio).toBeCloseTo(1);
    // Low demand never lengthens the timetable headway.
    const low = lineFleet({ ...line, peakDemandPphpd: 1 }, s, { cycleMin: 60 })!;
    expect(low.designHeadwayMin).toBe(policy);
  });

  it('fewer vehicles than needed make the line run less often, in the summary and the simulation', () => {
    const cycleMin = roundTripS(buildLineModel(line, s)!) / 60;
    const f = lineFleet({ ...line, fleetSize: 1 }, s, { cycleMin })!;
    expect(f.effectiveHeadwayMin).toBeCloseTo(cycleMin);
    const m = buildLineModel({ ...line, fleetSize: 1 }, s)!;
    expect(m.headwayS / 60).toBeCloseTo(cycleMin, 0);
    // Enough vehicles: the timetable headway.
    const many = buildLineModel({ ...line, fleetSize: 1000 }, s)!;
    expect(many.headwayS).toBe(line.servicePatterns[0]!.peakHeadwayMin * 60);
  });
});
