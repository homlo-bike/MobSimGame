import { describe, expect, it } from 'vitest';
import { emptyScenario } from './network';
import { createTracks } from './tracks';
import { trackGuideSnap } from './trackGuides';
import { xy } from '../test/fixtures/tracks';

describe('track drawing guides on the network', () => {
  it('continue an existing track end when the drawing starts there', () => {
    const s = createTracks(emptyScenario(), { points: [xy(0, 0), xy(300, 0)], mode: 'tram' }).scenario;
    const snap = trackGuideSnap(s.trackNetwork, [xy(300, 0)], xy(400, 2), 5)!;
    expect(snap.label).toBe('straight on');
    // Snapped onto the extension of the track (y = 0), not north-aligned.
    const back = xy(400, 0);
    expect(snap.position[0]).toBeCloseTo(back[0], 6);
    expect(snap.position[1]).toBeCloseTo(back[1], 6);
  });

  it('offer a parallel to straight track within 100 m of the cursor', () => {
    const s = createTracks(emptyScenario(), { points: [xy(0, 0), xy(600, 0)], mode: 'tram' }).scenario;
    // Drawing elsewhere: last leg heads north-east; a parallel to the track runs east from the last point.
    const placed = [xy(100, 20), xy(150, 60)];
    const snap = trackGuideSnap(s.trackNetwork, placed, xy(250, 61), 3)!;
    expect(snap.label).toBe('parallel to track');
    expect(trackGuideSnap(s.trackNetwork, [xy(100, 520), xy(150, 560)], xy(250, 561), 3)).toBeNull();
  });
});
