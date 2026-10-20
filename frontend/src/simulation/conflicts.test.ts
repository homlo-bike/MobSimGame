import { describe, expect, it } from 'vitest';
import type { Scenario, TransportMode } from '../domain/schema';
import { createLine, emptyScenario, updateLine } from '../domain/network';
import { findConflicts } from './conflicts';
import { moveModePriority } from '../domain/modeSeparation';
import { buildLineModel, buildScenarioModels, vehicleStates, type LineSimulationModel } from './engine';

function line(s: Scenario, coords: [number, number][], mode: TransportMode, headwayMin = 3) {
  const r = createLine(s, { coordinates: coords, mode });
  const pattern = r.line.servicePatterns[0]!;
  // Same speed for every test line, so arrival times at the crossing are predictable.
  return updateLine(r.scenario, r.line.id, {
    maxSpeedKmh: 36,
    segments: r.line.segments.map((g) => ({
      ...g,
      rightOfWay: 'dedicated_track' as const,
      speedLimitKmh: null,
    })),
    servicePatterns: [{ ...pattern, peakHeadwayMin: headwayMin, offPeakHeadwayMin: headwayMin }],
  });
}

/**
 * A tram running east and a bus running north, crossing half-way at (0.01, 0.005): with the
 * same speed and headway both reach the crossing at about the same time on every trip.
 */
function crossingPair(busMode: TransportMode = 'bus') {
  let s = emptyScenario();
  s = line(
    s,
    [
      [0, 0.005],
      [0.02, 0.005],
    ],
    'tram',
  );
  s = line(
    s,
    [
      [0.01, -0.005],
      [0.01, 0.015],
    ],
    busMode,
  );
  return s;
}

/** Seconds in which vehicles of both lines are within `m` metres of the crossing at once. */
function bothNear(models: LineSimulationModel[], at: [number, number], m: number, seconds = 3600): number {
  const near = (p: [number, number]) =>
    Math.hypot((p[0] - at[0]) * 111_320 * Math.cos((at[1] * Math.PI) / 180), (p[1] - at[1]) * 110_574) < m;
  let n = 0;
  for (let t = 0; t < seconds; t++) {
    const lines = models.filter((md) => vehicleStates(md, t).some((v) => near(v.position)));
    if (lines.length >= 2) n++;
  }
  return n;
}

