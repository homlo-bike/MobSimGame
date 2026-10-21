import { describe, expect, it } from 'vitest';
import { createLine, updateLine } from './network';
import { routeThroughStations, setServiceStops } from './serviceRouting';
import { splitTrack } from './tracks';
import { railLine, xy } from '../test/fixtures/tracks';

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
});
