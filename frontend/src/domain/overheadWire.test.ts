import { describe, expect, it } from 'vitest';
import type { Electrification, Scenario } from './schema';
import { emptyScenario } from './network';
import { createTracks } from './tracks';
import { createStopLine } from './stopLines';
import { wirePaths, wireRailCrossings, wireSummary } from './overheadWire';
import { validateScenario } from '../validation/validate';
import { xy } from '../test/fixtures/tracks';

function setup(electrification: Electrification, mode: 'tram' | 'metro' = 'tram', level?: number) {
  let s: Scenario = createTracks(emptyScenario(), {
    points: [xy(250, -300), xy(250, 300)],
    mode,
    ...(level !== undefined ? { level } : {}),
  }).scenario;
  s = {
    ...s,
    trackNetwork: {
      ...s.trackNetwork,
      tracks: s.trackNetwork.tracks.map((t) => ({ ...t, electrification })),
    },
  };
  // A one-way loop from (0, 0) to (500, 0) and back crosses the track twice.
  const res = createStopLine(s, {
    points: [xy(0, 0), xy(500, 0), xy(500, 100), xy(0, 100)],
    mode: 'trolleybus',
  });
  return { scenario: res.scenario, line: res.line! };
}

describe('trolleybus overhead wire', () => {
  it('follows every trolleybus line', () => {
    const { scenario, line } = setup('none');
    expect(wirePaths(scenario)).toHaveLength(1);
    expect(wireSummary(scenario, line)!.lengthM).toBeGreaterThan(1100);
  });

  it('warns where it crosses a rail overhead line on the same level', () => {
    const { scenario, line } = setup('overhead');
    const crossings = wireRailCrossings(scenario, line);
    expect(crossings).toHaveLength(2);
    expect(crossings.every((c) => c.overhead)).toBe(true);
    const warnings = validateScenario(scenario).filter(
      (f) => f.lineId === line.id && f.severity === 'warning' && /overhead line of/.test(f.message),
    );
    expect(warnings).toHaveLength(2);
  });

  it('notes a crossing when the track electrification is not specified', () => {
    const { scenario, line } = setup('unknown');
    const notes = validateScenario(scenario).filter(
      (f) => f.lineId === line.id && /electrification is not specified/.test(f.message),
    );
    expect(notes.map((f) => f.severity)).toEqual(['info', 'info']);
  });

  it('ignores third rail, unelectrified and other-level track', () => {
    expect(
      wireRailCrossings(setup('third_rail', 'metro').scenario, setup('third_rail', 'metro').line),
    ).toHaveLength(0);
    const none = setup('none');
    expect(wireRailCrossings(none.scenario, none.line)).toHaveLength(0);
    const under = setup('overhead', 'tram', -1);
    expect(wireRailCrossings(under.scenario, under.line)).toHaveLength(0);
  });

  it('is shared with another trolleybus line on the same street', () => {
    const { scenario, line } = setup('none');
    const second = createStopLine(scenario, {
      points: [xy(0, 0), xy(500, 0), xy(500, -100)],
      mode: 'trolleybus',
    });
    const summary = wireSummary(second.scenario, second.line!)!;
    expect(summary.sharedWith.map((s) => s.lineId)).toEqual([line.id]);
    expect(summary.sharedWith[0]!.lengthM).toBeGreaterThan(400);
  });
});
