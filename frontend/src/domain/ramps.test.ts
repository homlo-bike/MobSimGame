import { describe, expect, it } from 'vitest';
import type { Scenario } from './schema';
import { emptyScenario } from './network';
import { createTracks } from './tracks';
import {
  levelHeightM,
  maxRampGradient,
  ramps,
  setNodeLevel,
  stationMaxGradient,
  trackHeightAt,
  trackRamp,
} from './ramps';
import { validateTrackNetwork } from '../validation/trackValidation';
import { xy } from '../test/fixtures/tracks';
import { placeStation } from './stationLayout';

function track(lengthM: number, mode: 'tram' | 'commuter_rail' = 'tram'): Scenario {
  return createTracks(emptyScenario(), { points: [xy(0, 0), xy(lengthM, 0)], mode, double: false }).scenario;
}

describe('ramps between levels', () => {
  it('a track whose ends are on different levels is a ramp', () => {
    let s = track(400);
    const t = s.trackNetwork.tracks[0]!;
    expect(trackRamp(s.trackNetwork, t)).toBeNull();
    s = setNodeLevel(s, t.toNodeId, -1);
    const r = trackRamp(s.trackNetwork, s.trackNetwork.tracks[0]!)!;
    // Default depth 10 m over 400 m = 2.5 %.
    expect(r.riseM).toBeCloseTo(-10);
    expect(r.gradientPercent).toBeCloseTo(2.5, 1);
    expect(r.fits).toBe(true);
    expect(r.portal).toEqual(s.trackNetwork.nodes.find((n) => n.id === t.fromNodeId)!.position);
    expect(trackHeightAt(s.trackNetwork, s.trackNetwork.tracks[0]!, 0.5)).toBeCloseTo(-5);
    expect(ramps(s)).toHaveLength(1);
    // Both ends underground: no longer a ramp, and the track itself is on level −1.
    s = setNodeLevel(s, t.fromNodeId, -1);
    expect(ramps(s)).toHaveLength(0);
    expect(s.trackNetwork.tracks[0]!.level).toBe(-1);
  });

  it('a ramp that is too short is reported with the length it needs', () => {
    let s = track(80);
    s = setNodeLevel(s, s.trackNetwork.tracks[0]!.toNodeId, -1);
    const r = trackRamp(s.trackNetwork, s.trackNetwork.tracks[0]!)!;
    expect(r.fits).toBe(false);
    // Tram placeholder maximum 7 %: 10 m needs about 143 m.
    expect(maxRampGradient('tram').cited).toBe(false);
    expect(r.requiredLengthM).toBeCloseTo((10 / maxRampGradient('tram').percent) * 100);
    const f = validateTrackNetwork(s).find((x) => x.category === 'grade');
    expect(f?.severity).toBe('warning');
    expect(f?.message).toMatch(/needs at least \d+ m/);
  });

  it('railways use the cited EBO limits and get errors', () => {
    let s = track(500, 'commuter_rail');
    s = setNodeLevel(s, s.trackNetwork.tracks[0]!.toNodeId, 1);
    expect(maxRampGradient('commuter_rail')).toMatchObject({ percent: 1.25, cited: true });
    expect(stationMaxGradient(s.trackNetwork, 'commuter_rail')).toMatchObject({ percent: 0.25, cited: true });
    // 7 m default height over 500 m = 1.4 % > 1.25 %.
    expect(validateTrackNetwork(s).find((x) => x.category === 'grade')?.severity).toBe('error');
  });

  it('a station platform on a ramp is reported', () => {
    const placed = placeStation(emptyScenario(), {
      position: xy(0, 0),
      mode: 'tram',
      bearingDeg: 90,
      sidePlatforms: 1,
      islandPlatforms: 0,
    });
    const st = placed.station!;
    const t = placed.scenario.trackNetwork.tracks.find((x) => x.id === st.layout!.trackIds[0])!;
    const s = setNodeLevel(placed.scenario, t.toNodeId, -1);
    const f = validateTrackNetwork(s).find((x) => x.stationId === st.id && x.category === 'grade');
    expect(f?.message).toMatch(/is on a ramp/);
  });

  it('level heights follow the project parameters', () => {
    const net = { ...emptyScenario().trackNetwork, parameterOverrides: { levelDepthM: 15, levelHeightM: 8 } };
    expect(levelHeightM(net, -2)).toBe(-30);
    expect(levelHeightM(net, 1)).toBe(8);
    expect(levelHeightM(net, 0)).toBe(0);
  });
});
