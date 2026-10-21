import { describe, expect, it } from 'vitest';
import type { Scenario } from '../domain/schema';
import { OccupancyLedger } from './occupancy';
import { buildScenarioModels, tripPhases } from './engine';
import { createLine, emptyScenario, updateLine } from '../domain/network';
import { addStationOnTracks, setServiceStops } from '../domain/serviceRouting';
import { createTracks, nodeEnds } from '../domain/tracks';
import { xy } from '../test/fixtures/tracks';

describe('junction zones (routing requirements)', () => {
  it('one route at a time; the same route only keeps its separation', () => {
    const l = new OccupancyLedger();
    expect(l.reserve('zone:n', 1, false, 0, 20, 5, 'a', true, 'r1')).toBe(0);
    // Another route through the node waits until the zone is clear.
    expect(l.reserve('zone:n', 1, false, 10, 20, 5, 'b', true, 'r2')).toBe(20);
    // A train on the first route follows at the separation time.
    expect(l.reserve('zone:n', 1, false, 6, 20, 5, 'c', true, 'r1')).toBeGreaterThanOrEqual(5);
  });

  it('two services through a diamond crossing never occupy it together', () => {
    // Line 1 runs west → east along y = 0; line 2 crosses it at (300, 0), south-west → north-east.
    let s: Scenario = emptyScenario();
    s = createTracks(s, { points: [xy(0, 0), xy(600, 0)], mode: 'tram', double: false }).scenario;
    s = createTracks(s, { points: [xy(0, -150), xy(300, 0)], mode: 'tram', double: false }).scenario;
    s = createTracks(s, { points: [xy(300, 0), xy(600, 150)], mode: 'tram', double: false }).scenario;
    const node = s.trackNetwork.nodes.find((n) => nodeEnds(s.trackNetwork, n.id).length === 4)!;
    expect(node).toBeDefined();
    const station = (at: [number, number]) => {
      const r = addStationOnTracks(s, xy(at[0], at[1]), { mode: 'tram' });
      s = r.scenario;
      return r.station!.id;
    };
    const a1 = station([20, 0]);
    const a2 = station([580, 0]);
    const b1 = station([20, -140]);
    const b2 = station([580, 140]);
    for (const [from, to] of [
      [a1, a2],
      [b1, b2],
    ] as const) {
      const pos = [from, to].map((id) => s.stations.find((x) => x.id === id)!.position);
      const c = createLine(s, { coordinates: pos, mode: 'tram' });
      s = updateLine(c.scenario, c.line.id, { direction: 'one_way' });
      s = setServiceStops(s, c.line.id, [from, to]);
    }
    expect(s.lines.every((l) => l.alignment.kind === 'track' && l.alignment.status === 'routed')).toBe(true);
    const models = buildScenarioModels(s);
    for (const m of models)
      expect(m.spans.forward.some((sp) => sp.resourceId === `zone:${node.id}`)).toBe(true);
    // Both depart at the same time and reach the crossing together: one of them waits.
    const waits = models.flatMap((m) =>
      tripPhases(m, m.services[0]!, 2).filter((p) => p.kind === 'occupied'),
    );
    expect(waits.length).toBeGreaterThan(0);
  });
});

describe('operations report', () => {
  it('names the junction where vehicles wait', async () => {
    const { operationsReport, waitPlaceKind } = await import('./report');
    expect(waitPlaceKind('zone:n1')).toBe('junction');
    expect(waitPlaceKind('block:t1')).toBe('single_track');
    expect(waitPlaceKind('x:a:b:12')).toBe('crossing');
    // A single track used in both directions by one bidirectional line: trains wait for each other.
    const { railLine } = await import('../test/fixtures/tracks');
    const { s, line } = railLine([xy(0, 0), xy(3000, 0)], 'tram', [xy(0, 0), xy(1500, 0), xy(3000, 0)], {
      double: false,
    });
    const sc = updateLine(s, line.id, { direction: 'bidirectional' });
    const r = operationsReport(sc, {}, 3600);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.trips).toBeGreaterThan(0);
    expect(r.lines[0]!.waits).toBeGreaterThan(0);
    expect(r.lines[0]!.places[0]!.kind).toBe('single_track');
  });
});

describe('changing track at the ends', () => {
  it('warns when a two-direction service switches tracks without a connection', async () => {
    const { railLine } = await import('../test/fixtures/tracks');
    const { validateScenario } = await import('../validation/validate');
    const jump = (double: boolean) => {
      const { s, line } = railLine([xy(0, 0), xy(2000, 0)], 'tram', [xy(0, 0), xy(2000, 0)], { double });
      return validateScenario(s).filter(
        (f) => f.lineId === line.id && /without a track connection/.test(f.message),
      );
    };
    // Plain double track: out on one track, back on the other, no crossover at either end.
    expect(jump(true)).toHaveLength(2);
    // Single track: the train reverses on the same track.
    expect(jump(false)).toHaveLength(0);
  });
});
