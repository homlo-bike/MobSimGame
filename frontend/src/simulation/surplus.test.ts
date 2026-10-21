import { describe, expect, it } from 'vitest';
import { createLine, emptyScenario, updateLine } from '../domain/network';
import { createTracks, updateTrack } from '../domain/tracks';
import { newlySurplus, syncFleet } from '../domain/fleetRegistry';
import { addDepot, parkingSpot } from '../domain/depots';
import { railLine, xy } from '../test/fixtures/tracks';
import { buildScenarioModels, surplusStates, SURPLUS_COLOR } from './engine';
import { surplusInfo } from './vehicleInfo';
import { distanceM } from '../geo/geometry';
import { validateSurplus } from '../validation/validate';

describe('vehicle lifecycle (F7)', () => {
  it('reports the vehicles an edit makes surplus, once', () => {
    let s = emptyScenario();
    const c = createLine(s, { coordinates: [xy(0, 0), xy(3000, 0)], mode: 'bus' });
    s = syncFleet(c.scenario, new Map([[c.line.id, 4]]));
    const fewer = syncFleet(s, new Map([[c.line.id, 2]]));
    expect(newlySurplus(s, fewer).map((v) => v.code)).toEqual(['BUS-003', 'BUS-004']);
    // Already surplus before: not reported again.
    expect(newlySurplus(fewer, syncFleet(fewer, new Map([[c.line.id, 2]])))).toEqual([]);
  });

  it('surplus buses stand at their depot, after the line buses, never on the line', () => {
    let s = emptyScenario();
    const c = createLine(s, { coordinates: [xy(0, 0), xy(3000, 0)], mode: 'bus' });
    s = updateLine(c.scenario, c.line.id, { direction: 'bidirectional' });
    s = syncFleet(s, new Map([[c.line.id, 4]]));
    const d = addDepot(s, 'bus', xy(-500, 0));
    s = syncFleet(d.scenario, new Map([[c.line.id, 2]]));
    const parked = surplusStates(s, buildScenarioModels(s));
    expect(parked.map((v) => v.id).sort()).toEqual(['BUS-003', 'BUS-004']);
    expect(parked.every((v) => v.state === 'parked' && v.color === SURPLUS_COLOR && !v.lineId)).toBe(true);
    // Places 2 and 3 of the depot: the line's two buses keep places 0 and 1.
    const spot = parkingSpot(d.depot, 2, 12, 2.55);
    expect(Math.min(...parked.map((v) => distanceM(v.position, spot)))).toBeLessThan(15);
    expect(parked.every((v) => distanceM(v.position, d.depot.position) < 100)).toBe(true);
    expect(surplusInfo(s, 'BUS-003').status).toMatch(/Surplus since .*Depot 1/);
  });

  it('surplus trams stand on the depot track room left; without a depot they wait at their line start', () => {
    const { s: s0, line } = railLine([xy(0, 0), xy(2000, 0)], 'tram', [xy(0, 0), xy(1000, 0), xy(2000, 0)], {
      double: false,
    });
    let s = updateLine(s0, line.id, { direction: 'bidirectional' });
    s = syncFleet(s, new Map([[line.id, 3]]));
    s = syncFleet(s, new Map([[line.id, 2]]));
    // No depot: still drawn, before the start of the line it last served, with a warning.
    const waiting = surplusStates(s, buildScenarioModels(s));
    expect(waiting).toHaveLength(1);
    expect(waiting[0]!.position[0]).toBeLessThan(xy(0, 0)[0]);
    expect(validateSurplus(s).map((f) => f.severity)).toEqual(['warning']);
    const before = new Set(s.trackNetwork.tracks.map((t) => t.id));
    s = createTracks(s, { points: [xy(0, 0), xy(-400, 0)], mode: 'tram', double: false }).scenario;
    const depot = s.trackNetwork.tracks.find((t) => !before.has(t.id))!;
    s = updateTrack(s, depot.id, { usage: 'depot' });
    const parked = surplusStates(s, buildScenarioModels(s));
    expect(parked).toHaveLength(1);
    expect(parked[0]!.position[0]).toBeLessThan(xy(-1, 0)[0]);
    expect(parked[0]!.footprint.length).toBeGreaterThan(0);
  });
});
