import { describe, expect, it } from 'vitest';
import { createLine, emptyScenario, updateLine } from './network';
import { createTracks } from './tracks';
import { MODES } from './modes';
import { modeSetting, setLineInherits, setModeSetting, setTrackInherits } from './inheritance';
import { setModeTrackDefault } from './projectProperties';
import { xy } from '../test/fixtures/tracks';

describe('project settings and own values', () => {
  it('new lines follow the project setting of their mode until they set their own value', () => {
    let s = emptyScenario();
    const a = createLine(s, { coordinates: [xy(0, 0), xy(1000, 0)], mode: 'tram' });
    s = a.scenario;
    const b = createLine(s, { coordinates: [xy(0, 500), xy(1000, 500)], mode: 'tram' });
    s = b.scenario;
    expect(a.line.inherits).toEqual(['dwellTimeS', 'maxSpeedKmh']);
    expect(a.line.dwellTimeS).toBe(MODES.tram.defaultDwellTimeS);
    // Line B keeps its own dwell time.
    s = updateLine(s, b.line.id, { dwellTimeS: 45, inherits: ['maxSpeedKmh'] });
    s = setModeSetting(s, 'tram', { dwellTimeS: 30, maxSpeedKmh: 55 });
    expect(modeSetting(s, 'tram', 'dwellTimeS')).toBe(30);
    const [la, lb] = s.lines;
    expect(la!.dwellTimeS).toBe(30);
    expect(la!.maxSpeedKmh).toBe(55);
    expect(lb!.dwellTimeS).toBe(45);
    expect(lb!.maxSpeedKmh).toBe(55);
    // Back to the project setting.
    s = setLineInherits(s, b.line.id, 'dwellTimeS', true);
    expect(s.lines[1]!.dwellTimeS).toBe(30);
  });

  it('tracks follow the project gauge and electrification unless set', () => {
    let s = createTracks(emptyScenario(), {
      points: [xy(0, 0), xy(500, 0)],
      mode: 'tram',
      double: false,
    }).scenario;
    s = createTracks(s, { points: [xy(0, 300), xy(500, 300)], mode: 'tram', double: false }).scenario;
    const [t1, t2] = s.trackNetwork.tracks;
    s = setTrackInherits(s, t2!.id, 'gaugeMm', false);
    s = setModeTrackDefault(s, 'tram', { gaugeMm: 1435, electrification: 'overhead' });
    const get = (id: string) => s.trackNetwork.tracks.find((t) => t.id === id)!;
    expect(get(t1!.id).gaugeMm).toBe(1435);
    expect(get(t1!.id).electrification).toBe('overhead');
    expect(get(t2!.id).gaugeMm).toBeNull();
    expect(get(t2!.id).electrification).toBe('overhead');
  });
});
