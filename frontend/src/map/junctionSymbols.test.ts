import { describe, expect, it } from 'vitest';
import { createTracks, nodeEnds } from '../domain/tracks';
import { emptyScenario } from '../domain/network';
import { xy } from '../test/fixtures/tracks';
import { arrowsCollection, junctionMovesCollection, tracksCollection } from './overlays';

describe('junction and track-end symbols', () => {
  it('draws one curve per permitted movement at each junction', () => {
    let s = emptyScenario();
    s = createTracks(s, { points: [xy(0, 0), xy(300, 0)], mode: 'tram', double: false }).scenario;
    s = createTracks(s, { points: [xy(300, 0), xy(600, 0)], mode: 'tram', double: false }).scenario;
    s = createTracks(s, { points: [xy(0, -150), xy(300, 0)], mode: 'tram', double: false }).scenario;
    const node = s.trackNetwork.nodes.find((n) => nodeEnds(s.trackNetwork, n.id).length === 3)!;
    const moves = junctionMovesCollection(s, 10);
    // A merge: straight through and from the branch; the two western ends cannot reach each other.
    expect(node.movements).toHaveLength(2);
    const curves = moves.features.filter((f) => f.properties?.kind === 'movement');
    expect(curves).toHaveLength(2);
    // One arm per track end.
    expect(moves.features.filter((f) => f.properties?.kind === 'arm')).toHaveLength(3);
    expect(moves.features.every((f) => f.properties?.nodeId === node.id)).toBe(true);
  });

  it('shows a track direction only near its ends', () => {
    let s = emptyScenario();
    s = createTracks(s, { points: [xy(0, 0), xy(2000, 0)], mode: 'tram', double: false }).scenario;
    const tracks = tracksCollection(s, null);
    const along = arrowsCollection(tracks, { spacingM: 100 });
    const atEnds = arrowsCollection(tracks, { spacingM: 100, atEndsM: 20 });
    expect(along.features.length).toBeGreaterThan(10);
    // Two-way single track: one arrow per direction at each end.
    expect(atEnds.features).toHaveLength(4);
  });
});
