import { describe, expect, it } from 'vitest';
import type { Finding } from './validate';
import { SEVERITY_DEFINITIONS, SEVERITY_ORDER, SEVERITY_PLURALS, validateScenario } from './validate';
import { countBySeverity, findingMode, findingPosition, findingSubject, sortFindings } from './locate';
import { findingsCollection } from '../map/overlays';
import { railLine, xy } from '../test/fixtures/tracks';

const { s, line } = railLine([xy(0, 0), xy(1000, 0)], 'tram', [xy(0, 0), xy(1000, 0)]);
const track = s.trackNetwork.tracks[0]!;
const node = s.trackNetwork.nodes[0]!;
const station = s.stations[0]!;
const f = (p: Partial<Finding>): Finding => ({
  id: 'x',
  severity: 'warning',
  category: 'geometry',
  message: 'm',
  ...p,
});

describe('finding categories', () => {
  it('has a label, plural and definition for every category, most severe first', () => {
    expect(SEVERITY_ORDER).toEqual(['error', 'warning', 'recommendation', 'info']);
    for (const sev of SEVERITY_ORDER) {
      expect(SEVERITY_PLURALS[sev]).toBeTruthy();
      expect(SEVERITY_DEFINITIONS[sev].length).toBeGreaterThan(20);
    }
    expect(SEVERITY_DEFINITIONS.error).toMatch(/requires your action/i);
  });
});

describe('locating findings', () => {
  it('links a finding to its most specific object', () => {
    expect(findingSubject(f({ lineId: line.id, stationId: station.id }))).toEqual({
      kind: 'station',
      id: station.id,
    });
    expect(findingSubject(f({ trackId: track.id, nodeId: node.id }))).toEqual({ kind: 'node', id: node.id });
    expect(findingSubject(f({ trackId: track.id }))).toEqual({ kind: 'track', id: track.id });
    expect(findingSubject(f({ lineId: line.id }))).toEqual({ kind: 'line', id: line.id });
    expect(findingSubject(f({}))).toBeNull();
  });

  it('places a finding at its own position, else at its object', () => {
    expect(findingPosition(f({ position: [1, 2] }), s)).toEqual([1, 2]);
    expect(findingPosition(f({ stationId: station.id }), s)).toEqual(station.position);
    expect(findingPosition(f({ nodeId: node.id }), s)).toEqual(node.position);
    const mid = findingPosition(f({ trackId: track.id }), s)!;
    expect(mid[0]).toBeCloseTo(xy(500, 0)[0], 4);
    expect(findingPosition(f({ lineId: line.id }), s)).not.toBeNull();
    expect(findingPosition(f({}), s)).toBeNull();
    expect(findingMode(f({ trackId: track.id }), s)).toBe('tram');
  });

  it('counts and sorts findings', () => {
    const list = [
      f({ id: 'a', severity: 'info', lineId: line.id }),
      f({ id: 'b', severity: 'error' }),
      f({ id: 'c', severity: 'warning', stationId: station.id }),
    ];
    expect(countBySeverity(list)).toEqual({ error: 1, warning: 1, recommendation: 0, info: 1 });
    expect(sortFindings(list, 'severity', s).map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(sortFindings(list, 'station', s)[0]!.id).toBe('c');
    expect(sortFindings(list, 'line', s)[0]!.id).toBe('a');
  });
});

describe('validation markers', () => {
  it('shows one marker per located finding, hides switched-off categories and marks the focused one', () => {
    const findings = [
      f({ id: 'e', severity: 'error', stationId: station.id }),
      f({ id: 'i', severity: 'info', trackId: track.id }),
      f({ id: 'n', severity: 'warning' }),
    ];
    const all = findingsCollection(
      findings,
      s,
      { error: true, warning: true, recommendation: true, info: true },
      'e',
    );
    expect(all.features.map((x) => x.properties!.findingId)).toEqual(['e', 'i']);
    expect(all.features[0]!.properties!.focused).toBe(true);
    expect(all.features[0]!.properties!.label).toMatch(/^Error: /);
    const noInfo = findingsCollection(
      findings,
      s,
      { error: true, warning: true, recommendation: true, info: false },
      null,
    );
    expect(noInfo.features.map((x) => x.properties!.findingId)).toEqual(['e']);
  });

  it('places markers for every real finding of a scenario', () => {
    const fs = validateScenario(s);
    const fc = findingsCollection(
      fs,
      s,
      { error: true, warning: true, recommendation: true, info: true },
      null,
    );
    expect(fc.features.length).toBeGreaterThan(0);
    for (const x of fc.features) expect(x.properties!.severity).toMatch(/error|warning|recommendation|info/);
  });
});
