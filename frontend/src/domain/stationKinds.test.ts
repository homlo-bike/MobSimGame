import { describe, expect, it } from 'vitest';
import type { LngLat } from './schema';
import { addStationOnLine, createLine, deleteLine } from './network';
import { stationKind, stopsOnlyServedBy } from './stationKinds';
import { deleteTrackWithServices, setServiceStops } from './serviceRouting';
import { validateScenario } from '../validation/validate';
import { railLine, xy } from '../test/fixtures/tracks';

const errorsFor = (s: Parameters<typeof validateScenario>[0], id: string) =>
  validateScenario(s).filter((f) => f.stationId === id);

describe('station and stop rules', () => {
  it('tells rail stations, bus stops, shared stations and orphans apart', () => {
    const r = railLine([xy(0, 0), xy(1000, 0)], 'tram', [xy(0, 0), xy(1000, 0)]);
    let s = r.s;
    const [a, b] = r.line.stops.map((x) => s.stations.find((st) => st.id === x.stationId)!);
    expect(stationKind(s, a!)).toBe('rail');
    const bus = createLine(s, {
      coordinates: [xy(0, 0), xy(0, 800)] as LngLat[],
      mode: 'bus',
      alignment: 'polyline',
    });
    s = bus.scenario;
    s = addStationOnLine(s, bus.line.id, xy(0, 0)).scenario; // reuses the tram station
    s = addStationOnLine(s, bus.line.id, xy(0, 800)).scenario;
    expect(
      stationKind(
        s,
        s.stations.find((x) => x.id === a!.id)!,
      ),
    ).toBe('mixed');
    const busOnly = s.stations.find((x) => x.id !== a!.id && x.id !== b!.id)!;
    expect(stationKind(s, busOnly)).toBe('bus');
    expect(stopsOnlyServedBy(s, [bus.line.id]).map((x) => x.id)).toEqual([busOnly.id]);
    const removed = deleteLine(s, bus.line.id);
    expect(
      stationKind(
        removed,
        removed.stations.find((x) => x.id === busOnly.id)!,
      ),
    ).toBe('orphan');
  });

  it('a bus stop without a line is reported', () => {
    const bus = createLine(railLine([xy(0, 0), xy(100, 0)], 'tram').s, {
      coordinates: [xy(0, 0), xy(0, 800)] as LngLat[],
      mode: 'bus',
      alignment: 'polyline',
    });
    const s = addStationOnLine(bus.scenario, bus.line.id, xy(0, 800)).scenario;
    const stop = s.stations.at(-1)!;
    const after = deleteLine(s, bus.line.id);
    expect(errorsFor(after, stop.id).map((f) => [f.severity, f.message])).toEqual([
      ['warning', expect.stringMatching(/not served by any line\. A bus stop needs/)],
    ]);
  });

  it('a rail station whose tracks were deleted is an error while services still call at it', () => {
    const r = railLine([xy(0, 0), xy(1000, 0)], 'tram', [xy(0, 0), xy(1000, 0)]);
    let s = r.s;
    for (const id of r.trackIds) s = deleteTrackWithServices(s, id, 'break');
    const st = s.stations[0]!;
    expect(st.trackRefs).toHaveLength(0);
    const f = errorsFor(s, st.id);
    expect(f.some((x) => x.severity === 'error' && /is not on any track/.test(x.message))).toBe(true);
    // Removing it from the service leaves an orphan stop warning instead of an apparently valid station.
    const cleared = setServiceStops(s, r.line.id, []);
    expect(errorsFor(cleared, st.id).map((x) => x.severity)).toEqual(['warning']);
  });
});
