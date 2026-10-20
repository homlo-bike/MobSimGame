import { describe, expect, it } from 'vitest';
import type { Scenario } from './schema';
import { parseProject, SCHEMA_VERSION } from './schema';
import { emptyScenario, createLine } from './network';
import {
  autoMovements,
  createTracks,
  moveNode,
  nodeEnds,
  removeTrack,
  setMovement,
  splitTrack,
  trackGeometry,
  trackUsage,
} from './tracks';
import { components, shortestPath, singleTrackBlocks } from './trackGraph';
import {
  addStationOnTracks,
  deleteTrackWithServices,
  setServiceStops,
  suggestStationTracks,
} from './serviceRouting';
import { parameter, TRACK_PARAMETERS } from './trackParameters';
import { validateTrackNetwork } from '../validation/trackValidation';
import { railLine, xy } from '../test/fixtures/tracks';
import { blankProject } from '../store/projectStore';

const track = (s: Scenario, i = 0) => s.trackNetwork.tracks[i]!;

describe('track parameters', () => {
  it('every parameter has a source, a range containing the default, and a status', () => {
    for (const p of Object.values(TRACK_PARAMETERS)) {
      expect(p.source.length).toBeGreaterThan(10);
      expect(p.min).toBeLessThanOrEqual(p.defaultValue);
      expect(p.defaultValue).toBeLessThanOrEqual(p.max);
      if (p.status === 'demonstration') expect(p.source).toMatch(/placeholder|editor tolerance/i);
    }
  });

  it('applies valid user overrides and ignores out-of-range ones', () => {
    expect(
      parameter({ parameterOverrides: { stationTrackSearchM: 35 } }, 'stationTrackSearchM'),
    ).toMatchObject({
      value: 35,
      status: 'user_override',
    });
    expect(parameter({ parameterOverrides: { stationTrackSearchM: -1 } }, 'stationTrackSearchM').value).toBe(
      20,
    );
  });
});

