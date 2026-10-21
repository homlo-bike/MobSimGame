import { describe, expect, it } from 'vitest';
import type { Scenario } from '../domain/schema';
import { buildLineModel, tripPhases, vehicleStates } from './engine';
import { railLine, xy } from '../test/fixtures/tracks';
import { setNodeLevel } from '../domain/ramps';

// Test values for a light vehicle (not a real model).
function withPhysics(s: Scenario, lineId: string, patch: Record<string, number | null> = {}): Scenario {
  const line = s.lines.find((l) => l.id === lineId)!;
  return {
    ...s,
    vehicleTypes: s.vehicleTypes.map((v) =>
      v.id === line.vehicleTypeId
        ? {
            ...v,
            massT: 40,
            tractionPowerKw: 500,
            startingTractiveEffortKn: 50,
            davisAKn: 0.8,
            davisBKnPerMs: 0.01,
            davisCKnPerMs2: 0.006,
            ...patch,
          }
        : v,
    ),
  };
}

function setup() {
  const { s, line } = railLine([xy(0, 0), xy(3000, 0)], 'tram', [xy(0, 0), xy(1500, 0), xy(3000, 0)], {
    double: false,
  });
  return { s, line };
}

describe('simulation with train physics', () => {
  it('uses physics envelopes for every run when the vehicle gives mass and power', () => {
    const { s, line } = setup();
    const sp = withPhysics(s, line.id);
    const m = buildLineModel(sp.lines[0]!, sp)!;
    expect(m.physics).not.toBeNull();
    const runs = tripPhases(m, m.services[0]!, 0).filter((p) => p.kind === 'run');
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((p) => p.kind === 'run' && p.envelope)).toBe(true);
    // Constant rates without mass or power.
    expect(buildLineModel(s.lines[0]!, s)!.physics).toBeNull();
  });

  it('is slower with less power and moves continuously in time', () => {
    const { s, line } = setup();
    const strong = withPhysics(s, line.id);
    const weak = withPhysics(s, line.id, { tractionPowerKw: 100 });
    // Running time only: waits for trains on the single track depend on the timetable.
    const running = (sc: Scenario) => {
      const m = buildLineModel(sc.lines[0]!, sc)!;
      return tripPhases(m, m.services[0]!, 0)
        .filter((p) => p.kind === 'run')
        .reduce((x, p) => x + p.durationS, 0);
    };
    expect(running(weak)).toBeGreaterThan(running(strong));
    const m = buildLineModel(strong.lines[0]!, strong)!;
    let last = -1;
    for (let t = 0; t < 60; t += 2) {
      const v = vehicleStates(m, t).find((x) => x.id.endsWith('t0'))!;
      expect(v.chainageM).toBeGreaterThanOrEqual(last - 1e-6);
      last = v.chainageM;
    }
  });

  it('climbs a ramp more slowly than it runs on the level', () => {
    const { s, line } = setup();
    const flat = withPhysics(s, line.id, { tractionPowerKw: 150 });
    const end = flat.trackNetwork.nodes.find((n) => n.position[0] > 0.02)!;
    // The far end is elevated: the service climbs over the whole line.
    const raised = setNodeLevel(flat, end.id, 1);
    const tFlat = buildLineModel(flat.lines[0]!, flat)!;
    const tRamp = buildLineModel(raised.lines[0]!, raised)!;
    const out = (m: NonNullable<ReturnType<typeof buildLineModel>>) =>
      tripPhases(m, m.services[0]!, 0)
        .filter((p) => p.kind === 'run' && p.direction === 1)
        .reduce((x, p) => x + p.durationS, 0);
    expect(out(tRamp)).toBeGreaterThan(out(tFlat));
  });
});
