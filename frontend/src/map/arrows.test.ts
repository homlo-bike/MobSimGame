/**
 * Regression tests for the direction display: arrows must never sit on top of
 * each other (opposite directions on one track, or the two tracks of a double
 * track), must follow loops and reversed geometry, and must not repeat for
 * services that share track.
 */
import { describe, expect, it } from 'vitest';
import type { Feature, FeatureCollection, Point } from 'geojson';
import type { LngLat, Scenario } from '../domain/schema';
import { createLine, emptyScenario, reverseLineDirection, updateLine } from '../domain/network';
import { createTracks } from '../domain/tracks';
import { addStationOnTracks, setServiceStops } from '../domain/serviceRouting';
import { describeDirection } from '../domain/direction';
import { arrowsCollection, metresPerPixel, segmentsCollection, tracksCollection } from './overlays';
import { railLine, xy } from '../test/fixtures/tracks';
import { createFrame } from '../geo/track/projection';

/** The layer's icon offset beside the track, pixels (map/layers.ts). */
const ICON_OFFSET_PX = 6;
const ZOOM = 14;
const mpp = metresPerPixel(ZOOM, 0);
const frame = createFrame([0, 0]);

/** Where an arrow is drawn on screen, in pixels: its point plus the sideways icon offset. */
function screen(f: Feature): [number, number] {
  const p = frame.toMetres((f.geometry as Point).coordinates as LngLat);
  const b = ((f.properties!.bearing as number) * Math.PI) / 180;
  // Bearing is clockwise from north; the right of travel is bearing + 90°.
  const right: [number, number] = [Math.cos(b), -Math.sin(b)];
  const off = (f.properties!.offsetSign as number) * ICON_OFFSET_PX * mpp;
  return [(p[0] + right[0] * off) / mpp, (p[1] + right[1] * off) / mpp];
}

/** Smallest screen distance between two arrows pointing in clearly different directions. */
function minOpposingGapPx(fc: FeatureCollection): number {
  let min = Infinity;
  const fs = fc.features;
  for (let i = 0; i < fs.length; i++)
    for (let j = i + 1; j < fs.length; j++) {
      const db = Math.abs(
        ((((fs[i]!.properties!.bearing - fs[j]!.properties!.bearing) % 360) + 540) % 360) - 180,
      );
      if (db < 90) continue;
      const a = screen(fs[i]!);
      const b = screen(fs[j]!);
      min = Math.min(min, Math.hypot(a[0] - b[0], a[1] - b[1]));
    }
  return min;
}

const bearings = (fc: FeatureCollection) =>
  fc.features.map((f) => Math.round(f.properties!.bearing as number));

function busLine(direction: 'one_way' | 'bidirectional', tracks: 'single' | 'double' = 'single') {
  const { scenario, line } = createLine(emptyScenario(), {
    coordinates: [xy(0, 0), xy(2000, 0)],
    mode: 'custom',
  });
  const s = updateLine(scenario, line.id, {
    direction,
    segments: line.segments.map((seg) => ({ ...seg, tracks })),
  });
  return { s, line: s.lines[0]! };
}

