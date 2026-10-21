import { describe, expect, it } from 'vitest';
import { createLine, emptyScenario, updateLine } from './network';
import { syncFleet, type FleetChanges } from './fleetRegistry';
import { addDepot, setDepotLinks } from './depots';
import { spareRanker, railDepotReach } from './reassign';
import { createTracks, updateTrack } from './tracks';
import { railLine, xy } from '../test/fixtures/tracks';
import { validateDepots, validateStabling } from '../validation/validate';
import { buildScenarioModels, vehicleStates } from '../simulation/engine';
import { PLACEHOLDER_PEAK_PERIODS, type DepotLink, type LngLat, type Scenario } from './schema';
import { applySettings, DEFAULT_NOTIFICATION_SETTINGS } from '../store/notificationSettings';

const routed = (coordinates: LngLat[]): DepotLink => ({
  status: 'routed',
  coordinates,
  lengthM: null,
  durationS: 60,
  provider: 'test',
  routedAt: null,
  message: '',
});

/** Two bus lines; a second bus type (double decker) besides the 12 m bus. */
function twoLines() {
  let s = emptyScenario();
  const base = s.vehicleTypes.find((v) => v.id === 'vt-bus-12m')!;
  s = {
    ...s,
    vehicleTypes: [...s.vehicleTypes, { ...base, id: 'vt-dd', name: 'Double decker', lengthM: 11 }],
  };
  const a = createLine(s, { coordinates: [xy(0, 0), xy(3000, 0)], mode: 'bus' });
  const b = createLine(a.scenario, { coordinates: [xy(0, 2000), xy(3000, 2000)], mode: 'bus' });
  s = updateLine(b.scenario, b.line.id, { vehicleTypeId: 'vt-dd' });
  return { s, l1: a.line.id, l2: b.line.id };
}

describe('reassigning surplus vehicles (F8)', () => {
  it('uses a surplus vehicle only for a line that takes its type (main or accepted)', () => {
    const { s: s0, l1, l2 } = twoLines();
    let s = syncFleet(
      s0,
      new Map([
        [l1, 2],
        [l2, 0],
      ]),
    );
    s = syncFleet(
      s,
      new Map([
        [l1, 1],
        [l2, 0],
      ]),
    ); // BUS-002 (12 m) becomes surplus
    const changes: FleetChanges = { reassigned: [], added: [] };
    const dd = syncFleet(
      s,
      new Map([
        [l1, 1],
        [l2, 1],
      ]),
      { changes },
    );
    expect(changes.reassigned).toEqual([]);
    expect(changes.added.map((v) => v.vehicleTypeId)).toEqual(['vt-dd']);
    // L2 accepts 12 m buses too: the surplus one fills the place, no new vehicle.
    const accepting = updateLine(s, l2, { acceptedVehicleTypeIds: ['vt-bus-12m'] });
    const c2: FleetChanges = { reassigned: [], added: [] };
    syncFleet(
      accepting,
      new Map([
        [l1, 1],
        [l2, 1],
      ]),
      { changes: c2 },
    );
    expect(c2.reassigned.map((r) => r.vehicle.code)).toEqual(['BUS-002']);
    expect(c2.added).toEqual([]);
    expect(dd.fleet).toHaveLength(3);
  });

  it('a vehicle whose type its line no longer takes becomes surplus and remembers the line', () => {
    const { s: s0, l1 } = twoLines();
    const s = syncFleet(s0, new Map([[l1, 1]]));
    const changed = syncFleet(updateLine(s, l1, { vehicleTypeId: 'vt-dd' }), new Map([[l1, 1]]));
    const old = changed.fleet.find((v) => v.vehicleTypeId === 'vt-bus-12m')!;
    expect(old.status).toBe('surplus');
    expect(old.lastLineId).toBe(l1);
    expect(old.lastPosition).toEqual(xy(0, 0));
  });

  it('takes the surplus vehicle of the nearest depot that can reach the line, else the next', () => {
    const { s: s0, l1, l2 } = twoLines();
    let s = updateLine(s0, l2, { vehicleTypeId: 'vt-bus-12m' });
    const near = addDepot(s, 'bus', xy(-300, 0));
    const far = addDepot(near.scenario, 'bus', xy(-3000, 0));
    s = { ...far.scenario, depots: far.scenario.depots.map((d) => ({ ...d, capacityOverride: 1 })) };
    s = syncFleet(
      s,
      new Map([
        [l1, 0],
        [l2, 2],
      ]),
    );
    s = syncFleet(
      s,
      new Map([
        [l1, 0],
        [l2, 0],
      ]),
    ); // two surplus buses, one per depot
    // Only the far depot has a street route to L1.
    s = setDepotLinks(s, far.depot.id, l1, {
      toLine: routed([xy(-3000, 0), xy(0, 0)]),
      fromLine: routed([xy(0, 0), xy(-3000, 0)]),
    });
    const rank = spareRanker(s);
    const changes: FleetChanges = { reassigned: [], added: [] };
    syncFleet(
      s,
      new Map([
        [l1, 1],
        [l2, 0],
      ]),
      { rank, changes },
    );
    const atFar = [...s.fleet].find(
      (v) =>
        rank(
          v,
          s.lines.find((l) => l.id === l1)!,
        ).reachable,
    )!;
    expect(changes.reassigned).toHaveLength(1);
    expect(changes.reassigned[0]!.vehicle.code).toBe(atFar.code);
    expect(changes.reassigned[0]!.reachable).toBe(true);
    // No depot reaches the line: still the nearest, but reported as unreachable.
    const none: Scenario = { ...s, depots: s.depots.map((d) => ({ ...d, links: {} })) };
    const c2: FleetChanges = { reassigned: [], added: [] };
    syncFleet(
      none,
      new Map([
        [l1, 1],
        [l2, 0],
      ]),
      { rank: spareRanker(none), changes: c2 },
    );
    expect(c2.reassigned[0]!.reachable).toBe(false);
    expect(
      validateDepots(
        syncFleet(
          none,
          new Map([
            [l1, 1],
            [l2, 0],
          ]),
        ),
      ).some((f) => f.severity === 'error'),
    ).toBe(true);
  });
});

