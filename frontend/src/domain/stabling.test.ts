import { describe, expect, it } from 'vitest';
import { updateLine } from './network';
import { createTracks, updateTrack } from './tracks';
import { assignStabling, stablingNeed } from './stabling';
import { routeThroughStations } from './serviceRouting';
import { railLine, xy } from '../test/fixtures/tracks';
import { buildScenarioModels, vehicleStates } from '../simulation/engine';
import { validateStabling } from '../validation/validate';
import { PLACEHOLDER_PEAK_PERIODS } from './schema';

/** A tram line with a depot siding of `depotM` metres off its west end. */
function withDepot(depotM: number) {
  const { s: s0, line } = railLine([xy(0, 0), xy(2000, 0)], 'tram', [xy(0, 0), xy(1000, 0), xy(2000, 0)], {
    double: false,
  });
  let s = updateLine(s0, line.id, { direction: 'bidirectional' });
  const before = new Set(s.trackNetwork.tracks.map((t) => t.id));
  s = createTracks(s, { points: [xy(0, 0), xy(-depotM, 0)], mode: 'tram', double: false }).scenario;
  const depot = s.trackNetwork.tracks.find((t) => !before.has(t.id))!;
  s = updateTrack(s, depot.id, { usage: 'depot' });
  return { s, line: s.lines[0]!, depotId: depot.id };
}

describe('depot tracks', () => {
  it('services are never routed over a depot track', () => {
    const { s, depotId } = withDepot(300);
    const [a, , c] = s.stations;
    const r = routeThroughStations(s, [a!.id, c!.id], false, 'tram');
    expect(r.error).toBeNull();
    expect(r.steps.some((x) => x.trackId === depotId)).toBe(false);
  });

  it('counts the depot track a mode needs and warns when it is short', () => {
    const { s } = withDepot(40);
    const need = stablingNeed(s, 'tram', () => 3);
    expect(need.vehicles).toBe(3);
    expect(need.availableM).toBeGreaterThan(39);
    expect(need.neededM).toBeGreaterThan(need.availableM);
    expect(validateStabling(s).some((f) => f.severity === 'warning' && /depot track/.test(f.message))).toBe(
      true,
    );
  });

  it('gives each vehicle its own slot, nearest first, until the depot is full', () => {
    const { s, line, depotId } = withDepot(100);
    const { slots, unplaced } = assignStabling(s, 'tram', new Map([[line.id, 5]]));
    // 30 m trams with the minimum gap: three fit on 100 m.
    expect(slots.size + unplaced).toBe(5);
    expect(slots.size).toBe(3);
    const fr = [...slots.values()].map((x) => x.fraction);
    expect(new Set(fr).size).toBe(fr.length);
    expect([...slots.values()].every((x) => x.trackId === depotId && x.out.length > 0)).toBe(true);
  });

  it('trains out of service at night stand in their depot slots', () => {
    const { s, depotId } = withDepot(400);
    const models = buildScenarioModels(s, { timetable: { peakPeriods: PLACEHOLDER_PEAK_PERIODS } });
    const m = models[0]!;
    expect(m.stabling?.size).toBeGreaterThan(0);
    const night = vehicleStates(m, 3 * 3600);
    const depot = s.trackNetwork.tracks.find((t) => t.id === depotId)!;
    const west = Math.min(
      ...depot.points.map((p) => p[0]),
      s.trackNetwork.nodes.find((n) => n.id === depot.toNodeId)!.position[0],
    );
    const parked = night.filter((v) => v.state === 'parked' && v.position[0] < xy(-1, 0)[0]);
    expect(parked.length).toBe(m.stabling!.size);
    expect(west).toBeLessThan(xy(-100, 0)[0]);
    // Before the first departure trains drive out of the depot along the tracks.
    const start = m.timetable![0]!;
    let leaving = 0;
    for (let t = start - 60; t < start; t += 0.5)
      leaving += vehicleStates(m, t).filter((v) => v.state === 'deadhead').length;
    expect(leaving).toBeGreaterThan(0);
  });
});
