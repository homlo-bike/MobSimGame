import { describe, expect, it } from 'vitest';
import { emptyScenario } from '../domain/network';
import { following, followingGapM } from '../domain/trackParameters';
import { buildLineModel } from './engine';
import { createLine, updateLine } from '../domain/network';

describe('keeping the distance to the vehicle ahead', () => {
  it('buses and trams drive on sight with the IDM steady-state gap; metros are signalled', () => {
    const net = emptyScenario().trackNetwork;
    const bus = following(net, 'bus');
    expect(bus).toEqual({ kind: 'on_sight', minGapM: 2.5, timeGapS: 1 });
    // At 10 m/s: 2.5 m + 10 m/s × 1 s.
    expect(followingGapM(bus, 10)).toBeCloseTo(12.5);
    expect(followingGapM(bus, 0)).toBeCloseTo(2.5);
    expect(following(net, 'tram').kind).toBe('on_sight');
    expect(following(net, 'metro')).toEqual({ kind: 'signalled', distanceM: 200 });
  });

  it('uses the project values', () => {
    const s = emptyScenario();
    const net = { ...s.trackNetwork, parameterOverrides: { followingTimeGapS: 2, followingMinGapM: 4 } };
    expect(followingGapM(following(net, 'trolleybus'), 10)).toBeCloseTo(24);
  });

  it('a line model carries the rule and the consist length of its vehicles', () => {
    let s = emptyScenario();
    const c = createLine(s, {
      coordinates: [
        [0, 0],
        [0.02, 0],
      ],
      mode: 'bus',
    });
    s = updateLine(c.scenario, c.line.id, { consistUnits: 2 });
    const v = s.vehicleTypes.find((x) => x.id === c.line.vehicleTypeId)!;
    const m = buildLineModel(s.lines[0]!, s)!;
    expect(m.following.kind).toBe('on_sight');
    expect(m.vehicleLengthM).toBeCloseTo(2 * v.lengthM);
  });
});
