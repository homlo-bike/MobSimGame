import { describe, expect, it } from 'vitest';
import { featuresFromLabels, labelCategory, MAP_LABEL_PROVIDER, preferTransitKind } from './mapLabels';
import { suggestStationNames } from './suggest';
import type { LngLat } from '../domain/schema';

const at: LngLat = [13.4, 52.52];
const label = (sourceLayer: string, properties: Record<string, unknown>, coordinates: LngLat[] = [at]) => ({
  sourceLayer,
  properties,
  coordinates,
});

describe('station names from basemap labels', () => {
  it('maps OpenMapTiles layers to name categories', () => {
    expect(labelCategory(label('poi', { class: 'railway', subclass: 'station', name: 'X' }))).toBe(
      'transit_station',
    );
    expect(labelCategory(label('poi', { class: 'bus', subclass: 'bus_stop', name: 'X' }))).toBe(
      'transit_station',
    );
    expect(labelCategory(label('poi', { class: 'museum', name: 'X' }))).toBe('landmark');
    expect(labelCategory(label('poi', { class: 'shop', name: 'X' }))).toBe('facility');
    expect(labelCategory(label('place', { class: 'suburb', name: 'X' }))).toBe('district');
    expect(labelCategory(label('place', { class: 'city', name: 'X' }))).toBeNull();
    expect(labelCategory(label('transportation_name', { class: 'primary', name: 'X' }))).toBe('major_street');
    expect(labelCategory(label('transportation_name', { class: 'minor', name: 'X' }))).toBe('street');
    expect(labelCategory(label('transportation_name', { class: 'path', name: 'X' }))).toBeNull();
    expect(labelCategory(label('water_name', { name: 'X' }))).toBeNull();
  });

  it('prefers a station label over a district or street, and keeps localised names', () => {
    const features = featuresFromLabels(
      [
        label('transportation_name', { class: 'primary', name: 'Hauptstraße' }, [
          [13.399, 52.52],
          [13.4005, 52.52],
        ]),
        label('place', { class: 'suburb', name: 'Mitte' }, [[13.401, 52.521]]),
        label('poi', { class: 'railway', subclass: 'station', name: 'Alexanderplatz', 'name:en': 'Alex' }, [
          [13.4012, 52.5201],
        ]),
        label('poi', { class: 'railway', subclass: 'station', name: 'Alexanderplatz' }, [[13.4012, 52.5201]]),
      ],
      at,
    );
    expect(features).toHaveLength(3);
    expect(features.find((f) => f.category === 'transit_station')!.names['name:en']).toBe('Alex');
    // A street label is placed at its vertex nearest to the station.
    expect(features.find((f) => f.category === 'major_street')!.position).toEqual([13.4005, 52.52]);
    const [best] = suggestStationNames(at, features, { provider: MAP_LABEL_PROVIDER });
    expect(best!.name).toBe('Alexanderplatz');
    expect(best!.qualifier).toBe('Mitte');
  });

  it('skips unnamed labels', () => {
    expect(featuresFromLabels([label('poi', { class: 'railway' })], at)).toEqual([]);
  });
});

describe('transit kind preference', () => {
  const features = featuresFromLabels(
    [
      label('poi', { class: 'bus', subclass: 'bus_stop', name: 'Bus stop' }, [at]),
      label('poi', { class: 'railway', subclass: 'station', name: 'Rail station' }, [[13.402, 52.52]]),
    ],
    at,
  );
  const best = (kind: 'rail' | 'bus' | null) =>
    suggestStationNames(at, preferTransitKind(features, kind), { provider: MAP_LABEL_PROVIDER })[0]!.name;

  it('picks the label of the same kind of stop, else the nearest', () => {
    expect(best('rail')).toBe('Rail station');
    expect(best('bus')).toBe('Bus stop');
    expect(best(null)).toBe('Bus stop');
  });
});
