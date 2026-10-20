import { describe, expect, it } from 'vitest';
import type { LngLat } from '../domain/schema';
import { createLine, emptyScenario, updateLine } from '../domain/network';
import { toLocalMetres } from '../geo/geometry';
import { buildLineModel, measurePath, vehicleStates } from './engine';
import { consistFootprint, consistShape } from './footprint';
import { xy } from '../test/fixtures/tracks';

const shape = { unitLengthM: 30, units: 3, widthM: 2.65, placeholder: false };

function sizeOf(ring: LngLat[]) {
  const ref = ring[0]!;
  const p = ring.map((c) => toLocalMetres(c, ref));
  const side = (a: number, b: number) => Math.hypot(p[b]![0] - p[a]![0], p[b]![1] - p[a]![1]);
  return { width: side(0, 3), length: side(0, 1) };
}

describe('vehicles drawn to scale', () => {
  it('draws one rectangle per unit, centred on the vehicle position', () => {
    const path = measurePath([xy(0, 0), xy(1000, 0)], false);
    const units = consistFootprint(path, 500, 1, shape, false);
    expect(units).toHaveLength(3);
    for (const u of units) {
      const { width, length } = sizeOf(u);
      expect(width).toBeCloseTo(2.65, 1);
      expect(length).toBeCloseTo(30, 0);
    }
    // The lead unit is ahead of the centre in the travel direction.
    const leadX = toLocalMetres(units[0]![1]!, xy(0, 0))[0];
    const lastX = toLocalMetres(units[2]![0]!, xy(0, 0))[0];
    expect(leadX).toBeCloseTo(545, 0);
    expect(lastX).toBeCloseTo(455, 0);
    const back = consistFootprint(path, 500, -1, shape, false);
    expect(toLocalMetres(back[0]![1]!, xy(0, 0))[0]).toBeCloseTo(455, 0);
  });

  it('bends through a curve unit by unit and wraps on a ring', () => {
    const corner = measurePath([xy(0, 0), xy(100, 0), xy(100, 100)], false);
    const units = consistFootprint(corner, 100, 1, shape, false);
    expect(units).toHaveLength(3);
    const ring = measurePath([xy(0, 0), xy(200, 0), xy(200, 200), xy(0, 200)], true);
    expect(consistFootprint(ring, 10, 1, shape, true)).toHaveLength(3);
  });

  it('uses the vehicle profile, with placeholders where it gives no width', () => {
    let s = emptyScenario();
    const c = createLine(s, { coordinates: [xy(0, 0), xy(2000, 0)], mode: 'bus' });
    s = c.scenario;
    const v = s.vehicleTypes.find((x) => x.id === c.line.vehicleTypeId)!;
    const sh = consistShape(c.line, s);
    expect(sh.unitLengthM).toBe(v.lengthM);
    expect(sh.placeholder).toBe(v.widthM == null);
    s = updateLine(s, c.line.id, { consistUnits: 2 });
    expect(consistShape(s.lines[0]!, s).units).toBe(2);
    const model = buildLineModel(s.lines[0]!, s)!;
    const moving = vehicleStates(model, 600).find((x) => x.footprint.length);
    expect(moving?.footprint).toHaveLength(2);
  });
});
