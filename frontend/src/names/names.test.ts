import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LngLat } from '../domain/schema';
import type { OsmFeature, OsmFeatureProvider, ProviderResponse } from '../providers/types';
import { ProviderError } from '../providers/backend';
import { createLine, emptyScenario, addStationOnLine, renameStation } from '../domain/network';
import { resolvedName, suggestStationNames } from './suggest';
import { clearNameCache, lookupStationNames } from './lookup';

const here: LngLat = [13.4, 52.52];
const m = 1 / 111320;
const f = (
  id: string,
  category: OsmFeature['category'],
  name: string | null,
  dx: number,
  names = {},
): OsmFeature => ({
  id,
  category,
  name,
  names,
  position: [here[0] + dx * m * 1.64, here[1]],
  tags: {},
});

const response = (data: OsmFeature[]): ProviderResponse<OsmFeature[]> => ({
  data,
  provenance: {
    provider: 'Overpass API (test)',
    dataset: 'OpenStreetMap',
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
  },
  capability: { state: 'available', message: '', checkedAt: '' },
});

const provider = (
  impl: () => Promise<ProviderResponse<OsmFeature[]>>,
): Pick<OsmFeatureProvider, 'featuresNear'> => ({
  featuresNear: vi.fn(impl),
});

describe('station name suggestions', () => {
  it('ranks transport stations, landmarks, districts, facilities, intersections, streets, places', () => {
    const list = suggestStationNames(
      here,
      [
        f('a', 'street', 'Elm Street', 20),
        f('b', 'place', 'Old Square', 30),
        f('c', 'intersection', 'Main Street / Elm Street', 40),
        f('d', 'facility', 'City Hospital', 300),
        f('e', 'district', 'Mitte', 200),
        f('g', 'landmark', 'Town Hall', 150),
        f('h', 'transit_station', 'Central Station', 400),
        f('i', 'major_street', 'Main Street', 10),
      ],
      { provider: 'test' },
    );
    expect(list.map((s) => s.name)).toEqual([
      'Central Station',
      'Town Hall',
      'Mitte',
      'City Hospital',
      'Main Street / Elm Street',
      'Main Street',
      'Elm Street',
      'Old Square',
      expect.stringMatching(/^Station 52\.5200°N 13\.4000°E$/),
    ]);
    expect(list.at(-1)!.coordinateFallback).toBe(true);
    expect(list.slice(0, -1).every((s) => !s.coordinateFallback)).toBe(true);
  });

  it('uses the localised name, then the local one, and skips features without a name', () => {
    const list = suggestStationNames(
      here,
      [f('a', 'landmark', 'Rotes Rathaus', 50, { 'name:en': 'Red City Hall' }), f('b', 'landmark', '  ', 10)],
      { provider: 'test', language: 'en' },
    );
    expect(list[0]!.name).toBe('Red City Hall');
    expect(
      suggestStationNames(here, [f('a', 'landmark', 'Rotes Rathaus', 50)], {
        provider: 't',
        language: 'fr',
      })[0]!.name,
    ).toBe('Rotes Rathaus');
    expect(list.filter((s) => !s.coordinateFallback)).toHaveLength(1);
  });

  it('ignores invalid features instead of failing', () => {
    const bad = {
      id: 'x',
      category: 'landmark',
      name: 'Broken',
      names: {},
      position: [NaN, 1],
      tags: {},
    } as OsmFeature;
    expect(suggestStationNames(here, [bad], { provider: 't' })).toHaveLength(1);
  });

  it('qualifies a name that is already used in the project', () => {
    let s = emptyScenario();
    const r = createLine(s, { coordinates: [here, [here[0] + 0.01, here[1]]], mode: 'tram' });
    s = addStationOnLine(r.scenario, r.line.id, here).scenario;
    s = renameStation(s, s.stations[0]!.id, 'Town Hall');
    const [first] = suggestStationNames(
      here,
      [f('g', 'landmark', 'Town Hall', 10), f('e', 'district', 'Mitte', 50)],
      {
        provider: 't',
      },
    );
    expect(resolvedName(s, first!)).toBe('Town Hall (Mitte)');
    expect(resolvedName(s, first!, s.stations[0]!.id)).toBe('Town Hall');
  });
});

describe('station name lookup', () => {
  beforeEach(() => clearNameCache());
  afterEach(() => vi.useRealTimers());

  it('returns named suggestions and caches them', async () => {
    const p = provider(() => Promise.resolve(response([f('g', 'landmark', 'Town Hall', 10)])));
    const out = await lookupStationNames(here, p);
    expect(out.status).toBe('ok');
    expect(out.suggestions[0]!.name).toBe('Town Hall');
    expect(out.attribution).toMatch(/OpenStreetMap/);
    await lookupStationNames(here, p);
    expect(p.featuresNear).toHaveBeenCalledTimes(1);
  });

  it('reports an empty area instead of silently returning coordinates', async () => {
    const out = await lookupStationNames(
      here,
      provider(() => Promise.resolve(response([]))),
    );
    expect(out.status).toBe('empty');
    expect(out.message).toMatch(/No named/);
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0]!.coordinateFallback).toBe(true);
  });

  it('settles with an error message when the provider fails', async () => {
    const out = await lookupStationNames(
      here,
      provider(() =>
        Promise.reject(new ProviderError('Provider temporarily unavailable', 'temporarily_unavailable')),
      ),
    );
    expect(out.status).toBe('error');
    expect(out.message).toMatch(/Provider temporarily unavailable/);
  });

  it('settles after the timeout even if the provider never answers', async () => {
    vi.useFakeTimers();
    const pending = lookupStationNames(
      here,
      provider(() => new Promise(() => undefined)),
      { timeoutMs: 1000 },
    );
    await vi.advanceTimersByTimeAsync(1000);
    const out = await pending;
    expect(out.status).toBe('timeout');
    expect(out.message).toMatch(/within 1 s/);
  });

  it('rejects malformed data and can be cancelled', async () => {
    const bad = await lookupStationNames(
      here,
      provider(() => Promise.resolve({ ...response([]), data: 'nonsense' as unknown as OsmFeature[] })),
    );
    expect(bad.status).toBe('error');
    const ctrl = new AbortController();
    const pending = lookupStationNames(
      [1, 1],
      provider(() => new Promise(() => undefined)),
      { signal: ctrl.signal },
    );
    ctrl.abort();
    expect((await pending).status).toBe('cancelled');
  });
});
