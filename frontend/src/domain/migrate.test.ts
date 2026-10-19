import { describe, expect, it } from 'vitest';
import { parseProject, SCHEMA_VERSION } from './schema';
import { buildDemoProject } from './demo';

/** A v1 document: lines without alignment, origin, crossovers or signals. */
function v1Project() {
  const p = structuredClone(buildDemoProject()) as unknown as Record<string, unknown>;
  const scenarios = p.scenarios as Record<string, unknown>[];
  for (const sc of scenarios) {
    delete sc.trafficSignals;
    for (const l of sc.lines as Record<string, unknown>[]) {
      l.coordinates =
        (l.alignment as { kind: string; controlPoints?: unknown }).kind === 'spline'
          ? (l.alignment as { controlPoints: unknown }).controlPoints
          : l.coordinates;
      delete l.alignment;
      delete l.origin;
      delete l.crossovers;
      delete l.transitSignalPriority;
      for (const seg of l.segments as Record<string, unknown>[]) delete seg.flipped;
    }
  }
  return { ...p, schemaVersion: 1 } as Record<string, unknown>;
}

describe('schema migration v1 → v2', () => {
  it('converts track lines to smooth curves through their old vertices', () => {
    const v1 = v1Project();
    const oldMetro = (v1.scenarios as { lines: { mode: string; coordinates: unknown[] }[] }[])[0]!.lines.find(
      (l) => l.mode === 'metro',
    )!;
    const res = parseProject(v1);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.project.schemaVersion).toBe(SCHEMA_VERSION);
    const metro = res.project.scenarios[0]!.lines.find((l) => l.mode === 'metro')!;
    expect(metro.alignment.kind).toBe('spline');
    if (metro.alignment.kind === 'spline')
      expect(metro.alignment.controlPoints).toEqual(oldMetro.coordinates);
    expect(metro.coordinates.length).toBeGreaterThan(oldMetro.coordinates.length);
    expect(metro.origin.source).toBe('user');
    expect(metro.segments.every((s) => s.flipped === false)).toBe(true);
  });

  it('turns bus lines into street-routed lines with unrouted legs', () => {
    const res = parseProject(v1Project());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const brt = res.project.scenarios[0]!.lines.find((l) => l.mode === 'brt')!;
    expect(brt.alignment.kind).toBe('routed');
    if (brt.alignment.kind === 'routed') {
      expect(brt.alignment.legs.length).toBe(brt.alignment.waypoints.length - 1);
      expect(brt.alignment.legs.every((l) => l.status === 'unrouted')).toBe(true);
    }
  });

  it('rejects unknown future versions', () => {
    expect(parseProject({ ...v1Project(), schemaVersion: 99 }).ok).toBe(false);
  });
});
