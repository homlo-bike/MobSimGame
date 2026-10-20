import { describe, expect, it } from 'vitest';
import type { LngLat, Scenario } from './schema';
import { addStationOnLine, createLine, emptyScenario, updateLine } from './network';
import {
  addSignals,
  applySignalDefaults,
  isGreen,
  offsetFor,
  signalSearchPaths,
  updateSignal,
} from './signals';
import { buildLineModel, roundTripS, tripPhases } from '../simulation/engine';

function tramScenario(): { s: Scenario; id: string } {
  let s = emptyScenario();
  const r = createLine(s, {
    coordinates: [
      [0, 0],
      [0.02, 0],
    ],
    mode: 'tram',
  });
  s = r.scenario;
  for (const p of [
    [0, 0],
    [0.02, 0],
  ] as LngLat[])
    s = addStationOnLine(s, r.line.id, p).scenario;
  return { s, id: r.line.id };
}

describe('traffic signals', () => {
  it('adds OSM signals once with the assumed timings and spread offsets', () => {
    const { s } = tramScenario();
    const found = [
      { id: 'node/1', position: [0.005, 0] as LngLat },
      { id: 'node/2', position: [0.01, 0] as LngLat },
    ];
    const once = addSignals(s, found);
    const twice = addSignals(once, found);
    expect(twice.trafficSignals).toHaveLength(2);
    const sig = once.trafficSignals[0]!;
    expect(sig).toMatchObject({ ref: 'node/1', cycleS: 90, greenS: 45, timingStatus: 'demonstration' });
    expect(sig.offsetS).toBe(offsetFor('node/1', 90));
    expect(offsetFor('node/1', 90)).toBe(offsetFor('node/1', 90));
  });

  it('applies new defaults except to individually edited signals', () => {
    const { s } = tramScenario();
    let sc = addSignals(s, [
      { id: 'node/1', position: [0.005, 0] },
      { id: 'node/2', position: [0.01, 0] },
    ]);
    sc = updateSignal(sc, sc.trafficSignals[0]!.id, { greenS: 20 });
    sc = applySignalDefaults(sc, {
      ...sc.signalSettings,
      defaultCycleS: 60,
      defaultGreenS: 30,
      status: 'user_override',
    });
    expect(sc.trafficSignals[0]).toMatchObject({ cycleS: 90, greenS: 20, timingStatus: 'user_override' });
    expect(sc.trafficSignals[1]).toMatchObject({ cycleS: 60, greenS: 30 });
  });

  it('is green for the first part of each cycle', () => {
    const sig = { cycleS: 60, greenS: 20, offsetS: 10 };
    expect(isGreen(sig, 10)).toBe(true);
    expect(isGreen(sig, 31)).toBe(false);
    expect(isGreen(sig, 70)).toBe(true);
  });

  it('searches only along street-level tram and bus lines', () => {
    const { s, id } = tramScenario();
    expect(signalSearchPaths(s)).toHaveLength(1);
    const tunnel = updateLine(s, id, {
      segments: s.lines[0]!.segments.map((x) => ({ ...x, structure: 'tunnel' as const })),
    });
    expect(signalSearchPaths(tunnel)).toHaveLength(0);
  });

  it('transit signal priority shortens waits at red', () => {
    const { s, id } = tramScenario();
    const signals = [{ position: [0.01, 0] as LngLat, cycleS: 120, greenS: 30, offsetS: 0 }];
    const waits = (tsp: boolean) => {
      const line = { ...s.lines.find((l) => l.id === id)!, transitSignalPriority: tsp };
      const m = buildLineModel(line, s, { signals, signalPriorityS: 15 })!;
      let total = 0;
      for (let j = 0; j < 30; j++)
        total += tripPhases(m, m.services[0]!, j)
          .filter((p) => p.kind === 'signal')
          .reduce((a, p) => a + p.durationS, 0);
      return { total, trip: roundTripS(m) };
    };
    const without = waits(false);
    const withTsp = waits(true);
    expect(without.total).toBeGreaterThan(0);
    expect(withTsp.total).toBeLessThan(without.total);
  });
});
