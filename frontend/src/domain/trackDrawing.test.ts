import { describe, expect, it } from 'vitest';
import { emptyScenario } from './network';
import { applyTrackHandles, createTracks, nodeEnds, trackHandles, updateTrack } from './tracks';
import { rerouteServices } from './serviceRouting';
import { validateScenario } from '../validation/validate';
import { validateTrackNetwork } from '../validation/trackValidation';
import { railLine, xy } from '../test/fixtures/tracks';

const connectionKinks = (s: ReturnType<typeof emptyScenario>) =>
  validateTrackNetwork(s).filter((f) => /Connection with a/.test(f.message));

describe('drawing track that connects to existing track', () => {
  it('continues an open track end tangentially (no kink)', () => {
    let s = createTracks(emptyScenario(), { points: [xy(0, 0), xy(300, 0)], mode: 'tram' }).scenario;
    // Without the fix this leaves a 33.7° kink at the joint.
    const raw = createTracks(s, { points: [xy(300, 0), xy(600, 200)], mode: 'tram', tangentEnds: false });
    expect(connectionKinks(raw.scenario).length).toBe(1);
    s = createTracks(s, { points: [xy(300, 0), xy(600, 200)], mode: 'tram' }).scenario;
    const added = s.trackNetwork.tracks[1]!;
    expect(added.points.length).toBe(1);
    expect(added.radii[0]).not.toBeNull();
    expect(connectionKinks(s)).toEqual([]);
  });

  it('joins the middle of a track as a tangent junction', () => {
    let s = createTracks(emptyScenario(), { points: [xy(0, 0), xy(600, 0)], mode: 'tram' }).scenario;
    s = createTracks(s, { points: [xy(500, 300), xy(300, 0)], mode: 'tram' }).scenario;
    // The straight was split into two tracks at the junction; the new track leaves along it.
    expect(s.trackNetwork.tracks).toHaveLength(3);
    const junction = s.trackNetwork.nodes.find((n) => nodeEnds(s.trackNetwork, n.id).length === 3)!;
    expect(junction).toBeDefined();
    expect(connectionKinks(s)).toEqual([]);
  });

  it('continues a double track tangentially', () => {
    let s = createTracks(emptyScenario(), {
      points: [xy(0, 0), xy(400, 0)],
      mode: 'tram',
      double: true,
    }).scenario;
    s = createTracks(s, { points: [xy(400, 0), xy(800, 300)], mode: 'tram', double: true }).scenario;
    expect(s.trackNetwork.tracks).toHaveLength(4);
    const joints = s.trackNetwork.nodes.filter((n) => nodeEnds(s.trackNetwork, n.id).length === 2);
    expect(joints).toHaveLength(2);
    expect(connectionKinks(s)).toEqual([]);
  });

  it('closes a loop only when asked', () => {
    const pts = [xy(0, 0), xy(300, 0), xy(300, 300), xy(0, 300), xy(1, 1)];
    const open = createTracks(emptyScenario(), { points: pts, mode: 'tram', loop: false }).scenario;
    const t = open.trackNetwork.tracks[0]!;
    expect(t.fromNodeId).not.toBe(t.toNodeId);
    const ring = createTracks(emptyScenario(), { points: pts, mode: 'tram', loop: true }).scenario;
    const r = ring.trackNetwork.tracks[0]!;
    expect(r.fromNodeId).toBe(r.toNodeId);
  });
});

describe('moving a track end', () => {
  it('connects when dropped on another track end, never onto its own other end', () => {
    let s = createTracks(emptyScenario(), { points: [xy(0, 0), xy(300, 0)], mode: 'tram' }).scenario;
    s = createTracks(s, { points: [xy(400, 0), xy(700, 0)], mode: 'tram' }).scenario;
    const a = s.trackNetwork.tracks[0]!;
    const b = s.trackNetwork.tracks[1]!;
    const handles = trackHandles(s.trackNetwork, b);
    const joined = applyTrackHandles(s, b.id, [xy(301, 0), ...handles.slice(1)]);
    const b2 = joined.trackNetwork.tracks.find((t) => t.id === b.id)!;
    expect(b2.fromNodeId).toBe(a.toNodeId);
    expect(joined.trackNetwork.nodes).toHaveLength(3);
    // Dropping the end next to its own start does not close a loop.
    const short = createTracks(emptyScenario(), { points: [xy(0, 0), xy(20, 0)], mode: 'tram' }).scenario;
    const t = short.trackNetwork.tracks[0]!;
    const moved = applyTrackHandles(short, t.id, [trackHandles(short.trackNetwork, t)[0]!, xy(2, 0)]);
    const t2 = moved.trackNetwork.tracks[0]!;
    expect(t2.fromNodeId).not.toBe(t2.toNodeId);
  });

  it('connects to the middle of a track when dropped on it', () => {
    let s = createTracks(emptyScenario(), { points: [xy(0, 0), xy(600, 0)], mode: 'tram' }).scenario;
    s = createTracks(s, { points: [xy(300, 300), xy(300, 100)], mode: 'tram' }).scenario;
    const b = s.trackNetwork.tracks[1]!;
    const h = trackHandles(s.trackNetwork, b);
    const joined = applyTrackHandles(s, b.id, [...h.slice(0, -1), xy(300, 1)]);
    expect(joined.trackNetwork.tracks).toHaveLength(3);
    const b2 = joined.trackNetwork.tracks.find((t) => t.id === b.id)!;
    expect(nodeEnds(joined.trackNetwork, b2.toNodeId)).toHaveLength(3);
  });
});

describe('services need a way back over the tracks', () => {
  it('reports an error when a two-way service has no return path', () => {
    const { s, line, trackIds } = railLine([xy(0, 0), xy(800, 0)], 'tram', [xy(100, 0), xy(700, 0)], {
      double: false,
    });
    expect(
      validateScenario(s).filter((f) => f.lineId === line.id && /No track path back/.test(f.message)),
    ).toEqual([]);
    const oneWay = rerouteServices(updateTrack(s, trackIds[0]!, { direction: 'forward' }));
    const errors = validateScenario(oneWay).filter(
      (f) => f.lineId === line.id && f.severity === 'error' && /No track path back/.test(f.message),
    );
    expect(errors).toHaveLength(1);
  });
});
