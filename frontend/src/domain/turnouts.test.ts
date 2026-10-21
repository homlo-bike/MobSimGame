import { describe, expect, it } from 'vitest';
import type { Scenario } from './schema';
import { emptyScenario } from './network';
import { createTracks, movementHas, nodeEnds } from './tracks';
import {
  crossingRoutes,
  divergingRadiusM,
  divergingRestrictions,
  setTurnout,
  slipCandidates,
  turnoutDesign,
  turnoutRoles,
  TURNOUT_DESIGNS,
} from './turnouts';
import { validateTrackNetwork } from '../validation/trackValidation';
import { xy } from '../test/fixtures/tracks';

/** Straight track 0→400 m east, and a branch leaving it at 200 m, curving north with `radius`. */
function branch(radius: number): { s: Scenario; nodeId: string } {
  let s = createTracks(emptyScenario(), {
    points: [xy(0, 0), xy(400, 0)],
    mode: 'commuter_rail',
    double: false,
  }).scenario;
  s = createTracks(s, {
    points: [xy(200, 0), xy(320, 0), xy(450, 80)],
    mode: 'commuter_rail',
    double: false,
    radii: [null, radius, null],
  }).scenario;
  const node = s.trackNetwork.nodes.find((n) => nodeEnds(s.trackNetwork, n.id).length === 3)!;
  return { s, nodeId: node.id };
}

/** Two tracks crossing at a shallow angle at (200, 0), joined in one node. */
function crossing(): { s: Scenario; nodeId: string } {
  let s = createTracks(emptyScenario(), {
    points: [xy(0, 0), xy(400, 0)],
    mode: 'tram',
    double: false,
  }).scenario;
  s = createTracks(s, { points: [xy(0, -100), xy(200, 0)], mode: 'tram', double: false }).scenario;
  s = createTracks(s, { points: [xy(200, 0), xy(400, 100)], mode: 'tram', double: false }).scenario;
  const node = s.trackNetwork.nodes.find((n) => nodeEnds(s.trackNetwork, n.id).length === 4)!;
  return { s, nodeId: node.id };
}

