import { describe, expect, it } from 'vitest';
import { emptyScenario } from './network';
import { placeStation } from './stationLayout';
import {
  addWalkingLink,
  deleteWalkingLink,
  linkCandidates,
  linkDistanceM,
  linksOfStation,
  linkWalkMin,
  updateWalkingLink,
} from './walkingLinks';
import { xy } from '../test/fixtures/tracks';

function twoStations() {
  let s = placeStation(emptyScenario(), {
    position: xy(0, 0),
    mode: 'tram',
    bearingDeg: 90,
    sidePlatforms: 2,
    islandPlatforms: 0,
  }).scenario;
  s = placeStation(s, {
    position: xy(300, 0),
    mode: 'metro',
    bearingDeg: 0,
    sidePlatforms: 0,
    islandPlatforms: 1,
  }).scenario;
  s = placeStation(s, {
    position: xy(0, 900),
    mode: 'tram',
    bearingDeg: 90,
    sidePlatforms: 2,
    islandPlatforms: 0,
  }).scenario;
  return s;
}

describe('walking links', () => {
  it('link two stations with the distance and a calculated walking time', () => {
    const s = twoStations();
    const [tram, metro] = s.stations;
    const r = addWalkingLink(s, tram!.id, metro!.id);
    expect(r.error).toBeNull();
    const link = r.link!;
    expect(linkDistanceM(r.scenario, link)).toBeCloseTo(300, 3);
    // 300 m at the 4.5 km/h placeholder = 4 min.
    const w = linkWalkMin(r.scenario, link);
    expect(w.calculated).toBe(true);
    expect(w.minutes).toBeCloseTo(4, 6);
    const set = updateWalkingLink(r.scenario, link.id, { walkTimeMin: 6 });
    expect(linkWalkMin(set, set.interchanges[0]!)).toEqual({ minutes: 6, calculated: false });
    expect(linksOfStation(set, metro!.id)).toHaveLength(1);
    expect(addWalkingLink(set, metro!.id, tram!.id).error).toMatch(/already linked/);
    expect(addWalkingLink(set, tram!.id, tram!.id).error).toBeTruthy();
    expect(deleteWalkingLink(set, link.id).interchanges).toHaveLength(0);
  });

  it('offer stations of other modes first, then the nearest', () => {
    const s = twoStations();
    const [tram, metro, tram2] = s.stations;
    expect(linkCandidates(s, tram!).map((x) => x.id)).toEqual([metro!.id, tram2!.id]);
    expect(linkCandidates(s, tram!, 500).map((x) => x.id)).toEqual([metro!.id]);
  });
});
