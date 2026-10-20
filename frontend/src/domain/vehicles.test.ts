import { describe, expect, it } from 'vitest';
import { defaultVehicleTypes, MODE_LIST } from './modes';
import {
  addVehicleProfile,
  compatibleVehicles,
  consistCapacity,
  consistLengthM,
  deleteVehicleProfile,
  isVehicleCompatible,
  MODE_VEHICLE_CATEGORIES,
  updateVehicleProfile,
  usesVehicles,
  validateProfileInput,
} from './vehicles';
import { createLine, emptyScenario, updateLine } from './network';
import { lineFleet } from '../analysis/fleet';
import { validateLine } from '../validation/validate';
import { railLine, xy } from '../test/fixtures/tracks';

describe('vehicle compatibility', () => {
  it('offers only vehicles of the line’s mode', () => {
    const vs = defaultVehicleTypes();
    for (const m of MODE_LIST)
      for (const v of compatibleVehicles(vs, m)) expect(isVehicleCompatible(v, m)).toBe(true);
    expect(compatibleVehicles(vs, 'metro').map((v) => v.id)).toEqual(['vt-metro-100m']);
    expect(compatibleVehicles(vs, 'elevated_metro').map((v) => v.id)).toEqual(['vt-metro-100m']);
    expect(compatibleVehicles(vs, 'bus').every((v) => v.mode === 'bus')).toBe(true);
    expect(compatibleVehicles(vs, 'tram').some((v) => v.mode === 'bus')).toBe(false);
  });

  it('lists the brief’s categories per mode, and none for walking and cycling', () => {
    expect(MODE_VEHICLE_CATEGORIES.bus).toContain('double_decker_bus');
    expect(MODE_VEHICLE_CATEGORIES.brt).toContain('brt_double_articulated_bus');
    expect(MODE_VEHICLE_CATEGORIES.tram).toContain('tram_low_floor');
    expect(MODE_VEHICLE_CATEGORIES.metro).toContain('metro_automated');
    expect(MODE_VEHICLE_CATEGORIES.commuter_rail).toContain('locomotive_hauled');
    expect(usesVehicles('pedestrian')).toBe(false);
    expect(usesVehicles('cycling')).toBe(false);
  });

  it('new lines start with a compatible vehicle', () => {
    const { line } = createLine(emptyScenario(), {
      coordinates: [xy(0, 0), xy(100, 0)],
      mode: 'elevated_metro',
    });
    expect(line.vehicleTypeId).toBe('vt-metro-100m');
  });
});

describe('custom vehicle profiles', () => {
  it('validates, adds, edits and deletes profiles', () => {
    const input = {
      name: 'My tram',
      mode: 'tram' as const,
      category: 'tram_low_floor' as const,
      capacity: 200,
      maxSpeedKmh: 70,
      lengthM: 32,
      source: '',
    };
    expect(validateProfileInput({ ...input, category: 'standard_bus' })[0]).toMatch(/not a tram/);
    expect(validateProfileInput({ ...input, capacity: 0 })).toHaveLength(1);
    const res = addVehicleProfile(emptyScenario(), input);
    expect(res.errors).toEqual([]);
    expect(res.vehicle!.status).toBe('user_override');
    expect(res.vehicle!.minRadiusM).toBeNull();
    const edited = updateVehicleProfile(res.scenario, res.vehicle!.id, {
      minRadiusM: 18,
      unitsPerConsist: 2,
    });
    const v = edited.vehicleTypes.find((x) => x.id === res.vehicle!.id)!;
    expect(v.minRadiusM).toBe(18);
    expect(consistLengthM({ consistUnits: null }, v)).toBe(64);
    expect(consistCapacity({ consistUnits: 3 }, v)).toBe(600);
    // A profile in use cannot be deleted.
    const c = createLine(edited, { coordinates: [xy(0, 0), xy(100, 0)], mode: 'tram' });
    const withLine = updateLine(c.scenario, c.line.id, { vehicleTypeId: v.id });
    expect(deleteVehicleProfile(withLine, v.id).vehicleTypes).toHaveLength(withLine.vehicleTypes.length);
    expect(deleteVehicleProfile(edited, v.id).vehicleTypes).toHaveLength(edited.vehicleTypes.length - 1);
  });
});

describe('fleet and vehicle validation', () => {
  const { s, line } = railLine([xy(0, 0), xy(4000, 0)], 'tram', [xy(0, 0), xy(2000, 0), xy(4000, 0)]);

  it('computes the fleet needed for the headways and the shortfall', () => {
    const f = lineFleet(line, s)!;
    expect(f.peakRequired).toBeGreaterThan(0);
    expect(f.offPeakRequired).toBeLessThanOrEqual(f.peakRequired);
    expect(f.assigned).toBeNull();
    const short = lineFleet({ ...line, fleetSize: 1 }, s)!;
    expect(short.shortfall).toBe(f.peakRequired - 1);
    expect(f.peakCapacityPphpd).toBe((60 / line.servicePatterns[0]!.peakHeadwayMin) * 180);
  });

  it('reports a fleet too small, an incompatible vehicle and curves too tight for the vehicle', () => {
    const errors = (l: typeof line, sc = s) =>
      validateLine(l, sc)
        .filter((x) => x.severity === 'error')
        .map((x) => x.message);
    expect(errors({ ...line, fleetSize: 1 }).some((m) => /vehicle\(s\) assigned, but/.test(m))).toBe(true);
    expect(errors({ ...line, fleetSize: 100 }).some((m) => /assigned/.test(m))).toBe(false);
    expect(errors({ ...line, vehicleTypeId: 'vt-bus-12m' }).some((m) => /not compatible/.test(m))).toBe(true);
    const curvy = railLine([xy(0, 0), xy(500, 0), xy(500, 500)], 'tram', [xy(0, 0), xy(500, 500)], {
      radiusM: 30,
    });
    const fussy = updateVehicleProfile(curvy.s, 'vt-tram-30m', { minRadiusM: 50 });
    expect(errors(fussy.lines[0]!, fussy).some((m) => /needs curves of at least 50 m/.test(m))).toBe(true);
  });
});
