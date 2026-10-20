import { describe, expect, it } from 'vitest';
import { buildDemoProject } from '../test/fixtures/demoProject';
import { blankProject } from '../store/projectStore';
import { fullExport, FULL_EXPORT_FORMAT } from './fullExport';

const meta = {
  appVersion: '0.0.0-test',
  buildTime: '2026-10-20T00:00:00Z',
  exportedAt: '2026-10-20T12:00:00Z',
};

describe('full export', () => {
  it('contains the project, every calculated value and the metadata to judge them', () => {
    const project = buildDemoProject();
    const out = fullExport(project, meta);
    expect(out.format).toBe(FULL_EXPORT_FORMAT);
    expect(out.metadata.appVersion).toBe('0.0.0-test');
    expect(out.metadata.attribution.some((a) => a.includes('OpenStreetMap'))).toBe(true);
    expect(out.project).toBe(project);
    const sc = out.scenarios[0]!;
    expect(sc.parameters.length).toBeGreaterThan(5);
    expect(sc.parameters.every((p) => p.source && p.status)).toBe(true);
    expect(sc.lines.length).toBe(project.scenarios[0]!.lines.length);
    const line = sc.lines[0]!;
    expect(line.lengthM).toBeGreaterThan(0);
    expect(line.stops.length).toBeGreaterThan(1);
    expect(line.simulatedRoundTripS).toBeGreaterThan(0);
    expect(line.rates.accelMs2).toBeGreaterThan(0);
    expect(Array.isArray(sc.findings)).toBe(true);
    // The fictional demo carries its synthetic analysis, labelled.
    expect(sc.demonstrationAnalysis?.status).toBe('demonstration');
    // Everything survives JSON.
    expect(() => JSON.parse(JSON.stringify(out))).not.toThrow();
  });

  it('never adds synthetic figures to a real-place project', () => {
    const out = fullExport({ ...blankProject(), fictional: false }, meta);
    expect(out.scenarios.every((s) => s.demonstrationAnalysis === null)).toBe(true);
  });
});
