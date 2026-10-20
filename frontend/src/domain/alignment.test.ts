import { describe, expect, it } from 'vitest';
import type { LngLat } from './schema';
import { createLine, emptyScenario, setLineAlignmentKind, updateLineGeometry } from './network';
import {
  applyReturnRoute,
  applyRouteResults,
  buildAlignment,
  defaultAlignmentKind,
  editablePoints,
  routeStatus,
  setLegManual,
} from './alignment';

const wps: LngLat[] = [
  [0, 0],
  [0.01, 0],
  [0.02, 0.005],
];

function busLine() {
  return createLine(emptyScenario(), { coordinates: wps, mode: 'bus' });
}

describe('alignments', () => {
  it('runs track modes on tracks, buses on streets and other modes on straight segments', () => {
    expect(defaultAlignmentKind('tram')).toBe('track');
    expect(defaultAlignmentKind('commuter_rail')).toBe('track');
    expect(defaultAlignmentKind('bus')).toBe('routed');
    expect(defaultAlignmentKind('brt')).toBe('routed');
    expect(defaultAlignmentKind('cycling')).toBe('polyline');
  });

  it('starts street-routed lines with every section unrouted', () => {
    const { line } = busLine();
    expect(routeStatus(line)).toEqual({ total: 2, routed: 0, manual: 0, unrouted: 2 });
    expect(editablePoints(line)).toEqual(wps);
  });

  it('applies routed legs and keeps the line joined at the waypoints', () => {
    const { line } = busLine();
    const routed = applyRouteResults(
      line,
      [
        {
          status: 'routed',
          coordinates: [
            [0, 0],
            [0.005, 0.001],
            [0.01, 0],
          ],
          message: '',
        },
        { status: 'failed', coordinates: [], message: 'No path' },
      ],
      'Valhalla',
      false,
    );
    expect(routeStatus(routed)).toMatchObject({ routed: 1, unrouted: 1 });
    expect(routed.coordinates).toEqual([
      [0, 0],
      [0.005, 0.001],
      [0.01, 0],
      [0.02, 0.005],
    ]);
    if (routed.alignment.kind === 'routed') expect(routed.alignment.legs[1]!.message).toBe('No path');
  });

  it('keeps routed legs whose waypoints did not move and resets moved ones', () => {
    const { scenario, line } = busLine();
    const routed = applyRouteResults(
      line,
      [
        {
          status: 'routed',
          coordinates: [
            [0, 0],
            [0.005, 0.001],
            [0.01, 0],
          ],
          message: '',
        },
        {
          status: 'routed',
          coordinates: [
            [0.01, 0],
            [0.02, 0.005],
          ],
          message: '',
        },
      ],
      'Valhalla',
      false,
    );
    const sc = { ...scenario, lines: [routed] };
    const moved = updateLineGeometry(sc, line.id, [wps[0]!, wps[1]!, [0.03, 0.01]]).lines[0]!;
    expect(routeStatus(moved)).toMatchObject({ routed: 1, unrouted: 1 });
  });

  it('marks a section as an accepted manual sketch', () => {
    const { line } = busLine();
    const manual = setLegManual(line, 0, true, false);
    expect(routeStatus(manual)).toMatchObject({ manual: 1, unrouted: 1 });
    expect(routeStatus(setLegManual(manual, 0, false, false))).toMatchObject({ manual: 0, unrouted: 2 });
  });

  it('stores a separate return path only when it leaves the outbound streets', () => {
    const { line } = busLine();
    const out = applyRouteResults(
      line,
      [
        {
          status: 'routed',
          coordinates: [
            [0, 0],
            [0.01, 0],
          ],
          message: '',
        },
        {
          status: 'routed',
          coordinates: [
            [0.01, 0],
            [0.02, 0.005],
          ],
          message: '',
        },
      ],
      'Valhalla',
      false,
    );
    const same = applyReturnRoute(out, [
      {
        status: 'routed',
        coordinates: [
          [0.02, 0.005],
          [0.01, 0],
        ],
        message: '',
      },
      {
        status: 'routed',
        coordinates: [
          [0.01, 0],
          [0, 0],
        ],
        message: '',
      },
    ]);
    expect(same.alignment.kind === 'routed' && same.alignment.returnCoordinates).toBeNull();
    const other = applyReturnRoute(out, [
      {
        status: 'routed',
        coordinates: [
          [0.02, 0.005],
          [0.015, 0.004],
          [0.01, 0],
        ],
        message: '',
      },
      {
        status: 'routed',
        coordinates: [
          [0.01, 0],
          [0.005, 0.002],
          [0, 0],
        ],
        message: '',
      },
    ]);
    expect(other.alignment.kind === 'routed' && other.alignment.returnCoordinates).toHaveLength(5);
  });

  it('switches buses between streets and straight segments, but never puts rail on streets', () => {
    const bus = busLine();
    const straight = setLineAlignmentKind(bus.scenario, bus.line.id, 'polyline').lines[0]!;
    expect(straight.alignment.kind).toBe('polyline');
    expect(straight.coordinates).toEqual(wps);
    const tram = createLine(emptyScenario(), { coordinates: wps, mode: 'tram' });
    expect(tram.line.alignment.kind).toBe('track');
    // "Follow street" and "Straight segments" are not available for rail.
    expect(setLineAlignmentKind(tram.scenario, tram.line.id, 'routed')).toBe(tram.scenario);
    expect(setLineAlignmentKind(tram.scenario, tram.line.id, 'polyline')).toBe(tram.scenario);
    expect(buildAlignment('track', wps, false).alignment.kind).toBe('track');
  });
});
