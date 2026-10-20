import { describe, expect, it } from 'vitest';
import { emptyScenario, orderedStops } from './network';
import { createStopLine, stopNear } from './stopLines';
import { applyRouteResults } from './alignment';
import { xy } from '../test/fixtures/tracks';

describe('street lines drawn stop by stop', () => {
  it('makes a one-way loop through the clicked stops, in order', () => {
    const res = createStopLine(emptyScenario(), {
      points: [xy(0, 0), xy(500, 0), xy(500, 400)],
      mode: 'bus',
    });
    expect(res.error).toBeNull();
    const line = res.line!;
    expect(line.direction).toBe('one_way');
    expect(line.termination.kind).toBe('ring');
    expect(line.alignment.kind).toBe('routed');
    // Three legs: two between the stops and one back to the first stop.
    expect(line.alignment.kind === 'routed' && line.alignment.legs).toHaveLength(3);
    expect(res.scenario.stations).toHaveLength(3);
    expect(line.stops.map((s) => res.scenario.stations.find((x) => x.id === s.stationId)!.position)).toEqual([
      xy(0, 0),
      xy(500, 0),
      xy(500, 400),
    ]);
  });

  it('needs two stops and ignores a last click back on the first', () => {
    expect(createStopLine(emptyScenario(), { points: [xy(0, 0)], mode: 'bus' }).error).toMatch(/two stops/);
    const res = createStopLine(emptyScenario(), {
      points: [xy(0, 0), xy(500, 0), xy(500, 400), xy(0, 0)],
      mode: 'brt',
    });
    expect(res.line!.stops).toHaveLength(3);
  });

  it('reuses stops of the same mode only', () => {
    const bus = createStopLine(emptyScenario(), { points: [xy(0, 0), xy(500, 0)], mode: 'bus' }).scenario;
    expect(stopNear(bus, 'bus', xy(20, 0))).not.toBeNull();
    expect(stopNear(bus, 'trolleybus', xy(20, 0))).toBeNull();
    const second = createStopLine(bus, { points: [xy(20, 0), xy(0, 600)], mode: 'bus' });
    expect(second.reused).toBe(1);
    expect(second.scenario.stations).toHaveLength(3);
    const trolley = createStopLine(bus, { points: [xy(20, 0), xy(0, 600)], mode: 'trolleybus' });
    expect(trolley.reused).toBe(0);
    expect(trolley.scenario.stations).toHaveLength(4);
  });

  it('keeps the clicked order where the route passes a stop again on the way back', () => {
    // Out along y = 0 and back along y = 10 (other side of the street): stop 3 lies on the way
    // back, right next to the outbound leg, and must stay third.
    const res = createStopLine(emptyScenario(), {
      points: [xy(0, 0), xy(1000, 0), xy(300, 12)],
      mode: 'bus',
    });
    const routed = applyRouteResults(
      res.line!,
      [
        {
          status: 'routed',
          coordinates: [xy(0, 0), xy(1000, 0)],
          message: '',
        },
        {
          status: 'routed',
          coordinates: [xy(1000, 0), xy(1000, 10), xy(300, 10)],
          message: '',
        },
        {
          status: 'routed',
          coordinates: [xy(300, 10), xy(0, 10), xy(0, 0)],
          message: '',
        },
      ],
      'test',
      true,
    );
    const names = orderedStops(routed, res.scenario.stations).map((o) => Math.round(o.chainageM));
    expect(names[0]).toBe(0);
    expect(Math.abs(names[1]! - 1000)).toBeLessThan(5);
    expect(Math.abs(names[2]! - 1710)).toBeLessThan(5);
  });

  it('rail modes are not drawn by stops', () => {
    expect(
      createStopLine(emptyScenario(), { points: [xy(0, 0), xy(500, 0)], mode: 'tram' }).error,
    ).not.toBeNull();
  });
});
