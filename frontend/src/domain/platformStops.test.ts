import { describe, expect, it } from 'vitest';
import { createLine, updateLine } from './network';
import { routeThroughStations, setServiceStops } from './serviceRouting';
import { emptyScenario } from './network';
import { placeStation } from './stationLayout';
import { createTracks, splitTrack } from './tracks';
import { railLine, xy } from '../test/fixtures/tracks';
import { togglePlatformStop } from '../map/overlays';

/** A service through `stops` that returns to the first stop after the last (R14a default). */
function loopService(
  s: ReturnType<typeof railLine>['s'],
  stops: { stationId: string; trackId: string | null }[],
) {
  const c = createLine(s, { coordinates: s.stations.map((x) => x.position), mode: 'tram', ring: true });
  const n = setServiceStops(updateLine(c.scenario, c.line.id, { direction: 'one_way' }), c.line.id, stops);
  return { s: n, line: n.lines.find((l) => l.id === c.line.id)! };
}

describe('stops at platforms', () => {
  it('routes over the chosen platform track and names the platforms when no route exists', () => {
    const { s } = railLine([xy(0, 0), xy(2000, 0)], 'tram', [xy(0, 0), xy(2000, 0)], { double: true });
    const [a, b] = s.stations;
    expect(a!.trackRefs).toHaveLength(2);
    const results = a!.trackRefs.map((r) =>
      routeThroughStations(
        s,
        [
          { stationId: a!.id, trackId: r.trackId },
          { stationId: b!.id, trackId: b!.trackRefs.find((x) => x.trackId === r.trackId)?.trackId ?? null },
        ],
        false,
        'tram',
      ),
    );
    // One track runs from A to B, the other the opposite way.
    const ok = results.filter((r) => !r.error);
    const bad = results.filter((r) => r.error);
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    const used = new Set(ok[0]!.steps.map((x) => x.trackId));
    expect(used.size).toBe(1);
    expect(bad[0]!.error).toMatch(
      /No permitted track path from "Station 1" \(Track \d+\) to "Station 2" \(Track \d+\)/,
    );
  });

  it('a platform that is no longer at the station is an error', () => {
    const { s } = railLine([xy(0, 0), xy(2000, 0)], 'tram', [xy(0, 0), xy(2000, 0)], { double: false });
    const [a, b] = s.stations;
    const r = routeThroughStations(s, [{ stationId: a!.id, trackId: 'gone' }, b!.id], false, 'tram');
    expect(r.error).toMatch(/no platform on the chosen track/);
  });

  it('returns to the first stop, reversing at the end of a single track', () => {
    const { s } = railLine([xy(0, 0), xy(2000, 0)], 'tram', [xy(0, 0), xy(1000, 0), xy(2000, 0)], {
      double: false,
    });
    const { line } = loopService(
      s,
      s.stations.map((x) => ({ stationId: x.id, trackId: null })),
    );
    expect(line.alignment.kind === 'track' && line.alignment.status).toBe('routed');
    expect(line.alignment.kind === 'track' && line.alignment.message).toMatch(/reverses at "Station 3"/);
  });

  it('without crossovers on one-way double track the way back is reported, not drawn', () => {
    const { s } = railLine([xy(0, 0), xy(2000, 0)], 'tram', [xy(0, 0), xy(2000, 0)], { double: true });
    const { line } = loopService(
      s,
      s.stations.map((x) => ({ stationId: x.id, trackId: null })),
    );
    expect(line.alignment.kind === 'track' && line.alignment.status).toBe('unrouted');
    expect(line.alignment.kind === 'track' && line.alignment.message).toMatch(
      /add a crossover or a turning loop/,
    );
  });

  it('a stop keeps its platform when the track is split', () => {
    const { s } = railLine([xy(0, 0), xy(2000, 0)], 'tram', [xy(200, 0), xy(1800, 0)], { double: false });
    const [a, b] = s.stations;
    const trackId = a!.trackRefs[0]!.trackId;
    const { s: withStops, line } = loopService(s, [
      { stationId: a!.id, trackId },
      { stationId: b!.id, trackId },
    ]);
    const split = splitTrack(withStops, trackId, 0.5).scenario;
    const after = split.lines.find((l) => l.id === line.id)!;
    const st = (id: string) => split.stations.find((x) => x.id === id)!;
    for (const stop of after.stops)
      expect(st(stop.stationId).trackRefs.some((r) => r.trackId === stop.trackId)).toBe(true);
    // The station at 1800 m now stands on the new second part of the track.
    expect(after.stops[1]!.trackId).not.toBe(trackId);
  });

  it('names the one-way track a path would have to run against', () => {
    let s = emptyScenario();
    for (const x of [0, 1000])
      s = placeStation(s, {
        position: xy(x, 0),
        mode: 'tram',
        bearingDeg: 90,
        sidePlatforms: 2,
        islandPlatforms: 0,
      }).scenario;
    const [a, b] = s.stations;
    const ta = a!.layout!.trackIds;
    const tb = b!.layout!.trackIds;
    const nodeAt = (trackId: string, end: 'from' | 'to') => {
      const t = s.trackNetwork.tracks.find((x) => x.id === trackId)!;
      return s.trackNetwork.nodes.find((n) => n.id === (end === 'from' ? t.fromNodeId : t.toNodeId))!
        .position;
    };
    s = createTracks(s, {
      points: [nodeAt(ta[0]!, 'to'), nodeAt(tb[0]!, 'from')],
      mode: 'tram',
      double: true,
    }).scenario;
    // Crossovers: track 1 to track 2 after station 1, track 2 back to track 1 before station 2.
    const y = (k: number) => nodeAt(ta[k]!, 'to')[1];
    const p = (x: number, k: number): [number, number] => [xy(x, 0)[0], y(k)];
    s = createTracks(s, { points: [p(200, 0), p(260, 1)], mode: 'tram', double: false }).scenario;
    s = createTracks(s, { points: [p(740, 1), p(800, 0)], mode: 'tram', double: false }).scenario;
    const stops = [
      { stationId: a!.id, trackId: ta[0]! },
      { stationId: b!.id, trackId: tb[1]! },
    ];
    const r = routeThroughStations(s, stops, false, 'tram');
    expect(r.error).toMatch(/against the one-way direction of Track \d+/);
    expect(r.error).toMatch(/running direction to both ways, or add a crossover/);
    // Single (two-way) track between the stations: the same stops route.
    let single = emptyScenario();
    for (const x of [0, 1000])
      single = placeStation(single, {
        position: xy(x, 0),
        mode: 'tram',
        bearingDeg: 90,
        sidePlatforms: 1,
        islandPlatforms: 0,
      }).scenario;
    const [c, d] = single.stations;
    const tc = c!.layout!.trackIds[0]!;
    const td = d!.layout!.trackIds[0]!;
    const n2 = (trackId: string, end: 'from' | 'to') => {
      const t = single.trackNetwork.tracks.find((x) => x.id === trackId)!;
      return single.trackNetwork.nodes.find((n) => n.id === (end === 'from' ? t.fromNodeId : t.toNodeId))!
        .position;
    };
    single = createTracks(single, {
      points: [n2(tc, 'to'), n2(td, 'from')],
      mode: 'tram',
      double: false,
    }).scenario;
    const ok = routeThroughStations(
      single,
      [
        { stationId: c!.id, trackId: tc },
        { stationId: d!.id, trackId: td },
      ],
      false,
      'tram',
    );
    expect(ok.error).toBeNull();
  });

  it('says when tracks are not connected at all', () => {
    let s = emptyScenario();
    for (const x of [0, 1000])
      s = placeStation(s, {
        position: xy(x, 0),
        mode: 'tram',
        bearingDeg: 90,
        sidePlatforms: 1,
        islandPlatforms: 0,
      }).scenario;
    const [a, b] = s.stations;
    const r = routeThroughStations(s, [a!.id, b!.id], false, 'tram');
    expect(r.error).toMatch(/not connected through nodes/);
  });
});

describe('picking platforms', () => {
  it('a second click on a picked platform takes it out again', () => {
    const one = togglePlatformStop([], { stationId: 'a', trackId: 't1' });
    expect(one).toEqual({ draft: [{ stationId: 'a', trackId: 't1' }], removed: false });
    const two = togglePlatformStop(one.draft, { stationId: 'a', trackId: 't2' });
    expect(two.draft).toHaveLength(2);
    const back = togglePlatformStop(two.draft, { stationId: 'a', trackId: 't1' });
    expect(back).toEqual({ draft: [{ stationId: 'a', trackId: 't2' }], removed: true });
  });
});
