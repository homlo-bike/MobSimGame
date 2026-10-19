import { describe, expect, it } from 'vitest';
import type { LngLat, Scenario } from './schema';
import { parseProject } from './schema';
import {
  addExistingStationToLine,
  addStationAtChainage,
  addStationOnLine,
  applyNameSuggestion,
  createLine,
  deleteLine,
  deleteStation,
  detectSharedTracks,
  duplicateScenario,
  emptyScenario,
  isInterchange,
  joinLines,
  lineLengthM,
  moveStation,
  orderedStops,
  renameStation,
  splitLine,
  uniqueStationName,
  updateLineGeometry,
} from './network';
import { buildDemoProject } from './demo';
import { validateSegments } from '../geo/segments';

function twoCrossingLines() {
  let s = emptyScenario();
  const a = createLine(s, {
    coordinates: [
      [0, 0],
      [0.02, 0],
    ],
    mode: 'tram',
  });
  s = a.scenario;
  const b = createLine(s, {
    coordinates: [
      [0.01, -0.01],
      [0.01, 0.01],
    ],
    mode: 'bus',
  });
  s = b.scenario;
  return { s, a: a.line, b: b.line };
}

describe('lines', () => {
  it('creates a line with one full-length segment and defaults from the mode', () => {
    const { a } = twoCrossingLines();
    expect(a.segments).toHaveLength(1);
    expect(validateSegments(a.segments)).toEqual([]);
    expect(a.direction).toBe('bidirectional');
    expect(a.termination.kind).toBe('ends');
  });

  it('detects a drawn closed line as a ring and drops the closing vertex', () => {
    const { line } = createLine(emptyScenario(), {
      coordinates: [
        [0, 0],
        [0.01, 0],
        [0.01, 0.01],
        [0, 0],
      ],
      mode: 'light_rail',
    });
    expect(line.termination.kind).toBe('ring');
    expect(line.alignment.kind).toBe('spline');
    if (line.alignment.kind === 'spline') expect(line.alignment.controlPoints).toHaveLength(3);
    // The smooth ring is stored open (first coordinate not repeated).
    expect(line.coordinates[0]).not.toEqual(line.coordinates[line.coordinates.length - 1]);
  });

  it('supports one-way configuration', () => {
    const { s, a } = twoCrossingLines();
    expect(a.direction).toBe('bidirectional');
    const next = {
      ...s,
      lines: s.lines.map((l) => (l.id === a.id ? { ...l, direction: 'one_way' as const } : l)),
    };
    expect(next.lines[0]!.direction).toBe('one_way');
  });
});

