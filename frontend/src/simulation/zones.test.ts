import { describe, expect, it } from 'vitest';
import type { Scenario } from '../domain/schema';
import { OccupancyLedger } from './occupancy';
import { buildScenarioModels, tripPhases, vehicleStates, type VehicleState } from './engine';
import type { LngLat } from '../domain/schema';
import { toLocalMetres } from '../geo/geometry';

/** Smallest distance (m) between the centre lines of two trains' sections. */
function gapM(a: LngLat[][], b: LngLat[][]): number {
  const ref: LngLat = [13.4, 52.52];
  const line = (rings: LngLat[][]) =>
    rings.flatMap((r) => {
      const [p0, p1, p2, p3] = r.map((c) => toLocalMetres(c, ref)) as [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
      ];
      const rear = [(p0[0] + p3[0]) / 2, (p0[1] + p3[1]) / 2];
      const front = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
      return Array.from({ length: 11 }, (_, i) => [
        rear[0]! + ((front[0]! - rear[0]!) * i) / 10,
        rear[1]! + ((front[1]! - rear[1]!) * i) / 10,
      ]);
    });
  const pa = line(a);
  const pb = line(b);
  let d = Infinity;
  for (const p of pa) for (const q of pb) d = Math.min(d, Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!));
  return d;
}
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
    // The waiting train stops short of the crossing, and no two trains ever stand on it
    // together (chainage is the middle of the train, so it covers ± half its length).
    const at = models.map((m) => {
      const z = m.spans.forward.find((sp) => sp.resourceId === `zone:${node.id}`)!;
      return { m, nodeM: (z.fromM + z.toM) / 2, half: m.vehicleLengthM / 2 };
    });
    for (let t = 0; t < 3600; t += 2) {
      const onIt = at.filter(({ m, nodeM, half }) =>
        vehicleStates(m, t).some((v) => Math.abs(v.chainageM - nodeM) < half),
      );
      expect(onIt.length, `t = ${t}`).toBeLessThanOrEqual(1);
    }
  });
});

describe('waiting at a junction', () => {
  it('a train waits with its front short of the junction and never touches another train', () => {
    // Two services merge at (300, 0) onto one track to the east.
    let s: Scenario = emptyScenario();
    s = createTracks(s, { points: [xy(0, 0), xy(300, 0)], mode: 'tram', double: false }).scenario;
    s = createTracks(s, { points: [xy(300, 0), xy(700, 0)], mode: 'tram', double: false }).scenario;
    s = createTracks(s, { points: [xy(0, -150), xy(300, 0)], mode: 'tram', double: false }).scenario;
    const node = s.trackNetwork.nodes.find((n) => nodeEnds(s.trackNetwork, n.id).length === 3)!;
    expect(node).toBeDefined();
    const station = (at: [number, number]) => {
      const r = addStationOnTracks(s, xy(at[0], at[1]), { mode: 'tram' });
      s = r.scenario;
      return r.station!.id;
    };
    const a = station([20, 0]);
    const b = station([20, -140]);
    const end = station([680, 0]);
    for (const from of [a, b]) {
      const pos = [from, end].map((id) => s.stations.find((x) => x.id === id)!.position);
      const c = createLine(s, { coordinates: pos, mode: 'tram' });
      s = updateLine(c.scenario, c.line.id, { direction: 'one_way' });
      s = setServiceStops(s, c.line.id, [from, end]);
    }
    expect(s.lines.every((l) => l.alignment.kind === 'track' && l.alignment.status === 'routed')).toBe(true);
    const models = buildScenarioModels(s);
    let waited = false;
    for (let t = 0; t < 3600; t += 1) {
      const trains = models.map((m) => vehicleStates(m, t));
      for (const v of trains.flat()) if (v.state === 'waiting') waited = true;
      const [x, y] = trains as [VehicleState[], VehicleState[]];
      for (const p of x)
        for (const q of y) expect(gapM(p.footprint, q.footprint), `t = ${t}`).toBeGreaterThan(1);
    }
    expect(waited).toBe(true);
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
