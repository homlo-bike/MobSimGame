import { describe, expect, it } from 'vitest';
import type { LngLat, Scenario } from './schema';
import { addStationOnLine, createLine, emptyScenario } from './network';
import { addManualSignal, addSignals, describeSignal, moveSignal, signalAppliesTo } from './signals';
import { buildLineModel, tripPhases } from '../simulation/engine';
import { simulationOptions } from '../simulation/runtime';

function busScenario(): { s: Scenario; a: string; b: string } {
  let s = emptyScenario();
  const coords: LngLat[] = [
    [0, 0],
    [0.02, 0],
  ];
  const r1 = createLine(s, { coordinates: coords, mode: 'bus', alignment: 'polyline' });
  s = r1.scenario;
  const r2 = createLine(s, { coordinates: coords, mode: 'bus', alignment: 'polyline' });
  s = r2.scenario;
  for (const id of [r1.line.id, r2.line.id]) for (const p of coords) s = addStationOnLine(s, id, p).scenario;
  return { s, a: r1.line.id, b: r2.line.id };
}

const signalWaits = (s: Scenario, lineId: string) => {
  const m = buildLineModel(
    s.lines.find((l) => l.id === lineId)!,
    s,
    simulationOptions(s, []),
  )!;
  return [...Array(20).keys()].flatMap((j) =>
    tripPhases(m, m.services[0]!, j).filter((p) => p.kind === 'signal'),
  );
};

describe('manual traffic signals', () => {
  it('places, moves and describes a signal by hand', () => {
    const { s } = busScenario();
    const { scenario, signal } = addManualSignal(s, [0.01, 0]);
    expect(signal).toMatchObject({
      source: 'manual',
      confirmation: 'confirmed',
      ref: null,
      kind: 'intersection',
    });
    const moved = moveSignal(scenario, signal.id, [0.011, 0]);
    expect(moved.trafficSignals[0]!.position).toEqual([0.011, 0]);
    const described = describeSignal(moved, signal.id, {
      kind: 'pedestrian_crossing',
      controls: ['cars', 'pedestrians'],
      priority: 'extend_green',
      metadata: { owner: 'city' },
    });
    expect(described.trafficSignals[0]).toMatchObject({
      kind: 'pedestrian_crossing',
      priority: 'extend_green',
    });
    // Describing does not turn assumed timings into "your values".
    expect(described.trafficSignals[0]!.timingStatus).toBe('demonstration');
  });

  it('keeps the source, id, retrieval date, confidence and imported status of discovered signals', () => {
    const { s } = busScenario();
    const found = addSignals(s, [{ id: 'node/9', position: [0.01, 0] }], '2026-10-20T10:00:00Z');
    expect(found.trafficSignals[0]).toMatchObject({
      source: 'osm',
      ref: 'node/9',
      retrievedAt: '2026-10-20T10:00:00Z',
      confidence: 'medium',
      confirmation: 'imported',
    });
  });

  it('applies only to the attached line, and not to vehicles it does not control', () => {
    const { s, a, b } = busScenario();
    const { scenario, signal } = addManualSignal(s, [0.01, 0], { attachedTo: { kind: 'line', id: a } });
    const la = scenario.lines.find((l) => l.id === a)!;
    const lb = scenario.lines.find((l) => l.id === b)!;
    expect(signalAppliesTo(signal, la)).toBe(true);
    expect(signalAppliesTo(signal, lb)).toBe(false);
    expect(signalAppliesTo({ ...signal, attachedTo: null, controls: ['trams'] }, la)).toBe(false);
    expect(signalAppliesTo({ ...signal, attachedTo: null, controls: ['buses'] }, la)).toBe(true);
    expect(signalWaits(scenario, b)).toHaveLength(0);
  });

  it('uses a fixed approximate delay instead of the cycle when one is set', () => {
    const { s, a } = busScenario();
    const { scenario } = addManualSignal(s, [0.01, 0], { approxDelayS: 17 });
    const waits = signalWaits(scenario, a);
    expect(waits.length).toBeGreaterThan(0);
    expect(waits.every((p) => p.durationS === 17)).toBe(true);
  });
});
