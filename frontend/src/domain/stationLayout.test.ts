import { describe, expect, it } from 'vitest';
import { createLine, emptyScenario } from './network';
import { createTracks, networkFrame, nodeEnds } from './tracks';
import { setServiceStops } from './serviceRouting';
import {
  crossSection,
  deleteStationObject,
  layoutError,
  placeStation,
  snapDrawingToStations,
  snapStationBearing,
  updateStationLayout,
} from './stationLayout';
import { trackSpacingM } from './trackParameters';
import { validateScenario } from '../validation/validate';
import { xy } from '../test/fixtures/tracks';

const tracksOf = (side: number, island: number) =>
  crossSection(emptyScenario().trackNetwork, 'tram', side, island).filter((e) => e.kind === 'track').length;

function station(s: ReturnType<typeof emptyScenario>, x: number, island = 1, side = 0) {
  const r = placeStation(s, {
    position: xy(x, 0),
    mode: 'tram',
    bearingDeg: 90,
    sidePlatforms: side,
    islandPlatforms: island,
  });
  if (r.error) throw new Error(r.error);
  return r;
}

describe('station objects', () => {
  it('have one track per platform face and at least one platform', () => {
    expect([tracksOf(1, 0), tracksOf(2, 0), tracksOf(0, 1), tracksOf(1, 1), tracksOf(2, 1)]).toEqual([
      1, 2, 2, 3, 4,
    ]);
    expect(layoutError(0, 0)).toMatch(/at least one platform/);
    expect(
      placeStation(emptyScenario(), {
        position: xy(0, 0),
        mode: 'tram',
        bearingDeg: 0,
        sidePlatforms: 0,
        islandPlatforms: 0,
      }).error,
    ).toMatch(/at least one/);
    // Island: tracks either side, centred on the axis.
    const els = crossSection(emptyScenario().trackNetwork, 'tram', 0, 1);
    expect(els.map((e) => e.kind)).toEqual(['track', 'island', 'track']);
    expect(els[0]!.offset).toBeCloseTo(-els[2]!.offset, 9);
  });

  it('end at the normal double-track spacing so drawn double track connects, and services run through', () => {
    let s = emptyScenario();
    const a = station(s, 0);
    const b = station(a.scenario, 600);
    s = b.scenario;
    const net = s.trackNetwork;
    const spacing = trackSpacingM(net, 'tram');
    const ends = a.station!.layout!.trackIds.map((id) => net.tracks.find((t) => t.id === id)!);
    const frame = networkFrame(net);
    const endA = ends.map((t) => frame.toMetres(net.nodes.find((n) => n.id === t.toNodeId)!.position));
    expect(Math.hypot(endA[0]![0] - endA[1]![0], endA[0]![1] - endA[1]![1])).toBeCloseTo(spacing, 6);
    // Connect A's east end to B's west end with a double track drawn between the two throats.
    const mid = (st: typeof a.station, end: 'fromNodeId' | 'toNodeId') => {
      const ps = st!.layout!.trackIds.map((id) => {
        const t = net.tracks.find((x) => x.id === id)!;
        return frame.toMetres(net.nodes.find((n) => n.id === t[end])!.position);
      });
      return frame.toLngLat([(ps[0]![0] + ps[1]![0]) / 2, (ps[0]![1] + ps[1]![1]) / 2]);
    };
    const aEast = mid(a.station, 'toNodeId');
    const bWest = mid(b.station, 'fromNodeId');
    s = createTracks(s, { points: [aEast, bWest], mode: 'tram', double: true }).scenario;
    const joined = s.trackNetwork.nodes.filter((n) => nodeEnds(s.trackNetwork, n.id).length === 2);
    expect(joined).toHaveLength(4);
    const c = createLine(s, { coordinates: [xy(0, 0), xy(600, 0)], mode: 'tram' });
    s = setServiceStops(c.scenario, c.line.id, [a.station!.id, b.station!.id]);
    const line = s.lines.find((l) => l.id === c.line.id)!;
    expect(line.alignment).toMatchObject({ kind: 'track', status: 'routed' });
    expect(line.alignment.kind === 'track' && line.alignment.returnPath?.length).toBeGreaterThan(0);
  });

  it('take a track drawn into them at their end, for double track at both tracks', () => {
    let s = station(emptyScenario(), 0).scenario;
    s = station(s, 600).scenario;
    const pts = snapDrawingToStations(s, [xy(0, 0), xy(600, 0)], true);
    s = createTracks(s, { points: pts, mode: 'tram', double: true }).scenario;
    const joined = s.trackNetwork.nodes.filter((n) => nodeEnds(s.trackNetwork, n.id).length === 2);
    expect(joined).toHaveLength(4);
    // No platform track was split.
    expect(s.trackNetwork.tracks).toHaveLength(6);
  });

  it('move and rotate with their tracks; connected track follows', () => {
    let s = station(emptyScenario(), 0, 0, 1).scenario;
    const st = s.stations[0]!;
    const t0 = s.trackNetwork.tracks[0]!;
    const east = s.trackNetwork.nodes.find((n) => n.id === t0.toNodeId)!.position;
    s = createTracks(s, { points: [east, xy(400, 0)], mode: 'tram' }).scenario;
    expect(nodeEnds(s.trackNetwork, t0.toNodeId)).toHaveLength(2);
    const moved = updateStationLayout(s, st.id, { position: xy(0, 50), bearingDeg: 80 }).scenario;
    const node = moved.trackNetwork.nodes.find((n) => n.id === t0.toNodeId)!;
    expect(networkFrame(moved.trackNetwork).toMetres(node.position)[1]).toBeGreaterThan(50);
    // Still connected: the outside track ends at the moved node.
    expect(nodeEnds(moved.trackNetwork, t0.toNodeId)).toHaveLength(2);
  });

  it('change track count with the platforms, and delete with their tracks', () => {
    const s = station(emptyScenario(), 0, 1).scenario;
    const id = s.stations[0]!.id;
    const more = updateStationLayout(s, id, { sidePlatforms: 1 }).scenario;
    expect(more.stations[0]!.layout!.trackIds).toHaveLength(3);
    expect(more.trackNetwork.tracks).toHaveLength(3);
    expect(updateStationLayout(more, id, { sidePlatforms: 0, islandPlatforms: 0 }).error).toMatch(
      /at least one/,
    );
    const gone = deleteStationObject(more, id);
    expect(gone.stations).toHaveLength(0);
    expect(gone.trackNetwork.tracks).toHaveLength(0);
  });

  it('snap their bearing to nearby straight track', () => {
    const s = createTracks(emptyScenario(), { points: [xy(-300, 30), xy(300, 30)], mode: 'tram' }).scenario;
    const snap = snapStationBearing(s, null, xy(0, 0), 93);
    expect(snap.snapped).toBe(true);
    expect(snap.bearingDeg).toBeCloseTo(90, 5);
    expect(snapStationBearing(s, null, xy(0, 0), 60).snapped).toBe(false);
    expect(snapStationBearing(s, null, xy(0, 500), 93).snapped).toBe(false);
  });

  it('report platforms shorter than the trains and services of another mode', () => {
    let s = station(emptyScenario(), 0).scenario;
    s = station(s, 600).scenario;
    const [a, b] = s.stations;
    const tram = s.vehicleTypes.find((v) => v.mode === 'tram')!;
    const c = createLine(s, { coordinates: [xy(0, 0), xy(600, 0)], mode: 'tram' });
    s = setServiceStops(c.scenario, c.line.id, [a!.id, b!.id]);
    s = {
      ...s,
      lines: s.lines.map((l) =>
        l.id === c.line.id ? { ...l, vehicleTypeId: tram.id, consistUnits: 10 } : l,
      ),
    };
    const msgs = validateScenario(s)
      .filter((f) => f.lineId === c.line.id)
      .map((f) => f.message);
    expect(msgs.some((m) => /Platforms at "Station 1" are 45 m long/.test(m))).toBe(true);
    const bus = createLine(s, { coordinates: [xy(0, 0), xy(600, 0)], mode: 'bus' });
    const withBus = {
      ...bus.scenario,
      lines: bus.scenario.lines.map((l) =>
        l.id === bus.line.id ? { ...l, stops: [{ ...l.stops[0]!, stationId: a!.id }] } : l,
      ),
    };
    const busMsgs = validateScenario(withBus)
      .filter((f) => f.lineId === bus.line.id)
      .map((f) => f.message);
    expect(busMsgs.some((m) => /cannot call there/.test(m))).toBe(true);
  });
});
