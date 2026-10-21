import { describe, expect, it } from 'vitest';
import { createLine, emptyScenario } from './network';
import { deleteSurplus, lineVehicles, nextCode, syncFleet } from './fleetRegistry';
import { xy } from '../test/fixtures/tracks';

describe('fleet register', () => {
  it('adds the vehicles a line needs, makes extras surplus and never deletes on its own', () => {
    let s = emptyScenario();
    const a = createLine(s, { coordinates: [xy(0, 0), xy(2000, 0)], mode: 'tram' });
    s = a.scenario;
    s = syncFleet(s, new Map([[a.line.id, 3]]));
    expect(lineVehicles(s, a.line.id).map((v) => v.code)).toEqual(['TRM-001', 'TRM-002', 'TRM-003']);
    // Fewer needed: the last becomes surplus, still in the project.
    s = syncFleet(s, new Map([[a.line.id, 2]]));
    expect(lineVehicles(s, a.line.id)).toHaveLength(2);
    expect(s.fleet).toHaveLength(3);
    expect(s.fleet.find((v) => v.code === 'TRM-003')!.status).toBe('surplus');
    // More needed again: the surplus vehicle is used before a new one is added.
    s = syncFleet(s, new Map([[a.line.id, 4]]));
    expect(lineVehicles(s, a.line.id).map((v) => v.code)).toEqual([
      'TRM-001',
      'TRM-002',
      'TRM-003',
      'TRM-004',
    ]);
    // A deleted line's vehicles become surplus; only the user deletes them.
    s = { ...s, lines: [] };
    s = syncFleet(s, new Map());
    expect(s.fleet.every((v) => v.status === 'surplus' && v.lineId === null)).toBe(true);
    s = deleteSurplus(s, [s.fleet[0]!.id]);
    expect(s.fleet).toHaveLength(3);
    expect(nextCode(s.fleet, 'tram')).toBe('TRM-005');
    // Nothing to change: the same object.
    expect(syncFleet(s, new Map())).toBe(s);
  });
});