describe('stations', () => {
  it('snaps a new station onto the line', () => {
    const { s, a } = twoCrossingLines();
    const res = addStationOnLine(s, a.id, [0.005, 0.0003]);
    expect(res.error).toBeNull();
    expect(res.station!.position[1]).toBeCloseTo(0, 6);
  });

  it('refuses stations too far from the line when a limit is set', () => {
    const { s, a } = twoCrossingLines();
    const res = addStationOnLine(s, a.id, [0.005, 0.01], { maxSnapDistanceM: 100 });
    expect(res.station).toBeNull();
    expect(res.error).toMatch(/from the line/);
  });

  it('shares a station between lines instead of duplicating it', () => {
    const { s, a, b } = twoCrossingLines();
    const r1 = addStationOnLine(s, a.id, [0.01, 0]);
    const r2 = addStationOnLine(r1.scenario, b.id, [0.01, 0.0001]);
    expect(r2.reused).toBe(true);
    expect(r2.station!.id).toBe(r1.station!.id);
    expect(r2.scenario.stations).toHaveLength(1);
    expect(isInterchange(r2.scenario, r1.station!.id)).toBe(true);
  });

  it('can add an existing station to another line explicitly', () => {
    const { s, a, b } = twoCrossingLines();
    const r1 = addStationOnLine(s, a.id, [0.01, 0]);
    const s2 = addExistingStationToLine(r1.scenario, b.id, r1.station!.id);
    expect(s2.lines.find((l) => l.id === b.id)!.stops).toHaveLength(1);
  });

  it('orders stops by chainage regardless of insertion order', () => {
    const { s, a } = twoCrossingLines();
    let sc = addStationOnLine(s, a.id, [0.015, 0]).scenario;
    sc = addStationOnLine(sc, a.id, [0.005, 0]).scenario;
    sc = addStationOnLine(sc, a.id, [0.0, 0]).scenario;
    const ordered = orderedStops(sc.lines[0]!, sc.stations).map((o) => o.station.position[0]);
    expect(ordered).toEqual([...ordered].sort((x, y) => x - y));
    expect(
      sc.lines[0]!.stops.map((st) => sc.stations.find((x) => x.id === st.stationId)!.position[0]),
    ).toEqual(ordered);
  });

  it('adds a station by chainage (non-map alternative)', () => {
    const { s, a } = twoCrossingLines();
    const total = lineLengthM(a);
    const res = addStationAtChainage(s, a.id, total / 2);
    expect(res.station!.position[0]).toBeCloseTo(0.01, 4);
    expect(addStationAtChainage(s, a.id, total + 10).error).toMatch(/between/);
  });

  it('moves a single-line station along its line', () => {
    const { s, a } = twoCrossingLines();
    const r = addStationOnLine(s, a.id, [0.005, 0]);
    const moved = moveStation(r.scenario, r.station!.id, [0.012, 0.002]);
    const st = moved.stations[0]!;
    expect(st.position[0]).toBeCloseTo(0.012, 5);
    expect(st.position[1]).toBeCloseTo(0, 6);
  });

  it('deleting a station removes it from every line', () => {
    const { s, a, b } = twoCrossingLines();
    const r1 = addStationOnLine(s, a.id, [0.01, 0]);
    const r2 = addStationOnLine(r1.scenario, b.id, [0.01, 0]);
    const after = deleteStation(r2.scenario, r1.station!.id);
    expect(after.stations).toHaveLength(0);
    expect(after.lines.every((l) => l.stops.length === 0)).toBe(true);
  });

  it('never overwrites a user-edited name with a suggestion', () => {
    const { s, a } = twoCrossingLines();
    const r = addStationOnLine(s, a.id, [0.01, 0]);
    const named = renameStation(r.scenario, r.station!.id, 'My Name');
    const after = applyNameSuggestion(named, r.station!.id, {
      name: 'Suggested',
      sourceFeature: 'x',
      distanceM: 5,
      provider: 'test',
    });
    expect(after.stations[0]!.name).toBe('My Name');
    const fresh = applyNameSuggestion(r.scenario, r.station!.id, {
      name: 'Suggested',
      sourceFeature: 'x',
      distanceM: 5,
      provider: 'test',
    });
    expect(fresh.stations[0]!.name).toBe('Suggested');
    expect(fresh.stations[0]!.nameSource).toBe('suggestion');
  });

  it('avoids duplicate names with a qualifier', () => {
    const { s, a } = twoCrossingLines();
    const r = addStationOnLine(s, a.id, [0.0, 0], { name: 'Market' });
    expect(uniqueStationName(r.scenario, 'Market', 'Old Town')).toBe('Market (Old Town)');
    expect(uniqueStationName(r.scenario, 'market')).toBe('market 2');
  });
});