describe('vehicles never vanish (F8)', () => {
  it('a spare without a depot slot waits before the start of its line', () => {
    const { s: s0, l1 } = twoLines();
    const s = syncFleet(updateLine(s0, l1, { direction: 'bidirectional' }), new Map([[l1, 6]]));
    const m = buildScenarioModels(s, { timetable: { peakPeriods: PLACEHOLDER_PEAK_PERIODS } })[0]!;
    const all = vehicleStates(m, 12 * 3600);
    expect(new Set(all.map((v) => v.id))).toEqual(new Set(m.vehicleCodes));
  });

  it('an error when trains cannot reach their first stop from any depot track', () => {
    const { s: s0, line } = railLine([xy(0, 0), xy(2000, 0)], 'tram', [xy(0, 0), xy(2000, 0)], {
      double: false,
    });
    let s = syncFleet(s0, new Map([[line.id, 2]]));
    const before = new Set(s.trackNetwork.tracks.map((t) => t.id));
    // A depot track that is not connected to the line.
    s = createTracks(s, { points: [xy(0, 500), xy(-400, 500)], mode: 'tram', double: false }).scenario;
    const depot = s.trackNetwork.tracks.find((t) => !before.has(t.id))!;
    s = updateTrack(s, depot.id, { usage: 'depot' });
    expect(railDepotReach(s, s.lines[0]!).reachable).toBe(false);
    expect(
      validateStabling(s).some((f) => f.id === `depot-unreachable-${line.id}` && f.severity === 'error'),
    ).toBe(true);
  });
});

describe('notification settings', () => {
  it('pop-up and keep per severity; errors are always kept', () => {
    const off = {
      info: { popup: false, keep: false },
      warning: { popup: true, keep: false },
      error: { popup: false, keep: false },
    };
    expect(applySettings(off, 'success')).toEqual({ popup: false, keep: false });
    expect(applySettings(off, 'warning')).toEqual({ popup: true, keep: false });
    expect(applySettings(off, 'error')).toEqual({ popup: false, keep: true });
    expect(applySettings(DEFAULT_NOTIFICATION_SETTINGS, 'info')).toEqual({ popup: true, keep: true });
  });
});
