import { describe, expect, it } from 'vitest';
import type { Scenario } from '../domain/schema';
import {
  addStationOnLine,
  createLine,
  emptyScenario,
  orderedStops,
  toggleCrossover,
  updateLine,
} from '../domain/network';
import {
  buildLineModel,
  roundTripS,
  signalWaitS,
  SimulationClock,
  tripPhases,
  vehicleStates,
  type LineSimulationModel,
} from './engine';

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

const phasesOf = (m: LineSimulationModel) => tripPhases(m, m.services[0]!, 0);

describe('simulation engine', () => {
  it('bidirectional lines reverse at terminals', () => {
    const { s, line } = scenarioWith('bidirectional');
    const m = buildLineModel(line, s, { layoverS: 60 })!;
    const directions = new Set<number>();
    const trip = roundTripS(m);
    for (let t = 0; t < trip; t += 30) for (const v of vehicleStates(m, t)) directions.add(v.direction);
    expect(directions).toEqual(new Set([1, -1]));
    // Same positions one headway later, shifted by one trip (steady service).
    const at = (t: number) => vehicleStates(m, t).map((v) => Math.round(v.chainageM));
    expect(at(1000 + m.headwayS).sort()).toEqual(at(1000).sort());
  });

  it('one-way lines only run forward', () => {
    const { s, line } = scenarioWith('one_way');
    const m = buildLineModel(line, s)!;
    for (let t = 0; t < roundTripS(m); t += 20) {
      for (const v of vehicleStates(m, t)) expect(v.direction).toBe(1);
    }
  });

  it('runs a fixed fleet: the same vehicles all the time, none vanishing at the ends', () => {
    for (const ring of [false, true]) {
      const { s, line } = scenarioWith('bidirectional', ring);
      const m = buildLineModel(line, s)!;
      expect(m.fleet).toBe(Math.ceil(roundTripS(m) / m.headwayS - 1e-6));
      const ids = new Set<string>();
      for (let t = 0; t < 4 * 3600; t += 15) {
        const vs = vehicleStates(m, t);
        expect(vs, `t = ${t}`).toHaveLength(m.fleet);
        for (const v of vs) ids.add(v.id);
      }
      expect(ids.size).toBe(m.fleet);
    }
  });

  it('circular lines wrap around without reversing', () => {
    const { s, line } = scenarioWith('bidirectional', true);
    const m = buildLineModel(line, s)!;
    expect(phasesOf(m).every((p) => p.direction === 1)).toBe(true);
    // The only layover is back at the start, waiting for the vehicle's next departure.
    const layovers = phasesOf(m).filter((p) => p.kind === 'layover');
    expect(layovers.every((p) => p.kind === 'layover' && p.chainageM === m.services[0]!.endM)).toBe(true);
  });

  it('dwells at stations', () => {
    const { s, line } = scenarioWith('bidirectional');
    const m = buildLineModel(line, s)!;
    const dwell = phasesOf(m).filter((p) => p.kind === 'dwell');
    expect(dwell.length).toBe(6); // three stops each way
    expect(dwell[0]!.durationS).toBe(line.dwellTimeS);
  });

  it('runs one vehicle per headway along the round trip', () => {
    const { s, line } = scenarioWith('bidirectional');
    const m = buildLineModel(line, s)!;
    const expected = Math.ceil(roundTripS(m) / m.headwayS);
    const n = vehicleStates(m, 5000).length;
    expect(Math.abs(n - expected)).toBeLessThanOrEqual(1);
  });

  it('is a pure function of simulated time (frame-rate independent)', () => {
    const { s, line } = scenarioWith('bidirectional');
    const m = buildLineModel(line, s)!;
    const other = buildLineModel(line, s)!;
    expect(vehicleStates(m, 1234.5)).toEqual(vehicleStates(other, 1234.5));
    expect(vehicleStates(m, 1234.5)).toEqual(vehicleStates(m, 1234.5));
  });

  it('stops vehicles at red signals and lets them pass on green', () => {
    const sig = { cycleS: 90, greenS: 40, offsetS: 0 };
    expect(signalWaitS(sig, 10)).toBe(0);
    expect(signalWaitS(sig, 50)).toBe(40);
    // Priority extends green and shortens red.
    expect(signalWaitS(sig, 45, 10)).toBe(0);
    expect(signalWaitS(sig, 60, 10)).toBe(20);
    const { s, line } = scenarioWith('bidirectional');
    const withSignal = buildLineModel(line, s, {
      signals: [{ ...sig, position: [0.005, 0.00001] }],
    })!;
    const plain = buildLineModel(line, s)!;
    const waits = [...Array(20).keys()].flatMap((j) =>
      tripPhases(withSignal, withSignal.services[0]!, j).filter((p) => p.kind === 'signal'),
    );
    expect(waits.length).toBeGreaterThan(0);
    expect(roundTripS(withSignal)).toBeGreaterThanOrEqual(roundTripS(plain));
    // A vehicle waiting at red has braked to a standstill at the stop line.
    for (let j = 0; j < 20; j++) {
      const ph = tripPhases(withSignal, withSignal.services[0]!, j);
      ph.forEach((p, i) => {
        const before = ph[i - 1];
        if (p.kind === 'signal' && before?.kind === 'run') expect(before.profile?.v1).toBe(0);
      });
    }
  });

  it('closures turn trains back at crossovers or block service without them', () => {
    const { s, line } = scenarioWith('bidirectional');
    const stops = orderedStops(line, s.stations);
    const closure = {
      lineId: line.id,
      fromStationId: stops[1]!.station.id,
      toStationId: stops[2]!.station.id,
      kind: 'turnback' as const,
    };
    const none = buildLineModel(line, s, { closures: [closure] })!;
    expect(none.services).toHaveLength(0);
    expect(none.notes.join(' ')).toMatch(/No crossover/);
    // A crossover just before the closed section lets the western part keep running.
    const withXo = toggleCrossover(s, line.id, stops[1]!.station.id, 'before');
    const m = buildLineModel(withXo.lines[0]!, withXo, { closures: [closure] })!;
    expect(m.services.map((x) => x.id)).toEqual(['west']);
    expect(m.services[0]!.endM).toBeLessThan(stops[1]!.chainageM);
  });

  it('single-track working holds trains for the opposite direction', () => {
    const { s, line } = scenarioWith('bidirectional');
    const stops = orderedStops(line, s.stations);
    let sc = toggleCrossover(s, line.id, stops[1]!.station.id, 'before');
    sc = toggleCrossover(sc, line.id, stops[2]!.station.id, 'before');
    const m = buildLineModel(sc.lines[0]!, sc, {
      closures: [
        {
          lineId: line.id,
          fromStationId: stops[1]!.station.id,
          toStationId: stops[1]!.station.id,
          kind: 'single_track',
        },
      ],
    })!;
    expect(m.services.map((x) => x.id)).toEqual(['single-track']);
    expect(phasesOf(m).filter((p) => p.kind === 'hold')).toHaveLength(2);
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
