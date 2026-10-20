import { describe, expect, it } from 'vitest';
import { allowedClasses, serviceCanUse, trackClass, vehicleTrackIssues } from './compatibility';
import { createLine } from './network';
import { setServiceStops } from './serviceRouting';
import { updateTrack } from './tracks';
import { validateScenario } from '../validation/validate';
import { railLine, xy } from '../test/fixtures/tracks';

/** A metro line with three stations, plus a tram service calling at the same stations. */
function metroWithTram() {
  const { s, line } = railLine([xy(0, 0), xy(1000, 0)], 'metro', [xy(100, 0), xy(500, 0), xy(900, 0)]);
  const c = createLine(s, { coordinates: [xy(100, 0), xy(900, 0)], mode: 'tram' });
  const tram = setServiceStops(
    c.scenario,
    c.line.id,
    line.stops.map((x) => x.stationId),
  );
  return { s: tram, metroId: line.id, tramId: c.line.id };
}

describe('infrastructure compatibility', () => {
  it('derives the class from the design mode and applies the default matrix', () => {
    const t = { infrastructureClass: null, designMode: 'elevated_metro' as const };
    expect(trackClass(t)).toBe('metro');
    // Every mode keeps to its own infrastructure: no sharing, not even tram and light rail.
    expect(serviceCanUse('tram', { infrastructureClass: null, designMode: 'tram' })).toBe(true);
    expect(serviceCanUse('tram', { infrastructureClass: 'light_rail', designMode: 'tram' })).toBe(false);
    expect(serviceCanUse('tram', t)).toBe(false);
    expect(serviceCanUse('commuter_rail', { infrastructureClass: null, designMode: 'tram' })).toBe(false);
    expect(allowedClasses('metro')).toEqual(['metro']);
    expect(allowedClasses('bus')).toEqual(['bus']);
    expect(allowedClasses('trolleybus')).toEqual(['trolleybus']);
  });

  it('routes a service only over track its mode may use', () => {
    const { s, metroId, tramId } = metroWithTram();
    expect(s.lines.find((l) => l.id === metroId)!.alignment).toMatchObject({ status: 'routed' });
    const tram = s.lines.find((l) => l.id === tramId)!;
    expect(tram.alignment).toMatchObject({ status: 'unrouted' });
    expect(tram.alignment.kind === 'track' && tram.alignment.message).toMatch(
      /has no track this tram \/ streetcar service may use/,
    );
  });

  it('reports an error when a routed service runs on track of a class it may not use', () => {
    const { s, metroId } = metroWithTram();
    const metro = s.lines.find((l) => l.id === metroId)!;
    const trackId = metro.alignment.kind === 'track' ? metro.alignment.path[0]!.trackId : '';
    // Change the class without rerouting, as an imported or stale project could have it.
    const changed = updateTrack(s, trackId, { infrastructureClass: 'railway' });
    const msgs = validateScenario(changed)
      .filter((f) => f.lineId === metroId && f.severity === 'error')
      .map((f) => f.message);
    expect(msgs.some((m) => /may not use railway track \(1 track/.test(m))).toBe(true);
  });

  it('flags gauge and electrification conflicts, never unknown values', () => {
    const v = { name: 'Tram A', gaugeMm: 1435, energy: 'electric_overhead' as const };
    expect(vehicleTrackIssues(v, { gaugeMm: null, electrification: 'unknown' })).toEqual([]);
    expect(vehicleTrackIssues(v, { gaugeMm: 1435, electrification: 'overhead' })).toEqual([]);
    const issues = vehicleTrackIssues(v, { gaugeMm: 1000, electrification: 'third_rail' });
    expect(issues.map((i) => i.kind)).toEqual(['gauge', 'electrification']);
    expect(
      vehicleTrackIssues({ ...v, energy: 'battery' }, { gaugeMm: 1435, electrification: 'none' }),
    ).toEqual([]);
  });
});
