import { describe, expect, it } from 'vitest';
import type { LngLat, Provenance } from './schema';
import { parseProject } from './schema';
import { controlPoints, networkToProject, type NetworkData } from './examples';
import { validateScenario } from '../validation/validate';
import { routeStatus } from './alignment';

/** Test data in the shape the backend returns (not real places). */
const provenance: Provenance = {
  provider: 'test',
  dataset: 'test network',
  sourceUrl: null,
  license: 'ODbL-1.0',
  attribution: '© OpenStreetMap contributors',
  retrievedAt: null,
  coverage: 'test',
  datasetDate: null,
  spatialResolution: null,
  status: 'observed',
  limitations: [],
  cacheExpiresAt: null,
  confidence: 'medium',
};

const straight = (n: number, lat = 52.5): LngLat[] =>
  [...Array(n).keys()].map((i) => [13.4 + i * 0.001, lat] as LngLat);

function network(kind: NetworkData['kind'], mode: NetworkData['lines'][number]['mode']): NetworkData {
  return {
    city: 'test',
    cityName: 'Testville',
    kind,
    label: 'Test network',
    center: [13.4, 52.5],
    zoom: 12,
    lines: [
      {
        id: 'relation/1',
        ref: '1',
        name: 'Line 1',
        colour: '#123456',
        mode,
        coordinates: straight(20),
        returnCoordinates: mode === 'bus' ? straight(20, 52.5005).reverse() : null,
        stops: ['a', 'b', 'c'],
        status: '',
        gaps: 0,
      },
    ],
    stations: [
      { key: 'a', name: 'Stop A', position: [13.4, 52.5] },
      { key: 'b', name: 'Stop B', position: [13.41, 52.5] },
      { key: 'c', name: 'Stop C', position: [13.419, 52.5] },
      { key: 'unused', name: 'Unused', position: [13.5, 52.6] },
    ],
    notes: [],
  };
}

describe('real-city example projects', () => {
  it('builds a valid real-place project with OSM provenance', () => {
    const p = networkToProject(network('tram', 'tram'), provenance);
    expect(parseProject(JSON.parse(JSON.stringify(p))).ok).toBe(true);
    expect(p.fictional).toBe(false);
    expect(p.datasetReferences[0]!.provenance.license).toBe('ODbL-1.0');
    const sc = p.scenarios[0]!;
    expect(sc.stations.map((s) => s.name)).toEqual(['Stop A', 'Stop B', 'Stop C']);
    const line = sc.lines[0]!;
    expect(line.origin).toMatchObject({ source: 'osm', ref: 'relation/1', edited: false });
    expect(line.alignment.kind).toBe('spline');
    expect(line.color).toBe('#123456');
  });

  it('reports findings on unedited imported lines as information only', () => {
    const p = networkToProject(network('tram', 'tram'), provenance);
    const findings = validateScenario(p.scenarios[0]!);
    expect(findings.every((f) => f.severity === 'info')).toBe(true);
  });

  it('turns bus routes into street-routed sections between stops', () => {
    const p = networkToProject(network('bus', 'bus'), provenance);
    const line = p.scenarios[0]!.lines[0]!;
    expect(line.alignment.kind).toBe('routed');
    expect(routeStatus(line)).toMatchObject({ routed: 2, unrouted: 0 });
    expect(line.alignment.kind === 'routed' && line.alignment.returnCoordinates).toHaveLength(20);
  });

  it('thins dense geometry to control points but keeps sharp turns', () => {
    const corner: LngLat[] = [
      ...straight(10),
      ...[...Array(10).keys()].map((i) => [13.409, 52.5 + (i + 1) * 0.001] as LngLat),
    ];
    const cps = controlPoints(corner, 1000);
    expect(cps[0]).toEqual(corner[0]);
    expect(cps[cps.length - 1]).toEqual(corner[corner.length - 1]);
    expect(cps).toContainEqual([13.409, 52.5]);
  });
});