describe('turnouts', () => {
  it('finds the toe, the main and the diverging route from the geometry', () => {
    const { s, nodeId } = branch(300);
    const net = s.trackNetwork;
    const roles = turnoutRoles(net, nodeId)!;
    expect(roles).not.toBeNull();
    const pos = (trackId: string) => net.tracks.find((t) => t.id === trackId)!;
    // The toe is the western part of the straight track; the branch diverges.
    const toeTrack = pos(roles.toe.trackId);
    const branchTrack = pos(roles.diverging.trackId);
    expect(toeTrack.groupId === branchTrack.groupId && toeTrack.id === branchTrack.id).toBe(false);
    expect(roles.divergenceDeg).toBeLessThan(10);
    expect(divergingRadiusM(net, roles)).toBeCloseTo(300, 0);
  });

  it('permits toe–main and toe–diverging, never main–diverging', () => {
    const { s, nodeId } = branch(300);
    const t = setTurnout(s, nodeId, {
      kind: 'simple',
      designId: 'db-ew-300-9',
      slip: null,
      radiusM: null,
      divergingSpeedKmh: null,
    });
    const node = t.trackNetwork.nodes.find((n) => n.id === nodeId)!;
    const roles = turnoutRoles(t.trackNetwork, nodeId)!;
    expect(node.movementMode).toBe('turnout');
    expect(node.movements).toHaveLength(2);
    expect(node.movements.some((m) => movementHas(m, roles.main, roles.diverging))).toBe(false);
    // Removing it brings back the geometric movements.
    const back = setTurnout(t, nodeId, null).trackNetwork.nodes.find((n) => n.id === nodeId)!;
    expect(back.movementMode).toBe('auto');
  });

  it('warns when the diverging track is tighter than the turnout', () => {
    const { s, nodeId } = branch(190);
    const t = setTurnout(s, nodeId, {
      kind: 'simple',
      designId: 'db-ew-500-12',
      slip: null,
      radiusM: null,
      divergingSpeedKmh: null,
    });
    const msgs = validateTrackNetwork(t)
      .filter((f) => f.nodeId === nodeId)
      .map((f) => f.message);
    expect(msgs.some((m) => /tighter than the turnout's 500 m/.test(m))).toBe(true);
    const ok = setTurnout(s, nodeId, {
      kind: 'simple',
      designId: 'db-ew-190-9',
      slip: null,
      radiusM: null,
      divergingSpeedKmh: null,
    });
    expect(validateTrackNetwork(ok).some((f) => f.nodeId === nodeId && /tighter/.test(f.message))).toBe(
      false,
    );
  });

  it('reports a kind that does not match the track ends', () => {
    const { s, nodeId } = branch(300);
    const t = setTurnout(s, nodeId, {
      kind: 'diamond',
      designId: null,
      slip: null,
      radiusM: null,
      divergingSpeedKmh: null,
    });
    expect(
      validateTrackNetwork(t).some(
        (f) => f.nodeId === nodeId && f.severity === 'error' && /4 track ends/.test(f.message),
      ),
    ).toBe(true);
  });

  it('crossings: two straight routes, slips add the movements between them', () => {
    const { s, nodeId } = crossing();
    const net = s.trackNetwork;
    expect(crossingRoutes(net, nodeId)).not.toBeNull();
    const slips = slipCandidates(net, nodeId);
    expect(slips).toHaveLength(2);
    const mk = (kind: 'diamond' | 'single_slip' | 'double_slip') =>
      setTurnout(s, nodeId, {
        kind,
        designId: null,
        slip: null,
        radiusM: null,
        divergingSpeedKmh: null,
      }).trackNetwork.nodes.find((n) => n.id === nodeId)!.movements.length;
    expect(mk('diamond')).toBe(2);
    expect(mk('single_slip')).toBe(3);
    expect(mk('double_slip')).toBe(4);
  });

  it('limits the speed where a service takes the diverging route', () => {
    const { s, nodeId } = branch(300);
    const t = setTurnout(s, nodeId, {
      kind: 'simple',
      designId: 'db-ew-300-9',
      slip: null,
      radiusM: null,
      divergingSpeedKmh: null,
    });
    const net = t.trackNetwork;
    const roles = turnoutRoles(net, nodeId)!;
    const step = (trackId: string, toNode: boolean) => ({
      trackId,
      reversed: false,
      from: toNode ? 0 : 1,
      to: toNode ? 1 : 0,
    });
    const toeTrack = net.tracks.find((x) => x.id === roles.toe.trackId)!;
    const divTrack = net.tracks.find((x) => x.id === roles.diverging.trackId)!;
    // Run along the toe track to the node, then out along the diverging track.
    const towards = (tr: typeof toeTrack, end: 'start' | 'end') => step(tr.id, end === 'end');
    const away = (tr: typeof divTrack, end: 'start' | 'end') => step(tr.id, end === 'start');
    const via = [towards(toeTrack, roles.toe.end), away(divTrack, roles.diverging.end)];
    const r = divergingRestrictions(net, via);
    expect(r).toHaveLength(1);
    expect(r[0]!.speedKmh).toBe(turnoutDesign('db-ew-300-9')!.divergingSpeedKmh);
    // Straight through: no restriction.
    const mainTrack = net.tracks.find((x) => x.id === roles.main.trackId)!;
    expect(
      divergingRestrictions(net, [towards(toeTrack, roles.toe.end), away(mainTrack, roles.main.end)]),
    ).toEqual([]);
  });

  it('catalogue designs carry radius, inclination, speed and a source', () => {
    expect(TURNOUT_DESIGNS.length).toBeGreaterThan(5);
    for (const d of TURNOUT_DESIGNS) {
      expect(d.radiusM).toBeGreaterThan(0);
      expect(d.divergingSpeedKmh).toBeGreaterThan(0);
      expect(d.source).toMatch(/Wikipedia/);
    }
    expect(new Set(TURNOUT_DESIGNS.map((d) => d.id)).size).toBe(TURNOUT_DESIGNS.length);
  });
});