describe('editing operations', () => {
  it('splits a line and distributes stops and segments', () => {
    const { s, a } = twoCrossingLines();
    let sc = addStationOnLine(s, a.id, [0.0, 0]).scenario;
    sc = addStationOnLine(sc, a.id, [0.02, 0]).scenario;
    const split = splitLine(sc, a.id, 0.5);
    const parts = split.lines.filter((l) => l.mode === 'tram');
    expect(parts).toHaveLength(2);
    expect(parts[0]!.stops).toHaveLength(1);
    expect(parts[1]!.stops).toHaveLength(1);
    expect(lineLengthM(parts[0]!) + lineLengthM(parts[1]!)).toBeCloseTo(lineLengthM(a), -1);
    for (const p of parts) expect(validateSegments(p.segments)).toEqual([]);
  });

  it('joins two lines end to end, reversing the second if needed', () => {
    let s = emptyScenario();
    const a = createLine(s, {
      coordinates: [
        [0, 0],
        [0.01, 0],
      ],
      mode: 'tram',
    });
    s = a.scenario;
    const b = createLine(s, {
      coordinates: [
        [0.02, 0],
        [0.01, 0],
      ],
      mode: 'tram',
    });
    s = b.scenario;
    const { scenario, error } = joinLines(s, a.line.id, b.line.id);
    expect(error).toBeNull();
    expect(scenario.lines).toHaveLength(1);
    expect(scenario.lines[0]!.coordinates.at(-1)).toEqual([0.02, 0]);
    expect(joinLines(s, a.line.id, a.line.id).error).toBeTruthy();
  });

  it('keeps segment fractions and re-orders stops when geometry changes', () => {
    const { s, a } = twoCrossingLines();
    const sc = addStationOnLine(s, a.id, [0.01, 0]).scenario;
    const updated = updateLineGeometry(sc, a.id, [
      [0, 0],
      [0.01, 0],
      [0.03, 0],
    ] as LngLat[]);
    const edited = updated.lines[0]!;
    expect(edited.alignment.kind === 'spline' && edited.alignment.controlPoints).toHaveLength(3);
    expect(edited.coordinates.length).toBeGreaterThan(3);
    expect(edited.segments[0]!.toFraction).toBe(1);
  });

  it('deleting a line removes shared-track references', () => {
    let s = emptyScenario();
    s = createLine(s, {
      coordinates: [
        [0, 0],
        [0.02, 0],
      ],
      mode: 'tram',
    }).scenario;
    s = createLine(s, {
      coordinates: [
        [0.01, 0],
        [0.02, 0],
        [0.03, 0.01],
      ],
      mode: 'tram',
    }).scenario;
    const shared = detectSharedTracks(s);
    expect(shared).toHaveLength(1);
    const withShared: Scenario = { ...s, sharedTracks: shared };
    expect(deleteLine(withShared, s.lines[0]!.id).sharedTracks).toHaveLength(0);
  });
});

describe('scenarios and projects', () => {
  it('duplicates a scenario with a new id and an independent copy', () => {
    const p = buildDemoProject();
    const d = duplicateScenario(p, p.activeScenarioId);
    expect(d.scenarios).toHaveLength(2);
    expect(d.activeScenarioId).not.toBe(p.activeScenarioId);
    d.scenarios[1]!.lines[0]!.name = 'changed';
    expect(p.scenarios[0]!.lines[0]!.name).not.toBe('changed');
  });

  it('demo project validates and has the required features', () => {
    const p = buildDemoProject();
    expect(parseProject(JSON.parse(JSON.stringify(p))).ok).toBe(true);
    const s = p.scenarios[0]!;
    expect(p.fictional).toBe(true);
    expect(s.lines.length).toBeGreaterThanOrEqual(2);
    expect(s.lines.some((l) => l.termination.kind === 'ring')).toBe(true);
    const structures = new Set(s.lines.flatMap((l) => l.segments.map((g) => g.structure)));
    for (const k of ['at_grade', 'tunnel', 'elevated']) expect(structures.has(k as never)).toBe(true);
    expect(s.stations.some((st) => isInterchange(s, st.id))).toBe(true);
    expect(s.stations.every((st) => st.name.includes('(fictional)'))).toBe(true);
  });

  it('rejects projects with dangling station references', () => {
    const p = buildDemoProject();
    p.scenarios[0]!.lines[0]!.stops.push({ stationId: 'missing' });
    const r = parseProject(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/missing station/);
  });
});
