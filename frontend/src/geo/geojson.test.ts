import { describe, expect, it } from 'vitest';
import { buildDemoScenario } from '../domain/demo';
import { emptyScenario, isInterchange } from '../domain/network';
import { importGeoJSON, sampledCoordinatesCsv, scenarioToGeoJSON } from './geojson';

describe('GeoJSON export', () => {
  it('exports lines, segments and stations in [lng, lat] order', () => {
    const s = buildDemoScenario();
    const fc = scenarioToGeoJSON(s, { projectName: 'Demo', fictional: true });
    const kinds = new Set(fc.features.map((f) => (f.properties as { kind: string }).kind));
    expect(kinds).toEqual(new Set(['line', 'segment', 'station']));
    const station = fc.features.find((f) => (f.properties as { kind: string }).kind === 'station')!;
    const [lng, lat] = (station.geometry as { coordinates: number[] }).coordinates;
    expect(lng).toBeCloseTo(s.stations[0]!.position[0]);
    expect(lat).toBeCloseTo(s.stations[0]!.position[1]);
    expect((fc as unknown as { mobsimgame: { coordinateOrder: string } }).mobsimgame.coordinateOrder).toMatch(
      /longitude, latitude/,
    );
  });

  it('round-trips through import with shared stations preserved', () => {
    const s = buildDemoScenario();
    const fc = JSON.parse(JSON.stringify(scenarioToGeoJSON(s, { projectName: 'Demo', fictional: true })));
    const res = importGeoJSON(emptyScenario(), fc, 'tram');
    if ('error' in res) throw new Error(res.error);
    expect(res.scenario.lines).toHaveLength(s.lines.length);
    expect(res.scenario.stations).toHaveLength(s.stations.length);
    expect(res.scenario.lines.find((l) => l.termination.kind === 'ring')).toBeTruthy();
    const interchanges = res.scenario.stations.filter((st) => isInterchange(res.scenario, st.id));
    expect(interchanges.length).toBe(s.stations.filter((st) => isInterchange(s, st.id)).length);
  });
});

describe('GeoJSON import errors', () => {
  it('rejects non-GeoJSON input', () => {
    expect(importGeoJSON(emptyScenario(), { foo: 1 }, 'tram')).toHaveProperty('error');
    expect(importGeoJSON(emptyScenario(), null, 'tram')).toHaveProperty('error');
  });

  it('explains probable [lat, lng] order instead of swapping silently', () => {
    const bad = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [52.5, 13.4],
              [52.5, 113.4],
            ],
          },
        },
      ],
    };
    const res = importGeoJSON(emptyScenario(), bad, 'tram');
    expect('error' in res && res.error).toMatch(/\[longitude, latitude\]/);
  });

  it('skips degenerate lines and far-away points with a report', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [0.01, 0],
            ],
          },
        },
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0]] } },
        { type: 'Feature', properties: { name: 'Far' }, geometry: { type: 'Point', coordinates: [1, 1] } },
        {
          type: 'Feature',
          properties: { name: 'Near' },
          geometry: { type: 'Point', coordinates: [0.005, 0.0001] },
        },
      ],
    };
    const res = importGeoJSON(emptyScenario(), fc, 'bus');
    if ('error' in res) throw new Error(res.error);
    expect(res.report.linesAdded).toBe(1);
    expect(res.report.stationsAdded).toBe(1);
    expect(res.report.skipped).toHaveLength(2);
    expect(res.scenario.lines[0]!.mode).toBe('bus');
  });
});

describe('CSV export', () => {
  it('writes sampled coordinates with a header', () => {
    const csv = sampledCoordinatesCsv(buildDemoScenario(), 500);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('line_id,line_name,chainage_m,longitude,latitude,structure');
    expect(lines.length).toBeGreaterThan(10);
    expect(lines.some((l) => l.endsWith(',tunnel'))).toBe(true);
  });
});
