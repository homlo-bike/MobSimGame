import { describe, expect, it } from 'vitest';
import { createLine, emptyScenario } from './network';
import { placeStation, stationObjectLevel, updateStationLayout } from './stationLayout';
import { heightAtFraction, lineHeightProfile } from './ramps';
import { initialSegments } from '../geo/segments';
import { xy } from '../test/fixtures/tracks';
import { buildLineModel, vehicleStates } from '../simulation/engine';

const at = { position: xy(0, 0), bearingDeg: 90, sidePlatforms: 2, islandPlatforms: 0 };

describe('stations on different levels', () => {
  it('stack on the same spot without sharing track', () => {
    let s = placeStation(emptyScenario(), { ...at, mode: 'metro', level: -1, name: 'Metro' }).scenario;
    s = placeStation(s, { ...at, mode: 'tram', level: 0, name: 'Tram' }).scenario;
    s = placeStation(s, { ...at, mode: 'light_rail', level: 1, name: 'Elevated' }).scenario;
    const [metro, tram, elevated] = s.stations;
    expect([metro, tram, elevated].map((st) => stationObjectLevel(s, st!))).toEqual([-1, 0, 1]);
    expect(metro!.construction).toBe('underground');
    expect(elevated!.construction).toBe('elevated');
    // Their tracks lie on their own levels and share no node.
    const nodesOf = (id: string) =>
      new Set(
        s.trackNetwork.tracks.filter((t) => t.stationId === id).flatMap((t) => [t.fromNodeId, t.toNodeId]),
      );
    const a = nodesOf(metro!.id);
    expect([...nodesOf(tram!.id)].some((n) => a.has(n))).toBe(false);
    expect(
      s.trackNetwork.tracks.filter((t) => t.stationId === elevated!.id).every((t) => t.level === 1),
    ).toBe(true);
  });

  it('moves a station object to another level with its tracks', () => {
    let s = placeStation(emptyScenario(), { ...at, mode: 'tram' }).scenario;
    const st = s.stations[0]!;
    s = updateStationLayout(s, st.id, { level: -2 }).scenario;
    expect(stationObjectLevel(s, s.stations[0]!)).toBe(-2);
    expect(s.stations[0]!.construction).toBe('underground');
    expect(s.trackNetwork.tracks.every((t) => t.level === -2 && t.structure === 'underground')).toBe(true);
  });
});

describe('height along a line', () => {
  it('a street line changes height over a ramp at a tunnel', () => {
    let s = emptyScenario();
    const c = createLine(s, { coordinates: [xy(0, 0), xy(2000, 0)], mode: 'bus', alignment: 'polyline' });
    s = c.scenario;
    const segs = initialSegments(c.line.segments[0]!);
    const line = {
      ...c.line,
      segments: [
        { ...segs[0]!, id: 'a', fromFraction: 0, toFraction: 0.5 },
        { ...segs[0]!, id: 'b', fromFraction: 0.5, toFraction: 1, structure: 'tunnel' as const },
      ],
    };
    const p = lineHeightProfile(s, line);
    expect(heightAtFraction(p, 0.1)).toBe(0);
    expect(heightAtFraction(p, 0.9)).toBe(-10);
    // Half-way through the ramp (centred on the change) the bus is 5 m down.
    expect(heightAtFraction(p, 0.5)).toBeCloseTo(-5);
    // Simulated vehicles carry their height, for drawing them underground.
    const sc = { ...s, lines: [line] };
    const m = buildLineModel(line, sc)!;
    const heights = [...Array(60).keys()].flatMap((k) => vehicleStates(m, k * 30).map((v) => v.heightM));
    expect(Math.min(...heights)).toBeLessThan(-5);
    expect(Math.max(...heights)).toBe(0);
  });
});