describe('creating tracks', () => {
  it('draws a single track with nodes at the ends and the cited default radius', () => {
    const r = createTracks(emptyScenario(), { points: [xy(0, 0), xy(500, 0), xy(500, 500)], mode: 'metro' });
    expect(r.trackIds).toHaveLength(1);
    expect(r.scenario.trackNetwork.nodes).toHaveLength(2);
    expect(track(r.scenario).radii).toEqual([200]);
    const g = trackGeometry(r.scenario.trackNetwork, track(r.scenario));
    expect(g.primitives.map((p) => p.kind)).toEqual(['line', 'arc', 'line']);
    // Length = 2 × (500 − T) + arc, with T = R tan 45° = 200 and arc = R π/2.
    expect(g.lengthM).toBeCloseTo(2 * 300 + 100 * Math.PI, 0);
  });

  it('draws double track as two physical tracks with their own ids, opposite directions and concentric radii', () => {
    const r = createTracks(emptyScenario(), {
      points: [xy(0, 0), xy(500, 0), xy(500, 500)],
      mode: 'metro',
      double: true,
    });
    expect(r.trackIds).toHaveLength(2);
    const [left, right] = r.trackIds.map((id) => r.scenario.trackNetwork.tracks.find((t) => t.id === id)!);
    expect(left!.groupId).toBe(r.groupId);
    expect(right!.groupId).toBe(r.groupId);
    expect(r.scenario.trackNetwork.groups[0]!.spacingM).toBe(4);
    // Right-hand running: the right track runs in the drawing direction.
    expect(right!.direction).toBe('forward');
    expect(left!.direction).toBe('backward');
    // A left curve: the left (inner) track has radius R − s/2, the right (outer) R + s/2. The default
    // centre-line radius keeps the inner track at the cited recommended 200 m.
    expect(left!.radii[0]).toBeCloseTo(200, 6);
    expect(right!.radii[0]).toBeCloseTo(204, 6);
    expect(r.scenario.trackNetwork.nodes).toHaveLength(4);
  });

  it('uses the tram placeholder spacing for trams and rejects radii too small for the spacing', () => {
    const r = createTracks(emptyScenario(), {
      points: [xy(0, 0), xy(200, 0), xy(200, 200)],
      mode: 'tram',
      double: true,
    });
    expect(r.scenario.trackNetwork.groups[0]!.spacingM).toBe(3.2);
    const bad = createTracks(emptyScenario(), {
      points: [xy(0, 0), xy(200, 0), xy(200, 200)],
      mode: 'tram',
      double: true,
      // Centre-line radii (as from an import) smaller than half the spacing collapse the inner track.
      radii: [null, 1, null],
    });
    expect(bad.error).toMatch(/too tight for double track/);
  });

  it('continues an existing track at its end node and permits the through movement', () => {
    let s = createTracks(emptyScenario(), { points: [xy(0, 0), xy(300, 0)], mode: 'tram' }).scenario;
    s = createTracks(s, { points: [xy(300, 1), xy(600, 0)], mode: 'tram' }).scenario;
    expect(s.trackNetwork.nodes).toHaveLength(3);
    const mid = s.trackNetwork.nodes.find((n) => nodeEnds(s.trackNetwork, n.id).length === 2)!;
    expect(mid.movements).toHaveLength(1);
    expect(components(s.trackNetwork)).toHaveLength(1);
  });

  it('joins a branch to the middle of a track by splitting it into a junction', () => {
    let s = createTracks(emptyScenario(), { points: [xy(0, 0), xy(600, 0)], mode: 'tram' }).scenario;
    s = createTracks(s, { points: [xy(300, 2), xy(500, 200)], mode: 'tram' }).scenario;
    expect(s.trackNetwork.tracks).toHaveLength(3);
    const junction = s.trackNetwork.nodes.find((n) => nodeEnds(s.trackNetwork, n.id).length === 3)!;
    expect(junction).toBeTruthy();
    // Straight through, and from the west into the branch (it leaves eastwards); not east → branch.
    expect(junction.movements).toHaveLength(2);
    expect(autoMovements(s.trackNetwork, junction.id)).toHaveLength(2);
  });

  it('never connects tracks that only cross; reports the crossing on the same level only', () => {
    let s = createTracks(emptyScenario(), { points: [xy(0, 0), xy(600, 0)], mode: 'tram' }).scenario;
    s = createTracks(s, { points: [xy(300, -300), xy(300, 300)], mode: 'tram' }).scenario;
    const net = s.trackNetwork;
    expect(components(net)).toHaveLength(2);
    expect(
      shortestPath(net, { trackId: track(s, 0).id, fraction: 0 }, { trackId: track(s, 1).id, fraction: 1 }),
    ).toBeNull();
    expect(validateTrackNetwork(s).some((f) => /cross on the same level/.test(f.message))).toBe(true);
    let bridge = createTracks(emptyScenario(), { points: [xy(0, 0), xy(600, 0)], mode: 'tram' }).scenario;
    bridge = createTracks(bridge, {
      points: [xy(300, -300), xy(300, 300)],
      mode: 'tram',
      structure: 'bridge',
    }).scenario;
    expect(validateTrackNetwork(bridge).some((f) => /cross on the same level/.test(f.message))).toBe(false);
  });
});