describe('direction arrows', () => {
  it('one-way route: one coherent direction, never two arrows at one place', () => {
    const { s } = busLine('one_way', 'double');
    const fc = arrowsCollection(segmentsCollection(s, null), { spacingM: 200 });
    expect(fc.features.length).toBeGreaterThan(5);
    expect(new Set(bearings(fc))).toEqual(new Set([90]));
  });

  it('bidirectional single track: both directions shown side by side, not on top of each other', () => {
    const { s } = busLine('bidirectional', 'single');
    const fc = arrowsCollection(segmentsCollection(s, null), { spacingM: 200 });
    expect(new Set(bearings(fc))).toEqual(new Set([90, 270]));
    expect(minOpposingGapPx(fc)).toBeGreaterThanOrEqual(2 * ICON_OFFSET_PX - 0.5);
    // A physical single track used both ways is drawn the same way.
    const t = createTracks(emptyScenario(), { points: [xy(0, 0), xy(2000, 0)], mode: 'tram' }).scenario;
    const tf = arrowsCollection(tracksCollection(t, null), { spacingM: 200 });
    expect(new Set(bearings(tf))).toEqual(new Set([90, 270]));
    expect(minOpposingGapPx(tf)).toBeGreaterThanOrEqual(2 * ICON_OFFSET_PX - 0.5);
  });

  it('paired single-direction tracks: each track one direction, arrows apart on screen', () => {
    const t = createTracks(emptyScenario(), {
      points: [xy(0, 0), xy(2000, 0)],
      mode: 'tram',
      double: true,
    }).scenario;
    const tracks = tracksCollection(t, null);
    const fc = arrowsCollection(tracks, { spacingM: 200 });
    for (const tr of tracks.features) {
      const own = fc.features.filter((f) => f.properties!.trackId === tr.properties!.trackId);
      expect(new Set(bearings({ type: 'FeatureCollection', features: own })).size).toBe(1);
    }
    // The tracks are 3.2 m apart (under a pixel at zoom 14): the arrows must still not overlap.
    expect(minOpposingGapPx(fc)).toBeGreaterThan(2 * ICON_OFFSET_PX);
  });

  it('loop service: arrows follow the loop around its arcs', () => {
    const square: LngLat[] = [xy(0, 0), xy(1000, 0), xy(1000, 1000), xy(0, 1000), xy(0, 0)];
    const t = createTracks(emptyScenario(), { points: square, mode: 'tram', radiusM: 100 }).scenario;
    const one = {
      ...t,
      trackNetwork: {
        ...t.trackNetwork,
        tracks: t.trackNetwork.tracks.map((x) => ({ ...x, direction: 'forward' as const })),
      },
    };
    const fc = arrowsCollection(tracksCollection(one, null), { spacingM: 100 });
    // Drawn anticlockwise: every arrow turns left around the centre (cross product > 0).
    const c = frame.toMetres(xy(500, 500));
    for (const f of fc.features) {
      const p = frame.toMetres((f.geometry as Point).coordinates as LngLat);
      const b = ((f.properties!.bearing as number) * Math.PI) / 180;
      const dir: [number, number] = [Math.sin(b), Math.cos(b)];
      const r: [number, number] = [p[0] - c[0], p[1] - c[1]];
      expect(r[0] * dir[1] - r[1] * dir[0]).toBeGreaterThan(0);
    }
  });

  it('reversed geometry reverses the arrows', () => {
    const { s, line } = busLine('one_way');
    const before = bearings(arrowsCollection(segmentsCollection(s, null), { spacingM: 200 }));
    const rev = reverseLineDirection(s, line.id);
    const after = bearings(arrowsCollection(segmentsCollection(rev, null), { spacingM: 200 }));
    expect(new Set(before)).toEqual(new Set([90]));
    expect(new Set(after)).toEqual(new Set([270]));
  });

  it('shared track: services on the same track add no extra arrows', () => {
    const r = railLine([xy(0, 0), xy(2000, 0)], 'tram', [xy(0, 0), xy(2000, 0)]);
    let s: Scenario = r.s;
    const c = createLine(s, { coordinates: [xy(0, 0), xy(2000, 0)], mode: 'tram' });
    s = setServiceStops(
      c.scenario,
      c.line.id,
      r.s.lines[0]!.stops.map((x) => x.stationId),
    );
    expect(s.lines).toHaveLength(2);
    expect(arrowsCollection(segmentsCollection(s, null)).features).toHaveLength(0);
    const one = arrowsCollection(tracksCollection(r.s, null), { spacingM: 200 }).features.length;
    expect(arrowsCollection(tracksCollection(s, null), { spacingM: 200 }).features).toHaveLength(one);
  });

  it('keeps arrows clear of stations and adapts spacing to the zoom', () => {
    const t = createTracks(emptyScenario(), { points: [xy(0, 0), xy(2000, 0)], mode: 'tram' }).scenario;
    const st = addStationOnTracks(t, xy(1000, 0)).scenario;
    const pos = st.stations[0]!.position;
    const tracks = tracksCollection(st, null);
    const fc = arrowsCollection(tracks, { spacingM: 100, avoid: [pos], avoidM: 60 });
    const near = fc.features.filter((f) => {
      const p = frame.toMetres((f.geometry as Point).coordinates as LngLat);
      const q = frame.toMetres(pos);
      return Math.hypot(p[0] - q[0], p[1] - q[1]) < 60;
    });
    expect(near).toHaveLength(0);
    const coarse = arrowsCollection(tracks, { spacingM: 400 }).features.length;
    const fine = arrowsCollection(tracks, { spacingM: 100 }).features.length;
    expect(fine).toBeGreaterThan(coarse * 3);
    expect(metresPerPixel(15, 0)).toBeCloseTo(metresPerPixel(14, 0) / 2, 9);
  });
});

describe('direction in text', () => {
  it('describes one-way, both-way and ring services in words', () => {
    const r = railLine([xy(0, 0), xy(2000, 0)], 'tram', [xy(0, 0), xy(2000, 0)]);
    const line = r.s.lines[0]!;
    const [a, b] = line.stops.map((x) => r.s.stations.find((s) => s.id === x.stationId)!.name);
    expect(describeDirection(line, r.s)).toBe(
      `Both directions between ${a} and ${b}. The way back uses its own track where there is double track.`,
    );
    expect(describeDirection({ ...line, direction: 'one_way' }, r.s)).toBe(`One-way from ${a} to ${b}.`);
    const ring = createLine(emptyScenario(), {
      coordinates: [xy(0, 0), xy(1000, 0), xy(1000, 1000), xy(0, 1000)],
      mode: 'custom',
      ring: true,
    });
    expect(describeDirection({ ...ring.line, direction: 'one_way' }, ring.scenario)).toMatch(
      /One-way ring, anticlockwise/,
    );
  });
});
