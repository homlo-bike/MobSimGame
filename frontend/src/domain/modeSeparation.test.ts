import { describe, expect, it } from 'vitest';
import { emptyScenario } from './network';
import { applyTrackHandles, createTracks, nodeEnds, trackHandles } from './tracks';
import { placeStation } from './stationLayout';
import { modeCounts, stationMode, stationsForMode, stationsOfMode } from './modeSeparation';
import { xy } from '../test/fixtures/tracks';

describe('modes are kept separate', () => {
  it('a track never joins track of another mode, at an end or along it', () => {
    let s = createTracks(emptyScenario(), { points: [xy(0, 0), xy(300, 0)], mode: 'metro' }).scenario;
    s = createTracks(s, { points: [xy(300, 0), xy(600, 100)], mode: 'tram' }).scenario;
    s = createTracks(s, { points: [xy(150, 200), xy(150, 0)], mode: 'tram' }).scenario;
    const metro = s.trackNetwork.tracks.find((t) => t.designMode === 'metro')!;
    expect(s.trackNetwork.tracks.filter((t) => t.designMode === 'metro')).toHaveLength(1);
    expect(nodeEnds(s.trackNetwork, metro.toNodeId)).toHaveLength(1);
    // Same mode still joins.
    const tramJoined = createTracks(s, { points: [xy(600, 100), xy(900, 100)], mode: 'tram' }).scenario;
    const firstTram = tramJoined.trackNetwork.tracks.find((t) => t.designMode === 'tram')!;
    expect(nodeEnds(tramJoined.trackNetwork, firstTram.toNodeId)).toHaveLength(2);
  });

  it('dragging an end onto track of another mode does not connect', () => {
    let s = createTracks(emptyScenario(), { points: [xy(0, 0), xy(300, 0)], mode: 'metro' }).scenario;
    s = createTracks(s, { points: [xy(400, 0), xy(700, 0)], mode: 'tram' }).scenario;
    const tram = s.trackNetwork.tracks.find((t) => t.designMode === 'tram')!;
    const moved = applyTrackHandles(s, tram.id, [xy(301, 0), ...trackHandles(s.trackNetwork, tram).slice(1)]);
    const metro = moved.trackNetwork.tracks.find((t) => t.designMode === 'metro')!;
    expect(nodeEnds(moved.trackNetwork, metro.toNodeId)).toHaveLength(1);
  });

  it('stations belong to one mode and only that mode can call there', () => {
    let s = placeStation(emptyScenario(), {
      position: xy(0, 0),
      mode: 'tram',
      bearingDeg: 90,
      sidePlatforms: 2,
      islandPlatforms: 0,
    }).scenario;
    s = placeStation(s, {
      position: xy(0, 300),
      mode: 'metro',
      bearingDeg: 90,
      sidePlatforms: 0,
      islandPlatforms: 1,
    }).scenario;
    const [tram, metro] = s.stations;
    expect(stationMode(s, tram!)).toBe('tram');
    expect(stationsForMode(s, 'tram').map((x) => x.id)).toEqual([tram!.id]);
    expect(stationsForMode(s, 'metro').map((x) => x.id)).toEqual([metro!.id]);
    expect(stationsForMode(s, 'light_rail')).toEqual([]);
    expect(modeCounts(s)).toMatchObject({ tram: 3, metro: 3 });
  });

  it('lists under a mode tab only the stations of that mode', () => {
    let s = emptyScenario();
    s = placeStation(s, {
      position: xy(0, 0),
      mode: 'tram',
      bearingDeg: 90,
      sidePlatforms: 1,
      islandPlatforms: 0,
    }).scenario;
    s = placeStation(s, {
      position: xy(500, 0),
      mode: 'metro',
      bearingDeg: 90,
      sidePlatforms: 1,
      islandPlatforms: 0,
    }).scenario;
    expect(stationsOfMode(s, 'tram').map((x) => stationMode(s, x))).toEqual(['tram']);
    expect(stationsOfMode(s, 'metro').map((x) => stationMode(s, x))).toEqual(['metro']);
    expect(stationsOfMode(s, 'bus')).toHaveLength(0);
  });
});