describe('crossings and shared streets', () => {
  it('finds crossings between any lines on the same level, also of the same mode', () => {
    const s = crossingPair();
    const { crossings } = findConflicts(s);
    expect(crossings).toHaveLength(1);
    expect(crossings[0]!.position[0]).toBeCloseTo(0.01, 6);
    expect(crossings[0]!.position[1]).toBeCloseTo(0.005, 6);
    expect(crossings[0]!.fractions[0]).toBeCloseTo(0.5, 3);
    // Two bus lines crossing.
    expect(findConflicts(crossingPair('tram')).crossings).toHaveLength(1);
    // Different levels never cross: put the tram in a tunnel.
    const tunnel = updateLine(s, s.lines[0]!.id, {
      segments: s.lines[0]!.segments.map((g) => ({ ...g, structure: 'tunnel' as const })),
    });
    expect(findConflicts(tunnel).crossings).toHaveLength(0);
  });

  it('finds bus lines sharing a street and their direction', () => {
    let s = emptyScenario();
    s = line(
      s,
      [
        [0, 0],
        [0.004, 0],
        [0.008, 0.002],
      ],
      'bus',
    );
    s = line(
      s,
      [
        [0.002, -0.002],
        [0.002, 0],
        [0.006, 0],
        [0.006, 0.003],
      ],
      'bus',
    );
    const { shared } = findConflicts(s);
    expect(shared).toHaveLength(1);
    expect(shared[0]!.sameDirection).toBe(true);
    // The shared part is about 0.002° of longitude ≈ 220 m along the first line.
    const r = shared[0]!.ranges[0]!;
    expect(r.to - r.from).toBeGreaterThan(0.15);
  });

  it('never has two vehicles in a crossing at once, and the higher mode never waits', () => {
    const s = crossingPair();
    const at: [number, number] = [0.01, 0.005];
    // Without conflict handling the two lines collide regularly.
    const alone = s.lines.map((l) => buildLineModel(l, s)!);
    expect(bothNear(alone, at, 15)).toBeGreaterThan(0);
    const models = buildScenarioModels(s);
    expect(bothNear(models, at, 15)).toBe(0);
    const tram = models.find((m) => m.lineId === s.lines[0]!.id)!;
    const bus = models.find((m) => m.lineId === s.lines[1]!.id)!;
    let tramWaits = 0;
    let busWaits = 0;
    for (let t = 0; t < 3600; t += 5) {
      tramWaits += vehicleStates(tram, t).filter((v) => v.state === 'waiting').length;
      busWaits += vehicleStates(bus, t).filter((v) => v.state === 'waiting').length;
    }
    expect(tramWaits).toBe(0);
    expect(busWaits).toBeGreaterThan(0);
  });

  it('follows the project priority order', () => {
    let s = crossingPair();
    for (let i = 0; i < 4; i++) s = moveModePriority(s, 'bus', -1);
    // Bus is now above tram: the tram waits, the bus does not.
    const order = s.modePriority!;
    expect(order.indexOf('bus')).toBeLessThan(order.indexOf('tram'));
    const models = buildScenarioModels(s);
    const waits = (id: string) => {
      const m = models.find((x) => x.lineId === id)!;
      let n = 0;
      for (let t = 0; t < 3600; t += 5) n += vehicleStates(m, t).filter((v) => v.state === 'waiting').length;
      return n;
    };
    expect(waits(s.lines[1]!.id)).toBe(0);
    expect(waits(s.lines[0]!.id)).toBeGreaterThan(0);
  });

  it('lets the first to arrive go first between vehicles of the same mode, without collisions', () => {
    const s = crossingPair('tram');
    const at: [number, number] = [0.01, 0.005];
    const alone = s.lines.map((l) => buildLineModel(l, s)!);
    expect(bothNear(alone, at, 15)).toBeGreaterThan(0);
    expect(bothNear(buildScenarioModels(s), at, 15)).toBe(0);
  });

  it('keeps buses of different lines apart on a shared street', () => {
    let s = emptyScenario();
    // Two lines joining the same east-bound street from different sides.
    s = line(
      s,
      [
        [0, 0.002],
        [0.002, 0],
        [0.012, 0],
      ],
      'bus',
    );
    s = line(
      s,
      [
        [0.0035, -0.0035],
        [0.002, -0.0005],
        [0.0021, 0],
        [0.012, 0],
      ],
      'bus',
    );
    const { shared } = findConflicts(s);
    expect(shared.length).toBeGreaterThan(0);
    const models = buildScenarioModels(s);
    // On the shared street (x 0.004–0.011), two buses are never closer than the following distance.
    let closest = Infinity;
    let together = 0;
    for (let t = 0; t < 3600; t += 2) {
      const on = models
        .flatMap((m) => vehicleStates(m, t))
        .filter(
          (v) =>
            v.direction === 1 &&
            Math.abs(v.position[1]) < 1e-5 &&
            v.position[0] > 0.004 &&
            v.position[0] < 0.011,
        )
        .map((v) => v.position[0] * 111_320);
      on.sort((a, b) => a - b);
      if (on.length >= 2) together++;
      for (let i = 1; i < on.length; i++) closest = Math.min(closest, on[i]! - on[i - 1]!);
    }
    expect(together).toBeGreaterThan(0);
    expect(closest).toBeGreaterThanOrEqual(15);
  });

  it('is a pure function of simulated time', () => {
    const s = crossingPair();
    const a = buildScenarioModels(s);
    const b = buildScenarioModels(s);
    // Query b in a different order and at different steps: the same states result.
    for (let t = 1800; t >= 0; t -= 37) vehicleStates(b[1]!, t);
    for (const t of [100, 900, 1700])
      expect(vehicleStates(a[1]!, t).map((v) => v.chainageM)).toEqual(
        vehicleStates(b[1]!, t).map((v) => v.chainageM),
      );
  });
});