describe('editing tracks', () => {
  it('moving a node moves every connected track', () => {
    let s = createTracks(emptyScenario(), { points: [xy(0, 0), xy(300, 0)], mode: 'tram' }).scenario;
    s = createTracks(s, { points: [xy(300, 0), xy(300, 300)], mode: 'tram' }).scenario;
    const mid = s.trackNetwork.nodes.find((n) => nodeEnds(s.trackNetwork, n.id).length === 2)!;
    const before = s.trackNetwork.tracks.map((t) => trackGeometry(s.trackNetwork, t).lengthM);
    s = moveNode(s, mid.id, xy(400, 0));
    const after = s.trackNetwork.tracks.map((t) => trackGeometry(s.trackNetwork, t).lengthM);
    expect(after[0]).toBeCloseTo(before[0]! + 100, 0);
    expect(after[1]).toBeGreaterThan(before[1]!);
  });

  it('splits a track inside an arc without changing the geometry, keeping stations and services', () => {
    const { s, line } = railLine([xy(0, 0), xy(500, 0), xy(500, 500)], 'metro', [xy(0, 0), xy(500, 500)], {
      double: false,
    });
    const t = track(s);
    const g = trackGeometry(s.trackNetwork, t);
    const res = splitTrack(s, t.id, 0.5);
    expect(res.trackIds).not.toBeNull();
    const parts = res.trackIds!.map((id) => res.scenario.trackNetwork.tracks.find((x) => x.id === id)!);
    const sum = parts.reduce((a, p) => a + trackGeometry(res.scenario.trackNetwork, p).lengthM, 0);
    expect(sum).toBeCloseTo(g.lengthM, 3);
    expect(parts.every((p) => p.radii.every((r) => r === null || Math.abs(r - 200) < 1e-6))).toBe(true);
    const served = res.scenario.stations.flatMap((st) => st.trackRefs.map((r) => r.trackId));
    expect(new Set(served)).toEqual(new Set(res.trackIds));
    const routed = res.scenario.lines.find((l) => l.id === line.id)!;
    expect(routed.alignment.kind === 'track' && routed.alignment.path.map((p) => p.trackId)).toEqual(
      res.trackIds,
    );
  });

  it('manual movements can forbid a connection', () => {
    let s = createTracks(emptyScenario(), { points: [xy(0, 0), xy(300, 0)], mode: 'tram' }).scenario;
    s = createTracks(s, { points: [xy(300, 0), xy(600, 0)], mode: 'tram' }).scenario;
    const mid = s.trackNetwork.nodes.find((n) => nodeEnds(s.trackNetwork, n.id).length === 2)!;
    const [a, b] = nodeEnds(s.trackNetwork, mid.id);
    const off = setMovement(s, mid.id, a!, b!, false);
    expect(off.trackNetwork.nodes.find((n) => n.id === mid.id)!.movementMode).toBe('manual');
    expect(
      shortestPath(
        off.trackNetwork,
        { trackId: track(off, 0).id, fraction: 0 },
        { trackId: track(off, 1).id, fraction: 1 },
      ),
    ).toBeNull();
  });
});

