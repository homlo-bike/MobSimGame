import { describe, expect, it } from 'vitest';
import { emptyScenario } from './network';
import { regionFromPlace, regionTypeForPlace } from './regionLookup';
import { updateRegion } from './regions';

const square = {
  type: 'Polygon',
  coordinates: [
    [
      [13.4, 52.5],
      [13.41, 52.5],
      [13.41, 52.51],
      [13.4, 52.51],
      [13.4, 52.5],
    ],
  ],
};
const kreuzberg = {
  label: 'Kreuzberg, Berlin, Deutschland',
  kind: 'suburb',
  osmType: 'relation',
  osmId: 55764,
  hierarchy: ['Berlin', 'Deutschland'],
};

describe('regions from a place lookup', () => {
  it('maps place kinds to region types', () => {
    expect(regionTypeForPlace('suburb')).toBe('neighbourhood');
    expect(regionTypeForPlace('city')).toBe('municipality');
    expect(regionTypeForPlace('city_district')).toBe('district');
    expect(regionTypeForPlace('peak')).toBe('user_defined');
  });

  it('creates a region from the boundary with provenance and no statistics', () => {
    const res = regionFromPlace(emptyScenario(), kreuzberg, { geometry: square }, '2026-10-20T12:00:00Z');
    expect(res.outcome).toBe('created');
    if (res.outcome !== 'created') return;
    expect(res.region.name).toBe('Kreuzberg');
    expect(res.region.type).toBe('neighbourhood');
    expect(res.region.source.status).toBe('imported');
    expect(res.region.source.sourceUrl).toBe('https://www.openstreetmap.org/relation/55764');
    expect(res.region.metadata.Within).toBe('Berlin › Deutschland');
    expect(res.region.attributes).toEqual({});
  });

  it('never invents a boundary', () => {
    const sc = emptyScenario();
    const point = regionFromPlace(sc, kreuzberg, { geometry: { type: 'Point', coordinates: [1, 2] } }, 'x');
    expect(point.outcome).toBe('no_boundary');
    expect(regionFromPlace(sc, kreuzberg, { geometry: null }, 'x').outcome).toBe('no_boundary');
    expect(point.scenario.regions).toHaveLength(0);
  });

  it('never overwrites a region the user already has from the same place', () => {
    const first = regionFromPlace(emptyScenario(), kreuzberg, { geometry: square }, 'x');
    if (first.outcome !== 'created') throw new Error('not created');
    const edited = updateRegion(first.scenario, first.region.id, { name: 'My Kreuzberg' });
    const again = regionFromPlace(edited, kreuzberg, { geometry: square }, 'y');
    expect(again.outcome).toBe('exists');
    expect(again.scenario).toBe(edited);
    expect(again.scenario.regions).toHaveLength(1);
    expect(again.scenario.regions[0]!.name).toBe('My Kreuzberg');
  });
});
