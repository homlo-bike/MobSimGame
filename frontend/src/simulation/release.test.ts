import { describe, expect, it } from 'vitest';
import { createLine, emptyScenario, updateLine } from '../domain/network';
import { newlySurplus, syncFleet } from '../domain/fleetRegistry';
import { addDepot, setDepotLinks } from '../domain/depots';
import { xy } from '../test/fixtures/tracks';
import { PLACEHOLDER_PEAK_PERIODS, type DepotLink, type LngLat, type Scenario } from '../domain/schema';
import { buildScenarioModels, surplusPlan, vehicleStates } from './engine';
import { releasesFor } from './release';
import { validateSurplus } from '../validation/validate';
import { distanceM } from '../geo/geometry';

const routed = (coordinates: LngLat[]): DepotLink => ({
  status: 'routed',
  coordinates,
  lengthM: null,
  durationS: 120,
  provider: 'test',
  routedAt: null,
  message: '',
});
const opts = { timetable: { peakPeriods: PLACEHOLDER_PEAK_PERIODS } };

/** A bus line with 3 buses and a routed depot west of its start. */
function setup(link = true): { s: Scenario; lineId: string; depot: LngLat } {
  let s = emptyScenario();
  const c = createLine(s, { coordinates: [xy(0, 0), xy(3000, 0)], mode: 'bus' });
  s = updateLine(c.scenario, c.line.id, { direction: 'bidirectional' });
  s = syncFleet(s, new Map([[c.line.id, 3]]));
  const d = addDepot(s, 'bus', xy(-500, 0));
  s = d.scenario;
  if (link) {
    const street = [xy(-500, 0), xy(0, 0)];
    s = setDepotLinks(s, d.depot.id, c.line.id, {
      toLine: routed(street),
      fromLine: routed([...street].reverse()),
    });
  }
  return { s, lineId: c.line.id, depot: d.depot.position };
}

/** Make one bus surplus at time t (as the store does), from the plan before the edit. */
function release(before: Scenario, lineId: string, t: number) {
  let after = syncFleet(before, new Map([[lineId, 2]]));
  const codes = newlySurplus(before, after).map((v) => v.code);
  const trips = releasesFor(before, opts, codes, t);
  after = {
    ...after,
    fleet: after.fleet.map((v) => (trips.has(v.code) ? { ...v, release: trips.get(v.code)! } : v)),
  };
  return { after, code: codes[0]! };
}

describe('surplus vehicles finish their trip, then drive to the depot (F8)', () => {
  it('runs to the end of its trip, drives the street route to the depot, then parks there', () => {
    const { s, lineId, depot } = setup();
    // A time when BUS-003 is out on the line.
    const m0 = buildScenarioModels(s, opts)[0]!;
    let t = 12 * 3600;
    while (vehicleStates(m0, t).find((v) => v.id === 'BUS-003')?.state !== 'running') t += 30;
    const { after, code } = release(s, lineId, t);
    expect(code).toBe('BUS-003');
    const r = after.fleet.find((v) => v.code === code)!.release!;
    expect(r.samples.length).toBeGreaterThan(2);
    const endS = r.samples[r.samples.length - 1]![0];
    const plan = surplusPlan(after, buildScenarioModels(after, opts));
    const at = (x: number) => plan(x).find((v) => v.id === code)!;
    // Still in service on the line until the trip ends, never at the depot meanwhile.
    expect(at(t + 10).state).toBe('running');
    expect(distanceM(at(t + 10).position, depot)).toBeGreaterThan(400);
    // Then out of service along the route (never a straight jump), and parked at the depot.
    let deadhead = 0;
    let prev = at(endS).position;
    for (let x = endS; x < endS + 900; x += 2) {
      const v = at(x);
      if (v.state === 'deadhead') deadhead++;
      expect(distanceM(prev, v.position)).toBeLessThan(60);
      prev = v.position;
    }
    expect(deadhead).toBeGreaterThan(0);
    expect(at(endS + 3 * 3600).state).toBe('parked');
    expect(distanceM(at(endS + 3 * 3600).position, depot)).toBeLessThan(100);
    expect(validateSurplus(after)).toEqual([]);
  });

  it('without a street route to the depot it stays at the end of its trip and an error says why', () => {
    const { s, lineId } = setup(false);
    const m0 = buildScenarioModels(s, opts)[0]!;
    let t = 12 * 3600;
    while (vehicleStates(m0, t).find((v) => v.id === 'BUS-003')?.state !== 'running') t += 30;
    const { after, code } = release(s, lineId, t);
    const r = after.fleet.find((v) => v.code === code)!.release!;
    const end = r.samples[r.samples.length - 1]!;
    const plan = surplusPlan(after, buildScenarioModels(after, opts));
    const later = plan(end[0] + 3600).find((v) => v.id === code)!;
    expect(distanceM(later.position, [end[1], end[2]])).toBeLessThan(20);
    expect(
      validateSurplus(after).some((f) => f.id === `surplus-no-way-${code}` && f.severity === 'error'),
    ).toBe(true);
  });
});
