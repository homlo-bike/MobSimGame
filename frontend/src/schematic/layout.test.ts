import { describe, expect, it } from 'vitest';
import { buildDemoScenario } from '../domain/demo';
import { computeSchematic, describeSchematic, isOctilinear, snapAngle } from './layout';
import { orderedStops } from '../domain/network';

describe('schematic layout', () => {
  it('snaps angles to multiples of 45°', () => {
    expect(snapAngle(0.1)).toBe(0);
    expect(snapAngle(Math.PI / 4 + 0.1)).toBeCloseTo(Math.PI / 4);
    expect(snapAngle(-Math.PI / 2 + 0.2)).toBeCloseTo((3 * Math.PI) / 2);
  });

  it('places each station once and keeps interchanges shared', () => {
    const s = buildDemoScenario();
    const layout = computeSchematic(s);
    expect(layout.stations).toHaveLength(s.stations.length);
    const interchanges = layout.stations.filter((x) => x.interchange);
    expect(interchanges.length).toBeGreaterThanOrEqual(3);
  });

  it('preserves station order of each line', () => {
    const s = buildDemoScenario();
    const layout = computeSchematic(s);
    for (const line of s.lines) {
      const geo = orderedStops(line, s.stations).map((o) => o.station.id);
      expect(layout.lines.find((l) => l.id === line.id)!.stationIds).toEqual(geo);
    }
  });

  it('draws only horizontal, vertical and diagonal segments', () => {
    const layout = computeSchematic(buildDemoScenario());
    for (const l of layout.lines) {
      for (let i = 1; i < l.points.length; i++)
        expect(isOctilinear(l.points[i - 1]!, l.points[i]!)).toBe(true);
    }
  });

  it('closes ring lines and applies manual corrections', () => {
    const s = buildDemoScenario();
    const ring = computeSchematic(s).lines.find((l) => l.ring)!;
    expect(ring.points[0]).toEqual(ring.points[ring.points.length - 1]);
    const id = s.stations[0]!.id;
    const other = s.stations[3]!.id;
    const rel = (layout: ReturnType<typeof computeSchematic>) =>
      layout.stations.find((x) => x.id === id)!.x - layout.stations.find((x) => x.id === other)!.x;
    // Positions are normalised to the viewport, so compare relative positions.
    expect(rel(computeSchematic(s, { [id]: { dx: 40, dy: 0 } })) - rel(computeSchematic(s))).toBeCloseTo(40);
  });

  it('produces a text alternative', () => {
    const text = describeSchematic(computeSchematic(buildDemoScenario()));
    expect(text).toMatch(/Red Line/);
    expect(text).toMatch(/interchange/);
    expect(text).toMatch(/ring/);
  });
});
