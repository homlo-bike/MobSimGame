import { describe, expect, it } from 'vitest';
import type { LngLat, Scenario, TransportLine } from '../domain/schema';
import { addStationOnLine, createLine, emptyScenario, updateLine } from '../domain/network';
import { buildDemoScenario } from '../domain/demo';
import { MODE_PROFILES } from '../domain/modeProfiles';
import {
  gradeSummary,
  isLineComplete,
  segmentGrades,
  validateLine,
  validateScenario,
  type Finding,
} from './validate';

function lineWith(coords: LngLat[], mode: TransportLine['mode'] = 'tram', stations: LngLat[] = []) {
  let s: Scenario = emptyScenario();
  const r = createLine(s, { coordinates: coords, mode });
  s = r.scenario;
  for (const p of stations) s = addStationOnLine(s, r.line.id, p).scenario;
  return { s, line: s.lines.find((l) => l.id === r.line.id)! };
}

const blocking = (f: Finding[]) => f.filter((x) => x.severity === 'blocking');

describe('terminal and loop validation', () => {
  it('blocks a line without terminal stations', () => {
    const { s, line } = lineWith([
      [0, 0],
      [0.01, 0],
    ]);
    const f = validateLine(line, s);
    expect(blocking(f).length).toBeGreaterThan(0);
    expect(isLineComplete(line, s)).toBe(false);
  });

  it('accepts a line with terminal stations at both ends', () => {
    const { s, line } = lineWith(
      [
        [0, 0],
        [0.01, 0],
      ],
      'tram',
      [
        [0, 0],
        [0.01, 0],
      ],
    );
    expect(blocking(validateLine(line, s))).toEqual([]);
    expect(isLineComplete(line, s)).toBe(true);
  });

  it('blocks when only one end has a station', () => {
    const { s, line } = lineWith(
      [
        [0, 0],
        [0.02, 0],
      ],
      'tram',
      [
        [0, 0],
        [0.01, 0],
      ],
    );
    const f = blocking(validateLine(line, s));
    expect(f).toHaveLength(1);
    expect(f[0]!.message).toMatch(/end of the line/);
  });

  it('accepts a ring without terminal stations at the ends', () => {
    const { s, line } = lineWith(
      [
        [0, 0],
        [0.01, 0],
        [0.01, 0.01],
        [0, 0.01],
        [0, 0],
      ],
      'light_rail',
      [
        [0.005, 0],
        [0.01, 0.005],
        [0, 0.005],
      ],
    );
    expect(line.termination.kind).toBe('ring');
    expect(blocking(validateLine(line, s))).toEqual([]);
  });

  it('validates a user-defined loop ending', () => {
    // The line runs east then loops back to touch itself.
    const coords: LngLat[] = [
      [0, 0],
      [0.02, 0],
      [0.025, 0.004],
      [0.02, 0.008],
      [0.015, 0.004],
      [0.015, 0],
    ];
    const { s, line } = lineWith(coords, 'tram', [
      [0, 0],
      [0.02, 0],
    ]);
    const looped = updateLine(s, line.id, { termination: { kind: 'loop', note: '' } });
    const l = looped.lines[0]!;
    expect(blocking(validateLine(l, looped))).toEqual([]);
    const notLooped = updateLine(looped, line.id, {
      coordinates: [
        [0, 0],
        [0.02, 0],
        [0.03, 0.01],
      ],
    });
    expect(
      blocking(validateLine(notLooped.lines[0]!, notLooped)).some((f) => f.message.includes('loop')),
    ).toBe(true);
  });

  it('blocks invalid geometry', () => {
    const { s, line } = lineWith([
      [0, 0],
      [0.01, 0],
    ]);
    const broken = { ...line, coordinates: [[0, 0]] as LngLat[] };
    expect(blocking(validateLine(broken, s))[0]!.category).toBe('geometry');
  });
});

describe('mode profile validation', () => {
  it('profiles are versioned and flagged as uncited placeholders', () => {
    for (const p of Object.values(MODE_PROFILES)) {
      expect(p.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(p.cited).toBe(false);
      expect(p.minCurveRadiusM.absoluteLimit).toBeNull();
    }
  });

  it('warns about sharp curves for rail modes', () => {
    // A right-angle corner with short legs → very small radius.
    const { s, line } = lineWith(
      [
        [0, 0],
        [0.001, 0],
        [0.001, 0.001],
      ],
      'metro',
      [
        [0, 0],
        [0.001, 0.001],
      ],
    );
    const f = validateLine(line, s).filter((x) => x.category === 'curve_radius');
    expect(f.some((x) => x.severity === 'warning')).toBe(true);
    expect(f[0]!.message).toMatch(/placeholder/);
  });

  it('does not warn about curves on a straight line', () => {
    const { s, line } = lineWith(
      [
        [0, 0],
        [0.01, 0],
        [0.02, 0],
      ],
      'metro',
      [
        [0, 0],
        [0.02, 0],
      ],
    );
    expect(validateLine(line, s).filter((x) => x.category === 'curve_radius')).toEqual([]);
  });

  it('warns about steep grades when elevation is available', () => {
    const { s, line } = lineWith(
      [
        [0, 0],
        [0.01, 0],
      ],
      'metro',
      [
        [0, 0],
        [0.01, 0],
      ],
    );
    const elevation = {
      [line.id]: [
        { chainageM: 0, elevationM: 0 },
        { chainageM: 500, elevationM: 40 },
        { chainageM: 1112, elevationM: 40 },
      ],
    };
    const f = validateLine(line, s, { elevation }).filter((x) => x.category === 'grade');
    expect(f.some((x) => x.severity === 'warning')).toBe(true);
  });

  it('says grades were not checked without elevation data', () => {
    const { s, line } = lineWith(
      [
        [0, 0],
        [0.01, 0],
      ],
      'metro',
      [
        [0, 0],
        [0.01, 0],
      ],
    );
    expect(validateLine(line, s).some((x) => x.category === 'grade' && x.severity === 'info')).toBe(true);
  });

  it('warns that bus alignments are not routed', () => {
    const { s, line } = lineWith(
      [
        [0, 0],
        [0.01, 0],
      ],
      'bus',
      [
        [0, 0],
        [0.01, 0],
      ],
    );
    expect(
      validateLine(line, s).some(
        (x) => x.category === 'road_compatibility' && /not been routed/.test(x.message),
      ),
    ).toBe(true);
  });

  it('flags stops that are too close', () => {
    const { s, line } = lineWith(
      [
        [0, 0],
        [0.01, 0],
      ],
      'metro',
      [
        [0, 0],
        [0.001, 0],
        [0.01, 0],
      ],
    );
    expect(validateLine(line, s).some((x) => x.category === 'stop_spacing' && x.severity === 'warning')).toBe(
      true,
    );
  });
});

describe('grade summary', () => {
  it('computes max, mean and cumulative gain', () => {
    const p = [
      { chainageM: 0, elevationM: 10 },
      { chainageM: 100, elevationM: 13 },
      { chainageM: 200, elevationM: 12 },
    ];
    expect(segmentGrades(p).map((g) => g.gradePercent)).toEqual([3, -1]);
    const s = gradeSummary(p);
    expect(s.maxGradePercent).toBe(3);
    expect(s.meanGradePercent).toBe(2);
    expect(s.cumulativeGainM).toBe(3);
  });
});

describe('demo scenario', () => {
  it('has no blocking findings', () => {
    const s = buildDemoScenario();
    expect(blocking(validateScenario(s))).toEqual([]);
  });
});
