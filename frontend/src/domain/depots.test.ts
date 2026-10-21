import { describe, expect, it } from 'vitest';
import { createLine, emptyScenario, updateLine } from './network';
import { syncFleet } from './fleetRegistry';
import { addDepot, allocateDepots, depotCapacity, setDepotLinks, updateDepot } from './depots';
import { validateDepots } from '../validation/validate';
import { buildScenarioModels, vehicleStates } from '../simulation/engine';
import { PLACEHOLDER_PEAK_PERIODS } from './schema';
import type { DepotLink, LngLat } from './schema';
import { xy } from '../test/fixtures/tracks';

const routed = (coordinates: LngLat[]): DepotLink => ({
  status: 'routed',
  coordinates,
  lengthM: null,
  durationS: 120,
  provider: 'test',
  routedAt: null,
  message: '',
});

function busLine(vehicles: number) {
  let s = emptyScenario();
  const c = createLine(s, { coordinates: [xy(0, 0), xy(3000, 0)], mode: 'bus' });
  s = updateLine(c.scenario, c.line.id, { direction: 'bidirectional' });
  s = syncFleet(s, new Map([[c.line.id, vehicles]]));
  return { s, line: s.lines[0]! };
}

describe('bus depots', () => {
  it('shares the vehicles over the depots unless a depot has its own capacity', () => {
    let { s } = busLine(5);
    const a = addDepot(s, 'bus', xy(-500, 0));
    s = a.scenario;
    const b = addDepot(s, 'bus', xy(4000, 0));
    s = b.scenario;
    expect(depotCapacity(s, s.depots[0]!)).toBe(3);
    s = updateDepot(s, b.depot.id, { capacityOverride: 1 });
    expect(depotCapacity(s, s.depots[1]!)).toBe(1);
    // Nearest depot with room first: the line starts at x = 0, depot A is nearer.
    const alloc = allocateDepots(s);
    expect([...alloc.values()].filter((id) => id === a.depot.id)).toHaveLength(3);
    expect([...alloc.values()].filter((id) => id === b.depot.id)).toHaveLength(1);
    // 4 places for 5 buses: a warning.
    expect(validateDepots(s).some((f) => f.severity === 'warning')).toBe(true);
  });

  it('buses drive to the depot only on a routed street link, never straight', () => {
    const b = busLine(3);
    let s = b.s;
    const line = b.line;
    const d = addDepot(s, 'bus', xy(-500, 200));
    s = d.scenario;
    const opts = { timetable: { peakPeriods: PLACEHOLDER_PEAK_PERIODS } };
    // Not routed yet: no depot runs, vehicles wait at the line end (and a note says why).
    expect(buildScenarioModels(s, opts)[0]!.stabling).toBeNull();
    expect(validateDepots(s).some((f) => /no street route/.test(f.message))).toBe(true);
    const street = [xy(-500, 200), xy(-500, 0), xy(0, 0)];
    s = setDepotLinks(s, d.depot.id, line.id, {
      toLine: routed(street),
      fromLine: routed([...street].reverse()),
    });
    const m = buildScenarioModels(s, opts)[0]!;
    expect(m.stabling?.size).toBeGreaterThan(0);
    // At night the buses stand at the depot, beside its point.
    const night = vehicleStates(m, 3 * 3600);
    expect(night.filter((v) => v.state === 'parked' && v.position[0] < xy(-400, 0)[0])).toHaveLength(
      m.stabling!.size,
    );
  });
});
