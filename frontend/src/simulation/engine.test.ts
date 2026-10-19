import { describe, expect, it } from 'vitest';
import type { Scenario } from '../domain/schema';
import { addStationOnLine, createLine, emptyScenario, updateLine } from '../domain/network';
import { buildLineModel, SimulationClock, vehicleStates } from './engine';

function scenarioWith(direction: 'one_way' | 'bidirectional', ring = false) {
  let s: Scenario = emptyScenario();
  const coords: [number, number][] = ring
    ? [
        [0, 0],
        [0.01, 0],
        [0.01, 0.01],
        [0, 0.01],
      ]
    : [
        [0, 0],
        [0.02, 0],
      ];
  const r = createLine(s, { coordinates: coords, mode: 'tram', ring });
  s = r.scenario;
  for (const p of ring
    ? ([
        [0.005, 0],
        [0.01, 0.005],
      ] as [number, number][])
    : ([
        [0, 0],
        [0.01, 0],
        [0.02, 0],
      ] as [number, number][])) {
    s = addStationOnLine(s, r.line.id, p).scenario;
  }
  s = updateLine(s, r.line.id, { direction });
  return { s, line: s.lines[0]! };
}

describe('simulation engine', () => {
  it('bidirectional lines reverse at terminals', () => {
    const { s, line } = scenarioWith('bidirectional');
    const m = buildLineModel(line, s, { layoverS: 60 })!;
    const directions = new Set<number>();
    for (let t = 0; t < m.cycleS; t += 30) directions.add(vehicleStates(m, t)[0]!.direction);
    expect(directions).toEqual(new Set([1, -1]));
    // Back at the start after a full cycle.
    expect(vehicleStates(m, m.cycleS)[0]!.chainageM).toBeCloseTo(vehicleStates(m, 0)[0]!.chainageM, 3);
  });

  it('one-way lines only run forward', () => {
    const { s, line } = scenarioWith('one_way');
    const m = buildLineModel(line, s)!;
    for (let t = 0; t < m.cycleS; t += 20) {
      for (const v of vehicleStates(m, t)) expect(v.direction).toBe(1);
    }
  });

  it('circular lines wrap around without reversing', () => {
    const { s, line } = scenarioWith('bidirectional', true);
    const m = buildLineModel(line, s)!;
    expect(m.phases.every((p) => p.direction === 1)).toBe(true);
    expect(m.phases.some((p) => p.kind === 'layover')).toBe(false);
  });

  it('dwells at stations', () => {
    const { s, line } = scenarioWith('bidirectional');
    const m = buildLineModel(line, s)!;
    const dwell = m.phases.filter((p) => p.kind === 'dwell');
    expect(dwell.length).toBe(6); // three stops each way
    expect(dwell[0]!.durationS).toBe(line.dwellTimeS);
  });

  it('runs several vehicles spaced by the headway', () => {
    const { s, line } = scenarioWith('bidirectional');
    const m = buildLineModel(line, s)!;
    expect(m.vehicleCount).toBe(Math.ceil(m.cycleS / m.headwayS));
    expect(vehicleStates(m, 100)).toHaveLength(m.vehicleCount);
  });

  it('is a pure function of simulated time (frame-rate independent)', () => {
    const { s, line } = scenarioWith('bidirectional');
    const m = buildLineModel(line, s)!;
    expect(vehicleStates(m, 1234.5)).toEqual(vehicleStates(m, 1234.5));
  });

  it('clock supports pause, resume, reset and speed multiplier', () => {
    let now = 0;
    const clock = new SimulationClock(() => now);
    clock.multiplier = 10;
    clock.start();
    now = 1000;
    expect(clock.tick()).toBeCloseTo(10);
    clock.pause();
    now = 5000;
    expect(clock.tick()).toBeCloseTo(10);
    clock.start();
    clock.setMultiplier(60);
    now = 6000;
    expect(clock.tick()).toBeCloseTo(70);
    clock.reset();
    expect(clock.timeS).toBe(0);
  });
});
