import { describe, expect, it } from 'vitest';
import type { RegionGeometry } from './schema';
import { parseProject } from './schema';
import { emptyScenario } from './network';
import {
  addHole,
  calculatedDensity,
  createRegion,
  mergeRegions,
  regionAreaM2,
  regionsFromGeoJSON,
  regionsToGeoJSON,
  setRegionAttribute,
  setRegionGeometry,
  splitRegion,
  updateRegion,
} from './regions';
import { xy } from '../test/fixtures/tracks';
import { blankProject } from '../store/projectStore';

const square = (x0: number, y0: number, size: number): RegionGeometry => ({
  type: 'Polygon',
  coordinates: [[xy(x0, y0), xy(x0 + size, y0), xy(x0 + size, y0 + size), xy(x0, y0 + size), xy(x0, y0)]],
});

describe('regions', () => {
  it('computes the area in projected metres, holes subtracted', () => {
    expect(regionAreaM2(square(0, 0, 1000))).toBeCloseTo(1e6, -2);
    const { scenario, region } = createRegion(emptyScenario(), {
      geometry: square(0, 0, 1000),
      type: 'neighbourhood',
    });
    const holed = addHole(scenario, region.id, square(400, 400, 200));
    expect(holed.error).toBeNull();
    const g = holed.scenario.regions[0]!.geometry;
    expect(g.type === 'Polygon' && g.coordinates.length).toBe(2);
    expect(regionAreaM2(g)).toBeCloseTo(1e6 - 4e4, -2);
  });

  it('keeps sourced attributes and calculates density from population and area', () => {
    let { scenario, region } = createRegion(emptyScenario(), { geometry: square(0, 0, 1000) });
    scenario = setRegionAttribute(scenario, region.id, 'totalPopulation', {
      value: 5000,
      unit: 'persons',
      currency: null,
      priceYear: null,
      datasetYear: 2024,
      source: 'Census 2024',
      sourceUrl: null,
      sourceDate: null,
      resolution: 'census tract',
      status: 'observed',
      confidence: 'high',
      note: '',
    });
    region = scenario.regions[0]!;
    expect(calculatedDensity(region)).toBeCloseTo(5000, -1);
    expect(region.attributes.totalPopulation).toMatchObject({
      datasetYear: 2024,
      resolution: 'census tract',
    });
    expect(setRegionAttribute(scenario, region.id, 'totalPopulation', null).regions[0]!.attributes).toEqual(
      {},
    );
  });

  it('refuses edits of a locked region', () => {
    const { scenario, region } = createRegion(emptyScenario(), { geometry: square(0, 0, 1000) });
    const locked = updateRegion(scenario, region.id, { locked: true });
    expect(setRegionGeometry(locked, region.id, square(0, 0, 500))).toBe(locked);
    expect(addHole(locked, region.id, square(100, 100, 100)).error).toMatch(/locked/);
    expect(splitRegion(locked, region.id, [xy(500, -100), xy(500, 1100)]).error).toMatch(/locked/);
  });

  it('splits along a line without dividing numeric statistics, and merges back', () => {
    const created = createRegion(emptyScenario(), {
      geometry: square(0, 0, 1000),
      name: 'Old town',
    });
    const region = created.region;
    let scenario = created.scenario;
    scenario = setRegionAttribute(scenario, region.id, 'totalPopulation', { ...val(5000) });
    scenario = setRegionAttribute(scenario, region.id, 'landUseMix', { ...val('mixed') });
    const res = splitRegion(scenario, region.id, [xy(500, -100), xy(500, 1100)]);
    expect(res.error).toBeNull();
    expect(res.scenario.regions.map((r) => r.name)).toEqual(['Old town A', 'Old town B']);
    for (const r of res.scenario.regions) {
      expect(r.attributes.totalPopulation).toBeUndefined();
      expect(r.attributes.landUseMix?.value).toBe('mixed');
      expect(regionAreaM2(r.geometry)).toBeCloseTo(5e5, -3);
    }
    const [a, b] = res.scenario.regions;
    const merged = mergeRegions(res.scenario, a!.id, b!.id);
    expect(merged.error).toBeNull();
    expect(merged.scenario.regions).toHaveLength(1);
    expect(regionAreaM2(merged.scenario.regions[0]!.geometry)).toBeCloseTo(1e6, -3);
    expect(merged.scenario.regions[0]!.notes).toMatch(/not combined/);
    expect(splitRegion(scenario, region.id, [xy(-100, -100), xy(-50, -50)]).error).toMatch(
      /all the way across/,
    );
  });

  it('round-trips GeoJSON and keeps other properties as metadata', () => {
    const created = createRegion(emptyScenario(), {
      geometry: square(0, 0, 1000),
      name: 'Campus',
      type: 'university_campus',
    });
    const region = created.region;
    let scenario = created.scenario;
    scenario = setRegionAttribute(scenario, region.id, 'schoolEnrollment', { ...val(12000) });
    const fc = regionsToGeoJSON(scenario.regions);
    expect(fc.features[0]!.properties).toMatchObject({ name: 'Campus', regionType: 'university_campus' });
    const extra = JSON.parse(JSON.stringify(fc));
    extra.features[0].properties.district_code = 'D-7';
    extra.features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: {},
    });
    const back = regionsFromGeoJSON(emptyScenario(), extra, 'test.geojson');
    expect(back).toMatchObject({ imported: 1, skipped: 1 });
    const r = back.scenario.regions[0]!;
    expect(r).toMatchObject({
      name: 'Campus',
      type: 'university_campus',
      metadata: { district_code: 'D-7' },
    });
    expect(r.attributes.schoolEnrollment?.value).toBe(12000);
    expect(r.source.status).toBe('imported');
  });

  it('is saved with the project', () => {
    const { scenario } = createRegion(emptyScenario(), { geometry: square(0, 0, 1000) });
    const res = parseProject(
      JSON.parse(JSON.stringify({ ...blankProject(), scenarios: [scenario], activeScenarioId: scenario.id })),
    );
    expect(res.ok && res.project.scenarios[0]!.regions).toHaveLength(1);
  });
});

function val(value: number | string) {
  return {
    value,
    unit: '',
    currency: null,
    priceYear: null,
    datasetYear: null,
    source: 'test',
    sourceUrl: null,
    sourceDate: null,
    resolution: 'whole region',
    status: 'manual' as const,
    confidence: 'unknown' as const,
    note: '',
  };
}
