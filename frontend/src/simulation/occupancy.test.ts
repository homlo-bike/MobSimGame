import { describe, expect, it } from 'vitest';
import { OccupancyLedger } from './occupancy';
import { buildScenarioModels, tripPhases, vehicleStates } from './engine';
import { updateLine } from '../domain/network';
import { railLine, xy } from '../test/fixtures/tracks';

describe('occupancy ledger', () => {
  it('makes an opposing vehicle wait until the block is clear', () => {
    const l = new OccupancyLedger();
    expect(l.reserve('b', 1, true, 0, 100, 0)).toBe(0);
    expect(l.reserve('b', -1, true, 50, 100, 0)).toBe(100);
    // It fits into a gap before a later reservation.
    l.reserve('b', 1, true, 1000, 100, 0);
    expect(l.reserve('b', -1, true, 300, 100, 0)).toBe(300);
  });

  it('keeps the separation time between following vehicles and never lets one queue overtake', () => {
    const l = new OccupancyLedger();
    l.reserve('t', 1, false, 0, 100, 30, 'q');
    expect(l.reserve('t', 1, false, 10, 100, 30, 'q')).toBe(30);
    // Opposite directions do not interact on a one-way resource.
    expect(l.reserve('t', -1, false, 10, 100, 30, 'q2')).toBe(10);
    const m = new OccupancyLedger();
    m.reserve('t', 1, false, 500, 100, 30, 'q');
    expect(m.reserve('t', 1, false, 0, 100, 30, 'q')).toBe(530);
    // Another line's vehicle may run ahead if it clears the track in time.
    expect(m.reserve('t', 1, false, 0, 100, 30, 'other')).toBe(0);
  });
});

function singleTrackService(headwayMin: number) {
  const { s, line } = railLine([xy(0, 0), xy(2000, 0)], 'tram', [xy(0, 0), xy(2000, 0)], { double: false });
  const sc = updateLine(s, line.id, {
    servicePatterns: [{ ...line.servicePatterns[0]!, peakHeadwayMin: headwayMin }],
  });
  return sc;
}

describe('single-track working in the simulation', () => {
  it('never has trains of both directions inside a single-track section', () => {
    const sc = singleTrackService(4);
    const models = buildScenarioModels(sc);
    expect(models[0]!.spans.forward.some((sp) => sp.opposing)).toBe(true);
    const L = models[0]!.path.lengthM;
    for (let t = 0; t < 4 * 3600; t += 7) {
      const inside = models
        .flatMap((m) => vehicleStates(m, t))
        .filter((v) => v.chainageM > 1 && v.chainageM < L - 1 && v.state === 'running');
      expect(new Set(inside.map((v) => v.direction)).size).toBeLessThanOrEqual(1);
    }
    // Trains do wait for each other.
    const waits = [...Array(40).keys()].flatMap((j) => tripPhases(models[0]!, models[0]!.services[0]!, j));
    expect(waits.some((p) => p.kind === 'occupied')).toBe(true);
  });

  it('does not delay trains on double track', () => {
    const { s } = railLine([xy(0, 0), xy(2000, 0)], 'tram', [xy(0, 0), xy(2000, 0)]);
    const m = buildScenarioModels(s)[0]!;
    expect(m.spans.forward.every((sp) => !sp.opposing)).toBe(true);
    expect(m.returnPath).not.toBeNull();
    for (let j = 0; j < 30; j++)
      expect(tripPhases(m, m.services[0]!, j).some((p) => p.kind === 'occupied')).toBe(false);
  });

  it('is a deterministic function of simulated time, whatever order times are queried in', () => {
    const sc = singleTrackService(3);
    const a = buildScenarioModels(sc);
    const b = buildScenarioModels(sc);
    const times = [5000, 100, 2500, 7000, 40];
    const fromA = times.map((t) => a.flatMap((m) => vehicleStates(m, t)));
    const fromB = [...times]
      .reverse()
      .map((t) => b.flatMap((m) => vehicleStates(m, t)))
      .reverse();
    expect(fromA).toEqual(fromB);
  });
});
