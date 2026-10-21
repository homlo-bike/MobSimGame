import { describe, expect, it } from 'vitest';
import { emptyScenario } from './network';
import { createTracks } from './tracks';
import { applyModeDefaultsToTracks, modeDefaultRows, setModeTrackDefault } from './projectProperties';
import { xy } from '../test/fixtures/tracks';

describe('project properties', () => {
  it('lists defaults for every mode tab with cited curve radii for rail', () => {
    const rows = modeDefaultRows(emptyScenario());
    expect(rows.map((r) => r.mode)).toEqual([
      'bus',
      'brt',
      'trolleybus',
      'tram',
      'light_rail',
      'metro',
      'commuter_rail',
    ]);
    const tram = rows.find((r) => r.mode === 'tram')!;
    expect(tram.curve?.minimumM).toBe(25);
    expect(tram.platformLengthM).toBeGreaterThan(0);
    expect(rows.find((r) => r.mode === 'bus')!.platformLengthM).toBeNull();
  });

  it('gives new track the mode default and fills it into existing track without a value', () => {
    let s = createTracks(emptyScenario(), { points: [xy(0, 0), xy(300, 0)], mode: 'tram' }).scenario;
    expect(s.trackNetwork.tracks[0]!.electrification).toBe('unknown');
    s = setModeTrackDefault(s, 'tram', { electrification: 'overhead', gaugeMm: 1435 });
    s = createTracks(s, { points: [xy(0, 200), xy(300, 200)], mode: 'tram' }).scenario;
    expect(s.trackNetwork.tracks[1]).toMatchObject({ electrification: 'overhead', gaugeMm: 1435 });
    // Existing track that follows the project took the new default at once (G1).
    expect(s.trackNetwork.tracks[0]).toMatchObject({ electrification: 'overhead', gaugeMm: 1435 });
    // Track with its own unset values (older projects) is filled in on request.
    const own = {
      ...s,
      trackNetwork: {
        ...s.trackNetwork,
        tracks: s.trackNetwork.tracks.map((t, i) =>
          i === 0 ? { ...t, inherits: [], electrification: 'unknown' as const, gaugeMm: null } : t,
        ),
      },
    };
    const applied = applyModeDefaultsToTracks(own, 'tram');
    expect(applied.changed).toBe(1);
    expect(applied.scenario.trackNetwork.tracks.every((t) => t.electrification === 'overhead')).toBe(true);
    expect(applyModeDefaultsToTracks(applied.scenario, 'tram').changed).toBe(0);
  });
});