describe('graph', () => {
  it('respects running directions', () => {
    const r = createTracks(emptyScenario(), { points: [xy(0, 0), xy(500, 0)], mode: 'tram', double: true });
    const net = r.scenario.trackNetwork;
    const right = net.tracks.find((t) => t.direction === 'forward')!;
    expect(
      shortestPath(net, { trackId: right.id, fraction: 0.1 }, { trackId: right.id, fraction: 0.9 }),
    ).not.toBeNull();
    expect(
      shortestPath(net, { trackId: right.id, fraction: 0.9 }, { trackId: right.id, fraction: 0.1 }),
    ).toBeNull();
  });

  it('groups consecutive single tracks into one block and stops at a passing loop', () => {
    let s = createTracks(emptyScenario(), { points: [xy(0, 0), xy(300, 0)], mode: 'tram' }).scenario;
    s = createTracks(s, { points: [xy(300, 0), xy(600, 0)], mode: 'tram' }).scenario;
    let blocks = singleTrackBlocks(s.trackNetwork);
    expect(new Set([...blocks.values()].map((b) => b.blockId)).size).toBe(1);
    // A passing loop at the east end: a second track from 600 to 900 and back.
    s = createTracks(s, { points: [xy(600, 0), xy(900, 0)], mode: 'tram' }).scenario;
    s = createTracks(s, {
      points: [xy(600, 0), xy(750, 30), xy(900, 0)],
      mode: 'tram',
      radiusM: null,
    }).scenario;
    blocks = singleTrackBlocks(s.trackNetwork);
    const ids = s.trackNetwork.tracks.map((t) => blocks.get(t.id)!.blockId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });
});

describe('stations on tracks', () => {
  it('suggests tracks within 20 m on the same level only', () => {
    let s = createTracks(emptyScenario(), {
      points: [xy(0, 0), xy(500, 0)],
      mode: 'metro',
      double: true,
      structure: 'at_grade',
    }).scenario;
    s = createTracks(s, {
      points: [xy(0, 15), xy(500, 15)],
      mode: 'metro',
      structure: 'underground',
    }).scenario;
    s = createTracks(s, { points: [xy(0, 40), xy(500, 40)], mode: 'metro', structure: 'at_grade' }).scenario;
    const near = suggestStationTracks(s, xy(250, 0), 0);
    expect(near).toHaveLength(2);
    expect(near.every((h) => h.track.level === 0 && h.distanceM <= 20)).toBe(true);
    const station = addStationOnTracks(s, xy(250, 1));
    expect(station.station!.trackRefs).toHaveLength(2);
    expect(station.station!.construction).toBe('surface');
  });
});

describe('services on tracks', () => {
  it('routes out on one track and back on the other on double track', () => {
    const { s, line } = railLine([xy(0, 0), xy(1000, 0)], 'tram', [xy(0, 0), xy(500, 0), xy(1000, 0)]);
    expect(line.alignment.kind).toBe('track');
    if (line.alignment.kind !== 'track') return;
    expect(line.alignment.status).toBe('routed');
    const out = new Set(line.alignment.path.map((p) => p.trackId));
    const back = new Set(line.alignment.returnPath!.map((p) => p.trackId));
    expect([...out].some((id) => back.has(id))).toBe(false);
    const fwd = s.trackNetwork.tracks.find((t) => t.direction === 'forward')!;
    expect([...out]).toEqual([fwd.id]);
    expect(line.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(line.segments.every((x) => x.tracks === 'double')).toBe(true);
  });

  it('reports a service whose stations are not connected', () => {
    let s = createTracks(emptyScenario(), { points: [xy(0, 0), xy(300, 0)], mode: 'tram' }).scenario;
    s = createTracks(s, { points: [xy(0, 100), xy(300, 100)], mode: 'tram' }).scenario;
    const a = addStationOnTracks(s, xy(0, 0));
    const b = addStationOnTracks(a.scenario, xy(300, 100));
    const c = createLine(b.scenario, { coordinates: [xy(0, 0), xy(300, 100)], mode: 'tram' });
    const routed = setServiceStops(c.scenario, c.line.id, [a.station!.id, b.station!.id]);
    const l = routed.lines[0]!;
    expect(l.alignment.kind === 'track' && l.alignment.status).toBe('unrouted');
    expect(l.alignment.kind === 'track' && l.alignment.message).toMatch(/No permitted track path/);
  });

  it('deleting a used track: break, reroute or delete the services', () => {
    // Two parallel single tracks between the same stations: the service can reroute.
    let s = createTracks(emptyScenario(), { points: [xy(0, 0), xy(1000, 0)], mode: 'tram' }).scenario;
    s = createTracks(s, {
      points: [xy(0, 0), xy(500, 300), xy(1000, 0)],
      mode: 'tram',
      radiusM: null,
    }).scenario;
    const a = addStationOnTracks(s, xy(0, 0));
    const b = addStationOnTracks(a.scenario, xy(1000, 0));
    const c = createLine(b.scenario, { coordinates: [xy(0, 0), xy(1000, 0)], mode: 'tram' });
    s = setServiceStops(c.scenario, c.line.id, [a.station!.id, b.station!.id]);
    const used = (s.lines[0]!.alignment.kind === 'track' && s.lines[0]!.alignment.path[0]!.trackId) as string;
    expect(trackUsage(s, used).lineIds).toEqual([c.line.id]);
    const broken = deleteTrackWithServices(s, used, 'break').lines[0]!;
    expect(broken.alignment.kind === 'track' && broken.alignment.status).toBe('unrouted');
    const rerouted = deleteTrackWithServices(s, used, 'reroute').lines[0]!;
    expect(rerouted.alignment.kind === 'track' && rerouted.alignment.status).toBe('routed');
    expect(deleteTrackWithServices(s, used, 'delete_services').lines).toHaveLength(0);
    expect(removeTrack(s, used).trackNetwork.tracks).toHaveLength(1);
  });
});

describe('schema 3', () => {
  it('rejects projects saved in older formats with a clear message', () => {
    const res = parseProject({ schemaVersion: 2, id: 'x' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]).toMatch(/older, unpublished format/);
  });

  it('round-trips a project with a track network', () => {
    const { s } = railLine([xy(0, 0), xy(600, 0), xy(600, 600)], 'tram', [xy(0, 0), xy(600, 600)]);
    const project = { ...blankProject(), scenarios: [s], activeScenarioId: s.id };
    expect(project.schemaVersion).toBe(SCHEMA_VERSION);
    const res = parseProject(JSON.parse(JSON.stringify(project)));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.project.scenarios[0]!.trackNetwork.tracks).toHaveLength(2);
  });

  it('reports references to missing nodes', () => {
    const { s } = railLine([xy(0, 0), xy(600, 0)], 'tram', [xy(0, 0), xy(600, 0)]);
    const broken = { ...s, trackNetwork: { ...s.trackNetwork, nodes: s.trackNetwork.nodes.slice(1) } };
    const res = parseProject({ ...blankProject(), scenarios: [broken], activeScenarioId: broken.id });
    expect(res.ok).toBe(false);
  });
});
