import { describe, expect, it } from 'vitest';
import type { Scenario } from '../domain/schema';
import { buildScenarioModels, tripPhases, vehicleStates } from './engine';
import { createLine, emptyScenario, updateLine } from '../domain/network';
import { addStationOnTracks, setServiceStops } from '../domain/serviceRouting';
import { createTracks, nodeEnds } from '../domain/tracks';
import { clearanceDistanceM } from '../domain/clearancePoints';
import { signalOverlapM } from '../domain/trackParameters';
import { xy } from '../test/fixtures/tracks';

/** Two services merging at (300, 0) onto one track to the east, with a stop just after the junction. */
function merge(stopAfterJunction: boolean) {
  let s: Scenario = emptyScenario();
  s = createTracks(s, { points: [xy(0, 0), xy(300, 0)], mode: 'tram', double: false }).scenario;
  s = createTracks(s, { points: [xy(300, 0), xy(900, 0)], mode: 'tram', double: false }).scenario;
  s = createTracks(s, { points: [xy(0, -150), xy(300, 0)], mode: 'tram', double: false }).scenario;
  const node = s.trackNetwork.nodes.find((n) => nodeEnds(s.trackNetwork, n.id).length === 3)!;
  const station = (at: [number, number]) => {
    const r = addStationOnTracks(s, xy(at[0], at[1]), { mode: 'tram' });
    s = r.scenario;
    return r.station!.id;
  };
  const a = station([20, 0]);
  const b = station([20, -140]);
  // A stop whose platform starts right after the junction: a train standing there occupies
  // the section beyond the junction.
  const mid = stopAfterJunction ? station([335, 0]) : null;
  const end = station([880, 0]);
  for (const from of [a, b]) {
    const ids = [from, ...(mid ? [mid] : []), end];
    const pos = ids.map((id) => s.stations.find((x) => x.id === id)!.position);
    const c = createLine(s, { coordinates: pos, mode: 'tram' });
    s = updateLine(c.scenario, c.line.id, { direction: 'one_way', dwellTimeS: 60 });
    s = setServiceStops(s, c.line.id, ids);
  }
  return { s, node };
}

describe('clearance points', () => {
  it('lie where the converging tracks are the marker spacing apart', () => {
    const { s, node } = merge(false);
    const net = s.trackNetwork;
    const branch = nodeEnds(net, node.id).find((e) => {
      const t = net.tracks.find((x) => x.id === e.trackId)!;
      return t.points.length === 0 && net.nodes.find((n) => n.id === t.fromNodeId)!.position[1] < 0;
    })!;
    // Straight tracks at angle θ: the spacing is reached at s = 3.5 / sin θ (θ = atan(150 / 300)).
    const expected = 3.5 / Math.sin(Math.atan2(150, 300));
    expect(clearanceDistanceM(net, node.id, branch, 3.5)).toBeGreaterThanOrEqual(Math.floor(expected));
    expect(clearanceDistanceM(net, node.id, branch, 3.5)).toBeLessThanOrEqual(Math.ceil(expected) + 1);
  });

  it('signalled trains keep the overlap for their speed', () => {
    const net = emptyScenario().trackNetwork;
    expect(signalOverlapM(net, 30)).toBe(0);
    expect(signalOverlapM(net, 40)).toBe(50);
    expect(signalOverlapM(net, 60)).toBe(100);
    expect(signalOverlapM(net, 80)).toBe(200);
  });
});

describe('route setting at junctions', () => {
  it('a train waits clear of the junction while the section beyond it is occupied', () => {
    const { s, node } = merge(true);
    expect(s.lines.every((l) => l.alignment.kind === 'track' && l.alignment.status === 'routed')).toBe(true);
    const models = buildScenarioModels(s);
    const zones = models.map((m) => m.spans.forward.find((sp) => sp.resourceId === `zone:${node.id}`)!);
    let atJunction = 0;
    for (const [k, m] of models.entries())
      for (let j = 0; j < 6; j++)
        for (const p of tripPhases(m, m.services[0]!, j))
          if (p.kind === 'occupied') {
            const z = zones[k]!;
            // Never inside the junction zone: before it, or past it (waiting for a platform).
            expect(p.chainageM <= z.fromM + 1e-6 || p.chainageM >= z.toM - 1e-6).toBe(true);
            if (p.chainageM <= z.fromM + 1e-6) atJunction++;
          }
    // The train behind waits before the junction while the one ahead stands at the stop beyond it.
    expect(atJunction).toBeGreaterThan(0);
    // And no two trains ever touch.
    for (let t = 0; t < 3600; t += 1) {
      const [x, y] = models.map((m) => vehicleStates(m, t));
      for (const p of x!)
        for (const q of y!)
          for (const ra of p.footprint)
            for (const rb of q.footprint)
              expect(
                Math.min(...ra.flatMap((c) => rb.map((d) => Math.hypot(c[0] - d[0], c[1] - d[1])))),
                `t = ${t}`,
              ).toBeGreaterThan(0);
    }
  });

  it('a train may follow one running the same way beyond the junction at a safe distance', () => {
    const { s, node } = merge(false);
    const models = buildScenarioModels(s);
    // The second train waits for the junction only while the first holds it, not until
    // the first has cleared the whole section beyond.
    const atJunction = models.flatMap((m) => {
      const z = m.spans.forward.find((sp) => sp.resourceId === `zone:${node.id}`)!;
      return tripPhases(m, m.services[0]!, 2).filter(
        (p) => p.kind === 'occupied' && p.chainageM <= z.fromM + 1e-6,
      );
    });
    const total = atJunction.reduce((x, p) => x + p.durationS, 0);
    const first = models[0]!;
    const shared = first.spans.forward.find(
      (sp) => (sp.resourceId.startsWith('track:') || sp.resourceId.startsWith('block:')) && sp.fromM > 200,
    )!;
    expect(total).toBeLessThan(first.speedAt(shared.fromM, shared.toM));
    expect(node).toBeDefined();
  });
});
